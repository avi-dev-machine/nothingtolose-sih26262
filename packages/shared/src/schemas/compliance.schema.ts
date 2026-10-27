import { z } from 'zod';
import { ComplianceCategory, ComplianceStatus } from '../enums/compliance.enum.js';

export const CreateComplianceSchema = z.object({
  institutionId: z.string().uuid(),
  category: z.nativeEnum(ComplianceCategory),
  title: z.string().min(3),
  issuingAuthority: z.string().min(2),
  referenceNumber: z.string().min(2),
  issuedDate: z.string().datetime(),
  expiryDate: z.string().datetime(),
  documentId: z.string().uuid(),
  alertBeforeDays: z.number().int().min(7).max(90).default(30),
});

export type CreateComplianceDto = z.infer<typeof CreateComplianceSchema>;

export const UpdateComplianceSchema = z.object({
  status: z.nativeEnum(ComplianceStatus).optional(),
  expiryDate: z.string().datetime().optional(),
  renewalDocumentId: z.string().uuid().optional(),
  remarks: z.string().optional(),
});

export type UpdateComplianceDto = z.infer<typeof UpdateComplianceSchema>;

export const ComplianceRadarQuerySchema = z.object({
  regionId: z.string().uuid().optional(),
  institutionId: z.string().uuid().optional(),
  category: z.nativeEnum(ComplianceCategory).optional(),
  status: z.nativeEnum(ComplianceStatus).optional(),
  expiresInDays: z.coerce.number().int().optional(),
});

export type ComplianceRadarQueryDto = z.infer<typeof ComplianceRadarQuerySchema>;
