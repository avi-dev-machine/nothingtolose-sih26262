import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClockEventType, ClockOwner, type ApplicationState } from '@aicte/shared';
import { sql, type Transaction } from 'kysely';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { QueueService } from '../queue/queue.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface TransitionCommand {
  targetState: ApplicationState | string;
  reason: string;
  metadata?: Record<string, unknown>;
  overrideAiFlag?: boolean;
  overrideReason?: string;
}

const stateAction: Record<string, string> = {
  SUBMITTED: AuditAction.APPLICATION_SUBMITTED,
  UNDER_SCRUTINY: AuditAction.SCRUTINY_STARTED,
  DEFICIENCY_RAISED: AuditAction.DEFICIENCY_ISSUED,
  SCRUTINY_CLEARED: AuditAction.SCRUTINY_CLEARED,
  EVC_SCHEDULED: AuditAction.EVC_VISIT_SCHEDULED,
  EVC_COMPLETED: AuditAction.EVC_REPORT_SUBMITTED,
  COMMITTEE_REVIEW: AuditAction.COMMITTEE_REVIEW_HELD,
  APPROVED: AuditAction.FINAL_DECISION_RECORDED,
  APPROVED_WITH_CONDITIONS: AuditAction.FINAL_DECISION_RECORDED,
  REJECTED: AuditAction.FINAL_DECISION_RECORDED,
  COMPLIANCE_REQUIRED: AuditAction.FINAL_DECISION_RECORDED,
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  async transition(applicationId: string, actor: Actor, command: TransitionCommand) {
    const completed = await this.database.db.transaction().execute(async (trx) => this.transitionInTransaction(trx, applicationId, actor, command));
    await this.afterCommit(completed.outboxId, completed.application);
    return completed.application;
  }

  async transitionInTransaction(trx: Transaction<Database>, applicationId: string, actor: Actor, command: TransitionCommand) {
    const application = await trx.selectFrom('applications').selectAll().where('id', '=', applicationId).forUpdate().executeTakeFirst();
    if (!application) throw new NotFoundException('Application not found');
    this.assertScope(actor, application.institution_id, application.region_id);

    const rule = await trx.selectFrom('workflow_rules')
      .selectAll()
      .where('from_state', '=', application.state)
      .where('to_state', '=', command.targetState)
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('track', '=', application.track), eb('track', 'is', null)]))
      .orderBy('track', 'desc')
      .executeTakeFirst();
    if (!rule) throw new BadRequestException(`Transition ${application.state} → ${command.targetState} is not configured for ${application.track}`);

    const allowedRoles = this.toStringArray(rule.allowed_roles);
    if (!allowedRoles.includes(actor.role)) throw new ForbiddenException('Your role cannot perform this configured workflow transition');
    await this.assertGates(trx, application.id, this.toStringArray(rule.required_gates));
    if (command.overrideAiFlag && !command.overrideReason?.trim()) throw new BadRequestException('An AI override requires a reason');

    const timestamp = new Date();
    const updated = await trx.updateTable('applications').set({ state: command.targetState, updated_at: timestamp }).where('id', '=', application.id).returningAll().executeTakeFirstOrThrow();
    const clock = this.clockForState(command.targetState);
    await trx.insertInto('clock_events').values({ application_id: application.id, event_type: clock.eventType, active_clock: clock.owner, timestamp, trigger_source: actor.role === 'INSTITUTION' ? 'INSTITUTION' : 'OFFICER', remarks: command.reason }).execute();
    await this.audit.append(trx, actor, {
      action: stateAction[command.targetState] ?? AuditAction.CLOCK_EVENT_RECORDED,
      targetEntity: 'APPLICATION', targetId: application.id,
      payload: { fromState: application.state, targetState: command.targetState, reason: command.reason, metadata: command.metadata ?? {}, aiOverride: Boolean(command.overrideAiFlag), overrideReason: command.overrideReason ?? null },
    });
    const outbox = await trx.insertInto('outbox_events').values({
      topic: 'WORKFLOW_TRANSITION', aggregate_type: 'APPLICATION', aggregate_id: application.id,
      payload: { applicationId: application.id, applicationNumber: application.application_number, institutionId: application.institution_id, regionId: application.region_id, fromState: application.state, state: command.targetState, reason: command.reason, actorRole: actor.role },
    }).returning('id').executeTakeFirstOrThrow();
    return { application: updated, outboxId: outbox.id };
  }

  async assertGates(trx: Transaction<Database>, applicationId: string, gates: string[]) {
    for (const gate of gates) {
      if (gate === 'OPEN_DEFICIENCY') {
        const row = await trx.selectFrom('deficiencies').select('id').where('application_id', '=', applicationId).where('status', '=', 'OPEN').executeTakeFirst();
        if (!row) throw new BadRequestException('This transition requires at least one open deficiency');
      }
      if (gate === 'RESPONDED_DEFICIENCY') {
        const row = await trx.selectFrom('deficiencies').select('id').where('application_id', '=', applicationId).where('status', '=', 'RESPONDED').executeTakeFirst();
        if (!row) throw new BadRequestException('This transition requires a submitted deficiency response');
      }
      if (gate === 'NO_OPEN_DEFICIENCIES') {
        const row = await trx.selectFrom('deficiencies').select('id').where('application_id', '=', applicationId).where('status', 'in', ['OPEN', 'RESPONDED']).executeTakeFirst();
        if (row) throw new BadRequestException('All deficiency items must be resolved before scrutiny can clear');
      }
      if (gate === 'EVC_VISIT_SCHEDULED') {
        const row = await trx.selectFrom('evc_visits').select('id').where('application_id', '=', applicationId).where('status', '=', 'SCHEDULED').executeTakeFirst();
        if (!row) throw new BadRequestException('An EVC visit must be scheduled first');
      }
      if (gate === 'EVC_REPORT_COMPLETED') {
        const row = await trx.selectFrom('evc_visits').select('id').where('application_id', '=', applicationId).where('status', '=', 'COMPLETED').executeTakeFirst();
        if (!row) throw new BadRequestException('A completed EVC report is required');
      }
      if (gate === 'COMMITTEE_DECISION_RECORDED') {
        const row = await trx.selectFrom('committee_decisions').select('id').where('application_id', '=', applicationId).executeTakeFirst();
        if (!row) throw new BadRequestException('A recorded human committee decision is required');
      }
    }
  }

  private async afterCommit(outboxId: string, application: { id: string; institution_id: string; region_id: string; state: string }) {
    await this.queues.publishOutbox(outboxId);
    this.realtime.publish({ type: 'application.transitioned', applicationId: application.id, institutionId: application.institution_id, regionId: application.region_id, data: { state: application.state }, timestamp: new Date().toISOString() });
  }

  private clockForState(targetState: string): { owner: ClockOwner; eventType: ClockEventType } {
    if (['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED'].includes(targetState)) return { owner: ClockOwner.AICTE, eventType: ClockEventType.CLOCK_STOPPED };
    if (targetState === 'DEFICIENCY_RAISED') return { owner: ClockOwner.INSTITUTION, eventType: ClockEventType.DEFICIENCY_ISSUED };
    if (targetState === 'RESUBMITTED') return { owner: ClockOwner.AICTE, eventType: ClockEventType.DEFICIENCY_RESPONDED };
    if (targetState === 'EVC_SCHEDULED') return { owner: ClockOwner.AICTE, eventType: ClockEventType.INSPECTION_SCHEDULED };
    return { owner: ClockOwner.AICTE, eventType: ClockEventType.CLOCK_RESUMED };
  }

  private assertScope(actor: Actor, institutionId: string, regionId: string) {
    if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) throw new ForbiddenException('You can only act on your institution applications');
    if (!['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Application is outside your regional scope');
  }

  private toStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
}
