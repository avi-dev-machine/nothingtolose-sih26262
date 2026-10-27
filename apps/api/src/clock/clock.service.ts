import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ClockOwner, SlaStatus } from '@aicte/shared';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';

const TERMINAL_STATES = new Set(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED']);

export interface VirtualClockState {
  virtualTime: string;
  offsetMs: number;
  offsetHours: number;
  isVirtual: boolean;
}

@Injectable()
export class ClockService {
  private virtualOffsetMs = 0;

  constructor(private readonly database: DatabaseService) {}

  /**
   * Central injected time source: returns current virtual time.
   */
  now(): Date {
    return new Date(Date.now() + this.virtualOffsetMs);
  }

  nowMs(): number {
    return Date.now() + this.virtualOffsetMs;
  }

  /**
   * Advance virtual clock for SLA, escalation and demo testing (Admin only).
   */
  advanceTime(hours: number): VirtualClockState {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TIME_TRAVEL !== 'true') {
      throw new BadRequestException('Time travel is disabled in production environments');
    }
    this.virtualOffsetMs += hours * 3600 * 1000;
    return this.getClockState();
  }

  resetTime(): VirtualClockState {
    this.virtualOffsetMs = 0;
    return this.getClockState();
  }

  getClockState(): VirtualClockState {
    return {
      virtualTime: this.now().toISOString(),
      offsetMs: this.virtualOffsetMs,
      offsetHours: Number((this.virtualOffsetMs / 3600000).toFixed(2)),
      isVirtual: this.virtualOffsetMs !== 0,
    };
  }

  /**
   * Stop any currently open clock event for an application.
   */
  async stopOpenClock(
    trx: Transaction<Database>,
    applicationId: string,
    stopReason: string,
    stoppedAt: Date = this.now(),
  ): Promise<void> {
    await trx
      .updateTable('clock_events')
      .set({
        stopped_at: stoppedAt,
        stop_reason: stopReason,
      })
      .where('application_id', '=', applicationId)
      .where('stopped_at', 'is', null)
      .execute();
  }

  /**
   * Start a new clock event for an application.
   */
  async startClock(
    trx: Transaction<Database>,
    applicationId: string,
    clock: 'INSTITUTION' | 'AICTE',
    stateRef: string,
    holderUserId: string | null,
    holderRole: string,
    reason: string,
    startedAt: Date = this.now(),
  ): Promise<void> {
    // Stop any currently running clock first to preserve invariant
    await this.stopOpenClock(trx, applicationId, `Handover to ${clock} clock for ${stateRef}`, startedAt);

    await trx
      .insertInto('clock_events')
      .values({
        application_id: applicationId,
        clock: clock as any,
        started_at: startedAt,
        stopped_at: null,
        holder_user_id: holderUserId,
        holder_role: holderRole as any,
        state_ref: stateRef as any,
        reason,
      })
      .execute();

    // Assert DB invariant
    await this.assertSingleOpenClock(trx, applicationId, stateRef);
  }

  /**
   * Asserts that at most one open clock exists for a non-terminal application.
   */
  async assertSingleOpenClock(
    trx: Transaction<Database>,
    applicationId: string,
    currentState: string,
  ): Promise<void> {
    if (TERMINAL_STATES.has(currentState) || currentState === 'DRAFT') {
      return;
    }

    const openClocks = await trx
      .selectFrom('clock_events')
      .selectAll()
      .where('application_id', '=', applicationId)
      .where('stopped_at', 'is', null)
      .execute();

    if (openClocks.length > 1) {
      throw new BadRequestException(
        `Dual clock invariant violation: application ${applicationId} has ${openClocks.length} simultaneously open clocks`,
      );
    }
  }

  /**
   * Full clock summary: current holder, calendar elapsed, business hours elapsed, and SLA status.
   */
  async summary(applicationId: string) {
    const application = await this.database.db
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();

    if (!application) throw new NotFoundException('Application not found');

    const [events, slaPolicy] = await Promise.all([
      this.database.db
        .selectFrom('clock_events')
        .selectAll()
        .where('application_id', '=', applicationId)
        .orderBy('started_at', 'asc')
        .execute(),
      this.database.db
        .selectFrom('sla_policies')
        .selectAll()
        .where('stage_state', '=', application.state)
        .executeTakeFirst(),
    ]);

    const currentTime = this.now();
    let institutionSeconds = 0;
    let aicteSeconds = 0;
    let aicteBusinessSeconds = 0;

    let openClockEvent: (typeof events)[number] | null = null;

    for (const evt of events) {
      const start = evt.started_at ? new Date(evt.started_at) : (evt.timestamp ? new Date(evt.timestamp) : currentTime);
      const end = evt.stopped_at ? new Date(evt.stopped_at) : currentTime;
      const durationSec = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));

      if (evt.clock === 'INSTITUTION' || evt.active_clock === 'INSTITUTION') {
        institutionSeconds += durationSec;
      } else if (evt.clock === 'AICTE' || evt.active_clock === 'AICTE') {
        aicteSeconds += durationSec;
        // Compute business seconds using SQL function
        try {
          const biz = await sql<{ sec: string }>`SELECT fn_business_seconds(${start.toISOString()}::TIMESTAMPTZ, ${end.toISOString()}::TIMESTAMPTZ) AS sec`.execute(this.database.db);
          aicteBusinessSeconds += Number(biz.rows[0]?.sec ?? 0);
        } catch {
          // fallback if function not ready
          aicteBusinessSeconds += Math.floor(durationSec * 0.33);
        }
      }

      if (!evt.stopped_at) {
        openClockEvent = evt;
      }
    }

    const slaHours = slaPolicy?.duration_hours ?? 168; // default 7 days (168h)
    const criticalHours = slaHours + (slaPolicy?.grace_hours ?? 24);
    const aicteHours = Number((aicteSeconds / 3600).toFixed(2));
    const aicteBizHours = Number((aicteBusinessSeconds / 3600).toFixed(2));

    let slaStatus = SlaStatus.WITHIN_SLA;
    if (aicteHours >= criticalHours) {
      slaStatus = SlaStatus.CRITICAL_ESCALATION;
    } else if (aicteHours >= slaHours) {
      slaStatus = SlaStatus.BREACHED;
    } else if (aicteHours >= slaHours * 0.8) {
      slaStatus = SlaStatus.NEAR_BREACH;
    }

    return {
      applicationId,
      state: application.state,
      isTerminal: TERMINAL_STATES.has(application.state),
      currentHolder: openClockEvent
        ? {
            clock: openClockEvent.clock,
            holderRole: openClockEvent.holder_role,
            holderUserId: openClockEvent.holder_user_id,
            startedAt: openClockEvent.started_at,
          }
        : null,
      elapsed: {
        institutionHours: Number((institutionSeconds / 3600).toFixed(2)),
        aicteCalendarHours: aicteHours,
        aicteBusinessHours: aicteBizHours,
        totalCalendarHours: Number(((institutionSeconds + aicteSeconds) / 3600).toFixed(2)),
      },
      sla: {
        targetHours: slaHours,
        criticalHours,
        status: slaStatus,
        remainingHours: Math.max(0, Number((slaHours - aicteHours).toFixed(2))),
      },
      events: events.map((e) => ({
        id: e.id,
        clock: e.clock,
        stateRef: e.state_ref,
        startedAt: e.started_at,
        stoppedAt: e.stopped_at,
        holderRole: e.holder_role,
        reason: e.reason,
        stopReason: e.stop_reason,
      })),
      virtualClock: this.getClockState(),
    };
  }

  /**
   * Clock reconciliation invariant check:
   * Asserts every non-draft, non-terminal application has exactly one open clock event.
   */
  async reconcileClocks(): Promise<{ inspected: number; anomalies: Array<{ applicationId: string; openClockCount: number }> }> {
    const activeApps = await this.database.db
      .selectFrom('applications')
      .select(['id', 'state'])
      .where('state', '!=', 'DRAFT')
      .where('state', 'not in', Array.from(TERMINAL_STATES))
      .execute();

    const anomalies: Array<{ applicationId: string; openClockCount: number }> = [];

    for (const app of activeApps) {
      const openCount = await this.database.db
        .selectFrom('clock_events')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('application_id', '=', app.id)
        .where('stopped_at', 'is', null)
        .executeTakeFirst();

      const count = Number(openCount?.count ?? 0);
      if (count !== 1) {
        anomalies.push({
          applicationId: app.id,
          openClockCount: count,
        });
      }
    }

    return {
      inspected: activeApps.length,
      anomalies,
    };
  }
}
