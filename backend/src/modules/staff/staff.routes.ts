import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  inviteStaffController,
  createStaffController,
  createStaffPasswordResetLinkController,
  createStaffTelegramLinkCodeController,
  deleteStaffController,
  getStaffController,
  listStaffController,
  replaceStaffServicesController,
  replaceStaffWorkingHoursController,
  unlinkStaffTelegramController,
  updateStaffController,
} from './staff.controller.js';
import {
  createStaffBodySchema,
  createStaffPasswordResetLinkBodySchema,
  inviteStaffBodySchema,
  replaceStaffServicesBodySchema,
  replaceWorkingHoursBodySchema,
  staffIdParamsSchema,
  updateStaffBodySchema,
} from './staff.schemas.js';

export const staffRouter = Router();
staffRouter.post(
  '/invite',
  authenticate,
  requireRole(Role.OWNER),
  requireWritableSubscription,
  validate({ body: inviteStaffBodySchema }),
  inviteStaffController,
);

staffRouter.get('/', authenticate, requireRole(Role.OWNER, Role.MANAGER), listStaffController);

staffRouter.post(
  '/',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ body: createStaffBodySchema }),
  createStaffController,
);

staffRouter.get(
  '/:id',
  authenticate,
  validate({ params: staffIdParamsSchema }),
  getStaffController,
);

staffRouter.patch(
  '/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: updateStaffBodySchema }),
  updateStaffController,
);

staffRouter.delete(
  '/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema }),
  deleteStaffController,
);

staffRouter.put(
  '/:id/services',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: replaceStaffServicesBodySchema }),
  replaceStaffServicesController,
);

staffRouter.put(
  '/:id/working-hours',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: replaceWorkingHoursBodySchema }),
  replaceStaffWorkingHoursController,
);

staffRouter.post(
  '/:id/password-reset-link',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: createStaffPasswordResetLinkBodySchema }),
  createStaffPasswordResetLinkController,
);

staffRouter.post(
  '/:id/telegram-link-code',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema }),
  createStaffTelegramLinkCodeController,
);

staffRouter.delete(
  '/:id/telegram',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema }),
  unlinkStaffTelegramController,
);
