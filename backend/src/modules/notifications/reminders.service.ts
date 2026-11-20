import { DateTime } from 'luxon';
import { env } from '../../config/env.js';
import {
  type AppointmentStatus,
  type Locale,
  NotificationChannel,
  OutboxStatus,
  Prisma,
  ReminderMode,
  Role,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { addDaysToLocalDate, localDateTimeToUtc, utcToLocalParts } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import { REMINDABLE_STATUSES } from '../appointments/status-transitions.js';
import { computeBillingState } from '../billing/billing-state.js';
import { getPlatformSettings } from '../platform/platform-settings.service.js';
import { registerOutboxRecheckHook } from './dispatcher.service.js';
import { enqueue } from './outbox.service.js';

const REMINDER_KINDS = ['REMINDER_24H', 'REMINDER_2H'] as const;

function applyQuietHours(
  scheduledFor: Date,
  appointmentStartAt: Date,
  timezone: string,
): Date | null {
  const local = utcToLocalParts(scheduledFor, timezone);
  const hour = Number(local.time.slice(0, 2));
  let shifted = scheduledFor;

  if (hour >= 22) {
    const nextDate = addDaysToLocalDate(local.date, 1, timezone);
    shifted = localDateTimeToUtc(nextDate, '08:00', timezone);
  } else if (hour < 8) {
    shifted = localDateTimeToUtc(local.date, '08:00', timezone);
  }

  // Only send if shifted reminder is still at least 30 minutes before the appointment
  if (shifted.getTime() > appointmentStartAt.getTime() - 30 * 60_000) {
    return null;
  }

  return shifted;
}

export async function cancelPendingReminders(
  tx: TransactionClient,
  appointmentId: string,
): Promise<void> {
  await tx.outboxMessage.updateMany({
    where: {
      appointmentId,
      status: OutboxStatus.PENDING,
      kind: { in: [...REMINDER_KINDS] },
    },
    data: {
      status: OutboxStatus.CANCELLED,
      lastError: 'Cancelled due to appointment or settings change',
    },
  });
}

export async function cancelAllPendingCompanyReminders(
  tx: TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.outboxMessage.updateMany({
    where: {
      companyId,
      status: OutboxStatus.PENDING,
      kind: { in: [...REMINDER_KINDS] },
    },
    data: {
      status: OutboxStatus.CANCELLED,
      lastError: 'Company reminders disabled or switched mode',
    },
  });
}

export async function scheduleAppointmentReminders(
  tx: TransactionClient,
  params: {
    appointment: {
      id: string;
      companyId: string;
      clientId?: string;
      startAt: Date;
      clientPhone: string;
      clientLocale: Locale;
      manageToken: string;
      status: AppointmentStatus;
    };
    company: {
      id: string;
      name: string;
      address: string | null;
      timezone: string;
      reminderMode: ReminderMode;
      remind24h: boolean;
      remind2h: boolean;
    };
    serviceName: string;
    currentNow?: Date;
  },
): Promise<void> {
  const { appointment, company } = params;
  if (!REMINDABLE_STATUSES.includes(appointment.status)) return;

  const clientTelegramRow = await tx.client.findFirst({
    where: {
      companyId: company.id,
      ...(appointment.clientId ? { id: appointment.clientId } : { phone: appointment.clientPhone }),
    },
    select: { telegramChatId: true },
  });
  const clientTelegramChatId = clientTelegramRow?.telegramChatId ?? null;

  if (company.reminderMode !== ReminderMode.AUTO && !clientTelegramChatId) return;

  const currentNow = params.currentNow ?? clockNow();
  const channel =
    env.CLIENT_MESSAGE_PROVIDER.toLowerCase() === 'sms'
      ? NotificationChannel.SMS
      : NotificationChannel.WHATSAPP;

  const local = utcToLocalParts(appointment.startAt, company.timezone);
  const localDateTime = `${local.date} ${local.time}`;
  const manageUrl = `${env.APP_URL}/manage/${appointment.manageToken}`;

  const offsets: Array<{ enabled: boolean; hours: number; tag: '24h' | '2h'; kind: string }> = [
    { enabled: company.remind24h, hours: 24, tag: '24h', kind: 'REMINDER_24H' },
    { enabled: company.remind2h, hours: 2, tag: '2h', kind: 'REMINDER_2H' },
  ];

  for (const offset of offsets) {
    if (!offset.enabled) continue;
    const rawScheduled = DateTime.fromJSDate(appointment.startAt, { zone: 'utc' })
      .minus({ hours: offset.hours })
      .toJSDate();
    if (rawScheduled.getTime() <= currentNow.getTime()) {
      continue; // Never send late reminders
    }
    const scheduledFor = applyQuietHours(rawScheduled, appointment.startAt, company.timezone);
    if (!scheduledFor || scheduledFor.getTime() <= currentNow.getTime()) {
      continue;
    }

    if (company.reminderMode === ReminderMode.AUTO) {
      await enqueue(tx, {
        companyId: company.id,
        channel,
        kind: offset.kind,
        recipient: appointment.clientPhone,
        appointmentId: appointment.id,
        locale: appointment.clientLocale,
        scheduledFor,
        payload: {
          companyName: company.name,
          serviceName: params.serviceName,
          localDateTime,
          address: company.address ?? '',
          manageUrl,
        },
        dedupeKey: `reminder:${appointment.id}:${appointment.startAt.toISOString()}:${offset.tag}`,
      });
    }

    if (clientTelegramChatId) {
      await enqueue(tx, {
        companyId: company.id,
        channel: NotificationChannel.TELEGRAM,
        kind: offset.kind,
        recipient: clientTelegramChatId,
        appointmentId: appointment.id,
        locale: appointment.clientLocale,
        scheduledFor,
        payload: {
          companyName: company.name,
          serviceName: params.serviceName,
          localDateTime,
          address: company.address ?? '',
          manageUrl,
          replyMarkup: {
            inline_keyboard: [
              [
                { text: '📋 Мои записи', callback_data: 'client:my' },
                {
                  text: '❌ Отменить запись',
                  callback_data: `client:cancel:${appointment.id}`,
                },
              ],
            ],
          },
        },
        dedupeKey: `reminder-tg:${appointment.id}:${appointment.startAt.toISOString()}:${offset.tag}`,
      });
    }
  }
}

export async function backfillCompanyAutoReminders(
  tx: TransactionClient,
  companyId: string,
): Promise<void> {
  const currentNow = clockNow();
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      address: true,
      timezone: true,
      reminderMode: true,
      remind24h: true,
      remind2h: true,
    },
  });
  if (!company || company.reminderMode !== ReminderMode.AUTO) return;

  const futureAppts = await tx.appointment.findMany({
    where: {
      companyId,
      deletedAt: null,
      status: { in: [...REMINDABLE_STATUSES] },
      startAt: { gt: currentNow },
    },
    include: {
      service: { select: { name: true } },
      items: { orderBy: { position: 'asc' }, select: { name: true } },
    },
  });

  for (const appt of futureAppts) {
    await scheduleAppointmentReminders(tx, {
      appointment: appt,
      company,
      serviceName: appt.items.length
        ? appt.items.map((item) => item.name).join(' + ')
        : appt.service.name,
      currentNow,
    });
  }
}

