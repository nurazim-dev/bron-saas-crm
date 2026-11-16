import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  getCompanyCapabilitiesController,
  getCompanyController,
  updateCompanyController,
} from './company.controller.js';
import { updateCompanyBodySchema } from './company.schemas.js';

export const companyRouter = Router();

companyRouter.get('/', authenticate, getCompanyController);
companyRouter.get('/capabilities', authenticate, getCompanyCapabilitiesController);

companyRouter.patch(
  '/',
  authenticate,
  requireWritableSubscription,
  requireRole(Role.OWNER),
  validate({ body: updateCompanyBodySchema }),
  updateCompanyController,
);
