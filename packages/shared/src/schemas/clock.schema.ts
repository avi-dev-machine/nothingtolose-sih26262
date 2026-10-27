import { z } from 'zod';
import { ClockEventType, ClockOwner, SlaStatus } from '../enums/clock.enum.js';

export const ClockEventSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  eventType: z.nativeEnum(ClockEventType),
  activeClock: z.nativeEnum(ClockOwner),
  timestamp: z.string().datetime(),
  triggerSource: z.enum(['SYSTEM', 'OFFICER', 'INSTITUTION', 'CRON']),
  remarks: z.string().optional(),
});

export type ClockEventDto = z.infer<typeof ClockEventSchema>;

export const DualClockSummarySchema = z.object({
  applicationId: z.string().uuid(),
  activeClock: z.nativeEnum(ClockOwner),
  institutionDurationHours: z.number().nonnegative(),
  aicteDurationHours: z.number().nonnegative(),
  totalElapsedHours: z.number().nonnegative(),
  slaThresholdHours: z.number().positive(),
  slaStatus: z.nativeEnum(SlaStatus),
  timeRemainingHours: z.number(),
  lastEventTimestamp: z.string().datetime(),
});

export type DualClockSummaryDto = z.infer<typeof DualClockSummarySchema>;
