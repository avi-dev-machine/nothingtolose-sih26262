import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type ScheduleEvcDto, type SubmitEvcReportDto } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';

@Injectable()
export class EvcService {
  constructor(private readonly database: DatabaseService, private readonly workflow: WorkflowService, private readonly audit: AuditService) {}

  async schedule(actor: Actor, input: ScheduleEvcDto) {
    if (!['REGIONAL_OFFICER', 'BUREAU_OFFICER', 'ADMIN'].includes(actor.role)) throw new ForbiddenException('Only a regional or bureau officer may schedule an EVC');
    if (!input.memberIds.includes(input.leadMemberId)) throw new BadRequestException('The EVC lead must be one of the selected members');
    if (new Date(input.scheduledDate) <= new Date()) throw new BadRequestException('EVC visits must be scheduled in the future');
    return this.database.db.transaction().execute(async (trx) => {
      const app = await trx.selectFrom('applications').selectAll().where('id', '=', input.applicationId).forUpdate().executeTakeFirst();
      if (!app) throw new NotFoundException('Application not found');
      this.assertOfficerScope(actor, app.region_id);
      if (app.state !== 'EVC_REQUIRED') throw new BadRequestException('Application is not awaiting an EVC visit');
      const members = await trx.selectFrom('users').select(['id', 'role', 'region_id']).where('id', 'in', input.memberIds).execute();
      if (members.length !== input.memberIds.length || members.some((member) => member.role !== 'EVC_MEMBER' || (member.region_id && member.region_id !== app.region_id))) throw new BadRequestException('All committee members must be EVC members assigned to this region');
      const visit = await trx.insertInto('evc_visits').values({ application_id: app.id, scheduled_date: new Date(input.scheduledDate), lead_member_id: input.leadMemberId, members: input.memberIds, special_instructions: input.specialInstructions ?? null }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.EVC_COMMITTEE_FORMED, targetEntity: 'EVC_REPORT', targetId: visit.id, payload: { applicationId: app.id, leadMemberId: input.leadMemberId, memberIds: input.memberIds, scheduledDate: input.scheduledDate } });
      await this.workflow.transitionInTransaction(trx, app.id, actor, { targetState: 'EVC_SCHEDULED', reason: `EVC scheduled for ${input.scheduledDate}`, metadata: { evcVisitId: visit.id } });
      return visit;
    });
  }

  async start(actor: Actor, applicationId: string) {
    if (!['EVC_MEMBER', 'REGIONAL_OFFICER'].includes(actor.role)) throw new ForbiddenException('Only EVC members can start an inspection');
    return this.workflow.transition(applicationId, actor, { targetState: 'EVC_IN_PROGRESS', reason: 'EVC inspection started by authorised member' });
  }

  async submit(actor: Actor, input: SubmitEvcReportDto) {
    if (actor.role !== 'EVC_MEMBER') throw new ForbiddenException('Only an EVC member may submit an inspection report');
    return this.database.db.transaction().execute(async (trx) => {
      const visit = await trx.selectFrom('evc_visits').innerJoin('applications', 'applications.id', 'evc_visits.application_id').selectAll('evc_visits').select(['applications.region_id', 'applications.state']).where('evc_visits.application_id', '=', input.applicationId).where('evc_visits.status', 'in', ['SCHEDULED', 'IN_PROGRESS']).forUpdate().executeTakeFirst();
      if (!visit) throw new NotFoundException('Active EVC visit not found');
      const members = Array.isArray(visit.members) ? visit.members : [];
      if (!members.includes(actor.id)) throw new ForbiddenException('You are not assigned to this EVC visit');
      if (visit.state !== 'EVC_IN_PROGRESS') throw new BadRequestException('The EVC inspection must be started before reporting');
      const photos = await trx.selectFrom('documents').select(['id', 'application_id']).where('id', 'in', input.photoDocumentIds).execute();
      if (photos.length !== input.photoDocumentIds.length || photos.some((photo) => photo.application_id !== input.applicationId)) throw new BadRequestException('All EVC photos must be attached to the application');
      const report = await trx.updateTable('evc_visits').set({ status: 'COMPLETED', geo_latitude: input.geoLatitude, geo_longitude: input.geoLongitude, geo_accuracy_meters: input.geoAccuracyMeters ?? null, checklist_results: input.checklistResults, recommendation: input.overallRecommendation, justification: input.justification, photo_document_ids: input.photoDocumentIds, report_submitted_at: new Date(), updated_at: new Date() }).where('id', '=', visit.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.EVC_REPORT_SUBMITTED, targetEntity: 'EVC_REPORT', targetId: visit.id, payload: { applicationId: input.applicationId, recommendation: input.overallRecommendation, checklistItems: input.checklistResults.length, geo: { latitude: input.geoLatitude, longitude: input.geoLongitude, accuracyMeters: input.geoAccuracyMeters ?? null } } });
      await this.workflow.transitionInTransaction(trx, input.applicationId, actor, { targetState: 'EVC_COMPLETED', reason: 'Digital EVC inspection report submitted', metadata: { evcVisitId: visit.id, recommendation: input.overallRecommendation } });
      return report;
    });
  }

  private assertOfficerScope(actor: Actor, regionId: string) { if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Application is outside your regional scope'); }
}