export function buildManualReminderWhatsappUrl(params: {
  phone: string;
  locale: Locale;
  companyName: string;
  serviceName: string;
  localDateTime: string;
  address: string | null;
  manageUrl: string;
}): string {
  const digits = params.phone.replace(/[^\d]/g, '');
  const lines =
    params.locale === 'KY'
      ? [
          `${params.companyName}: жазылууңузду эскертебиз.`,
          `Кызмат: ${params.serviceName}`,
          `Убактысы: ${params.localDateTime}`,
          ...(params.address ? [`Дареги: ${params.address}`] : []),
          `Башкаруу: ${params.manageUrl}`,
        ]
      : params.locale === 'EN'
        ? [
            `${params.companyName}: appointment reminder.`,
            `Service: ${params.serviceName}`,
            `Date & time: ${params.localDateTime}`,
            ...(params.address ? [`Address: ${params.address}`] : []),
            `Manage appointment: ${params.manageUrl}`,
          ]
        : [
            `${params.companyName}: напоминаем о вашей записи.`,
            `Услуга: ${params.serviceName}`,
            `Дата и время: ${params.localDateTime}`,
            ...(params.address ? [`Адрес: ${params.address}`] : []),
            `Управление записью: ${params.manageUrl}`,
          ];
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

export async function listManualRemindersQueue(actor: AuthenticatedActor) {
  const currentNow = clockNow();
  const horizon = DateTime.fromJSDate(currentNow, { zone: 'utc' }).plus({ hours: 48 }).toJSDate();

  const company = await prisma.company.findUnique({
    where: { id: actor.companyId },
    select: {
      id: true,
      name: true,
      address: true,
      timezone: true,
      reminderMode: true,
    },
  });
  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
      deletedAt: null,
      status: { in: [...REMINDABLE_STATUSES] },
      manualReminderSentAt: null,
      startAt: { gt: currentNow, lte: horizon },
    },
    include: {
      service: { select: { name: true } },
      items: { orderBy: { position: 'asc' }, select: { name: true } },
      master: { select: { id: true, name: true } },
    },
    orderBy: { startAt: 'asc' },
    take: 100,
  });

  return {
    reminderMode: company.reminderMode,
    items: appointments.map((a) => {
      const local = utcToLocalParts(a.startAt, company.timezone);
      const localDateTime = `${local.date} ${local.time}`;
      const manageUrl = `${env.APP_URL}/manage/${a.manageToken}`;
      return {
        id: a.id,
        clientName: a.clientName,
        clientPhone: a.clientPhone,
        clientLocale: a.clientLocale,
        startAt: a.startAt.toISOString(),
        serviceName: a.service.name,
        masterName: a.master.name,
        whatsappUrl: buildManualReminderWhatsappUrl({
          phone: a.clientPhone,
          locale: a.clientLocale,
          companyName: company.name,
          serviceName: a.service.name,
          localDateTime,
          address: company.address,
          manageUrl,
        }),
      };
    }),
  };
}

