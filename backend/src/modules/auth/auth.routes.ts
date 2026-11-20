import { z } from 'zod';
import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { verifyCookieOrigin } from '../../middleware/origin-check.js';
import { requireRole } from '../../middleware/require-role.js';
import {
  authRateLimiter,
  forgotPasswordEmailRateLimiter,
  forgotPasswordIpRateLimiter,
  impersonateExchangeRateLimiter,
} from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  createAdditionalCompanyController,
  listCompaniesController,
  requestEmailVerificationController,
  confirmEmailVerificationController,
  sessionsController,
  revokeSessionController,
  changePasswordController,
  forgotPasswordController,
  impersonateExchangeController,
  impersonateExitController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resetPasswordController,
  switchCompanyController,
  validateResetPasswordTokenController,
} from './auth.controller.js';
import {
  changePasswordBodySchema,
  createAdditionalCompanyBodySchema,
  forgotPasswordBodySchema,
  impersonateExchangeBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  switchCompanyBodySchema,
  validateResetTokenQuerySchema,
} from './auth.schemas.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimiter,
  validate({ body: registerBodySchema }),
  registerController,
);

authRouter.post('/login', authRateLimiter, validate({ body: loginBodySchema }), loginController);

authRouter.post('/refresh', authRateLimiter, verifyCookieOrigin, refreshController);

authRouter.post('/logout', verifyCookieOrigin, logoutController);

authRouter.get('/me', authenticate, meController);
authRouter.get('/companies', authenticate, listCompaniesController);
authRouter.post(
  '/companies',
  authenticate,
  requireRole(Role.OWNER),
  authRateLimiter,
  validate({ body: createAdditionalCompanyBodySchema }),
  createAdditionalCompanyController,
);
authRouter.post(
  '/switch-company',
  authenticate,
  authRateLimiter,
  validate({ body: switchCompanyBodySchema }),
  switchCompanyController,
);
authRouter.get('/sessions', authenticate, sessionsController);
authRouter.delete(
  '/sessions/:id',
  authenticate,
  validate({ params: z.object({ id: z.uuid() }) }),
  revokeSessionController,
);

authRouter.patch(
  '/password',
  authenticate,
  validate({ body: changePasswordBodySchema }),
  changePasswordController,
);

authRouter.post(
  '/forgot-password',
  forgotPasswordIpRateLimiter,
  validate({ body: forgotPasswordBodySchema }),
  forgotPasswordEmailRateLimiter,
  forgotPasswordController,
);

authRouter.get(
  '/reset-password/validate',
  validate({ query: validateResetTokenQuerySchema }),
  validateResetPasswordTokenController,
);

authRouter.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordBodySchema }),
  resetPasswordController,
);

authRouter.post(
  '/impersonate/exchange',
  impersonateExchangeRateLimiter,
  validate({ body: impersonateExchangeBodySchema }),
  impersonateExchangeController,
);

authRouter.post('/impersonate/exit', authenticate, impersonateExitController);

authRouter.post(
  '/email-verification/request',
  authenticate,
  authRateLimiter,
  requestEmailVerificationController,
);
authRouter.post(
  '/email-verification/confirm',
  authRateLimiter,
  validate({ body: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict() }),
  confirmEmailVerificationController,
);
