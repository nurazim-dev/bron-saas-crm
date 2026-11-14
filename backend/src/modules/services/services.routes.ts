import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
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
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema, body: updateServiceBodySchema }),
  updateServiceController,
);

servicesRouter.delete(
  '/:id',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: serviceIdParamsSchema }),
  deleteServiceController,
);
