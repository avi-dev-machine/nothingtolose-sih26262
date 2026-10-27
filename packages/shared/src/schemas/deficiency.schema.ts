import { z } from 'zod';

export const CreateDeficiencySchema = z.object({
  applicationId: z.string().uuid(),
  clauseId: z.string().min(1, 'APH clause reference is required'),
  clauseTitle: z.string().min(1),
  category: z.enum([
    'INFRASTRUCTURE',
    'FACULTY',
    'LAND_AND_BUILDING',
    'FINANCIAL',
    'LEGAL_AND_REGULATORY',
    'ACADEMIC_GOVERNANCE',
  ]),
  description: z.string().min(10, 'Deficiency description must be detailed'),
  requiredDocuments: z.array(z.string()).default([]),
  deadlineDays: z.number().int().min(1).max(30).default(7),
});

export type CreateDeficiencyDto = z.infer<typeof CreateDeficiencySchema>;

export const RespondDeficiencySchema = z.object({
  deficiencyId: z.string().uuid(),
  responseNote: z.string().min(10, 'Detailed response explanation required'),
  uploadedDocumentIds: z.array(z.string().uuid()).min(1, 'Proof documents must be attached'),
});

export type RespondDeficiencyDto = z.infer<typeof RespondDeficiencySchema>;

export const ResolveDeficiencySchema = z.object({
  deficiencyId: z.string().uuid(),
  status: z.enum(['ACCEPTED', 'REJECTED']),
  resolutionRemarks: z.string().min(5),
});

export type ResolveDeficiencyDto = z.infer<typeof ResolveDeficiencySchema>;
