import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { ClockService } from '../clock/clock.service.js';
import { ValidationEngineService, ValidationResult } from './validation-engine.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly clock: ClockService,
    private readonly validationEngine: ValidationEngineService,
    private readonly workflow: WorkflowService,
  ) {}

  async create(actor: Actor, input: {
    institutionId: string;
    academicYear?: string;
    track: string;
    programme?: string;
    program?: string;
    coursesRequested?: Array<{ name: string; level: string; proposedIntake: number; currentIntake?: number }>;
    formData?: Record<string, unknown>;
    remarks?: string;
  }) {
    if (actor.role !== 'INSTITUTION') throw new ForbiddenException('Only an institution account may create an application');
    if (actor.institutionId !== input.institutionId) throw new ForbiddenException('You can create applications only for your own institution');

    const institution = await this.database.db
      .selectFrom('institutions')
      .selectAll()
      .where('id', '=', input.institutionId)
      .executeTakeFirst();

    if (!institution) throw new BadRequestException('Institution does not exist');

    const academicYear = input.academicYear || '2026-27';
    const now = this.clock.now();

    const application = await this.database.db.transaction().execute(async (trx) => {
      const refNo = await this.nextRefNo(academicYear);

      const row = await trx
        .insertInto('applications')
        .values({
          ref_no: refNo,
          application_number: refNo,
          academic_year: academicYear,
          institution_id: input.institutionId,
          region_id: institution.region_id,
          track: input.track as any,
          state: 'DRAFT',
          programme: input.programme || input.program || 'ENGINEERING_AND_TECHNOLOGY',
          courses_data: input.coursesRequested || (input.formData?.courses as any) || [],
          version: 1,
          state_entered_at: now,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Store initial draft form data
      const formData = input.formData || {
        program: input.programme || input.program,
        courses: input.coursesRequested || [],
        remarks: input.remarks,
      };

      await trx
        .insertInto('application_forms')
        .values({
          application_id: row.id,
          version: 1,
          data: formData as any,
          valid: false,
          validation_report: {} as any,
        })
        .execute();

      await this.audit.append(trx, actor, {
        action: AuditAction.APPLICATION_CREATED,
        entityType: 'APPLICATION',
        entityId: row.id,
        applicationId: row.id,
        payload: { refNo, track: input.track, academicYear },
      });

      const outbox = await trx
        .insertInto('outbox_events')
        .values({
          topic: 'APPLICATION_CREATED',
          aggregate_type: 'APPLICATION',
          aggregate_id: row.id,
          payload: { applicationId: row.id, refNo, institutionId: row.institution_id },
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return { row, outboxId: outbox.id };
    });

    await this.queues.publishOutbox(application.outboxId);
    return application.row;
  }

  async updateDraft(
    actor: Actor,
    applicationId: string,
    formData: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const app = await this.database.db
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();

    if (!app) throw new NotFoundException('Application not found');
    this.assertScope(actor, app.institution_id, (app as any).region_id);

    if (app.state !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT applications can have their forms updated directly');
    }

    if (expectedVersion !== undefined && app.version !== expectedVersion) {
      throw new ConflictException(
        `Application draft version conflict: expected version ${expectedVersion}, but found version ${app.version}`,
      );
    }

    const now = this.clock.now();
    const newVersion = app.version + 1;

    return this.database.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('applications')
        .set({
          version: newVersion,
          updated_at: now,
        })
        .where('id', '=', applicationId)
        .execute();

      await trx
        .insertInto('application_forms')
        .values({
          application_id: applicationId,
          version: newVersion,
          data: formData as any,
          valid: false,
          validation_report: {} as any,
        })
        .execute();

      await this.audit.append(trx, actor, {
        action: 'DRAFT_FORM_UPDATED',
        entityType: 'APPLICATION',
        entityId: applicationId,
        applicationId,
        payload: { version: newVersion },
      });

      return { applicationId, version: newVersion, updatedAt: now.toISOString() };
    });
  }

  async validate(actor: Actor, applicationId: string): Promise<ValidationResult> {
    const app = await this.database.db
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();

    if (!app) throw new NotFoundException('Application not found');
    this.assertScope(actor, app.institution_id, (app as any).region_id);

    return this.validationEngine.validateApplication(applicationId);
  }

  async submit(actor: Actor, applicationId: string, expectedVersion?: number) {
    const validation = await this.validate(actor, applicationId);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Submission blocked: application has failing validation checks or missing mandatory documents',
        details: validation.errors,
      });
    }

    return this.workflow.transition({
      applicationId,
      action: 'SUBMIT',
      actor,
      reason: 'Application submitted by institution after full compliance check',
      expectedVersion,
    });
  }

  async list(actor: Actor, input: {
    page?: number;
    limit?: number;
    cursor?: string;
    state?: string;
    track?: string;
    regionId?: string;
    institutionId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = input.page ?? 1;
    const limit = Math.min(input.limit ?? 20, 100);

    let query = this.database.db
      .selectFrom('applications')
      .innerJoin('institutions', 'institutions.id', 'applications.institution_id')
      .selectAll('applications')
      .select(['institutions.name as institution_name', 'institutions.code as institution_code']);

    let countQuery = this.database.db
      .selectFrom('applications')
      .select((eb) => eb.fn.countAll<number>().as('count'));

    const applyFilters = (qb: any) => {
      let filtered = qb;
      if (actor.role === 'INSTITUTION') {
        filtered = filtered.where('applications.institution_id', '=', actor.institutionId ?? '');
      } else if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) {
        filtered = filtered.where('applications.region_id', '=', actor.regionId);
      }
      if (input.state) filtered = filtered.where('applications.state', '=', input.state);
      if (input.track) filtered = filtered.where('applications.track', '=', input.track);
      if (input.regionId) filtered = filtered.where('applications.region_id', '=', input.regionId);
      if (input.institutionId) filtered = filtered.where('applications.institution_id', '=', input.institutionId);
      if (input.search) {
        filtered = filtered.where((eb: any) =>
          eb.or([
            eb('applications.ref_no', 'ilike', `%${input.search}%`),
            eb('institutions.name', 'ilike', `%${input.search}%`),
          ]),
        );
      }
      return filtered;
    };

    query = applyFilters(query);
    countQuery = applyFilters(countQuery);

    const sortCol = input.sortBy || 'applications.updated_at';
    const sortDir = input.sortOrder || 'desc';

    const [items, total] = await Promise.all([
      query.orderBy(sortCol as any, sortDir).limit(limit).offset((page - 1) * limit).execute(),
      countQuery.executeTakeFirstOrThrow(),
    ]);

    const totalCount = Number(total.count);
    return {
      items,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      hasNext: page * limit < totalCount,
      hasPrev: page > 1,
    };
  }

  async get(actor: Actor, id: string) {
    const row = await this.database.db
      .selectFrom('applications')
      .innerJoin('institutions', 'institutions.id', 'applications.institution_id')
      .selectAll('applications')
      .select(['institutions.name as institution_name', 'institutions.code as institution_code'])
      .where('applications.id', '=', id)
      .executeTakeFirst();

    if (!row) throw new NotFoundException('Application not found');
    this.assertScope(actor, row.institution_id, (row as any).region_id);

    const latestForm = await this.database.db
      .selectFrom('application_forms')
      .selectAll()
      .where('application_id', '=', id)
      .orderBy('version', 'desc')
      .executeTakeFirst();

    return {
      ...row,
      form: latestForm ? { data: latestForm.data, valid: latestForm.valid, validationReport: latestForm.validation_report } : null,
    };
  }

  private async nextRefNo(academicYear: string): Promise<string> {
    const count = await this.database.db
      .selectFrom('applications')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return `AICTE-${academicYear.replace('-', '')}-${String(Number(count.count) + 1).padStart(6, '0')}`;
  }

  private assertScope(actor: Actor, institutionId: string, regionId?: string) {
    if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) {
      throw new ForbiddenException('Application belongs to another institution');
    }
    if (!['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && regionId && actor.regionId !== regionId) {
      throw new ForbiddenException('Application is outside your regional scope');
    }
  }
}
