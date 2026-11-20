import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { processTelegramUpdate } from './telegram-link.service.js';

const updatesSchema = z.object({
  ok: z.literal(true),
  result: z.array(
    z.object({
      update_id: z.number().int().nonnegative(),
      message: z
        .object({
          message_id: z.number().int().optional(),
          text: z.string().optional(),
          chat: z.object({ id: z.number().int(), type: z.string() }),
        })
        .optional(),
      callback_query: z
        .object({
          id: z.string(),
          data: z.string().optional(),
          message: z
            .object({
              message_id: z.number().int().optional(),
              chat: z.object({ id: z.number().int(), type: z.string() }),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
});

/** Run in the API process only, independently of the notification worker. */
export function startTelegramPolling(): { stop(): Promise<void> } | null {
  if (env.TELEGRAM_MODE !== 'polling') return null;
  if (!env.TELEGRAM_BOT_TOKEN.trim()) {
    logger.error('Telegram polling requires TELEGRAM_BOT_TOKEN');
    return null;
  }

  const controller = new AbortController();
  const { signal } = controller;
  let offset = 0;

  async function run(): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              offset,
              timeout: 25,
              allowed_updates: ['message', 'callback_query'],
            }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
          },
        );
        if (!response.ok) {
          // Never log fetch errors or response bodies: they can contain the bot token.
          logger.warn({ status: response.status }, 'Telegram polling request rejected');
          throw new Error('Telegram polling request rejected');
        }
        const updates = updatesSchema.parse(await response.json());
        for (const update of updates.result) {
          if (signal.aborted) return;
          // Staff and client notifications may only be linked to a private conversation.
          const chatType = update.message?.chat.type ?? update.callback_query?.message?.chat.type;
          if (chatType === 'private') {
            await processTelegramUpdate(update);
          }
          // Acknowledge only after processing; failed updates are retried.
          offset = update.update_id + 1;
        }
      } catch {
        if (signal.aborted) return;
        logger.warn('Telegram polling failed; retrying in 5 seconds');
        await delay(5000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  const running = run();
  logger.info('Telegram polling started');
  return {
    async stop() {
      controller.abort();
      await running;
      logger.info('Telegram polling stopped');
    },
  };
}
