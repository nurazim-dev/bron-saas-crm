import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  getUnreadCountController,
  listNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
} from './notifications.controller.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from './notifications.schemas.js';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  validate({ query: listNotificationsQuerySchema }),
  listNotificationsController,
);

notificationsRouter.get('/unread-count', getUnreadCountController);

notificationsRouter.post('/read-all', markAllNotificationsReadController);

notificationsRouter.post(
  '/:id/read',
  validate({ params: notificationIdParamsSchema }),
  markNotificationReadController,
);
