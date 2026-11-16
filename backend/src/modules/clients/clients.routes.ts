import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  anonymizeClientController,
  getClientDetailController,
  listClientsController,
  updateClientController,
} from './clients.controller.js';
import {
  anonymizeClientSchema,
  clientIdParamsSchema,
  getClientDetailQuerySchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './clients.schemas.js';

export const clientsRouter = Router();

clientsRouter.use(authenticate);

clientsRouter.get('/', validate({ query: listClientsQuerySchema }), listClientsController);

clientsRouter.get(
  '/:id',
  validate({ params: clientIdParamsSchema, query: getClientDetailQuerySchema }),
  getClientDetailController,
);

clientsRouter.patch(
  '/:id',
  requireWritableSubscription,
  requireRole('OWNER'),
  validate({ params: clientIdParamsSchema, body: updateClientSchema }),
  updateClientController,
);

clientsRouter.post(
  '/:id/anonymize',
  requireWritableSubscription,
  requireRole('OWNER'),
  validate({ params: clientIdParamsSchema, body: anonymizeClientSchema }),
  anonymizeClientController,
);
