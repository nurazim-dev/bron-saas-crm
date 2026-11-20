import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  AppointmentStatus,
  BusinessPaymentKind,
  BusinessPaymentStatus,
  Role,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import {
  addDaysToLocalDate,
  addDurationMsUtc,
  getLocalDayBoundsUtc,
  utcToLocalParts,
} from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import { changeAppointmentStatusForActor } from '../appointments/appointments.service.js';
import {
  EDITABLE_APPOINTMENT_STATUSES,
  UPCOMING_ACTIVE_STATUSES,
} from '../appointments/status-transitions.js';
import type { DbClient } from '../availability/availability.service.js';
import { assertWritableSubscription } from '../billing/billing.service.js';
import { cancelPublicManageAppointment } from '../public/public-manage.service.js';
import { enqueue } from './outbox.service.js';
import { escapeTelegramHtml } from './providers/telegram.provider.js';
import type { TelegramReplyMarkup } from './providers/types.js';

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number | string; type?: string };
    };
  };
}

const STATUS_LABELS_RU: Record<AppointmentStatus, string> = {
  SCHEDULED: '⏳ Ожидает',
  CONFIRMED: '✅ Подтверждена',
  IN_PROGRESS: '✂️ В работе',
  COMPLETED: '🏁 Завершена',
  NO_SHOW: '🚫 Не пришёл',
  CANCELLED: '❌ Отменена',
};

const ROLE_LABELS_RU: Record<Role, string> = {
  OWNER: 'Владелец',
  MANAGER: 'Менеджер',
  MASTER: 'Мастер',
};

function buildStaffMainMenuKeyboard(
  role: Role,
  hasMultipleCompanies: boolean,
): TelegramReplyMarkup {
  const rows: TelegramReplyMarkup['inline_keyboard'] = [
    [
      { text: '📅 Сегодня', callback_data: 'cmd:today' },
      { text: '📆 Завтра', callback_data: 'cmd:tomorrow' },
    ],
    [{ text: '📋 Ближайшие записи', callback_data: 'cmd:upcoming' }],
  ];
  if (role === Role.OWNER || role === Role.MANAGER) {
    rows.push([{ text: '📊 Сводка за сегодня', callback_data: 'cmd:stats' }]);
  }
  if (hasMultipleCompanies) {
    rows.push([{ text: '🏢 Переключить компанию', callback_data: 'cmd:companies' }]);
  }
  rows.push([
    { text: '🔔 Уведомления', callback_data: 'cmd:settings' },
    { text: '🧹 Очистить чат', callback_data: 'cmd:clear' },
  ]);
  return { inline_keyboard: rows };
}

function buildClientMainMenuKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📋 Мои записи', callback_data: 'client:my' },
        { text: '🧹 Очистить чат', callback_data: 'cmd:clear' },
      ],
    ],
  };
}

function buildAppointmentActionsKeyboard(
  appointmentId: string,
  status: AppointmentStatus,
): TelegramReplyMarkup {
  const rows: TelegramReplyMarkup['inline_keyboard'] = [];
  if (status === AppointmentStatus.SCHEDULED) {
    rows.push([
      { text: '✅ Подтвердить', callback_data: `appt:${appointmentId}:CONFIRMED` },
      { text: '✂️ Начать', callback_data: `appt:${appointmentId}:IN_PROGRESS` },
    ]);
    rows.push([
      { text: '🏁 Завершить', callback_data: `appt:${appointmentId}:COMPLETED` },
      { text: '🚫 Не пришёл', callback_data: `appt:${appointmentId}:NO_SHOW` },
    ]);
    rows.push([{ text: '❌ Отменить', callback_data: `appt:${appointmentId}:CANCELLED` }]);
  } else if (status === AppointmentStatus.CONFIRMED) {
    rows.push([
      { text: '✂️ Начать', callback_data: `appt:${appointmentId}:IN_PROGRESS` },
      { text: '🏁 Завершить', callback_data: `appt:${appointmentId}:COMPLETED` },
    ]);
    rows.push([
      { text: '🚫 Не пришёл', callback_data: `appt:${appointmentId}:NO_SHOW` },
      { text: '❌ Отменить', callback_data: `appt:${appointmentId}:CANCELLED` },
    ]);
  } else if (status === AppointmentStatus.IN_PROGRESS) {
    rows.push([
      { text: '🏁 Завершить', callback_data: `appt:${appointmentId}:COMPLETED` },
      { text: '❌ Отменить', callback_data: `appt:${appointmentId}:CANCELLED` },
    ]);
  }
  rows.push([{ text: '⬅️ В меню', callback_data: 'cmd:menu' }]);
  return { inline_keyboard: rows };
}

