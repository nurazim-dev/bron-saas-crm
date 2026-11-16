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

registerNotificationTemplate('PASSWORD_RESET', (locale, payload) => {
  const resetUrl = readString(payload, 'resetUrl', '');
  const userName = readString(payload, 'userName', '');
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const expiresRaw = payload.expiresInMinutes;
  const expiresMin = typeof expiresRaw === 'number' && expiresRaw > 0 ? expiresRaw : 60;

  if (locale === 'KY') {
    const subject = `Сырсөздү калыбына келтирүү — ${companyName}`;
    const greeting = userName ? `Саламатсызбы, ${userName}!` : 'Саламатсызбы!';
    const text = [
      greeting,
      '',
      `${companyName} (Zapis.kg) аккаунтуңуздун сырсөзүн калыбына келтирүү сурамы алынды.`,
      `Жаңы сырсөз орнотуу үчүн төмөнкү шилтемеге өтүңүз (шилтеме ${expiresMin} мүнөт жарактуу):`,
      resetUrl,
      '',
      'Эгер сиз бул сурамды жөнөтпөгөн болсоңуз, бул катты этибарга албаңыз.',
    ].join('\n');

    const html = [
      `<p>${escapeHtml(greeting)}</p>`,
      `<p><strong>${escapeHtml(companyName)}</strong> (Zapis.kg) аккаунтуңуздун сырсөзүн калыбына келтирүү сурамы алынды.</p>`,
      `<p>Шилтеме ${expiresMin} мүнөт жарактуу:</p>`,
      `<p><a href="${escapeHtml(resetUrl)}">Сырсөздү жаңылоо</a></p>`,
      `<p>Же шилтемени көчүрүңүз: ${escapeHtml(resetUrl)}</p>`,
      '<p>Эгер сиз бул сурамды жөнөтпөгөн болсоңуз, бул катты этибарга албаңыз.</p>',
    ].join('');

    return {
      subject,
      text,
      html,
      telegramHtml: `<b>${escapeTelegramHtml(subject)}</b>\n${escapeTelegramHtml(resetUrl)}`,
    };
  }

  const subject = `Сброс пароля — ${companyName}`;
  const greeting = userName ? `Здравствуйте, ${userName}!` : 'Здравствуйте!';
  const text = [
    greeting,
    '',
    `Мы получили запрос на сброс пароля для вашего аккаунта в ${companyName} (Zapis.kg).`,
    `Чтобы задать новый пароль, перейдите по ссылке (действует ${expiresMin} минут):`,
    resetUrl,
    '',
    'Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.',
  ].join('\n');

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Мы получили запрос на сброс пароля для вашего аккаунта в <strong>${escapeHtml(companyName)}</strong> (Zapis.kg).</p>`,
    `<p>Ссылка действует ${expiresMin} минут:</p>`,
    `<p><a href="${escapeHtml(resetUrl)}">Сбросить пароль</a></p>`,
    `<p>Или скопируйте ссылку: ${escapeHtml(resetUrl)}</p>`,
    '<p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>',
  ].join('');

  return {
    subject,
    text,
    html,
    telegramHtml: `<b>${escapeTelegramHtml(subject)}</b>\n${escapeTelegramHtml(resetUrl)}`,
  };
});

function buildSimpleEmailTemplate(subject: string, lines: string[]): RenderedNotification {
  const text = lines.join('\n');
  const html = lines
    .map((line) => (line.length === 0 ? '<br/>' : `<p>${escapeHtml(line)}</p>`))
    .join('');
  return {
    subject,
    text,
    html,
    telegramHtml: `<b>${escapeTelegramHtml(subject)}</b>\n${escapeTelegramHtml(text)}`,
  };
}

registerNotificationTemplate('BILLING_PAYMENT_CONFIRMED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const planName = readString(payload, 'planName', '');
  const periodEndIso = readString(payload, 'periodEndIso', '').slice(0, 10);
  const amount = readString(payload, 'amount', '');
  return buildSimpleEmailTemplate(`Оплата подписки подтверждена — ${companyName}`, [
    `Тариф «${planName}» для ${companyName} активирован до ${periodEndIso}.`,
    amount ? `Сумма: ${amount} KGS.` : '',
  ]);
});

registerNotificationTemplate('BILLING_PAYMENT_REJECTED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const planName = readString(payload, 'planName', '');
  const reason = readString(payload, 'reason', 'Не указана');
  return buildSimpleEmailTemplate(`Заявка на оплату отклонена — ${companyName}`, [
    `Заявка на тариф «${planName}» для ${companyName} отклонена.`,
    `Причина: ${reason}`,
  ]);
});

registerNotificationTemplate('BILLING_TRIAL_EXPIRING', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const daysLeftRaw = payload.daysLeft;
  const daysLeft = typeof daysLeftRaw === 'number' ? daysLeftRaw : 3;
  return buildSimpleEmailTemplate(`Подписка заканчивается через ${daysLeft} дн. — ${companyName}`, [
    `Срок действия текущего периода подписки для ${companyName} истекает через ${daysLeft} дн.`,
    'Продлите тариф в разделе «Оплата и тариф», чтобы избежать ограничений.',
  ]);
});

registerNotificationTemplate('BILLING_PERIOD_ENDED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  return buildSimpleEmailTemplate(`Период подписки завершён — ${companyName}`, [
    `Оплаченный период подписки для ${companyName} завершился.`,
    'Включён льготный период. Пожалуйста, оформите продление в разделе «Оплата и тариф».',
  ]);
});

registerNotificationTemplate('BILLING_GRACE_ENDING', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  return buildSimpleEmailTemplate(`Льготный период заканчивается — ${companyName}`, [
    `Льготный период подписки для ${companyName} подходит к концу.`,
    'После окончания льготного периода кабинет перейдёт в режим только чтения.',
  ]);
});

registerNotificationTemplate('BILLING_LOCKED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  return buildSimpleEmailTemplate(`Кабинет переведён в режим только чтения — ${companyName}`, [
    `Подписка для ${companyName} не продлена, и льготный период истёк.`,
    'Данные сохранены. Чтобы возобновить работу и онлайн-запись, оплатите тариф в разделе «Оплата и тариф».',
  ]);
});