export async function markManualReminderSent(actor: AuthenticatedActor, appointmentId: string) {
  const currentNow = clockNow();
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
    },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  const updated = await prisma.appointment.update({
    where: { id: existing.id },
    data: { manualReminderSentAt: currentNow },
    select: { id: true, manualReminderSentAt: true },
  });

  return {
    id: updated.id,
    manualReminderSentAt: updated.manualReminderSentAt?.toISOString() ?? null,
  };
}

let hooksRegistered = false;

export function registerReminderOutboxHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  for (const kind of REMINDER_KINDS) {
    registerOutboxRecheckHook(kind, async (db, message, currentNow) => {
      if (!message.appointmentId || !message.companyId) {
        return { skip: true, reason: 'MISSING_APPOINTMENT' };
      }

      const appt = await db.appointment.findUnique({
        where: { id: message.appointmentId },
        include: {
          company: {
            include: {
              subscription: {
                include: { plan: true },
              },
            },
          },
        },
      });

      if (!appt || appt.deletedAt !== null || !REMINDABLE_STATUSES.includes(appt.status)) {
        return { skip: true, reason: 'APPOINTMENT_NOT_SCHEDULED' };
      }

      const { company } = appt;
      if (company.deletedAt !== null || company.suspendedAt !== null) {
        return { skip: true, reason: 'COMPANY_UNAVAILABLE' };
      }

      if (
        message.channel !== NotificationChannel.TELEGRAM &&
        company.reminderMode !== ReminderMode.AUTO
      ) {
        return { skip: true, reason: 'REMINDER_MODE_CHANGED' };
      }

      if (message.channel !== NotificationChannel.TELEGRAM && company.subscription) {
        const settings = await getPlatformSettings(db);
        const billingState = computeBillingState(
          {
            planId: company.subscription.planId,
            isTrial: company.subscription.isTrial,
            periodStartsAt: company.subscription.periodStartsAt,
            periodEndsAt: company.subscription.periodEndsAt,
          },
          currentNow,
          { graceDays: settings.graceDays },
        );
        if (billingState.state === 'LOCKED') {
          return { skip: true, reason: 'COMPANY_LOCKED' };
        }

        const cap = company.subscription.plan.maxRemindersPerMonth;
        if (cap !== null) {
          const localDt = DateTime.fromJSDate(currentNow, { zone: company.timezone });
          const monthStartUtc = localDt.startOf('month').toUTC().toJSDate();
          const nextMonthStartUtc = localDt.startOf('month').plus({ months: 1 }).toUTC().toJSDate();
          const yearMonth = localDt.toFormat('yyyy-MM');

          const sentThisMonth = await db.outboxMessage.count({
            where: {
              companyId: company.id,
              kind: { in: [...REMINDER_KINDS] },
              status: OutboxStatus.SENT,
              sentAt: { gte: monthStartUtc, lt: nextMonthStartUtc },
            },
          });

          if (sentThisMonth >= cap) {
            const owner = await db.user.findFirst({
              where: { companyId: company.id, role: Role.OWNER, isActive: true, deletedAt: null },
              select: { id: true, email: true },
            });
            if (owner) {
              const existingInApp = await db.inAppNotification.findFirst({
                where: {
                  companyId: company.id,
                  userId: owner.id,
                  kind: 'PLAN_REMINDER_CAP_REACHED',
                  createdAt: { gte: monthStartUtc, lt: nextMonthStartUtc },
                },
                select: { id: true },
              });
              if (!existingInApp) {
                await db.inAppNotification.create({
                  data: {
                    companyId: company.id,
                    userId: owner.id,
                    kind: 'PLAN_REMINDER_CAP_REACHED',
                    title: 'Лимит авто-напоминаний исчерпан',
                    body: `Достигнут месячный лимит (${cap}) авто-напоминаний. Перейдите на более высокий тариф.`,
                  },
                });
              }
              if (owner.email) {
                await db.$queryRaw(Prisma.sql`
                  INSERT INTO "OutboxMessage" (
                    "id", "companyId", "channel", "kind", "recipient", "toUserId", "locale",
                    "payload", "dedupeKey", "status", "attempts", "maxAttempts", "scheduledFor", "updatedAt"
                  )
                  VALUES (
                    gen_random_uuid(), ${company.id}::uuid, 'EMAIL'::"NotificationChannel",
                    'PLAN_REMINDER_CAP_REACHED', ${owner.email}, ${owner.id}::uuid, 'RU'::"Locale",
                    ${JSON.stringify({ companyName: company.name })}::jsonb,
                    ${`plan-reminder-cap:${company.id}:${yearMonth}`},
                    'PENDING'::"OutboxStatus", 0, 5, ${currentNow}, ${currentNow}
                  )
                  ON CONFLICT ("dedupeKey") DO NOTHING
                `);
              }
            }
            return { skip: true, reason: 'PLAN_LIMIT' };
          }
        }
      }

      return { skip: false };
    });
  }
}
