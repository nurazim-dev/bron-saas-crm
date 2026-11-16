import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { verifyCookieOrigin } from '../../middleware/origin-check.js';
import {
  authRateLimiter,
  forgotPasswordEmailRateLimiter,
  forgotPasswordIpRateLimiter,
} from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
  resetPasswordController,
  validateResetPasswordTokenController,
} from './auth.controller.js';
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
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
