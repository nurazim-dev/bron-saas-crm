import { now as clockNow } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import { computeBillingState } from '../../modules/billing/billing-state.js';
import { getPlatformSettings } from '../../modules/platform/platform-settings.service.js';

export const BILLING_STATE_SYNC_JOB_NAME = 'billing-state-sync';
export const BILLING_STATE_SYNC_LOCK_KEY = 48201;

export async function runBillingStateSyncOnce(
  currentNow: Date = clockNow(),
): Promise<{ checked: number; updated: number }> {
  const [settings, subscriptions] = await Promise.all([
    getPlatformSettings(prisma),
    prisma.subscription.findMany({
      where: {
        company: { deletedAt: null },
      },
      select: {
        id: true,
        planId: true,
        isTrial: true,
        periodStartsAt: true,
        periodEndsAt: true,
        status: true,
      },
    }),
  ]);

  let updated = 0;
  for (const sub of subscriptions) {
    const computed = computeBillingState(sub, currentNow, { graceDays: settings.graceDays });
    if (computed.state !== sub.status) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: computed.state },
      });
      updated += 1;
    }
  }

  return { checked: subscriptions.length, updated };
}
