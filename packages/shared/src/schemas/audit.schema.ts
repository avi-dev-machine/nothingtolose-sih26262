import { z } from 'zod';
import { AuditAction, TargetEntity } from '../enums/audit.enum.js';

export const AuditLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  sequenceNumber: z.number().int().positive(),
  timestamp: z.string().datetime(),
  actorId: z.string().uuid(),
  actorRole: z.string(),
  actorEmail: z.string().email(),
  action: z.nativeEnum(AuditAction),
  targetEntity: z.nativeEnum(TargetEntity),
  targetId: z.string().uuid(),
  previousHash: z.string().min(64).max(64), // SHA-256
  currentHash: z.string().min(64).max(64),  // SHA-256
  payload: z.record(z.any()),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type AuditLedgerEntryDto = z.infer<typeof AuditLedgerEntrySchema>;

export const AuditVerificationResultSchema = z.object({
  isValid: z.boolean(),
  totalEntriesChecked: z.number().int(),
  brokenEntryId: z.string().uuid().optional(),
  expectedHash: z.string().optional(),
  actualHash: z.string().optional(),
  verifiedAt: z.string().datetime(),
});

export type AuditVerificationResultDto = z.infer<typeof AuditVerificationResultSchema>;
