import { DateTime } from 'luxon';
import type { SubscriptionStatus } from '../../generated/prisma/client.js';

export type BillingState = SubscriptionStatus;

export interface BillingSubscriptionInput {
  planId: string;
  isTrial: boolean;
  periodStartsAt: Date;
  periodEndsAt: Date;
}

export interface BillingSettingsInput {
  graceDays: number;
}

export interface BillingStateResult {
  state: BillingState;
  isTrial: boolean;
  daysLeft: number;
  periodStartsAt: Date;
  periodEndsAt: Date;
  graceEndsAt: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Pure source-of-truth billing state machine (BR-19).
 * - now < periodEndsAt -> TRIAL (if isTrial) or ACTIVE
 * - periodEndsAt <= now < periodEndsAt + graceDays -> PAST_DUE
 * - now >= periodEndsAt + graceDays -> LOCKED
 */
export function computeBillingState(
  sub: BillingSubscriptionInput,
  now: Date,
  settings: BillingSettingsInput,
): BillingStateResult {
  const graceDays = Math.max(0, Math.floor(settings.graceDays));
  const graceEndsAt = DateTime.fromJSDate(sub.periodEndsAt, { zone: 'utc' })
    .plus({ days: graceDays })
    .toJSDate();

  const nowMs = now.getTime();
  const periodEndMs = sub.periodEndsAt.getTime();
  const graceEndMs = graceEndsAt.getTime();

  let state: BillingState;
  let daysLeft = 0;

  if (nowMs < periodEndMs) {
    state = sub.isTrial ? 'TRIAL' : 'ACTIVE';
    daysLeft = Math.max(0, Math.ceil((periodEndMs - nowMs) / MS_PER_DAY));
  } else if (nowMs < graceEndMs) {
    state = 'PAST_DUE';
    daysLeft = 0;
  } else {
    state = 'LOCKED';
    daysLeft = 0;
  }

  return {
    state,
    isTrial: sub.isTrial,
    daysLeft,
    periodStartsAt: sub.periodStartsAt,
    periodEndsAt: sub.periodEndsAt,
    graceEndsAt,
  };
}

export interface ConfirmedPeriodResult {
  periodStartsAt: Date;
  periodEndsAt: Date;
}

/**
 * Computes the new subscription period on payment confirmation (BR-19).
 * - Unchanged plan: start = max(now, current.periodEndsAt), end = start + months (calendar months, UTC).
 * - Plan switch: takes effect immediately; end = now + months + remainingWholeDaysOfOldPeriod.
 */
export function computeConfirmedPeriod(
  current: { planId: string; periodEndsAt: Date },
  newPlanId: string,
  months: number,
  now: Date,
): ConfirmedPeriodResult {
  if (current.planId === newPlanId) {
    const start = current.periodEndsAt.getTime() > now.getTime() ? current.periodEndsAt : now;
    const end = DateTime.fromJSDate(start, { zone: 'utc' }).plus({ months }).toJSDate();
    return { periodStartsAt: start, periodEndsAt: end };
  }

  const remainingMs = current.periodEndsAt.getTime() - now.getTime();
  const remainingWholeDays = remainingMs > 0 ? Math.floor(remainingMs / MS_PER_DAY) : 0;
  const end = DateTime.fromJSDate(now, { zone: 'utc' })
    .plus({ months, days: remainingWholeDays })
    .toJSDate();

  return { periodStartsAt: now, periodEndsAt: end };
}
