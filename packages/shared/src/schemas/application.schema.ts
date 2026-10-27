import { z } from 'zod';
import { ApplicationState, WorkflowTrack } from '../enums/workflow.enum.js';

export const CreateApplicationSchema = z.object({
  institutionId: z.string().uuid(),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, 'Academic year must be formatted as YYYY-YY (e.g. 2026-27)'),
  track: z.nativeEnum(WorkflowTrack),
  programme: z.string().min(2, 'Programme name required (e.g. Engineering & Technology, Management)'),
  coursesRequested: z.array(
    z.object({
      name: z.string().min(2),
      level: z.enum(['DIPLOMA', 'UG', 'PG', 'DOCTORAL']),
      proposedIntake: z.number().int().positive(),
      currentIntake: z.number().int().nonnegative().default(0),
    })
  ).min(1, 'At least one course is required'),
  remarks: z.string().optional(),
});

export type CreateApplicationDto = z.infer<typeof CreateApplicationSchema>;

export const TransitionStateSchema = z.object({
  targetState: z.nativeEnum(ApplicationState),
  reason: z.string().min(5, 'Reason or justification is required for state transition'),
  metadata: z.record(z.any()).optional(),
  overrideAiFlag: z.boolean().default(false),
  overrideReason: z.string().optional(),
});

export type TransitionStateDto = z.infer<typeof TransitionStateSchema>;

export const ApplicationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  state: z.nativeEnum(ApplicationState).optional(),
  track: z.nativeEnum(WorkflowTrack).optional(),
  regionId: z.string().uuid().optional(),
  institutionId: z.string().uuid().optional(),
  search: z.string().optional(),
  slaStatus: z.enum(['ALL', 'WITHIN_SLA', 'NEAR_BREACH', 'BREACHED']).optional(),
});

export type ApplicationQueryDto = z.infer<typeof ApplicationQuerySchema>;
