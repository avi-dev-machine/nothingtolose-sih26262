import { z } from 'zod';

export const ScheduleEvcSchema = z.object({
  applicationId: z.string().uuid(),
  scheduledDate: z.string().datetime(),
  memberIds: z.array(z.string().uuid()).min(2, 'At least 2 EVC members required for committee visit'),
  leadMemberId: z.string().uuid(),
  specialInstructions: z.string().optional(),
});

export type ScheduleEvcDto = z.infer<typeof ScheduleEvcSchema>;

export const EvcChecklistItemSchema = z.object({
  itemId: z.string(),
  parameter: z.string(),
  requiredNorm: z.string(),
  observedStatus: z.string(),
  compliance: z.enum(['COMPLIANT', 'DEFICIENT', 'NOT_APPLICABLE']),
  remarks: z.string().optional(),
});

export const SubmitEvcReportSchema = z.object({
  applicationId: z.string().uuid(),
  visitDate: z.string().datetime(),
  geoLatitude: z.number().min(-90).max(90),
  geoLongitude: z.number().min(-180).max(180),
  geoAccuracyMeters: z.number().nonnegative().optional(),
  checklistResults: z.array(EvcChecklistItemSchema).min(1),
  overallRecommendation: z.enum([
    'RECOMMENDED_FULL',
    'RECOMMENDED_WITH_CONDITIONS',
    'NOT_RECOMMENDED',
  ]),
  justification: z.string().min(20, 'Comprehensive justification required'),
  photoDocumentIds: z.array(z.string().uuid()).min(1, 'Geo-tagged site photos required'),
});

export type SubmitEvcReportDto = z.infer<typeof SubmitEvcReportSchema>;
