import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  cancelPaymentClaimController,
  createPaymentClaimController,
  getBillingController,
  listBillingPaymentsController,
  listBillingPlansController,
} from './billing.controller.js';
import {
  createPaymentClaimBodySchema,
  listPaymentsQuerySchema,
  paymentIdParamsSchema,
} from './billing.schemas.js';

export const billingRouter = Router();

billingRouter.use(authenticate, requireRole(Role.OWNER));

billingRouter.get('/', getBillingController);
billingRouter.get('/plans', listBillingPlansController);
billingRouter.get(
  '/payments',
  validate({ query: listPaymentsQuerySchema }),
  listBillingPaymentsController,
);
billingRouter.post(
  '/payments',
  validate({ body: createPaymentClaimBodySchema }),
  createPaymentClaimController,
);
billingRouter.delete(
  '/payments/:id',
  validate({ params: paymentIdParamsSchema }),
  cancelPaymentClaimController,
);
