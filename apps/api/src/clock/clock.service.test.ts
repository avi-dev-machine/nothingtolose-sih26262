import { describe, expect, it } from 'vitest';
import { ClockEventType, ClockOwner } from '@aicte/shared';

describe('clock event semantics', () => {
  it('keeps clock ownership as an inserted event attribute', () => {
    const event = { event_type: ClockEventType.DEFICIENCY_ISSUED, active_clock: ClockOwner.INSTITUTION };
    expect(event.active_clock).toBe('INSTITUTION');
    expect(event.event_type).toBe('DEFICIENCY_ISSUED');
  });
});
