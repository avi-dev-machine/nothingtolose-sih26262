import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type ApplicationState } from '@aicte/shared';
import { z } from 'zod';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';

export const RecordDecisionSchema = z.object({ applicationId: z.string().uuid(), meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), committeeType: z.enum(['SAC', 'SHC', 'EXECUTIVE_COMMITTEE']), decision: z.enum(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED']), conditions: z.array(z.object({ text: z.string().min(3), dueDate: z.string().datetime().optional() })).default([]), justification: z.string().min(20) });
export const FinalizeDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED']), reason: z.string().min(20) });

@Injectable()
export class CommitteeService {
  constructor(private readonly database: DatabaseService, private readonly workflow: WorkflowService, private readonly audit: AuditService) {}

  async record(actor: Actor, input: z.input<typeof RecordDecisionSchema>) {
    this.requireAuthority(actor);
    return this.database.db.transaction().execute(async (trx) => {
      const app = await trx.selectFrom('applications').selectAll().where('id', '=', input.applicationId).forUpdate().executeTakeFirst();
      if (!app) throw new NotFoundException('Application not found');
      this.assertScope(actor, app.region_id);
      if (!['COMMITTEE_REVIEW', 'SCRUTINY_CLEARED'].includes(app.state)) throw new BadRequestException('Application is not ready for a human committee decision');
    const conditions = input.conditions ?? [];
    if (input.decision === 'APPROVED_WITH_CONDITIONS' && conditions.length === 0) throw new BadRequestException('Conditional approval requires at least one condition');
      const decision = await trx.insertInto('committee_decisions').values({ application_id: app.id, meeting_date: new Date(input.meetingDate), committee_type: input.committeeType, decision: input.decision, conditions, justification: input.justification, recorded_by: actor.id }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.COMMITTEE_REVIEW_HELD, targetEntity: 'COMMITTEE_DECISION', targetId: decision.id, payload: { applicationId: app.id, committeeType: input.committeeType, proposedDecision: input.decision, conditions, justification: input.justification } });
      if (app.state === 'COMMITTEE_REVIEW') await this.workflow.transitionInTransaction(trx, app.id, actor, { targetState: 'FINAL_DECISION', reason: 'Human committee decision recorded for final bureau action', metadata: { committeeDecisionId: decision.id } });
      else await this.workflow.transitionInTransaction(trx, app.id, actor, { targetState: 'FINAL_DECISION', reason: 'Human decision recorded after Track A scrutiny', metadata: { committeeDecisionId: decision.id } });
      return decision;
    });
  }

  async finalize(actor: Actor, applicationId: string, input: z.infer<typeof FinalizeDecisionSchema>) {
    this.requireAuthority(actor);
    const application = await this.database.db.selectFrom('applications').select(['state', 'region_id']).where('id', '=', applicationId).executeTakeFirst();
    if (!application) throw new NotFoundException('Application not found');
    this.assertScope(actor, application.region_id);
    if (application.state !== 'FINAL_DECISION') throw new BadRequestException('Application is not at final decision stage');
    const latest = await this.database.db.selectFrom('committee_decisions').select(['decision']).where('application_id', '=', applicationId).orderBy('created_at', 'desc').executeTakeFirst();
    if (!latest) throw new BadRequestException('Final disposition requires a recorded human committee decision');
    if (latest.decision !== input.decision) throw new BadRequestException('Final disposition must match the recorded committee decision; record a new human decision to change it');
    return this.workflow.transition(applicationId, actor, { targetState: input.decision as ApplicationState, reason: input.reason, metadata: { humanCommitteeDecision: latest.decision } });
  }

  private requireAuthority(actor: Actor) { if (!['BUREAU_OFFICER', 'COMMITTEE_MEMBER', 'ADMIN'].includes(actor.role)) throw new ForbiddenException('A bureau officer or committee member must make this human decision'); }
  private assertScope(actor: Actor, regionId: string) { if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Application is outside your regional scope'); }
}
