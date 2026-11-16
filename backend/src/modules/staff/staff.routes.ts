import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  createStaffController,
  createStaffPasswordResetLinkController,
  deleteStaffController,
  getStaffController,
  listStaffController,
  replaceStaffServicesController,
  replaceStaffWorkingHoursController,
  updateStaffController,
} from './staff.controller.js';
import {
  createStaffBodySchema,
  createStaffPasswordResetLinkBodySchema,
  replaceStaffServicesBodySchema,
  replaceWorkingHoursBodySchema,
  staffIdParamsSchema,
  updateStaffBodySchema,
} from './staff.schemas.js';

export const staffRouter = Router();

staffRouter.get('/', authenticate, requireRole(Role.OWNER), listStaffController);

staffRouter.post(
  '/',
  authenticate,
  requireRole(Role.OWNER),
  validate({ body: createStaffBodySchema }),
  createStaffController,
);

// Both OWNER and MASTER may call GET /staff/:id (service enforces MASTER own-record check -> 404).
staffRouter.get(
  '/:id',
  authenticate,
  validate({ params: staffIdParamsSchema }),
  getStaffController,
);

staffRouter.patch(
  '/:id',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: updateStaffBodySchema }),
  updateStaffController,
);

staffRouter.delete(
  '/:id',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema }),
  deleteStaffController,
);

staffRouter.put(
  '/:id/services',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: replaceStaffServicesBodySchema }),
  replaceStaffServicesController,
);

staffRouter.put(
  '/:id/working-hours',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: replaceWorkingHoursBodySchema }),
  replaceStaffWorkingHoursController,
);

staffRouter.post(
  '/:id/password-reset-link',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: staffIdParamsSchema, body: createStaffPasswordResetLinkBodySchema }),
  createStaffPasswordResetLinkController,
);
