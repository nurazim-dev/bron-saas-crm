import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { now as clockNow } from '../../lib/clock.js';
import { addDurationMsUtc } from '../../lib/datetime.js';

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getProviderRegistry } from '../../lib/registry.js';
import type { AuthenticatedActor } from '../../types/express.js';

export interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

export async function getMyNotificationSettings(actor: AuthenticatedActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
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
  const updated = await prisma.user.update({
    where: { id: actor.userId },
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
  const currentNow = clockNow();
  const code = randomBytes(16).toString('base64url');
  const codeHash = sha256Hex(code);
  const expiresAt = addDurationMsUtc(currentNow, 15 * 60_000);

  await prisma.user.update({
    where: { id: actor.userId },
    data: {
      telegramLinkCodeHash: codeHash,
      telegramLinkCodeExpiresAt: expiresAt,
    },
  });

  return {
    code,
    expiresAt: expiresAt.toISOString(),
    deepLink: env.TELEGRAM_BOT_USERNAME
      ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`
      : null,
  };
}

export async function unlinkTelegram(actor: AuthenticatedActor): Promise<void> {
  await prisma.user.update({
    where: { id: actor.userId },
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

async function replyTelegram(chatId: string, text: string): Promise<void> {
  try {
    await getProviderRegistry().telegram.send({ chatId, html: text });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Telegram reply failed');
  }
}

export async function processTelegramUpdate(update: TelegramWebhookUpdate): Promise<void> {
  const rawChatId = update.message?.chat?.id;
  const text = (update.message?.text ?? '').trim();
  if (rawChatId === undefined || rawChatId === null) return;
  const chatId = String(rawChatId);

  if (text.startsWith('/start')) {
    const code = text.slice('/start'.length).trim();
    if (!code) {
      await replyTelegram(
        chatId,
        'Откройте ссылку привязки из личного кабинета Zapis.kg, чтобы подключить уведомления.',
      );
      return;
    }

    const codeHash = sha256Hex(code);
    const currentNow = clockNow();

    const user = await prisma.user.findFirst({
      where: {
        telegramLinkCodeHash: codeHash,
        telegramLinkCodeExpiresAt: { gt: currentNow },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, name: true },
    });

    if (!user) {
      await replyTelegram(
        chatId,
        'Код привязки недействителен или истёк. Запросите новую ссылку в кабинете Zapis.kg.',
      );
      return;
    }

    const existingOwner = await prisma.user.findFirst({
      where: { telegramChatId: chatId, id: { not: user.id } },
      select: { id: true },
    });
    if (existingOwner) {
      await replyTelegram(
        chatId,
        'Этот Telegram уже привязан к другому аккаунту Zapis.kg. Сначала отправьте /stop.',
      );
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramLinkCodeHash: null,
        telegramLinkCodeExpiresAt: null,
      },
    });

    await replyTelegram(chatId, `Telegram успешно подключён для ${user.name}!`);
    return;
  }

  if (text === '/stop') {
    await prisma.user.updateMany({
      where: { telegramChatId: chatId },
      data: { telegramChatId: null },
    });
    await replyTelegram(chatId, 'Уведомления Zapis.kg отключены.');
    return;
  }

  await replyTelegram(
    chatId,
    'Используйте ссылку из личного кабинета Zapis.kg для подключения или /stop для отключения.',
  );
}
