import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationIdParamsSchema = z.object({
  id: z.uuid({ message: 'Notification id must be a valid UUID' }),
});

export type NotificationIdParams = z.infer<typeof notificationIdParamsSchema>;
