import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import { getCompanyController, updateCompanyController } from './company.controller.js';
import { updateCompanyBodySchema } from './company.schemas.js';

export const companyRouter = Router();

companyRouter.get('/', authenticate, getCompanyController);

companyRouter.patch(
  '/',
  authenticate,
  requireRole(Role.OWNER),
  validate({ body: updateCompanyBodySchema }),
  updateCompanyController,
);
