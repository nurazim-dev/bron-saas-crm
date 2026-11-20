import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  createServiceController,
  createServicePackageController,
  deleteServiceController,
  deleteServicePackageController,
  getServiceController,
  listServicePackagesController,
  listServicesController,
  updateServiceController,
  updateServicePackageController,
} from './services.controller.js';
import {
  createServiceBodySchema,
  createServicePackageBodySchema,
  serviceIdParamsSchema,
  updateServiceBodySchema,
  updateServicePackageBodySchema,
} from './services.schemas.js';

export const servicesRouter = Router();

servicesRouter.get('/packages', authenticate, listServicePackagesController);

servicesRouter.post(
  '/packages',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ body: createServicePackageBodySchema }),
  createServicePackageController,
);

servicesRouter.patch(
  '/packages/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema, body: updateServicePackageBodySchema }),
  updateServicePackageController,
);

servicesRouter.delete(
  '/packages/:id',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema }),
  deleteServicePackageController,
);

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
