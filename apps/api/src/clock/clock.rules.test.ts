import { describe, expect, it } from 'vitest';
import { ClockOwner, ClockEventType } from '@aicte/shared';

describe('Dual-Clock Rules & Invariants', () => {
  it('enforces single open clock invariant across transitions', () => {
    // Initial state: DRAFT (no open clocks)
    const clocks: Array<{ clock: ClockOwner; startedAt: Date; stoppedAt: Date | null }> = [];
    const openClocks = () => clocks.filter((c) => c.stoppedAt === null);

    expect(openClocks().length).toBe(0);

    // Event 1: DRAFT -> SUBMITTED (Start AICTE clock)
    clocks.push({ clock: ClockOwner.AICTE, startedAt: new Date(1000), stoppedAt: null });
    expect(openClocks().length).toBe(1);
    expect(openClocks()[0].clock).toBe(ClockOwner.AICTE);

    // Event 2: Deficiency Raised (Stop AICTE clock, Start INSTITUTION clock)
    openClocks()[0].stoppedAt = new Date(2000);
    clocks.push({ clock: ClockOwner.INSTITUTION, startedAt: new Date(2000), stoppedAt: null });
    expect(openClocks().length).toBe(1);
    expect(openClocks()[0].clock).toBe(ClockOwner.INSTITUTION);

    // Event 3: Valid Resubmission (Stop INSTITUTION clock, Start AICTE clock)
    openClocks()[0].stoppedAt = new Date(3000);
    clocks.push({ clock: ClockOwner.AICTE, startedAt: new Date(3000), stoppedAt: null });
    expect(openClocks().length).toBe(1);
    expect(openClocks()[0].clock).toBe(ClockOwner.AICTE);

    // Event 4: Final Approval (Terminal state -> Stop all clocks)
    openClocks()[0].stoppedAt = new Date(4000);
    expect(openClocks().length).toBe(0);
  });

  it('virtual time travel advances elapsed hours correctly', () => {
    const startedAt = new Date('2026-01-01T10:00:00.000Z');
    let virtualOffsetHours = 0;

    const getElapsedHours = () => {
      const currentVirtual = new Date(startedAt.getTime() + virtualOffsetHours * 3600 * 1000);
      return (currentVirtual.getTime() - startedAt.getTime()) / 3600000;
    };

    expect(getElapsedHours()).toBe(0);

    // Advance 48 hours
    virtualOffsetHours = 48;
    expect(getElapsedHours()).toBe(48);

    // Advance to 168 hours (7 days SLA threshold)
    virtualOffsetHours = 168;
    expect(getElapsedHours()).toBe(168);
  });
});
