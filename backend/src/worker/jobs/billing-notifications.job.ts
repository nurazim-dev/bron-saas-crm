import {
  Locale,
  NotificationChannel,
  Role,
  SubscriptionStatus,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import { computeBillingState } from '../../modules/billing/billing-state.js';
import { createInAppNotification } from '../../modules/notifications/in-app.service.js';
import { enqueue } from '../../modules/notifications/outbox.service.js';
import { getPlatformSettings } from '../../modules/platform/platform-settings.service.js';

export const BILLING_NOTIFICATIONS_JOB_NAME = 'billing-notifications';
export const BILLING_NOTIFICATIONS_LOCK_KEY = 48202;

const MS_PER_DAY = 86_400_000;

export async function runBillingNotificationsOnce(
  currentNow: Date = clockNow(),
): Promise<{ checked: number; enqueued: number }> {
  const [settings, subscriptions] = await Promise.all([
    getPlatformSettings(prisma),
    prisma.subscription.findMany({
      where: {
        company: { deletedAt: null },
      },
      include: {
        company: {
          include: {
            users: {
              where: { role: Role.OWNER, isActive: true, deletedAt: null },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  let enqueued = 0;

  for (const sub of subscriptions) {
    const owner = sub.company.users[0];
    if (!owner) {
      continue;
    }

    const computed = computeBillingState(sub, currentNow, { graceDays: settings.graceDays });
    const periodKey = sub.periodEndsAt.toISOString().slice(0, 10);

    let kind: string | null = null;
    let title = '';
    let body = '';
    let dedupeKey = '';
    const payload: Record<string, unknown> = {
      companyName: sub.company.name,
      daysLeft: computed.daysLeft,
      periodEndIso: sub.periodEndsAt.toISOString(),
    };

    if (
      (computed.state === SubscriptionStatus.TRIAL ||
        computed.state === SubscriptionStatus.ACTIVE) &&
      computed.daysLeft <= 3 &&
      computed.daysLeft >= 1
    ) {
      kind = 'BILLING_TRIAL_EXPIRING';
      title = `Подписка заканчивается через ${computed.daysLeft} дн.`;
      body = 'Продлите тариф в разделе «Оплата и тариф», чтобы избежать ограничений.';
      dedupeKey = `billing:t-3:${sub.companyId}:${periodKey}`;
    } else if (computed.state === SubscriptionStatus.PAST_DUE) {
      const msUntilLock = computed.graceEndsAt.getTime() - currentNow.getTime();
      if (msUntilLock <= MS_PER_DAY && settings.graceDays >= 1) {
        kind = 'BILLING_GRACE_ENDING';
        title = 'Льготный период заканчивается';
        body = 'После окончания льготного периода кабинет перейдёт в режим только чтения.';
        dedupeKey = `billing:grace-ending:${sub.companyId}:${periodKey}`;
      } else {
        kind = 'BILLING_PERIOD_ENDED';
        title = 'Период подписки завершён';
        body = 'Включён льготный период. Пожалуйста, оформите продление.';
        dedupeKey = `billing:t-0:${sub.companyId}:${periodKey}`;
      }
    } else if (computed.state === SubscriptionStatus.LOCKED) {
      kind = 'BILLING_LOCKED';
      title = 'Кабинет переведён в режим только чтения';
      body = 'Подписка не продлена. Продлите тариф в разделе «Оплата и тариф».';
      dedupeKey = `billing:locked:${sub.companyId}:${periodKey}`;
    }

    if (!kind || !owner.email) {
      continue;
    }

    const outboxRes = await enqueue(prisma, {
      companyId: sub.companyId,
      channel: NotificationChannel.EMAIL,
      kind,
      recipient: owner.email,
      toUserId: owner.id,
      locale: Locale.RU,
      payload,
      dedupeKey,
    });

    if (outboxRes.enqueued) {
      await createInAppNotification(prisma, {
        companyId: sub.companyId,
        userId: owner.id,
        kind,
        title,
        body,
        data: payload,
      });
      enqueued += 1;
    }
  }

  return { checked: subscriptions.length, enqueued };
}
