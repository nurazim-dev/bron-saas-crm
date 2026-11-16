import { describe, expect, it } from 'vitest';
import {
  computeBillingState,
  computeConfirmedPeriod,
} from '../../src/modules/billing/billing-state.js';

describe('Billing state machine (pure BR-19)', () => {
  const periodStartsAt = new Date('2026-11-01T00:00:00.000Z');
  const periodEndsAt = new Date('2026-11-15T00:00:00.000Z');

  it('transitions TRIAL -> PAST_DUE -> LOCKED across exact millisecond boundaries', () => {
    const sub = { planId: 'plan-1', isTrial: true, periodStartsAt, periodEndsAt };
    const settings = { graceDays: 3 };

    // 1 ms before periodEndsAt -> TRIAL, daysLeft = 1
    const beforeEnd = computeBillingState(sub, new Date('2026-11-14T23:59:59.999Z'), settings);
    expect(beforeEnd.state).toBe('TRIAL');
    expect(beforeEnd.daysLeft).toBe(1);
    expect(beforeEnd.graceEndsAt.toISOString()).toBe('2026-11-18T00:00:00.000Z');

    // Exactly at periodEndsAt -> PAST_DUE, daysLeft = 0
    const atEnd = computeBillingState(sub, new Date('2026-11-15T00:00:00.000Z'), settings);
    expect(atEnd.state).toBe('PAST_DUE');
    expect(atEnd.daysLeft).toBe(0);

    // 1 ms before graceEndsAt -> PAST_DUE
    const beforeGraceEnd = computeBillingState(sub, new Date('2026-11-17T23:59:59.999Z'), settings);
    expect(beforeGraceEnd.state).toBe('PAST_DUE');

    // Exactly at graceEndsAt -> LOCKED
    const atGraceEnd = computeBillingState(sub, new Date('2026-11-18T00:00:00.000Z'), settings);
    expect(atGraceEnd.state).toBe('LOCKED');
    expect(atGraceEnd.daysLeft).toBe(0);
  });

  it('returns ACTIVE when isTrial=false and jumps directly to LOCKED when graceDays=0', () => {
    const sub = { planId: 'plan-1', isTrial: false, periodStartsAt, periodEndsAt };

    const active = computeBillingState(sub, new Date('2026-11-10T12:00:00.000Z'), {
      graceDays: 0,
    });
    expect(active.state).toBe('ACTIVE');
    expect(active.daysLeft).toBe(5);

    const lockedImmediately = computeBillingState(sub, new Date('2026-11-15T00:00:00.000Z'), {
      graceDays: 0,
    });
    expect(lockedImmediately.state).toBe('LOCKED');
  });

  it('computes confirmed period for same-plan renewal (active and expired) and plan switches', () => {
    const now = new Date('2026-11-10T12:00:00.000Z');

    // Same plan, still active (ends Nov 15): extends from Nov 15 + 1 calendar month = Dec 15
    const sameActive = computeConfirmedPeriod(
      { planId: 'p1', periodEndsAt: new Date('2026-11-15T00:00:00.000Z') },
      'p1',
      1,
      now,
    );
    expect(sameActive.periodStartsAt.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(sameActive.periodEndsAt.toISOString()).toBe('2026-12-15T00:00:00.000Z');

    // Same plan, already expired (ended Nov 5): starts from now (Nov 10) + 3 months = Feb 10
    const sameExpired = computeConfirmedPeriod(
      { planId: 'p1', periodEndsAt: new Date('2026-11-05T00:00:00.000Z') },
      'p1',
      3,
      now,
    );
    expect(sameExpired.periodStartsAt.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(sameExpired.periodEndsAt.toISOString()).toBe('2027-02-10T12:00:00.000Z');

    // Plan switch with 4.5 remaining days -> floor = 4 days added on top of 1 month from now
    const switched = computeConfirmedPeriod(
      { planId: 'p1', periodEndsAt: new Date('2026-11-15T00:00:00.000Z') },
      'p2',
      1,
      now,
    );
    expect(switched.periodStartsAt.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(switched.periodEndsAt.toISOString()).toBe('2026-12-14T12:00:00.000Z');
  });
});
