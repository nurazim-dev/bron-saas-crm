import { Router, raw } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  requireFeatureIfSubscribed,
  requireWritableSubscription,
} from '../../middleware/billing.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  confirmBusinessPaymentController,
  createBusinessPaymentController,
  getBusinessPaymentsSummaryController,
  listBusinessPaymentsController,
  readBusinessPaymentProofController,
  rejectBusinessPaymentController,
  uploadBusinessPaymentProofController,
} from './payments.controller.js';
import {
  businessPaymentsSummaryQuerySchema,
  createBusinessPaymentSchema,
  listBusinessPaymentsQuerySchema,
  paymentIdParamsSchema,
  paymentProofParamsSchema,
  rejectBusinessPaymentSchema,
} from './payments.schemas.js';

export const paymentsRouter = Router();

paymentsRouter.use(authenticate, requireRole(Role.OWNER));

paymentsRouter.get(
  '/',
  validate({ query: listBusinessPaymentsQuerySchema }),
  listBusinessPaymentsController,
);

paymentsRouter.get(
  '/summary',
  validate({ query: businessPaymentsSummaryQuerySchema }),
  getBusinessPaymentsSummaryController,
);

paymentsRouter.post(
  '/',
  requireWritableSubscription,
  requireFeatureIfSubscribed('manualPayments'),
  validate({ body: createBusinessPaymentSchema }),
  createBusinessPaymentController,
);

paymentsRouter.post(
  '/:id/confirm',
  requireWritableSubscription,
  requireFeatureIfSubscribed('manualPayments'),
  validate({ params: paymentIdParamsSchema }),
  confirmBusinessPaymentController,
);

paymentsRouter.post(
  '/:id/reject',
  requireWritableSubscription,
  requireFeatureIfSubscribed('manualPayments'),
  validate({ params: paymentIdParamsSchema, body: rejectBusinessPaymentSchema }),
  rejectBusinessPaymentController,
);

paymentsRouter.post(
  '/:id/proofs',
  requireWritableSubscription,
  requireFeatureIfSubscribed('manualPayments'),
  createRateLimiter({ windowMs: 60_000, limit: 20 }),
  validate({ params: paymentIdParamsSchema }),
  raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '5mb' }),
  uploadBusinessPaymentProofController,
);

paymentsRouter.get(
  '/:id/proofs/:proofId',
  validate({ params: paymentProofParamsSchema }),
  readBusinessPaymentProofController,
);
