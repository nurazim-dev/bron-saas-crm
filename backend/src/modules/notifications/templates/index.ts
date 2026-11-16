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

registerNotificationTemplate('NEW_ONLINE_BOOKING', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const masterName = readString(payload, 'masterName', '');
  const clientName = readString(payload, 'clientName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Новая онлайн-запись — ${companyName}`, [
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Мастер: ${masterName}`,
    `Время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('CLIENT_CANCELLED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const clientName = readString(payload, 'clientName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Клиент отменил запись — ${companyName}`, [
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('CLIENT_RESCHEDULED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const clientName = readString(payload, 'clientName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Клиент перенёс запись — ${companyName}`, [
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Новое время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('STAFF_BOOKING_FOR_MASTER', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const clientName = readString(payload, 'clientName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Новая запись для вас — ${companyName}`, [
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('PLAN_REMINDER_CAP_REACHED', (_locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  return buildSimpleEmailTemplate(`Лимит авто-напоминаний исчерпан — ${companyName}`, [
    `В этом месяце достигнут лимит автоматических напоминаний для ${companyName}.`,
    'Вы можете перейти на более высокий тариф в разделе «Оплата и тариф».',
  ]);
});

function buildReminderTemplate(
  locale: Locale,
  payload: Record<string, unknown>,
): RenderedNotification {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  const address = readString(payload, 'address', '');
  const manageUrl = readString(payload, 'manageUrl', '');

  if (locale === 'KY') {
    const lines = [
      `${companyName}: жазылууңузду эскертебиз.`,
      `Кызмат: ${serviceName}`,
      `Убактысы: ${localDateTime}`,
    ];
    if (address) lines.push(`Дареги: ${address}`);
    if (manageUrl) lines.push(`Жолугушууну башкаруу: ${manageUrl}`);
    return buildSimpleEmailTemplate(`${companyName} — жазылуу эскертүүсү`, lines);
  }

  const lines = [
    `${companyName}: напоминаем о вашей записи.`,
    `Услуга: ${serviceName}`,
    `Дата и время: ${localDateTime}`,
  ];
  if (address) lines.push(`Адрес: ${address}`);
  if (manageUrl) lines.push(`Управление записью: ${manageUrl}`);
  return buildSimpleEmailTemplate(`Напоминание о записи — ${companyName}`, lines);
}

registerNotificationTemplate('REMINDER_24H', buildReminderTemplate);
registerNotificationTemplate('REMINDER_2H', buildReminderTemplate);

registerNotificationTemplate('PREPAYMENT_PENDING_OWNER', (_locale, payload) => {
  const clientName = readString(payload, 'clientName', 'Клиент');
  const serviceName = readString(payload, 'serviceName', '');
  const amount = readString(payload, 'amount', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Ожидается предоплата: ${clientName}`, [
    `Новая запись с предоплатой ${amount} сом.`,
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Дата и время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('PREPAYMENT_EXPIRED_STAFF', (_locale, payload) => {
  const clientName = readString(payload, 'clientName', 'Клиент');
  const serviceName = readString(payload, 'serviceName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  return buildSimpleEmailTemplate(`Бронь отменена (истекла предоплата): ${clientName}`, [
    `Запись автоматически отменена, так как предоплата не была подтверждена в срок.`,
    `Клиент: ${clientName}`,
    `Услуга: ${serviceName}`,
    `Дата и время: ${localDateTime}`,
  ]);
});

registerNotificationTemplate('PREPAYMENT_EXPIRED_CLIENT', (locale, payload) => {
  const companyName = readString(payload, 'companyName', 'Zapis.kg');
  const serviceName = readString(payload, 'serviceName', '');
  const localDateTime = readString(payload, 'localDateTime', '');
  if (locale === 'KY') {
    return buildSimpleEmailTemplate(`${companyName} — жазылуу жокко чыгарылды`, [
      `Алдын ала төлөм өз убагында тастыкталбагандыктан, "${serviceName}" (${localDateTime}) жазылуусу жокко чыгарылды.`,
    ]);
  }
  return buildSimpleEmailTemplate(`Запись отменена — ${companyName}`, [
    `Бронь на «${serviceName}» (${localDateTime}) автоматически отменена, так как предоплата не поступила в установленный срок.`,
  ]);
});
