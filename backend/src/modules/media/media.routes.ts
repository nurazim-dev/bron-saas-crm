import { Router, raw } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './media.controller.js';
import * as schema from './media.schemas.js';
export const mediaRouter = Router();
const owner = [authenticate, requireRole(Role.OWNER)];
const write = [...owner, requireWritableSubscription];
mediaRouter.get(
  '/:id/profile',
  ...owner,
  validate({ params: schema.profileParams }),
  controller.profile,
);
mediaRouter.get(
  '/:id/media/:mediaId',
  ...owner,
  validate({ params: schema.mediaParams }),
  controller.read,
);

mediaRouter.patch(
  '/:id/profile',
  ...write,
  validate({ params: schema.profileParams, body: schema.profileSchema }),
  controller.save,
);
mediaRouter.post(
  '/:id/media/upload/:kind',
  ...write,
  createRateLimiter({ windowMs: 60000, limit: 10 }),
  validate({ params: schema.uploadParams }),
  raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'], limit: '20mb' }),
  controller.upload,
);
mediaRouter.patch(
  '/:id/media/:mediaId',
  ...write,
  validate({ params: schema.mediaParams, body: schema.mediaEditSchema }),
  controller.edit,
);
mediaRouter.delete(
  '/:id/media/:mediaId',
  ...write,
  validate({ params: schema.mediaParams }),
  controller.remove,
);
export const publicMediaRouter = Router();
publicMediaRouter.get(
  '/companies/:slug/masters/:id/media/:mediaId',
  validate({ params: schema.publicMediaParams }),
  controller.readPublic,
);
