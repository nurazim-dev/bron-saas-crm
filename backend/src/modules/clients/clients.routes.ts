import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import {
  requireFeatureIfSubscribed,
  requireWritableSubscription,
} from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  anonymizeClientController,
  createClientController,
  createClientTagController,
  deleteClientTagController,
  executeClientImportController,
  executeClientMergeController,
  getClientDetailController,
  listClientsController,
  listClientTagsController,
  previewClientImportController,
  previewClientMergeController,
  setClientTagsController,
  updateClientController,
  updateClientTagController,
} from './clients.controller.js';
import {
  anonymizeClientSchema,
  clientIdParamsSchema,
  createClientSchema,
  createClientTagSchema,
  getClientDetailQuerySchema,
  importClientsExecuteSchema,
  importClientsPreviewSchema,
  listClientsQuerySchema,
  mergeClientsExecuteSchema,
  mergeClientsPreviewSchema,
  setClientTagsSchema,
  tagIdParamsSchema,
  updateClientSchema,
  updateClientTagSchema,
} from './clients.schemas.js';

export const clientsRouter = Router();

clientsRouter.use(authenticate);

clientsRouter.get('/', validate({ query: listClientsQuerySchema }), listClientsController);

clientsRouter.post(
  '/',
  requireWritableSubscription,
  requireRole('OWNER'),
  validate({ body: createClientSchema }),
  createClientController,
);

// Static sub-routes MUST precede parameterized /:id routes
clientsRouter.get('/tags', listClientTagsController);

clientsRouter.post(
  '/tags',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ body: createClientTagSchema }),
  createClientTagController,
);

clientsRouter.patch(
  '/tags/:tagId',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ params: tagIdParamsSchema, body: updateClientTagSchema }),
  updateClientTagController,
);

clientsRouter.delete(
  '/tags/:tagId',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ params: tagIdParamsSchema }),
  deleteClientTagController,
);

clientsRouter.post(
  '/merge/preview',
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ body: mergeClientsPreviewSchema }),
  previewClientMergeController,
);

clientsRouter.post(
  '/merge',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ body: mergeClientsExecuteSchema }),
  executeClientMergeController,
);

clientsRouter.post(
  '/import/preview',
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ body: importClientsPreviewSchema }),
  previewClientImportController,
);

clientsRouter.post(
  '/import',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ body: importClientsExecuteSchema }),
  executeClientImportController,
);

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

clientsRouter.put(
  '/:id/tags',
  requireWritableSubscription,
  requireFeatureIfSubscribed('crmAdvanced'),
  requireRole('OWNER'),
  validate({ params: clientIdParamsSchema, body: setClientTagsSchema }),
  setClientTagsController,
);

clientsRouter.post(
  '/:id/anonymize',
  requireWritableSubscription,
  requireRole('OWNER'),
  validate({ params: clientIdParamsSchema, body: anonymizeClientSchema }),
  anonymizeClientController,
);
