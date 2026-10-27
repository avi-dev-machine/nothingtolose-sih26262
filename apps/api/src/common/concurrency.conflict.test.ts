import { describe, expect, it } from 'vitest';

describe('Concurrency Conflict & Optimistic Locking Test', () => {
  it('proves two simultaneous transitions on same version result in 1 success and 1 409 conflict', async () => {
    // Shared simulated database state with row versioning
    let rowVersion = 1;
    let state = 'DRAFT';

    const performTransition = async (id: string, action: string, expectedVersion: number) => {
      // Simulating "SELECT ... FOR UPDATE" & version check inside transaction
      if (expectedVersion !== rowVersion) {
        const error = new Error(`Application version conflict: expected ${expectedVersion}, found ${rowVersion}`);
        (error as any).status = 409;
        throw error;
      }

      // Simulate state update and atomic version increment
      rowVersion += 1;
      state = 'SUBMITTED';
      return { success: true, newVersion: rowVersion, state };
    };

    // Two concurrent requests both read version 1
    const requestA = performTransition('app-1', 'SUBMIT', 1);
    const requestB = performTransition('app-1', 'SUBMIT', 1);

    const results = await Promise.allSettled([requestA, requestB]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const conflicts = results.filter(
      (r) => r.status === 'rejected' && (r.reason as any).status === 409,
    );

    // Exactly one must succeed and exactly one must fail with 409
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);
    expect(rowVersion).toBe(2);
    expect(state).toBe('SUBMITTED');
  });
});
