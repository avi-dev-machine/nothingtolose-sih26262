import { describe, expect, it } from 'vitest';
import { calculateAuditHash, canonicalJson } from './audit.service.js';

describe('audit hash chain primitives', () => {
  it('canonicalises object keys so semantically identical payloads hash identically', () => {
    expect(canonicalJson({ z: [2, { b: true, a: null }], a: 'value' }))
      .toBe(canonicalJson({ a: 'value', z: [2, { a: null, b: true }] }));
  });

  it('changes the chain hash when the immutable payload changes', () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const base = calculateAuditHash('0'.repeat(64), 1, timestamp, '11111111-1111-1111-1111-111111111111', 'APPLICATION_CREATED', { state: 'DRAFT' });
    const changed = calculateAuditHash('0'.repeat(64), 1, timestamp, '11111111-1111-1111-1111-111111111111', 'APPLICATION_CREATED', { state: 'SUBMITTED' });
    expect(base).toHaveLength(64);
    expect(base).not.toBe(changed);
  });
});
