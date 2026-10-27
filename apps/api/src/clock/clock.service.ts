import { Injectable, NotFoundException } from '@nestjs/common';
import { ClockEventType, ClockOwner, SlaStatus } from '@aicte/shared';
import { DatabaseService } from '../database/database.service.js';

const TERMINAL_STATES = new Set(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED']);

@Injectable()
export class ClockService {
  constructor(private readonly database: DatabaseService) {}

  async summary(applicationId: string) {
    const [application, events] = await Promise.all([
      this.database.db.selectFrom('applications').select(['id', 'state']).where('id', '=', applicationId).executeTakeFirst(),
      this.database.db.selectFrom('clock_events').selectAll().where('application_id', '=', applicationId).orderBy('timestamp', 'asc').orderBy('created_at', 'asc').execute(),
    ]);
    if (!application) throw new NotFoundException('Application not found');
    const config = await this.database.db.selectFrom('sla_configs').selectAll().where('state', '=', application.state).where('is_active', '=', true).executeTakeFirst();
    const now = new Date();
    let institutionMs = 0;
    let aicteMs = 0;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const end = events[index + 1]?.timestamp ?? (TERMINAL_STATES.has(application.state) || event.event_type === ClockEventType.CLOCK_STOPPED ? event.timestamp : now);
      const duration = Math.max(0, new Date(end).getTime() - new Date(event.timestamp).getTime());
      if (event.active_clock === ClockOwner.INSTITUTION) institutionMs += duration;
      else if (event.active_clock === ClockOwner.AICTE) aicteMs += duration;
    }
    const last = events.at(-1);
    const threshold = config?.sla_hours ?? 168;
    const utilization = aicteMs / 3_600_000 / threshold;
    const near = Number(config?.near_breach_percent ?? 80) / 100;
    const escalation = Number(config?.escalation_after_hours ?? threshold + 24);
    const aicteHours = Number((aicteMs / 3_600_000).toFixed(2));
    const slaStatus = aicteHours >= escalation ? SlaStatus.CRITICAL_ESCALATION : aicteHours >= threshold ? SlaStatus.BREACHED : utilization >= near ? SlaStatus.NEAR_BREACH : SlaStatus.WITHIN_SLA;
    return {
      applicationId,
      activeClock: (last?.active_clock ?? ClockOwner.INSTITUTION) as ClockOwner,
      institutionDurationHours: Number((institutionMs / 3_600_000).toFixed(2)),
      aicteDurationHours: aicteHours,
      totalElapsedHours: Number(((institutionMs + aicteMs) / 3_600_000).toFixed(2)),
      slaThresholdHours: threshold,
      slaStatus,
      timeRemainingHours: Number((threshold - aicteHours).toFixed(2)),
      lastEventTimestamp: new Date(last?.timestamp ?? now).toISOString(),
    };
  }
}
