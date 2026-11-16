import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody, validate } from '../../middleware/validate.js';
import { listManualRemindersQueue } from './reminders.service.js';
import {
  createTelegramLinkCode,
  getMyNotificationSettings,
  processTelegramUpdate,
  type TelegramWebhookUpdate,
  unlinkTelegram,
  updateMyNotificationSettings,
  verifyTelegramWebhookSecret,
} from './telegram-link.service.js';

const updateNotificationSettingsSchema = z
  .object({
    notifyEmail: z.boolean().optional(),
    notifyTelegram: z.boolean().optional(),
  })
  .strict();

export const meNotificationsRouter = Router();
meNotificationsRouter.use(authenticate);

meNotificationsRouter.get('/notification-settings', async (req, res) => {
  const data = await getMyNotificationSettings(getAuthActor(req));
  res.status(200).json({ data });
});

meNotificationsRouter.patch(
  '/notification-settings',
  validate({ body: updateNotificationSettingsSchema }),
  async (req, res) => {
    const body = getValidatedBody<z.infer<typeof updateNotificationSettingsSchema>>(req);
    const data = await updateMyNotificationSettings(getAuthActor(req), body);
    res.status(200).json({ data });
  },
);

meNotificationsRouter.post('/telegram/link-code', async (req, res) => {
  const data = await createTelegramLinkCode(getAuthActor(req));
  res.status(200).json({ data });
});

meNotificationsRouter.delete('/telegram', async (req, res) => {
  await unlinkTelegram(getAuthActor(req));
  res.status(204).send();
});

export const telegramWebhookRouter = Router();

telegramWebhookRouter.post('/webhook', async (req, res) => {
  verifyTelegramWebhookSecret(req.get('x-telegram-bot-api-secret-token'));
  await processTelegramUpdate((req.body ?? {}) as TelegramWebhookUpdate);
  res.status(200).json({ ok: true });
});

export const remindersRouter = Router();
remindersRouter.use(authenticate);

remindersRouter.get('/queue', async (req, res) => {
  const data = await listManualRemindersQueue(getAuthActor(req));
  res.status(200).json({ data });
});
