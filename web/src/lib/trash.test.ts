import { describe, expect, it } from 'vitest';
import { daysLeft, TRASH_DAYS } from './local-db';

const DAY = 86400000;

describe('Recently deleted', () => {
  it('counts down the days until a deleted project goes for good', () => {
    const now = Date.UTC(2026, 10, 10, 12);
    expect(daysLeft({ deletedAt: now }, now)).toBe(TRASH_DAYS);
    expect(daysLeft({ deletedAt: now - DAY / 2 }, now)).toBe(TRASH_DAYS);
    expect(daysLeft({ deletedAt: now - 29.5 * DAY }, now)).toBe(1);
    expect(daysLeft({ deletedAt: now - 45 * DAY }, now)).toBe(0);
    expect(daysLeft({}, now)).toBe(TRASH_DAYS);
  });
});
