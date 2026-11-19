import { describe, expect, it } from 'vitest';
import { inWindow } from '../src/window.js';

// 2026-11-22 is a Sunday. India is UTC+5:30, so 20:30Z is 02:00 the next morning there.
const w = { days: [0], startHour: 2, durationHours: 3, timezone: 'Asia/Kolkata' };
const at = (iso: string) => new Date(iso);

describe('maintenance window', () => {
  it('is open on the chosen day, from the start hour, for its length, in the site time zone', () => {
    expect(inWindow(at('2026-11-21T20:30:00Z'), w)).toBe(true); // Sunday 02:00 in India
    expect(inWindow(at('2026-11-21T23:29:00Z'), w)).toBe(true); // 04:59
    expect(inWindow(at('2026-11-21T23:30:00Z'), w)).toBe(false); // 05:00: over
    expect(inWindow(at('2026-11-21T20:00:00Z'), w)).toBe(false); // 01:30: not yet
    expect(inWindow(at('2026-11-23T20:30:00Z'), w)).toBe(false); // Monday 02:00: wrong day
  });
  it('follows the time zone, not the server clock', () => {
    expect(inWindow(at('2026-11-22T02:30:00Z'), { ...w, timezone: 'UTC' })).toBe(true);
    expect(inWindow(at('2026-11-22T02:30:00Z'), w)).toBe(false); // 08:00 in India
  });
  it('can run past midnight into the next day', () => {
    const late = { days: [6], startHour: 23, durationHours: 3, timezone: 'UTC' }; // Saturday 23:00 to Sunday 02:00
    expect(inWindow(at('2026-11-21T23:30:00Z'), late)).toBe(true); // Saturday
    expect(inWindow(at('2026-11-22T01:30:00Z'), late)).toBe(true); // early Sunday
    expect(inWindow(at('2026-11-22T02:00:00Z'), late)).toBe(false);
    expect(inWindow(at('2026-11-22T23:30:00Z'), late)).toBe(false); // Sunday night is not in the window
  });
});
