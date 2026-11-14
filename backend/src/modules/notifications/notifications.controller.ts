import type { RequestHandler } from 'express';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedParams, getValidatedQuery } from '../../middleware/validate.js';
import {
  getUnreadCountForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from './in-app.service.js';
import type { ListNotificationsQuery, NotificationIdParams } from './notifications.schemas.js';

export const listNotificationsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListNotificationsQuery>(req);
  const result = await listNotificationsForUser(actor.companyId, actor.userId, query);
  res.status(200).json({
    data: result.items,
    meta: {
      page: query.page,
      limit: query.limit,
      total: result.total,
    },
  });
};

export const getUnreadCountController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const result = await getUnreadCountForUser(actor.companyId, actor.userId);
  res.status(200).json({ data: result });
};

export const markNotificationReadController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<NotificationIdParams>(req);
  const updated = await markNotificationRead(actor.companyId, actor.userId, id);
  res.status(200).json({ data: updated });
};

export const markAllNotificationsReadController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const result = await markAllNotificationsRead(actor.companyId, actor.userId);
  res.status(200).json({ data: result });
};
