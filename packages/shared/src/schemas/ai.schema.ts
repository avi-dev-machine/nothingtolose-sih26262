import { z } from 'zod';

export const AiSuggestionWrapperSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    id: z.string().uuid(),
    modelName: z.string(),
    modelVersion: z.string(),
    confidenceScore: z.number().min(0).max(1),
    isOverridden: z.boolean().default(false),
    overriddenBy: z.string().uuid().optional(),
    overrideReason: z.string().optional(),
    suggestedAt: z.string().datetime(),
    data: dataSchema,
  });

export const DocumentClassificationDataSchema = z.object({
  detectedType: z.string(),
  extractedDates: z.array(z.string()),
  extractedExpiryDate: z.string().nullable(),
  detectedOrganization: z.string().nullable(),
  isDuplicateLikely: z.boolean(),
  duplicateDocumentId: z.string().uuid().optional(),
  extractedFields: z.record(z.any()),
});

export const AphClauseSuggestionDataSchema = z.object({
  matchedClauseNumber: z.string(),
  clauseTitle: z.string(),
  similarityScore: z.number().min(0).max(1),
  relevantTextExcerpt: z.string(),
  complianceVerdictSuggestion: z.enum(['COMPLIANT', 'DEFICIENT', 'NEEDS_VERIFICATION']),
  deficiencyDraftText: z.string().optional(),
});

export const DelayRiskPredictionDataSchema = z.object({
  applicationId: z.string().uuid(),
  riskScore: z.number().min(0).max(100), // 0 to 100%
  riskCategory: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  keyRiskFactors: z.array(
    z.object({
      factor: z.string(),
      impactWeight: z.number(),
      suggestion: z.string(),
    })
  ),
  predictedCompletionDays: z.number().positive(),
  expectedBreachDate: z.string().datetime().nullable(),
});

export type DocumentClassificationSuggestion = z.infer<
  ReturnType<typeof AiSuggestionWrapperSchema<typeof DocumentClassificationDataSchema>>
>;

export type AphClauseSuggestion = z.infer<
  ReturnType<typeof AiSuggestionWrapperSchema<typeof AphClauseSuggestionDataSchema>>
>;

export type DelayRiskPredictionSuggestion = z.infer<
  ReturnType<typeof AiSuggestionWrapperSchema<typeof DelayRiskPredictionDataSchema>>
>;
