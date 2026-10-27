import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import { sql, type Transaction } from 'kysely';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { QueueService } from '../queue/queue.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ClockService } from '../clock/clock.service.js';

export interface TransitionRequest {
  applicationId: string;
  action: string;
  actor: Actor;
  reason?: string;
  clauseId?: string;
  payload?: Record<string, unknown>;
  expectedVersion?: number;
  overrideAiFlag?: boolean;
  overrideReason?: string;
}

export interface AllowedAction {
  action: string;
  targetState: string;
  requiresReason: boolean;
  requiresClause: boolean;
  guards: Record<string, unknown>;
}

const TERMINAL_STATES = new Set([
  'APPROVED',
  'APPROVED_WITH_CONDITIONS',
  'REJECTED',
  'COMPLIANCE_REQUIRED',
]);

@Injectable()
export class WorkflowService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Single entry point for workflow state transitions.
   * Runs in one single database transaction with FOR UPDATE locking,
   * guard verification, dual clock transition, task assignment,
   * audit append, and outbox event publishing.
   */
  async transition(request: TransitionRequest): Promise<any>;
  async transition(applicationId: string, actor: Actor, command: any): Promise<any>;
  async transition(reqOrId: TransitionRequest | string, maybeActor?: Actor, maybeCommand?: any): Promise<any> {
    const req: TransitionRequest = typeof reqOrId === 'string'
      ? {
          applicationId: reqOrId,
          actor: maybeActor!,
          action: maybeCommand.action || maybeCommand.targetState,
          reason: maybeCommand.reason,
          clauseId: maybeCommand.clauseId,
          payload: maybeCommand.payload || maybeCommand.metadata,
          expectedVersion: maybeCommand.expectedVersion,
          overrideAiFlag: maybeCommand.overrideAiFlag,
          overrideReason: maybeCommand.overrideReason,
        }
      : reqOrId;

    const completed = await this.database.db.transaction().execute(async (trx) => {
      return this.transitionInTransaction(trx, req);
    });

    await this.afterCommit(completed.outboxId, completed.application);
    return completed.application;
  }

  async transitionInTransaction(trx: Transaction<Database>, req: TransitionRequest): Promise<any>;
  async transitionInTransaction(trx: Transaction<Database>, applicationId: string, actor: Actor, command: any): Promise<any>;
  async transitionInTransaction(trx: Transaction<Database>, reqOrId: TransitionRequest | string, maybeActor?: Actor, maybeCommand?: any): Promise<any> {
    const req: TransitionRequest = typeof reqOrId === 'string'
      ? {
          applicationId: reqOrId,
          actor: maybeActor!,
          action: maybeCommand.action || maybeCommand.targetState,
          reason: maybeCommand.reason,
          clauseId: maybeCommand.clauseId,
          payload: maybeCommand.payload || maybeCommand.metadata,
          expectedVersion: maybeCommand.expectedVersion,
          overrideAiFlag: maybeCommand.overrideAiFlag,
          overrideReason: maybeCommand.overrideReason,
        }
      : reqOrId;

    const { applicationId, action, actor, expectedVersion, reason, clauseId, payload } = req;

    // 1. Load application FOR UPDATE
    const app = await trx
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .forUpdate()
      .executeTakeFirst();

    if (!app) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    // Check optimistic locking expectedVersion
    if (expectedVersion !== undefined && app.version !== expectedVersion) {
      throw new ConflictException(
        `Application version conflict: expected version ${expectedVersion}, but found version ${app.version}`,
      );
    }

    // 2. Load allowed transition for (track, state, action)
    // Check workflow_transitions first, fallback to workflow_rules
    let transitionConfig = await trx
      .selectFrom('workflow_transitions')
      .innerJoin('workflow_definitions', 'workflow_definitions.id', 'workflow_transitions.definition_id')
      .selectAll('workflow_transitions')
      .where('workflow_definitions.track', '=', app.track)
      .where('workflow_transitions.from_state', '=', app.state)
      .where('workflow_transitions.action', '=', action)
      .executeTakeFirst();

    let targetState = transitionConfig?.to_state;
    let allowedRoles: string[] = (transitionConfig?.allowed_roles as string[]) || [];
    let guards: Record<string, unknown> = (transitionConfig?.guards as Record<string, unknown>) || {};
    let requiresReason = Boolean(transitionConfig?.requires_reason);
    let requiresClause = Boolean(transitionConfig?.requires_clause);

    // Fallback: check workflow_rules if transitionConfig not found
    if (!transitionConfig) {
      const rule = await trx
        .selectFrom('workflow_rules')
        .selectAll()
        .where('from_state', '=', app.state)
        .where('to_state', '=', action as any)
        .where('is_active', '=', true)
        .where((eb) => eb.or([eb('track', '=', app.track), eb('track', 'is', null)]))
        .orderBy('track', 'desc')
        .executeTakeFirst();

      if (rule) {
        targetState = rule.to_state;
        allowedRoles = Array.isArray(rule.allowed_roles) ? (rule.allowed_roles as string[]) : [];
        guards = (rule.required_gates as Record<string, unknown>) || {};
      }
    }

    // If still no rule, reject transition
    if (!targetState) {
      throw new BadRequestException(
        `Illegal transition: action '${action}' is not permitted from current state '${app.state}' on track '${app.track}'`,
      );
    }

    // 3. Check role and ownership; check separation of duties
    this.assertScopeAndRole(actor, app, allowedRoles);
    await this.assertSeparationOfDuties(trx, app.id, actor, action);

    // Check mandatory fields
    if (requiresReason && (!reason || reason.trim() === '')) {
      throw new BadRequestException(`A justification reason is required for action '${action}'`);
    }
    if (requiresClause && !clauseId) {
      throw new BadRequestException(`A valid APH clause selection is required for action '${action}'`);
    }

    // 4. Run guards registry
    await this.runGuards(trx, app.id, guards);

    const now = this.clock.now();

    // 5. Update state, owner and due_at (from sla_policies)
    const slaPolicy = await trx
      .selectFrom('sla_policies')
      .selectAll()
      .where('stage_state', '=', targetState)
      .executeTakeFirst();

    const durationHours = slaPolicy?.duration_hours ?? 168; // default 7 days
    const dueAt = new Date(now.getTime() + durationHours * 3600 * 1000);

    // Determine next holder and role
    const { nextOwnerId, nextOwnerRole } = await this.resolveNextOwner(
      trx,
      app,
      targetState,
      actor,
    );

    // 6. Stop and start clocks per dual-clock rules (§2.4)
    await this.applyDualClockTransition(trx, app, targetState, nextOwnerId, nextOwnerRole, reason || action, now);

    // 7. Create/complete tasks and assign (§2.5)
    await this.syncTasks(trx, app, targetState, nextOwnerId, nextOwnerRole, dueAt, slaPolicy?.id);

    // 8. Append the audit row
    await this.audit.append(trx, actor, {
      action: action.toUpperCase(),
      entityType: 'APPLICATION',
      entityId: app.id,
      applicationId: app.id,
      oldState: app.state,
      newState: targetState,
      payload: {
        action,
        reason: reason || null,
        clauseId: clauseId || null,
        metadata: payload || {},
        aiAssisted: Boolean(req.overrideAiFlag),
        overrideReason: req.overrideReason || null,
      },
      aiAssisted: req.overrideAiFlag,
    });

    // 9. Update application record with version increment (optimistic locking)
    const newVersion = app.version + 1;
    const updatedApp = await trx
      .updateTable('applications')
      .set({
        state: targetState as any,
        state_entered_at: now,
        current_owner_id: nextOwnerId,
        current_owner_role: nextOwnerRole as any,
        due_at: dueAt,
        version: newVersion,
        submitted_at: targetState === 'SUBMITTED' ? now : (app as any).submitted_at,
        closed_at: TERMINAL_STATES.has(targetState) ? now : null,
        updated_at: now,
      })
      .where('id', '=', app.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Insert outbox events
    const outbox = await trx
      .insertInto('outbox_events')
      .values({
        topic: 'WORKFLOW_TRANSITION',
        aggregate_type: 'APPLICATION',
        aggregate_id: app.id,
        payload: {
          applicationId: app.id,
          refNo: app.ref_no,
          fromState: app.state,
          toState: targetState,
          action,
          institutionId: app.institution_id,
          actorId: actor.id,
          actorRole: actor.role,
          version: newVersion,
          timestamp: now.toISOString(),
        },
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { application: updatedApp, outboxId: outbox.id };
  }

  /**
   * Pure guard functions registry.
   */
  private async runGuards(trx: Transaction<Database>, applicationId: string, guards: Record<string, unknown>): Promise<void> {
    const guardKeys = Array.isArray(guards) ? guards : Object.keys(guards);

    for (const key of guardKeys) {
      if (key === 'no_open_deficiency' || key === 'NO_OPEN_DEFICIENCIES') {
        const openDeficiency = await trx
          .selectFrom('deficiencies')
          .select('id')
          .where('application_id', '=', applicationId)
          .where('status', 'in', ['OPEN', 'RESPONDED'])
          .executeTakeFirst();

        if (openDeficiency) {
          throw new BadRequestException(
            'Cannot clear scrutiny or advance workflow: open or responded deficiency items must first be resolved or waived',
          );
        }
      }

      if (key === 'all_required_docs_verified' || key === 'ALL_DOCS_VERIFIED') {
        const rejectedOrUnverified = await trx
          .selectFrom('documents')
          .select('id')
          .where('application_id', '=', applicationId)
          .where('status', 'in', ['UPLOADED', 'QUARANTINED', 'REJECTED'])
          .executeTakeFirst();

        if (rejectedOrUnverified) {
          throw new BadRequestException('All required documents must be clean and verified before proceeding');
        }
      }

      if (key === 'evc_report_present' || key === 'EVC_REPORT_COMPLETED') {
        const evc = await trx
          .selectFrom('evc_visits')
          .select('id')
          .where('application_id', '=', applicationId)
          .where('status', '=', 'COMPLETED')
          .executeTakeFirst();

        if (!evc) {
          throw new BadRequestException('A completed EVC inspection report is required for this transition');
        }
      }

      if (key === 'committee_decision_present' || key === 'COMMITTEE_DECISION_RECORDED') {
        const decision = await trx
          .selectFrom('committee_decisions')
          .select('id')
          .where('application_id', '=', applicationId)
          .executeTakeFirst();

        if (!decision) {
          throw new BadRequestException('A recorded committee decision is required for final approval');
        }
      }
    }
  }

  /**
   * Dual-Clock Rules (Section 2.4):
   * DRAFT -> SUBMITTED: AICTE start (holder: scrutiny assignee)
   * Deficiency raised: INSTITUTION start, AICTE stop
   * Valid resubmission: INSTITUTION stop, AICTE start (same reviewer)
   * Scrutiny cleared, EVC required: AICTE continues (handover: EVC/regional)
   * Committee / terminal decision: stop all clocks
   * Compliance required: INSTITUTION start, AICTE stop
   */
  private async applyDualClockTransition(
    trx: Transaction<Database>,
    app: { id: string; state: string },
    targetState: string,
    nextOwnerId: string | null,
    nextOwnerRole: string,
    reason: string,
    timestamp: Date,
  ): Promise<void> {
    if (TERMINAL_STATES.has(targetState)) {
      if (targetState === 'COMPLIANCE_REQUIRED') {
        // Start institution compliance clock, stop AICTE clock
        await this.clock.startClock(trx, app.id, 'INSTITUTION', targetState, nextOwnerId, 'INSTITUTION', reason, timestamp);
      } else {
        // Final terminal state: stop all clocks
        await this.clock.stopOpenClock(trx, app.id, `Application entered terminal state ${targetState}`, timestamp);
      }
      return;
    }

    if (targetState === 'DEFICIENCY_RAISED') {
      // Deficiency raised: start INSTITUTION clock, stop AICTE clock
      await this.clock.startClock(trx, app.id, 'INSTITUTION', targetState, nextOwnerId, 'INSTITUTION', reason, timestamp);
      return;
    }

    if (targetState === 'UNDER_SCRUTINY' || targetState === 'RESUBMITTED') {
      // Scrutiny / Resubmission: start AICTE clock, stop INSTITUTION clock
      await this.clock.startClock(trx, app.id, 'AICTE', targetState, nextOwnerId, nextOwnerRole, reason, timestamp);
      return;
    }

    if (targetState === 'SUBMITTED') {
      // DRAFT -> SUBMITTED: start AICTE clock
      await this.clock.startClock(trx, app.id, 'AICTE', targetState, nextOwnerId, nextOwnerRole, reason, timestamp);
      return;
    }

    // Default handover / continue AICTE clock
    await this.clock.startClock(trx, app.id, 'AICTE', targetState, nextOwnerId, nextOwnerRole, reason, timestamp);
  }

  /**
   * Tasks synchronization and auto-assignment.
   */
  private async syncTasks(
    trx: Transaction<Database>,
    app: { id: string; institution_id: string },
    targetState: string,
    assigneeId: string | null,
    assigneeRole: string,
    dueAt: Date,
    slaPolicyId?: string,
  ): Promise<void> {
    // Complete previously open tasks for this application
    await trx
      .updateTable('tasks')
      .set({
        status: 'COMPLETED',
        completed_at: this.clock.now(),
      })
      .where('application_id', '=', app.id)
      .where('status', '=', 'OPEN')
      .execute();

    // If not a terminal state, create task for next step
    if (!TERMINAL_STATES.has(targetState) && assigneeId) {
      await trx
        .insertInto('tasks')
        .values({
          application_id: app.id,
          kind: targetState,
          assignee_id: assigneeId,
          assignee_role: assigneeRole as any,
          state_ref: targetState as any,
          due_at: dueAt,
          status: 'OPEN',
          sla_policy_id: slaPolicyId ?? null,
        })
        .execute();
    }
  }

  /**
   * Resolves the next owner for an application based on state.
   * Auto-assigns scrutiny to least-loaded officer; auto-returns to same reviewer on resubmission.
   */
  private async resolveNextOwner(
    trx: Transaction<Database>,
    app: { id: string; institution_id: string; region_id?: string },
    targetState: string,
    actor: Actor,
  ): Promise<{ nextOwnerId: string | null; nextOwnerRole: string }> {
    if (targetState === 'DEFICIENCY_RAISED' || targetState === 'COMPLIANCE_REQUIRED') {
      const instUser = await trx
        .selectFrom('users')
        .select('id')
        .where('institution_id', '=', app.institution_id)
        .executeTakeFirst();
      return { nextOwnerId: instUser?.id ?? null, nextOwnerRole: 'INSTITUTION' };
    }

    if (targetState === 'UNDER_SCRUTINY') {
      // Check if this is a resubmission: auto-return to same reviewer!
      const lastDeficiency = await trx
        .selectFrom('deficiencies')
        .select('raised_by')
        .where('application_id', '=', app.id)
        .orderBy('raised_at', 'desc')
        .executeTakeFirst();

      if (lastDeficiency?.raised_by) {
        return { nextOwnerId: lastDeficiency.raised_by, nextOwnerRole: 'SCRUTINY_OFFICER' };
      }

      // Otherwise least-load auto-assignment by region
      const leastLoaded = await trx
        .selectFrom('users')
        .leftJoin('tasks', (join) =>
          join.onRef('tasks.assignee_id', '=', 'users.id').on('tasks.status', '=', 'OPEN'),
        )
        .select(['users.id', (eb) => eb.fn.countAll<number>().as('open_count')])
        .where('users.role', '=', 'SCRUTINY_OFFICER')
        .where('users.is_active', '=', true)
        .groupBy('users.id')
        .orderBy('open_count', 'asc')
        .executeTakeFirst();

      return { nextOwnerId: leastLoaded?.id ?? actor.id, nextOwnerRole: 'SCRUTINY_OFFICER' };
    }

    if (targetState === 'EVC_SCHEDULED' || targetState === 'EVC_INSPECTION') {
      return { nextOwnerId: null, nextOwnerRole: 'EVC_MEMBER' };
    }

    if (targetState === 'COMMITTEE_REVIEW') {
      return { nextOwnerId: null, nextOwnerRole: 'COMMITTEE_MEMBER' };
    }

    return { nextOwnerId: null, nextOwnerRole: 'BUREAU_OFFICER' };
  }

  private assertScopeAndRole(actor: Actor, app: { institution_id: string; region_id?: string }, allowedRoles: string[]): void {
    if (actor.role === 'INSTITUTION' && actor.institutionId !== app.institution_id) {
      throw new ForbiddenException('You can only perform actions on your own institution applications');
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(actor.role) && actor.role !== 'ADMIN') {
      throw new ForbiddenException(`Your role '${actor.role}' is not authorized for this workflow action`);
    }

    if (app.region_id && !['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role)) {
      if (actor.regionId && actor.regionId !== app.region_id) {
        throw new ForbiddenException('Application is outside your regional jurisdiction');
      }
    }
  }

  private async assertSeparationOfDuties(
    trx: Transaction<Database>,
    applicationId: string,
    actor: Actor,
    action: string,
  ): Promise<void> {
    // Maker cannot be checker
    if (action === 'APPROVE' || action === 'CLEAR_SCRUTINY') {
      const submission = await trx
        .selectFrom('audit_log')
        .select('actor_id')
        .where('application_id', '=', applicationId)
        .where('action', 'in', ['SUBMIT', 'APPLICATION_SUBMITTED'])
        .executeTakeFirst();

      if (submission && submission.actor_id === actor.id) {
        throw new ForbiddenException('Separation of duties violation: the user who submitted the application cannot review or approve it');
      }
    }
  }

  /**
   * Returns list of allowed transitions from current application state for UI.
   */
  async getAllowedActions(applicationId: string, actor: Actor): Promise<AllowedAction[]> {
    const app = await this.database.db
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();

    if (!app) throw new NotFoundException('Application not found');

    const transitions = await this.database.db
      .selectFrom('workflow_transitions')
      .innerJoin('workflow_definitions', 'workflow_definitions.id', 'workflow_transitions.definition_id')
      .selectAll('workflow_transitions')
      .where('workflow_definitions.track', '=', app.track)
      .where('workflow_transitions.from_state', '=', app.state)
      .execute();

    const allowed: AllowedAction[] = [];

    for (const t of transitions) {
      const roles = (t.allowed_roles as string[]) || [];
      if (roles.includes(actor.role) || actor.role === 'ADMIN') {
        allowed.push({
          action: t.action,
          targetState: t.to_state,
          requiresReason: Boolean(t.requires_reason),
          requiresClause: Boolean(t.requires_clause),
          guards: (t.guards as Record<string, unknown>) || {},
        });
      }
    }

    return allowed;
  }

  private async afterCommit(outboxId: string, application: { id: string; institution_id: string; region_id?: string | null; state: string }) {
    await this.queues.publishOutbox(outboxId);
    this.realtime.publish({
      type: 'application.transitioned',
      applicationId: application.id,
      institutionId: application.institution_id,
      regionId: application.region_id || '',
      data: { state: application.state },
      timestamp: this.clock.now().toISOString(),
    });
  }
}
