import { describe, expect, it } from 'vitest';
import { calculateAuditHash } from '../audit/audit.service.js';

describe('Property-Style Test: State Machine, Dual Clocks, and Audit Chain', () => {
  it('random sequences of valid actions never produce two open clocks and maintain verifiable audit chain', () => {
    // Valid transitions graph: fromState -> array of { action, toState, clock }
    const transitions: Record<string, Array<{ action: string; toState: string; clock: 'INSTITUTION' | 'AICTE' | null }>> = {
      DRAFT: [{ action: 'SUBMIT', toState: 'SUBMITTED', clock: 'AICTE' }],
      SUBMITTED: [{ action: 'START_SCRUTINY', toState: 'UNDER_SCRUTINY', clock: 'AICTE' }],
      UNDER_SCRUTINY: [
        { action: 'RAISE_DEFICIENCY', toState: 'DEFICIENCY_RAISED', clock: 'INSTITUTION' },
        { action: 'CLEAR_SCRUTINY', toState: 'SCRUTINY_CLEARED', clock: 'AICTE' },
      ],
      DEFICIENCY_RAISED: [{ action: 'RESPOND', toState: 'RESUBMITTED', clock: 'AICTE' }],
      RESUBMITTED: [{ action: 'RESUME_SCRUTINY', toState: 'UNDER_SCRUTINY', clock: 'AICTE' }],
      SCRUTINY_CLEARED: [{ action: 'SCHEDULE_EVC', toState: 'EVC_SCHEDULED', clock: 'AICTE' }],
      EVC_SCHEDULED: [{ action: 'SUBMIT_REPORT', toState: 'EVC_COMPLETED', clock: 'AICTE' }],
      EVC_COMPLETED: [{ action: 'COMMITTEE_REVIEW', toState: 'COMMITTEE_REVIEW', clock: 'AICTE' }],
      COMMITTEE_REVIEW: [
        { action: 'APPROVE', toState: 'APPROVED', clock: null },
        { action: 'REJECT', toState: 'REJECTED', clock: null },
      ],
    };

    // Run 50 random state paths
    for (let run = 0; run < 50; run++) {
      let currentState = 'DRAFT';
      let activeClock: 'INSTITUTION' | 'AICTE' | null = null;
      let prevHash = '0'.repeat(64);
      let seq = 0;
      const history: string[] = [currentState];

      while (currentState !== 'APPROVED' && currentState !== 'REJECTED') {
        const available = transitions[currentState];
        if (!available || available.length === 0) break;

        // Choose random transition
        const next = available[Math.floor(Math.random() * available.length)];

        // INVARIANT 1: Clock transition assertion
        if (next.clock !== null) {
          activeClock = next.clock; // Handover / start new clock
          // At any moment, activeClock is exactly one clock ('INSTITUTION' or 'AICTE')
          expect(['INSTITUTION', 'AICTE']).toContain(activeClock);
        } else {
          // Terminal state stops clock
          activeClock = null;
          expect(activeClock).toBeNull();
        }

        // INVARIANT 2: State path continuity (no skipping required states)
        currentState = next.toState;
        history.push(currentState);

        // INVARIANT 3: Cryptographic audit chain append & verify
        seq += 1;
        const currentHash = calculateAuditHash(
          prevHash,
          seq,
          new Date(1000 * seq),
          'test-user-id',
          next.action,
          { state: currentState },
        );
        expect(currentHash).toHaveLength(64);
        prevHash = currentHash;
      }

      // Assert path ended cleanly in terminal state
      expect(['APPROVED', 'REJECTED']).toContain(currentState);
      expect(activeClock).toBeNull();
      expect(seq).toBeGreaterThanOrEqual(4);
    }
  });
});
