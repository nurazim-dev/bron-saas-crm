import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const allowedOrigins = new Set<string>(env.CORS_ORIGINS);

/**
 * BR-11: Cookie-authenticated endpoints (refresh, logout) reject a present Origin header
 * that is not in the CORS allowlist.
 */
export const verifyCookieOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('Origin');
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    next(new AppError('FORBIDDEN', 403, 'Origin is not allowed'));
    return;
  }
  next();
};
