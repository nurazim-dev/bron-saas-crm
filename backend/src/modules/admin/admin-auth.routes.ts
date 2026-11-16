import { Router } from 'express';
import { verifyCookieOrigin } from '../../middleware/origin-check.js';
import { adminLoginRateLimiter, adminMfaRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  adminChangePasswordController,
  adminEnrollTotpController,
  adminLoginController,
  adminLogoutController,
  adminMeController,
  adminMfaController,
  adminRefreshController,
  adminVerifyEnrollTotpController,
} from './admin-auth.controller.js';
import { authenticateAdmin, authenticateAdminEnroll } from './admin-auth.middleware.js';
import {
  adminChangePasswordBodySchema,
  adminLoginBodySchema,
  adminMfaBodySchema,
  adminVerifyEnrollBodySchema,
} from './admin-auth.schemas.js';

export const adminAuthRouter = Router();

adminAuthRouter.post(
  '/login',
  adminLoginRateLimiter,
  validate({ body: adminLoginBodySchema }),
  adminLoginController,
);

adminAuthRouter.post(
  '/mfa',
  adminMfaRateLimiter,
  validate({ body: adminMfaBodySchema }),
  adminMfaController,
);

adminAuthRouter.post('/2fa/enroll', authenticateAdminEnroll, adminEnrollTotpController);

adminAuthRouter.post(
  '/2fa/verify-enroll',
  authenticateAdminEnroll,
  validate({ body: adminVerifyEnrollBodySchema }),
  adminVerifyEnrollTotpController,
);

adminAuthRouter.post('/refresh', verifyCookieOrigin, adminRefreshController);
adminAuthRouter.post('/logout', verifyCookieOrigin, adminLogoutController);

adminAuthRouter.get('/me', authenticateAdmin, adminMeController);
adminAuthRouter.patch(
  '/password',
  authenticateAdmin,
  validate({ body: adminChangePasswordBodySchema }),
  adminChangePasswordController,
);
