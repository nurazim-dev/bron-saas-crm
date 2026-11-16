import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticateAdmin } from './admin-auth.middleware.js';
import {
  activateAdminUserController,
  adjustCompanySubscriptionController,
  adminUserPasswordResetLinkController,
  cancelAdminOutboxController,
  confirmAdminPaymentController,
  createAdminPlanController,
  deactivateAdminUserController,
  deleteAdminCompanyController,
  getAdminCompanyController,
  getAdminOverviewController,
  getAdminSettingsController,
  getAdminSignupsController,
  impersonateCompanyController,
  listAdminAuditController,
  listAdminCompaniesController,
  listAdminOutboxController,
  listAdminPaymentsController,
  listAdminPlansController,
  listAdminUsersController,
  recordOfflinePaymentController,
  rejectAdminPaymentController,
  restoreAdminCompanyController,
  retryAdminOutboxController,
  revokeAdminUserSessionsController,
  suspendCompanyController,
  unsuspendCompanyController,
  updateAdminCompanyController,
  updateAdminPlanController,
  updateAdminSettingsController,
  updateAdminUserController,
} from './admin.controller.js';
import {
  adminAdjustSubscriptionBodySchema,
  adminAuditQuerySchema,
  adminCompaniesQuerySchema,
  adminCreatePlanBodySchema,
  adminDeleteCompanyBodySchema,
  adminOutboxQuerySchema,
  adminPaymentsQuerySchema,
  adminReasonBodySchema,
  adminRecordOfflinePaymentBodySchema,
  adminSignupsQuerySchema,
  adminUpdateCompanyBodySchema,
  adminUpdatePlanBodySchema,
  adminUpdateSettingsBodySchema,
  adminUpdateUserBodySchema,
  adminUserPasswordResetBodySchema,
  adminUsersQuerySchema,
  uuidParamsSchema,
} from './admin.schemas.js';

export const adminRouter = Router();

adminRouter.use(authenticateAdmin);

// Metrics
adminRouter.get('/metrics/overview', getAdminOverviewController);
adminRouter.get(
  '/metrics/signups',
  validate({ query: adminSignupsQuerySchema }),
  getAdminSignupsController,
);

// Companies
adminRouter.get(
  '/companies',
  validate({ query: adminCompaniesQuerySchema }),
  listAdminCompaniesController,
);
adminRouter.get(
  '/companies/:id',
  validate({ params: uuidParamsSchema }),
  getAdminCompanyController,
);
adminRouter.patch(
  '/companies/:id',
  validate({ params: uuidParamsSchema, body: adminUpdateCompanyBodySchema }),
  updateAdminCompanyController,
);
adminRouter.post(
  '/companies/:id/suspend',
  validate({ params: uuidParamsSchema, body: adminReasonBodySchema }),
  suspendCompanyController,
);
adminRouter.post(
  '/companies/:id/unsuspend',
  validate({ params: uuidParamsSchema }),
  unsuspendCompanyController,
);
adminRouter.delete(
  '/companies/:id',
  validate({ params: uuidParamsSchema, body: adminDeleteCompanyBodySchema }),
  deleteAdminCompanyController,
);
adminRouter.post(
  '/companies/:id/restore',
  validate({ params: uuidParamsSchema }),
  restoreAdminCompanyController,
);
adminRouter.post(
  '/companies/:id/impersonate',
  validate({ params: uuidParamsSchema, body: adminReasonBodySchema }),
  impersonateCompanyController,
);

// Subscriptions & Payments
adminRouter.put(
  '/companies/:id/subscription',
  validate({ params: uuidParamsSchema, body: adminAdjustSubscriptionBodySchema }),
  adjustCompanySubscriptionController,
);
adminRouter.post(
  '/companies/:id/payments',
  validate({ params: uuidParamsSchema, body: adminRecordOfflinePaymentBodySchema }),
  recordOfflinePaymentController,
);
adminRouter.get(
  '/payments',
  validate({ query: adminPaymentsQuerySchema }),
  listAdminPaymentsController,
);
adminRouter.post(
  '/payments/:id/confirm',
  validate({ params: uuidParamsSchema }),
  confirmAdminPaymentController,
);
adminRouter.post(
  '/payments/:id/reject',
  validate({ params: uuidParamsSchema, body: adminReasonBodySchema }),
  rejectAdminPaymentController,
);

// Plans
adminRouter.get('/plans', listAdminPlansController);
adminRouter.post(
  '/plans',
  validate({ body: adminCreatePlanBodySchema }),
  createAdminPlanController,
);
adminRouter.patch(
  '/plans/:id',
  validate({ params: uuidParamsSchema, body: adminUpdatePlanBodySchema }),
  updateAdminPlanController,
);

// Users
adminRouter.get('/users', validate({ query: adminUsersQuerySchema }), listAdminUsersController);
adminRouter.patch(
  '/users/:id',
  validate({ params: uuidParamsSchema, body: adminUpdateUserBodySchema }),
  updateAdminUserController,
);
adminRouter.post(
  '/users/:id/deactivate',
  validate({ params: uuidParamsSchema }),
  deactivateAdminUserController,
);
adminRouter.post(
  '/users/:id/activate',
  validate({ params: uuidParamsSchema }),
  activateAdminUserController,
);
adminRouter.post(
  '/users/:id/revoke-sessions',
  validate({ params: uuidParamsSchema }),
  revokeAdminUserSessionsController,
);
adminRouter.post(
  '/users/:id/password-reset-link',
  validate({ params: uuidParamsSchema, body: adminUserPasswordResetBodySchema }),
  adminUserPasswordResetLinkController,
);

// Outbox
adminRouter.get('/outbox', validate({ query: adminOutboxQuerySchema }), listAdminOutboxController);
adminRouter.post(
  '/outbox/:id/retry',
  validate({ params: uuidParamsSchema }),
  retryAdminOutboxController,
);
adminRouter.post(
  '/outbox/:id/cancel',
  validate({ params: uuidParamsSchema }),
  cancelAdminOutboxController,
);

// Audit & Settings
adminRouter.get('/audit', validate({ query: adminAuditQuerySchema }), listAdminAuditController);
adminRouter.get('/settings', getAdminSettingsController);
adminRouter.put(
  '/settings',
  validate({ body: adminUpdateSettingsBodySchema }),
  updateAdminSettingsController,
);