export async function getMyNotificationSettings(actor: AuthenticatedActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId, companyId: actor.companyId },
    select: {
      notifyEmail: true,
      notifyTelegram: true,
      telegramChatId: true,
    },
  });
  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'User not found');
  }
  return {
    notifyEmail: user.notifyEmail,
    notifyTelegram: user.notifyTelegram,
    telegramConnected: Boolean(user.telegramChatId),
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || null,
  };
}

export async function updateMyNotificationSettings(
  actor: AuthenticatedActor,
  input: { notifyEmail?: boolean; notifyTelegram?: boolean },
) {
  await getMyNotificationSettings(actor);
  const updated = await prisma.user.update({
    where: { id: actor.userId, companyId: actor.companyId },
    data: {
      ...(input.notifyEmail !== undefined ? { notifyEmail: input.notifyEmail } : {}),
      ...(input.notifyTelegram !== undefined ? { notifyTelegram: input.notifyTelegram } : {}),
    },
    select: {
      notifyEmail: true,
      notifyTelegram: true,
      telegramChatId: true,
    },
  });

  return {
    notifyEmail: updated.notifyEmail,
    notifyTelegram: updated.notifyTelegram,
    telegramConnected: Boolean(updated.telegramChatId),
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || null,
  };
}

export async function createTelegramLinkCode(actor: AuthenticatedActor) {
  await getMyNotificationSettings(actor);
  return issueTelegramLinkCodeForUser(actor.companyId, actor.userId);
}

export async function createStaffTelegramLinkCodeForCompany(companyId: string, staffId: string) {
  const staff = await prisma.user.findFirst({
    where: { id: staffId, companyId, deletedAt: null },
    select: { id: true, name: true, telegramChatId: true },
  });
  if (!staff) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }
  return issueTelegramLinkCodeForUser(companyId, staff.id);
}

async function issueTelegramLinkCodeForUser(companyId: string, userId: string) {
  const currentNow = clockNow();
  const code = randomBytes(16).toString('base64url');
  const codeHash = sha256Hex(code);
  const expiresAt = addDurationMsUtc(currentNow, 15 * 60_000);

  await prisma.user.update({
    where: { id: userId, companyId },
    data: {
      telegramLinkCodeHash: codeHash,
      telegramLinkCodeExpiresAt: expiresAt,
    },
  });

  const botUsername = env.TELEGRAM_BOT_USERNAME.trim() || 'zapis_kg_bot';
  return {
    code,
    expiresAt: expiresAt.toISOString(),
    deepLink: `https://t.me/${botUsername}?start=${code}`,
  };
}

export async function unlinkTelegram(actor: AuthenticatedActor): Promise<void> {
  await getMyNotificationSettings(actor);
  await prisma.user.update({
    where: { id: actor.userId, companyId: actor.companyId },
    data: {
      telegramChatId: null,
      telegramLinkCodeHash: null,
      telegramLinkCodeExpiresAt: null,
    },
  });
}

export async function unlinkStaffTelegramForCompany(
  companyId: string,
  staffId: string,
): Promise<void> {
  const staff = await prisma.user.findFirst({
    where: { id: staffId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!staff) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }
  await prisma.user.update({
    where: { id: staff.id, companyId },
    data: {
      telegramChatId: null,
      telegramLinkCodeHash: null,
      telegramLinkCodeExpiresAt: null,
    },
  });
}

export function verifyTelegramWebhookSecret(headerValue: string | undefined): void {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    throw new AppError('FORBIDDEN', 403, 'Telegram webhook is not configured');
  }
  const actual = Buffer.from(headerValue ?? '', 'utf8');
  const expected = Buffer.from(env.TELEGRAM_WEBHOOK_SECRET, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError('FORBIDDEN', 403, 'Invalid Telegram webhook secret');
  }
}

