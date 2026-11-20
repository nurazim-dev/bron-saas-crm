import { Router, raw } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  cancelPaymentClaimController,
  createPaymentClaimController,
  getBillingController,
  listBillingPaymentsController,
  listBillingPlansController,
  readBillingPaymentProofController,
  switchToFreePlanController,
  uploadBillingPaymentProofController,
} from './billing.controller.js';
import {
  createPaymentClaimBodySchema,
  listPaymentsQuerySchema,
  paymentIdParamsSchema,
  paymentProofParamsSchema,
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
billingRouter.post('/switch-free', switchToFreePlanController);

billingRouter.post(
  '/payments/:id/proofs',
  createRateLimiter({ windowMs: 60_000, limit: 20 }),
  validate({ params: paymentIdParamsSchema }),
  raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '5mb' }),
  uploadBillingPaymentProofController,
);

billingRouter.get(
  '/payments/:id/proofs/:proofId',
  validate({ params: paymentProofParamsSchema }),
  readBillingPaymentProofController,
);
