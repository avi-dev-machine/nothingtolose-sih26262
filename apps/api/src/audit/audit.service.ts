import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Actor } from '../common/actor.js';
import type { Database } from '../database/types.js';
import { DatabaseService } from '../database/database.service.js';

export interface AuditInput {
  action: string;
  targetEntity: string;
  targetId: string;
  payload: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function calculateAuditHash(previousHash: string, sequenceNumber: number, timestamp: Date, actorId: string, action: string, payload: Record<string, unknown>): string {
  return createHash('sha256').update(`${previousHash}${sequenceNumber}${timestamp.toISOString()}${actorId}${action}${canonicalJson(payload)}`).digest('hex');
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async append(trx: Transaction<Database>, actor: Actor, input: AuditInput) {
    // The advisory lock serialises chain writes across application processes.
    await sql`SELECT pg_advisory_xact_lock(hashtext('aicte_audit_ledger_chain'))`.execute(trx);
    const prior = await trx.selectFrom('audit_ledger').select(['sequence_number', 'current_hash']).orderBy('sequence_number', 'desc').limit(1).executeTakeFirst();
    const sequenceNumber = Number(prior?.sequence_number ?? 0) + 1;
    const previousHash = prior?.current_hash ?? '0'.repeat(64);
    const timestamp = new Date();
    const currentHash = calculateAuditHash(previousHash, sequenceNumber, timestamp, actor.id, input.action, input.payload);
    return trx.insertInto('audit_ledger').values({
      sequence_number: sequenceNumber,
      timestamp,
      actor_id: actor.id,
      actor_role: actor.role,
      actor_email: actor.email,
      action: input.action,
      target_entity: input.targetEntity,
      target_id: input.targetId,
      previous_hash: previousHash,
      current_hash: currentHash,
      payload: input.payload,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    }).returningAll().executeTakeFirstOrThrow();
  }

  async verify() {
    const rows = await this.database.db.selectFrom('audit_ledger').selectAll().orderBy('sequence_number', 'asc').execute();
    let previousHash = '0'.repeat(64);
    for (const row of rows) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const expectedHash = calculateAuditHash(previousHash, Number(row.sequence_number), new Date(row.timestamp), row.actor_id, row.action, payload);
      if (row.previous_hash !== previousHash || row.current_hash !== expectedHash) {
        return { isValid: false, totalEntriesChecked: rows.indexOf(row), brokenEntryId: row.id, expectedHash, actualHash: row.current_hash, verifiedAt: new Date().toISOString() };
      }
      previousHash = row.current_hash;
    }
    return { isValid: true, totalEntriesChecked: rows.length, verifiedAt: new Date().toISOString() };
  }
}
