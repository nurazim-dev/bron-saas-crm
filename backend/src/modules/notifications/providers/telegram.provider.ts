import { env } from '../../../config/env.js';
import { ProviderDeliveryError } from '../errors.js';
import type { TelegramProvider, TelegramSendParams } from './types.js';

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class HttpTelegramProvider implements TelegramProvider {
  async send(params: TelegramSendParams): Promise<void> {
    if (env.TELEGRAM_BOT_TOKEN.trim().length === 0) {
      throw new ProviderDeliveryError(
        'Telegram bot token is not configured',
        true,
        'TELEGRAM_NOT_CONFIGURED',
      );
    }

    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
      }),
    });

    if (response.ok) {
      return;
    }

    const bodyText = await response.text().catch(() => '');
    const isPermanent =
      response.status === 400 || response.status === 403 || response.status === 404;
    throw new ProviderDeliveryError(
      `Telegram API error (${String(response.status)}): ${bodyText}`,
      isPermanent,
      `TG_${String(response.status)}`,
    );
  }
}
