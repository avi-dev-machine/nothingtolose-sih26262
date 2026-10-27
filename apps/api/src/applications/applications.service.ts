import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClockEventType, ClockOwner } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';

@Injectable()
export class ApplicationsService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService, private readonly queues: QueueService) {}

  async create(actor: Actor, input: { institutionId: string; academicYear: string; track: string; programme: string; coursesRequested: Array<{ name: string; level: string; proposedIntake: number; currentIntake?: number }>; remarks?: string }) {
    if (actor.role !== 'INSTITUTION') throw new ForbiddenException('Only an institution account may create an application');
    if (actor.institutionId !== input.institutionId) throw new ForbiddenException('You can create applications only for your own institution');
    const institution = await this.database.db.selectFrom('institutions').select(['id', 'region_id']).where('id', '=', input.institutionId).executeTakeFirst();
    if (!institution) throw new BadRequestException('Institution does not exist');
    const application = await this.database.db.transaction().execute(async (trx) => {
      const applicationNumber = await this.nextApplicationNumber(input.academicYear);
      const row = await trx.insertInto('applications').values({ application_number: applicationNumber, academic_year: input.academicYear, institution_id: input.institutionId, region_id: institution.region_id, track: input.track, state: 'DRAFT', programme: input.programme, courses_data: input.coursesRequested, metadata: { remarks: input.remarks ?? null } }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('clock_events').values({ application_id: row.id, event_type: ClockEventType.CLOCK_STARTED, active_clock: ClockOwner.INSTITUTION, timestamp: new Date(), trigger_source: 'INSTITUTION', remarks: 'Application draft created' }).execute();
      await this.audit.append(trx, actor, { action: AuditAction.APPLICATION_CREATED, targetEntity: 'APPLICATION', targetId: row.id, payload: { applicationNumber, track: input.track, academicYear: input.academicYear, programme: input.programme } });
      const outbox = await trx.insertInto('outbox_events').values({ topic: 'APPLICATION_CREATED', aggregate_type: 'APPLICATION', aggregate_id: row.id, payload: { applicationId: row.id, applicationNumber, institutionId: row.institution_id, regionId: row.region_id } }).returning('id').executeTakeFirstOrThrow();
      return { row, outboxId: outbox.id };
    });
    await this.queues.publishOutbox(application.outboxId);
    return application.row;
  }

  async list(actor: Actor, input: { page?: number; limit?: number; state?: string; track?: string; regionId?: string; institutionId?: string; search?: string }) {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    let query = this.database.db.selectFrom('applications').innerJoin('institutions', 'institutions.id', 'applications.institution_id').select([
      'applications.id', 'applications.application_number', 'applications.academic_year', 'applications.track', 'applications.state', 'applications.programme', 'applications.institution_id', 'applications.region_id', 'applications.assigned_scrutiny_officer_id', 'applications.created_at', 'applications.updated_at', 'institutions.name as institution_name',
    ]);
    let countQuery = this.database.db.selectFrom('applications').select((eb) => eb.fn.countAll<number>().as('count'));
    const applyFilters = <T extends typeof query | typeof countQuery>(builder: T): T => {
      let filtered: any = builder;
      if (actor.role === 'INSTITUTION') filtered = filtered.where('applications.institution_id', '=', actor.institutionId ?? '');
      else if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) filtered = filtered.where('applications.region_id', '=', actor.regionId);
      if (input.state) filtered = filtered.where('applications.state', '=', input.state);
      if (input.track) filtered = filtered.where('applications.track', '=', input.track);
      if (input.regionId) filtered = filtered.where('applications.region_id', '=', input.regionId);
      if (input.institutionId) filtered = filtered.where('applications.institution_id', '=', input.institutionId);
      if (input.search) filtered = filtered.where((eb: any) => eb.or([eb('applications.application_number', 'ilike', `%${input.search}%`), eb('applications.programme', 'ilike', `%${input.search}%`)]));
      return filtered;
    };
    query = applyFilters(query);
    countQuery = applyFilters(countQuery);
    const [items, total] = await Promise.all([query.orderBy('applications.updated_at', 'desc').limit(limit).offset((page - 1) * limit).execute(), countQuery.executeTakeFirstOrThrow()]);
    return { items, total: Number(total.count), page, limit, totalPages: Math.ceil(Number(total.count) / limit), hasNext: page * limit < Number(total.count), hasPrev: page > 1 };
  }

  async get(actor: Actor, id: string) {
    const row = await this.database.db.selectFrom('applications').innerJoin('institutions', 'institutions.id', 'applications.institution_id').selectAll('applications').select(['institutions.name as institution_name', 'institutions.code as institution_code']).where('applications.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Application not found');
    this.assertScope(actor, row.institution_id, row.region_id);
    return row;
  }

  async assign(actor: Actor, applicationId: string, assigneeId: string, dueAt?: string) {
    if (!['ADMIN', 'BUREAU_OFFICER', 'REGIONAL_OFFICER'].includes(actor.role)) throw new ForbiddenException('Only an officer may assign scrutiny work');
    return this.database.db.transaction().execute(async (trx) => {
      const app = await trx.selectFrom('applications').selectAll().where('id', '=', applicationId).forUpdate().executeTakeFirst();
      if (!app) throw new NotFoundException('Application not found');
      this.assertScope(actor, app.institution_id, app.region_id);
      const assignee = await trx.selectFrom('users').select(['id', 'role', 'region_id']).where('id', '=', assigneeId).executeTakeFirst();
      if (!assignee || assignee.role !== 'SCRUTINY_OFFICER') throw new BadRequestException('Assignee must be an existing scrutiny officer');
      if (assignee.region_id && assignee.region_id !== app.region_id) throw new BadRequestException('Assignee must belong to the application region');
      await trx.updateTable('applications').set({ assigned_scrutiny_officer_id: assigneeId, updated_at: new Date() }).where('id', '=', applicationId).execute();
      const task = await trx.insertInto('task_assignments').values({ application_id: applicationId, assignee_id: assigneeId, assigned_by: actor.id, task_type: 'SCRUTINY', due_at: dueAt ? new Date(dueAt) : null }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.SCRUTINY_ASSIGNED, targetEntity: 'APPLICATION', targetId: applicationId, payload: { assigneeId, taskId: task.id, dueAt: dueAt ?? null } });
      return task;
    });
  }

  private async nextApplicationNumber(academicYear: string): Promise<string> {
    const count = await this.database.db.selectFrom('applications').select((eb) => eb.fn.countAll<number>().as('count')).where('academic_year', '=', academicYear).executeTakeFirstOrThrow();
    return `AICTE-${academicYear.replace('-', '')}-${String(Number(count.count) + 1).padStart(6, '0')}`;
  }

  private assertScope(actor: Actor, institutionId: string, regionId: string) {
    if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) throw new ForbiddenException('Application belongs to another institution');
    if (!['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Application is outside your regional scope');
  }
}
