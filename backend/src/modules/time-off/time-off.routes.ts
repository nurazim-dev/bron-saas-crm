import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { validate } from '../../middleware/validate.js';
import {
  createTimeOffController,
  deleteTimeOffController,
  listTimeOffController,
  updateTimeOffController,
} from './time-off.controller.js';
import {
  createTimeOffBodySchema,
  listTimeOffQuerySchema,
  timeOffIdParamsSchema,
  updateTimeOffBodySchema,
} from './time-off.schemas.js';

export const timeOffRouter = Router();

timeOffRouter.use(authenticate);

timeOffRouter.get('/', validate({ query: listTimeOffQuerySchema }), listTimeOffController);

timeOffRouter.post(
  '/',
  requireWritableSubscription,
  validate({ body: createTimeOffBodySchema }),
  createTimeOffController,
);

timeOffRouter.patch(
  '/:id',
  requireWritableSubscription,
  validate({ params: timeOffIdParamsSchema, body: updateTimeOffBodySchema }),
  updateTimeOffController,
);

timeOffRouter.delete(
  '/:id',
  requireWritableSubscription,
  validate({ params: timeOffIdParamsSchema }),
  deleteTimeOffController,
);
