import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock, now, resetClock, setClock, useFakeClock } from '../../src/lib/clock.js';
import { getTodayLocalDate } from '../../src/lib/datetime.js';
import { signAccessToken, verifyAccessToken } from '../../src/lib/jwt.js';

describe('lib/clock & FakeClock', () => {
  afterEach(() => {
    resetClock();
  });

  it('returns real system time by default and defensive copies from FakeClock', () => {
    const realBefore = Date.now();
    const current = now();
    const realAfter = Date.now();
    expect(current.getTime()).toBeGreaterThanOrEqual(realBefore);
    expect(current.getTime()).toBeLessThanOrEqual(realAfter);

    const fake = useFakeClock('2026-11-15T06:00:00.000Z');
    const t1 = now();
    expect(t1.toISOString()).toBe('2026-11-15T06:00:00.000Z');

    // Mutating returned Date instance must not mutate FakeClock internal state
    t1.setUTCFullYear(2099);
    expect(now().toISOString()).toBe('2026-11-15T06:00:00.000Z');

    fake.advanceHours(2);
    fake.advanceMinutes(30);
    fake.advanceSeconds(15);
    fake.advanceMs(500);
    expect(now().toISOString()).toBe('2026-11-15T08:30:15.500Z');

    fake.set('2026-12-31T20:00:00.000Z');
    expect(getTodayLocalDate('Asia/Bishkek')).toBe('2027-01-01');
  });

  it('integrates FakeClock with JWT signing and expiration verification', () => {
    const fake = new FakeClock('2026-11-15T10:00:00.000Z');
    setClock(fake);

    const token = signAccessToken({
      sub: '00000000-0000-0000-0000-000000000001',
      companyId: '00000000-0000-0000-0000-000000000002',
      role: 'OWNER',
      tv: 0,
    });

    // 10 minutes later (within 15m TTL) -> valid
    fake.advanceMinutes(10);
    expect(verifyAccessToken(token).sub).toBe('00000000-0000-0000-0000-000000000001');

    // 6 more minutes later (16m total > 15m TTL) -> expired
    fake.advanceMinutes(6);
    expect(() => verifyAccessToken(token)).toThrow(/Invalid or expired access token/);
  });
});
