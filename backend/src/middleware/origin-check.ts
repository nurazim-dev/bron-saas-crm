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
  if (origin !== undefined) {
    if (!allowedOrigins.has(origin)) {
      next(new AppError('FORBIDDEN', 403, 'Origin is not allowed'));
      return;
    }
    next();
    return;
  }

  const secFetchSite = req.get('Sec-Fetch-Site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    next(new AppError('FORBIDDEN', 403, 'Cross-site cookie request is not allowed'));
    return;
  }

  const referer = req.get('Referer');
  if (referer !== undefined) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowedOrigins.has(refOrigin)) {
        next(new AppError('FORBIDDEN', 403, 'Referer origin is not allowed'));
        return;
      }
    } catch {
      next(new AppError('FORBIDDEN', 403, 'Invalid Referer header'));
      return;
    }
  }

  next();
};
