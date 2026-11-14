import type { Locale } from '../../../generated/prisma/client.js';
import { ProviderDeliveryError } from '../errors.js';
import { escapeTelegramHtml } from '../providers/telegram.provider.js';

export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
  telegramHtml: string;
}

export type NotificationTemplateRenderer = (
  locale: Locale,
  payload: Record<string, unknown>,
) => RenderedNotification;

const templateRegistry = new Map<string, NotificationTemplateRenderer>();

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function registerNotificationTemplate(
  kind: string,
  renderer: NotificationTemplateRenderer,
): void {
  templateRegistry.set(kind, renderer);
}

export function renderNotificationTemplate(
  kind: string,
  locale: Locale,
  payload: Record<string, unknown>,
): RenderedNotification {
  const renderer = templateRegistry.get(kind);
  if (!renderer) {
    throw new ProviderDeliveryError(
      `No notification template registered for kind: ${kind}`,
      true,
      'UNKNOWN_TEMPLATE_KIND',
    );
  }
  return renderer(locale, payload);
}

function readString(payload: Record<string, unknown>, key: string, fallback: string): string {
  const val = payload[key];
  return typeof val === 'string' && val.trim().length > 0 ? val : fallback;
}

registerNotificationTemplate('SYSTEM_TEST', (locale, payload) => {
  const defaultTitle =
    locale === 'KY' ? 'Zapis.kg тесттик билдирүү' : 'Тестовое уведомление Zapis.kg';
  const defaultMessage =
    locale === 'KY'
      ? 'Бул Zapis.kg почта кызматынын тесттик каты.'
      : 'Это тестовое сообщение системы уведомлений Zapis.kg.';

  const subject = readString(payload, 'title', defaultTitle);
  const text = readString(payload, 'message', defaultMessage);

  return {
    subject,
    text,
    html: `<p>${escapeHtml(text)}</p>`,
    telegramHtml: `<b>${escapeTelegramHtml(subject)}</b>\n${escapeTelegramHtml(text)}`,
  };
});

registerNotificationTemplate('GENERIC', (_locale, payload) => {
  const subject = readString(payload, 'subject', 'Zapis.kg');
  const text = readString(payload, 'text', '');
  const htmlRaw = payload.html;
  const html = typeof htmlRaw === 'string' ? htmlRaw : `<p>${escapeHtml(text)}</p>`;

  return {
    subject,
    text,
    html,
    telegramHtml: `<b>${escapeTelegramHtml(subject)}</b>\n${escapeTelegramHtml(text)}`,
  };
});
