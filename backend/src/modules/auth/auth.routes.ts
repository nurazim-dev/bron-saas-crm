import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { verifyCookieOrigin } from '../../middleware/origin-check.js';
import { authRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  changePasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from './auth.controller.js';
import { changePasswordBodySchema, loginBodySchema, registerBodySchema } from './auth.schemas.js';

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
