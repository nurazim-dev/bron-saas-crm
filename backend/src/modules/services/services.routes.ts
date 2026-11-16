import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  createServiceController,
  deleteServiceController,
  getServiceController,
  listServicesController,
  updateServiceController,
} from './services.controller.js';
import {
  createServiceBodySchema,
  serviceIdParamsSchema,
  updateServiceBodySchema,
} from './services.schemas.js';

export const servicesRouter = Router();

servicesRouter.get('/', authenticate, listServicesController);

servicesRouter.post(
  '/',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ body: createServiceBodySchema }),
  createServiceController,
);

servicesRouter.get(
  '/:id',
  authenticate,
  validate({ params: serviceIdParamsSchema }),
  getServiceController,
);

servicesRouter.patch(
  '/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema, body: updateServiceBodySchema }),
  updateServiceController,
);

servicesRouter.delete(
  '/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema }),
  deleteServiceController,
);