async function queueReply(
  db: DbClient,
  chatId: string,
  text: string,
  dedupeKey: string,
  companyId?: string,
  options?: { replyMarkup?: TelegramReplyMarkup; telegramHtml?: string },
) {
  await enqueue(db, {
    companyId,
    channel: 'TELEGRAM',
    kind: 'GENERIC',
    recipient: chatId,
    payload: {
      subject: 'Zapis.kg',
      text,
      ...(options?.telegramHtml ? { telegramHtml: options.telegramHtml } : {}),
      ...(options?.replyMarkup ? { replyMarkup: options.replyMarkup } : {}),
    },
    dedupeKey,
  });
}

async function tryDeleteRecentBotMessages(
  chatId: string,
  triggerMessageId?: number,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN.trim() || !triggerMessageId) return;
  const startId = Math.max(1, triggerMessageId - 15);
  const requests: Promise<unknown>[] = [];
  for (let msgId = triggerMessageId; msgId >= startId; msgId -= 1) {
    requests.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
      }).catch(() => undefined),
    );
  }
  await Promise.all(requests);
}

async function tryAnswerCallbackQuery(callbackQueryId?: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN.trim() || !callbackQueryId) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => undefined);
}

async function resolveActiveStaffByChatId(tx: DbClient, chatId: string) {
  const directUser = await tx.user.findFirst({
    where: {
      telegramChatId: chatId,
      isActive: true,
      deletedAt: null,
      company: { deletedAt: null, suspendedAt: null },
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          currency: true,
        },
      },
      identity: {
        include: {
          members: {
            where: {
              isActive: true,
              deletedAt: null,
              company: { deletedAt: null, suspendedAt: null },
            },
            include: {
              company: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  timezone: true,
                  currency: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!directUser) return null;

  const memberships = directUser.identity?.members ?? [directUser];
  const preferredCompanyId = directUser.identity?.lastCompanyId;
  const activeMember =
    (preferredCompanyId ? memberships.find((m) => m.companyId === preferredCompanyId) : null) ??
    directUser;

  return {
    directUser,
    activeMember,
    memberships,
    hasMultipleCompanies: memberships.length > 1,
  };
}

export async function processTelegramUpdate(update: TelegramWebhookUpdate): Promise<void> {
  const isCallback = Boolean(update.callback_query);
  const rawChatId = isCallback
    ? update.callback_query?.message?.chat?.id
    : update.message?.chat?.id;
  const triggerMessageId = isCallback
    ? update.callback_query?.message?.message_id
    : update.message?.message_id;
  const rawInput = isCallback
    ? (update.callback_query?.data ?? '').trim()
    : (update.message?.text ?? '').trim();

  if (rawChatId === undefined || rawChatId === null) return;
  const chatId = String(rawChatId);

  if (isCallback && update.callback_query?.id) {
    await tryAnswerCallbackQuery(update.callback_query.id);
  }

  const updateKeyId = update.update_id ?? randomUUID();
  const baseKey = `telegram-update:${chatId}:${updateKeyId}`;

  // Handle status change or client cancel outside the advisory-locked transaction when needed,
  // or inside with service helpers. Let's check deduplication first.
  const alreadyProcessed = await prisma.outboxMessage.findFirst({
    where: {
      OR: [{ dedupeKey: baseKey }, { dedupeKey: { startsWith: `${baseKey}:` } }],
    },
    select: { id: true },
  });
  if (alreadyProcessed) return;

  if (rawInput === '/clear' || rawInput === 'cmd:clear') {
    await tryDeleteRecentBotMessages(chatId, triggerMessageId);
  }

  // Handle staff appointment status callback (`appt:<id>:<STATUS>`)
  if (rawInput.startsWith('appt:')) {
    const [, appointmentId, rawStatus] = rawInput.split(':');
    const validStatuses: readonly string[] = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.CANCELLED,
    ];
    if (appointmentId && rawStatus && validStatuses.includes(rawStatus)) {
      const ctx = await resolveActiveStaffByChatId(prisma, chatId);
      if (!ctx) {
        await queueReply(
          prisma,
          chatId,
          'Аккаунт сотрудника не привязан. Подключите Telegram в кабинете Zapis.kg.',
          baseKey,
        );
        return;
      }
      const actor: AuthenticatedActor = {
        userId: ctx.activeMember.id,
        companyId: ctx.activeMember.companyId,
        role: ctx.activeMember.role,
        tokenVersion: ctx.activeMember.tokenVersion,
      };
      try {
        await assertWritableSubscription(ctx.activeMember.companyId);
        const updated = await changeAppointmentStatusForActor(actor, appointmentId, {
          status: rawStatus as AppointmentStatus,
        });
        const local = utcToLocalParts(updated.startAt, ctx.activeMember.company.timezone);
        const statusLabel = STATUS_LABELS_RU[updated.status];
        const text = [
          `Статус записи обновлён: ${statusLabel}`,
          `Клиент: ${updated.clientName} (${updated.clientPhone})`,
          `Услуга: ${updated.service.name}`,
          `Мастер: ${updated.master.name}`,
          `Время: ${local.date} ${local.time}`,
        ].join('\n');
        await queueReply(prisma, chatId, text, baseKey, ctx.activeMember.companyId, {
          replyMarkup: buildAppointmentActionsKeyboard(updated.id, updated.status),
        });
      } catch (err) {
        const msg =
          err instanceof AppError
            ? `Не удалось изменить статус (${err.code}): ${err.message}`
            : 'Не удалось изменить статус записи.';
        await queueReply(prisma, chatId, msg, baseKey, ctx.activeMember.companyId, {
          replyMarkup: buildStaffMainMenuKeyboard(ctx.activeMember.role, ctx.hasMultipleCompanies),
        });
      }
      return;
    }
  }

  // Handle client cancellation callback (`client:cancel:<appointmentId>`)
  if (rawInput.startsWith('client:cancel:')) {
    const appointmentId = rawInput.slice('client:cancel:'.length).trim();
    const appt = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        deletedAt: null,
        client: { telegramChatId: chatId },
      },
      include: { company: true, service: true },
    });
    if (!appt) {
      await queueReply(prisma, chatId, 'Запись не найдена.', baseKey, undefined, {
        replyMarkup: buildClientMainMenuKeyboard(),
      });
      return;
    }
    try {
      await cancelPublicManageAppointment(appt.manageToken, {
        reason: 'Отменено клиентом через Telegram-бот',
      });
      const local = utcToLocalParts(appt.startAt, appt.company.timezone);
      await queueReply(
        prisma,
        chatId,
        `❌ Ваша запись в «${appt.company.name}» на ${local.date} ${local.time} (${appt.service.name}) отменена.`,
        baseKey,
        appt.companyId,
        { replyMarkup: buildClientMainMenuKeyboard() },
      );
    } catch (err) {
      const msg =
        err instanceof AppError && err.code === 'CHANGE_NOT_ALLOWED'
          ? `Онлайн-отмена уже недоступна (менее чем за ${appt.company.clientCancelMinHours} ч. до визита). Пожалуйста, свяжитесь с салоном.`
          : 'Не удалось отменить запись.';
      await queueReply(prisma, chatId, msg, baseKey, appt.companyId, {
        replyMarkup: buildClientMainMenuKeyboard(),
      });
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chatId},0))::text`;
    const dup = await tx.outboxMessage.findFirst({
      where: {
        OR: [{ dedupeKey: baseKey }, { dedupeKey: { startsWith: `${baseKey}:` } }],
      },
      select: { id: true },
    });
    if (dup) return;

    let subSeq = 0;
    const reply = (
      message: string,
      companyId?: string,
      options?: { replyMarkup?: TelegramReplyMarkup; telegramHtml?: string },
    ) => {
      const k = subSeq === 0 ? baseKey : `${baseKey}:${subSeq}`;
      subSeq += 1;
      return queueReply(tx, chatId, message, k, companyId, options);
    };

    // 1. /start or /start <token>
    if (rawInput === '/start' || rawInput.startsWith('/start ')) {
      const code = rawInput.slice(6).trim();

      // Client deep-link: /start client_<manageToken>
      if (code.startsWith('client_')) {
        const manageToken = code.slice('client_'.length).trim();
        const appt = await tx.appointment.findUnique({
          where: { manageToken },
          include: {
            company: true,
            service: true,
            items: { orderBy: { position: 'asc' } },
            master: true,
            client: true,
          },
        });
        if (!appt || appt.deletedAt !== null || appt.company.deletedAt !== null) {
          await reply('Ссылка записи недействительна или устарела.');
          return;
        }
        await tx.client.update({
          where: { id: appt.clientId },
          data: { telegramChatId: chatId },
        });
        const local = utcToLocalParts(appt.startAt, appt.company.timezone);
        const serviceTitle =
          appt.packageName ??
          (appt.items.length ? appt.items.map((item) => item.name).join(' + ') : appt.service.name);
        const manageUrl = `${env.APP_URL}/manage/${appt.manageToken}`;
        const lines = [
          `🔔 Telegram-уведомления подключены для ${appt.clientName}!`,
          `Салон: ${appt.company.name}`,
          `Услуга: ${serviceTitle}`,
          `Мастер: ${appt.master.name}`,
          `Дата и время: ${local.date} ${local.time}`,
          `Статус: ${STATUS_LABELS_RU[appt.status]}`,
        ];
        await reply(lines.join('\n'), appt.companyId, {
          replyMarkup: {
            inline_keyboard: [
              ...(EDITABLE_APPOINTMENT_STATUSES.includes(appt.status)
                ? [
                    [
                      { text: '🔄 Перенести на сайте', url: manageUrl },
                      { text: '❌ Отменить запись', callback_data: `client:cancel:${appt.id}` },
                    ],
                  ]
                : []),
              [
                { text: '📋 Мои записи', callback_data: 'client:my' },
                { text: '🧹 Очистить чат', callback_data: 'cmd:clear' },
              ],
            ],
          },
        });
        return;
      }

      // Staff link code: /start <code>
      if (code.length > 0) {
        const codeHash = sha256Hex(code);
        const currentNow = clockNow();
        const user = await tx.user.findFirst({
          where: {
            telegramLinkCodeHash: codeHash,
            telegramLinkCodeExpiresAt: { gt: currentNow },
            isActive: true,
            deletedAt: null,
          },
          include: {
            company: { select: { id: true, name: true } },
          },
        });
        if (!user) {
          await reply(
            'Код привязки недействителен или истёк. Запросите новую ссылку в кабинете Zapis.kg.',
          );
          return;
        }
        const existing = await tx.user.findFirst({
          where: { telegramChatId: chatId, id: { not: user.id } },
          select: { id: true },
        });
        if (existing) {
          await reply(
            'Этот Telegram уже привязан к другому аккаунту Zapis.kg. Сначала отправьте /stop.',
            user.companyId,
          );
          return;
        }
        const linked = await tx.user.updateMany({
          where: {
            id: user.id,
            companyId: user.companyId,
            telegramLinkCodeHash: codeHash,
            telegramLinkCodeExpiresAt: { gt: currentNow },
          },
          data: {
            telegramChatId: chatId,
            notifyTelegram: true,
            telegramLinkCodeHash: null,
            telegramLinkCodeExpiresAt: null,
          },
        });
        if (!linked.count) {
          await reply('Код уже использован. Запросите новую ссылку.', user.companyId);
          return;
        }
        await reply(
          `Telegram успешно подключён для ${user.name} (${ROLE_LABELS_RU[user.role]} • ${user.company.name})!\nИспользуйте кнопки ниже для управления расписанием и записями.`,
          user.companyId,
          {
            replyMarkup: buildStaffMainMenuKeyboard(user.role, false),
          },
        );
        return;
      }
    }

    // 2. /stop — unlink staff and/or client
    if (rawInput === '/stop' || rawInput === 'cmd:stop') {
      const users = await tx.user.findMany({
        where: { telegramChatId: chatId },
        select: { id: true, companyId: true },
      });
      for (const user of users) {
        await tx.user.updateMany({
          where: { id: user.id, companyId: user.companyId, telegramChatId: chatId },
          data: { telegramChatId: null },
        });
      }
      await tx.client.updateMany({
        where: { telegramChatId: chatId },
        data: { telegramChatId: null },
      });
      await reply('Уведомления Zapis.kg отключены.', users[0]?.companyId);
      return;
    }

    // 3. Resolve staff context if linked
    const staffCtx = await resolveActiveStaffByChatId(tx, chatId);

    // Client-only commands or fallback when chat is linked as a Client
    if (
      rawInput === 'client:my' ||
      (!staffCtx &&
        (rawInput === '/my' ||
          rawInput === '/menu' ||
          rawInput === '/start' ||
          rawInput === '/clear' ||
          rawInput === 'cmd:clear'))
    ) {
      const clientProfiles = await tx.client.findMany({
        where: { telegramChatId: chatId, mergedAt: null },
        select: { id: true, companyId: true, name: true },
      });
      if (clientProfiles.length > 0) {
        if (rawInput === '/clear' || rawInput === 'cmd:clear') {
          await reply('🧹 История чата очищена. Выберите действие:', clientProfiles[0]?.companyId, {
            replyMarkup: buildClientMainMenuKeyboard(),
          });
          return;
        }
        const currentNow = clockNow();
        const upcoming = await tx.appointment.findMany({
          where: {
            clientId: { in: clientProfiles.map((c) => c.id) },
            deletedAt: null,
            status: { in: [...UPCOMING_ACTIVE_STATUSES] },
            startAt: { gte: currentNow },
          },
          include: {
            company: true,
            service: true,
            items: { orderBy: { position: 'asc' } },
            master: true,
          },
          orderBy: { startAt: 'asc' },
          take: 5,
        });
        if (upcoming.length === 0) {
          await reply(
            'У вас пока нет предстоящих активных записей.',
            clientProfiles[0]?.companyId,
            { replyMarkup: buildClientMainMenuKeyboard() },
          );
          return;
        }
        for (const appt of upcoming) {
          const local = utcToLocalParts(appt.startAt, appt.company.timezone);
          const serviceTitle =
            appt.packageName ??
            (appt.items.length
              ? appt.items.map((item) => item.name).join(' + ')
              : appt.service.name);
          const manageUrl = `${env.APP_URL}/manage/${appt.manageToken}`;
          const cardText = [
            `📌 ${appt.company.name}`,
            `Услуга: ${serviceTitle} (${appt.price.toFixed(0)} ${appt.company.currency})`,
            `Мастер: ${appt.master.name}`,
            `Время: ${local.date} ${local.time}`,
            `Статус: ${STATUS_LABELS_RU[appt.status]}`,
          ].join('\n');
          await reply(cardText, appt.companyId, {
            replyMarkup: {
              inline_keyboard: [
                ...(EDITABLE_APPOINTMENT_STATUSES.includes(appt.status)
                  ? [
                      [
                        { text: '🔄 Перенести', url: manageUrl },
                        { text: '❌ Отменить', callback_data: `client:cancel:${appt.id}` },
                      ],
                    ]
                  : []),
                [{ text: '🧹 Очистить чат', callback_data: 'cmd:clear' }],
              ],
            },
          });
        }
        return;
      }
    }

    if (!staffCtx) {
      await reply(
        'Откройте ссылку привязки из личного кабинета Zapis.kg (или со страницы вашей записи), чтобы подключить Telegram-бот.',
      );
      return;
    }

    const { activeMember, memberships, hasMultipleCompanies } = staffCtx;
    const company = activeMember.company;
    const mainMenuMarkup = buildStaffMainMenuKeyboard(activeMember.role, hasMultipleCompanies);

    // 4. Clear chat command
    if (rawInput === '/clear' || rawInput === 'cmd:clear') {
      await reply(
        `🧹 Чат очищен.\nАктивная компания: ${company.name} (${ROLE_LABELS_RU[activeMember.role]}: ${activeMember.name})`,
        company.id,
        { replyMarkup: mainMenuMarkup },
      );
      return;
    }

    // 5. Switch active company in bot (`switch:<companyId>` or `/companies` / `cmd:companies`)
    if (rawInput === '/companies' || rawInput === 'cmd:companies') {
      const buttons = memberships.map((m) => [
        {
          text: `${m.companyId === company.id ? '✅ ' : ''}${m.company.name} (${ROLE_LABELS_RU[m.role]})`,
          callback_data: `switch:${m.companyId}`,
        },
      ]);
      buttons.push([{ text: '⬅️ В меню', callback_data: 'cmd:menu' }]);
      await reply(
        `Текущая компания: ${company.name}\nВыберите компанию для управления в Telegram:`,
        company.id,
        { replyMarkup: { inline_keyboard: buttons } },
      );
      return;
    }

    if (rawInput.startsWith('switch:')) {
      const targetCompanyId = rawInput.slice('switch:'.length).trim();
      const targetMember = memberships.find((m) => m.companyId === targetCompanyId);
      if (!targetMember || !staffCtx.directUser.identityId) {
        await reply('Компания не найдена среди ваших доступов.', company.id, {
          replyMarkup: mainMenuMarkup,
        });
        return;
      }
      await tx.identity.update({
        where: { id: staffCtx.directUser.identityId },
        data: { lastCompanyId: targetMember.companyId },
      });
      await reply(
        `✅ Активная компания переключена на «${targetMember.company.name}» (${ROLE_LABELS_RU[targetMember.role]}).`,
        targetMember.companyId,
        {
          replyMarkup: buildStaffMainMenuKeyboard(targetMember.role, hasMultipleCompanies),
        },
      );
      return;
    }

    // 6. Toggle Telegram notifications (`cmd:toggle_notify` or `/settings` / `cmd:settings`)
    if (rawInput === '/settings' || rawInput === 'cmd:settings') {
      const statusText = activeMember.notifyTelegram ? 'Включены 🔔' : 'На паузе 🔕';
      await reply(
        `Настройки Telegram (${company.name} • ${activeMember.name}):\nМгновенные пуш-уведомления: ${statusText}`,
        company.id,
        {
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: activeMember.notifyTelegram
                    ? '🔕 Поставить пуши на паузу'
                    : '🔔 Включить пуши',
                  callback_data: 'cmd:toggle_notify',
                },
              ],
              [{ text: '🔌 Отвязать Telegram (/stop)', callback_data: 'cmd:stop' }],
              [{ text: '⬅️ В меню', callback_data: 'cmd:menu' }],
            ],
          },
        },
      );
      return;
    }

    if (rawInput === 'cmd:toggle_notify') {
      const nextVal = !activeMember.notifyTelegram;
      await tx.user.update({
        where: { id: activeMember.id, companyId: company.id },
        data: { notifyTelegram: nextVal },
      });
      await reply(
        nextVal
          ? '🔔 Пуш-уведомления о новых записях включены.'
          : '🔕 Пуш-уведомления приостановлены. Вы по-прежнему можете смотреть расписание через меню.',
        company.id,
        { replyMarkup: mainMenuMarkup },
      );
      return;
    }

    // 7. Stats for today (`/stats` or `cmd:stats`) — OWNER and MANAGER
    if (rawInput === '/stats' || rawInput === 'cmd:stats') {
      if (activeMember.role === Role.MASTER) {
        await reply('Финансовая сводка салона доступна владельцу и менеджеру.', company.id, {
          replyMarkup: mainMenuMarkup,
        });
        return;
      }
      const currentNow = clockNow();
      const todayLocal = utcToLocalParts(currentNow, company.timezone).date;
      const bounds = getLocalDayBoundsUtc(todayLocal, company.timezone);
      const dayAppts = await tx.appointment.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          startAt: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        select: { status: true, price: true },
      });

      const totalCount = dayAppts.length;
      const completed = dayAppts.filter((a) => a.status === AppointmentStatus.COMPLETED);
      const active = dayAppts.filter((a) => UPCOMING_ACTIVE_STATUSES.includes(a.status));
      const cancelledCount = dayAppts.filter(
        (a) => a.status === AppointmentStatus.CANCELLED || a.status === AppointmentStatus.NO_SHOW,
      ).length;
      const completedSum = completed.reduce((acc, a) => acc + Number(a.price), 0);
      const expectedSum = [...completed, ...active].reduce((acc, a) => acc + Number(a.price), 0);

      const confirmedPayments = await tx.businessPayment.findMany({
        where: {
          companyId: company.id,
          status: BusinessPaymentStatus.CONFIRMED,
          createdAt: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        select: { kind: true, amount: true },
      });
      const netConfirmed = confirmedPayments.reduce(
        (acc, p) =>
          p.kind === BusinessPaymentKind.REFUND ? acc - Number(p.amount) : acc + Number(p.amount),
        0,
      );

      const statsText = [
        `📊 Сводка за сегодня (${todayLocal}) — ${company.name}`,
        `Всего записей: ${totalCount}`,
        `• Активные (ожидают/в работе): ${active.length}`,
        `• Завершено: ${completed.length}`,
        `• Отмены / неявки: ${cancelledCount}`,
        `Ожидаемая выручка по записям: ${expectedSum.toFixed(0)} ${company.currency}`,
        `Завершённые визиты: ${completedSum.toFixed(0)} ${company.currency}`,
        `Подтверждённая касса за день: ${netConfirmed.toFixed(0)} ${company.currency}`,
      ].join('\n');

      await reply(statsText, company.id, { replyMarkup: mainMenuMarkup });
      return;
    }

    // 8. Schedule commands: /today, /tomorrow, /upcoming
    if (
      rawInput === '/today' ||
      rawInput === 'cmd:today' ||
      rawInput === '/tomorrow' ||
      rawInput === 'cmd:tomorrow' ||
      rawInput === '/upcoming' ||
      rawInput === 'cmd:upcoming'
    ) {
      const currentNow = clockNow();
      const todayLocal = utcToLocalParts(currentNow, company.timezone).date;
      const isTomorrow = rawInput === '/tomorrow' || rawInput === 'cmd:tomorrow';
      const isUpcoming = rawInput === '/upcoming' || rawInput === 'cmd:upcoming';
      const targetDate = isTomorrow
        ? addDaysToLocalDate(todayLocal, 1, company.timezone)
        : todayLocal;
      const bounds = getLocalDayBoundsUtc(targetDate, company.timezone);

      const appts = await tx.appointment.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          ...(activeMember.role === Role.MASTER ? { masterId: activeMember.id } : {}),
          ...(isUpcoming
            ? {
                startAt: { gte: currentNow },
                status: { in: [...UPCOMING_ACTIVE_STATUSES] },
              }
            : {
                startAt: { gte: bounds.startUtc, lt: bounds.endUtc },
              }),
        },
        include: {
          service: { select: { name: true } },
          items: { orderBy: { position: 'asc' }, select: { name: true } },
          master: { select: { name: true } },
        },
        orderBy: { startAt: 'asc' },
        take: 8,
      });

      const heading = isUpcoming
        ? `📋 Ближайшие активные записи (${company.name})`
        : isTomorrow
          ? `📆 Расписание на завтра (${targetDate} • ${company.name})`
          : `📅 Расписание на сегодня (${targetDate} • ${company.name})`;

      if (appts.length === 0) {
        await reply(`${heading}\n\nЗаписей нет.`, company.id, { replyMarkup: mainMenuMarkup });
        return;
      }

      for (const appt of appts) {
        const local = utcToLocalParts(appt.startAt, company.timezone);
        const endLocal = utcToLocalParts(appt.endAt, company.timezone);
        const serviceTitle =
          appt.packageName ??
          (appt.items.length ? appt.items.map((item) => item.name).join(' + ') : appt.service.name);
        const lines = [
          `🕒 ${local.date} ${local.time}–${endLocal.time} • ${STATUS_LABELS_RU[appt.status]}`,
          `👤 Клиент: ${appt.clientName} (${appt.clientPhone})`,
          `💈 Услуга: ${serviceTitle} (${appt.price.toFixed(0)} ${company.currency})`,
          `✂️ Мастер: ${appt.master.name}`,
          ...(appt.clientNote ? [`💬 Комментарий: ${appt.clientNote}`] : []),
        ];
        const cardHtml = lines.map((l) => escapeTelegramHtml(l)).join('\n');
        await reply(lines.join('\n'), company.id, {
          telegramHtml: cardHtml,
          replyMarkup: buildAppointmentActionsKeyboard(appt.id, appt.status),
        });
      }
      return;
    }

    // 9. Default /menu, /start (when already linked), or unknown text -> show smart dashboard menu
    const welcomeText = [
      `👋 Кабинет Zapis.kg в Telegram`,
      `Компания: ${company.name}`,
      `Сотрудник: ${activeMember.name} (${ROLE_LABELS_RU[activeMember.role]})`,
      '',
      'Выберите раздел на клавиатуре ниже или используйте команды /today, /tomorrow, /upcoming, /stats, /clear:',
    ].join('\n');
    await reply(welcomeText, company.id, { replyMarkup: mainMenuMarkup });
  });
}
