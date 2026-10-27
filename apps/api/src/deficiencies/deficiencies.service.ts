import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type ResolveDeficiencyDto, type RespondDeficiencyDto } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';

@Injectable()
export class DeficienciesService {
  constructor(private readonly database: DatabaseService, private readonly workflow: WorkflowService, private readonly audit: AuditService) {}

  async create(actor: Actor, input: { applicationId: string; clauseId: string; clauseTitle: string; category: string; description: string; requiredDocuments?: string[]; deadlineDays?: number }) {
    this.requireOfficer(actor);
    const result = await this.database.db.transaction().execute(async (trx) => {
      const app = await trx.selectFrom('applications').selectAll().where('id', '=', input.applicationId).forUpdate().executeTakeFirst();
      if (!app) throw new NotFoundException('Application not found');
      this.assertScope(actor, app.region_id);
      if (app.state !== 'UNDER_SCRUTINY') throw new BadRequestException('Deficiencies can only be raised during scrutiny');
      const requiredDocuments = input.requiredDocuments ?? [];
      const deadline = new Date(Date.now() + (input.deadlineDays ?? 7) * 86_400_000);
      const deficiency = await trx.insertInto('deficiencies').values({ application_id: app.id, clause_id: input.clauseId, clause_title: input.clauseTitle, category: input.category, description: input.description, required_documents: requiredDocuments, deadline_at: deadline }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.DEFICIENCY_ISSUED, targetEntity: 'DEFICIENCY', targetId: deficiency.id, payload: { applicationId: app.id, clauseId: input.clauseId, deadlineAt: deadline.toISOString(), requiredDocuments } });
      return { deficiency, transition: await this.workflow.transitionInTransaction(trx, app.id, actor, { targetState: 'DEFICIENCY_RAISED', reason: `Deficiency ${input.clauseId} issued: ${input.description}`, metadata: { deficiencyId: deficiency.id } }) };
    });
    // transitionInTransaction writes a durable outbox row. The periodic outbox dispatcher handles delivery if Redis is unavailable.
    return result.deficiency;
  }

  async respond(actor: Actor, input: RespondDeficiencyDto) {
    if (actor.role !== 'INSTITUTION') throw new ForbiddenException('Only the institution may respond to a deficiency');
    return this.database.db.transaction().execute(async (trx) => {
      const deficiency = await trx.selectFrom('deficiencies').innerJoin('applications', 'applications.id', 'deficiencies.application_id').selectAll('deficiencies').select(['applications.institution_id', 'applications.state']).where('deficiencies.id', '=', input.deficiencyId).forUpdate().executeTakeFirst();
      if (!deficiency) throw new NotFoundException('Deficiency not found');
      if (deficiency.institution_id !== actor.institutionId) throw new ForbiddenException('Deficiency belongs to another institution');
      if (deficiency.status !== 'OPEN') throw new BadRequestException('Only open deficiencies can be responded to');
      const documents = await trx.selectFrom('documents').select(['id', 'application_id']).where('id', 'in', input.uploadedDocumentIds).execute();
      if (documents.length !== input.uploadedDocumentIds.length || documents.some((document) => document.application_id !== deficiency.application_id)) throw new BadRequestException('Every response document must belong to the application');
      const updated = await trx.updateTable('deficiencies').set({ status: 'RESPONDED', response_note: input.responseNote, response_documents: input.uploadedDocumentIds, responded_at: new Date(), updated_at: new Date() }).where('id', '=', deficiency.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.DEFICIENCY_RESOLVED, targetEntity: 'DEFICIENCY', targetId: deficiency.id, payload: { responseNote: input.responseNote, documentIds: input.uploadedDocumentIds, status: 'RESPONDED' } });
      await this.workflow.transitionInTransaction(trx, deficiency.application_id, actor, { targetState: 'RESUBMITTED', reason: `Institution responded to deficiency ${deficiency.clause_id}`, metadata: { deficiencyId: deficiency.id } });
      return updated;
    });
  }

  async resolve(actor: Actor, input: ResolveDeficiencyDto) {
    this.requireOfficer(actor);
    return this.database.db.transaction().execute(async (trx) => {
      const deficiency = await trx.selectFrom('deficiencies').innerJoin('applications', 'applications.id', 'deficiencies.application_id').selectAll('deficiencies').select(['applications.region_id', 'applications.state']).where('deficiencies.id', '=', input.deficiencyId).forUpdate().executeTakeFirst();
      if (!deficiency) throw new NotFoundException('Deficiency not found');
      this.assertScope(actor, deficiency.region_id);
      if (deficiency.status !== 'RESPONDED' || deficiency.state !== 'RESUBMITTED') throw new BadRequestException('A deficiency must be responded to while the application is resubmitted');
      const status = input.status === 'ACCEPTED' ? 'RESOLVED' : 'OPEN';
      const updated = await trx.updateTable('deficiencies').set({ status, resolved_by: input.status === 'ACCEPTED' ? actor.id : null, resolved_at: input.status === 'ACCEPTED' ? new Date() : null, resolution_remarks: input.resolutionRemarks, updated_at: new Date() }).where('id', '=', deficiency.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.DEFICIENCY_RESOLVED, targetEntity: 'DEFICIENCY', targetId: deficiency.id, payload: { status: input.status, resolutionRemarks: input.resolutionRemarks } });
      await this.workflow.transitionInTransaction(trx, deficiency.application_id, actor, { targetState: input.status === 'ACCEPTED' ? 'UNDER_SCRUTINY' : 'DEFICIENCY_RAISED', reason: `Deficiency response ${input.status.toLowerCase()}: ${input.resolutionRemarks}`, metadata: { deficiencyId: deficiency.id } });
      return updated;
    });
  }

  async list(actor: Actor, applicationId: string) {
    const app = await this.database.db.selectFrom('applications').select(['institution_id', 'region_id']).where('id', '=', applicationId).executeTakeFirst();
    if (!app) throw new NotFoundException('Application not found');
    if (actor.role === 'INSTITUTION' && app.institution_id !== actor.institutionId) throw new ForbiddenException('Application belongs to another institution');
    this.assertScope(actor, app.region_id);
    return this.database.db.selectFrom('deficiencies').selectAll().where('application_id', '=', applicationId).orderBy('created_at', 'desc').execute();
  }

  private requireOfficer(actor: Actor) { if (!['SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'BUREAU_OFFICER', 'ADMIN'].includes(actor.role)) throw new ForbiddenException('An authorised officer is required'); }
  private assertScope(actor: Actor, regionId: string) { if (!['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Application is outside your regional scope'); }
}
