import { createHash } from 'node:crypto';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 429, 'Too many requests, please try again later'));
    },
  });
}

export const globalRateLimiter: RateLimitRequestHandler = createRateLimiter({
  windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
  limit: env.RATE_LIMIT_GLOBAL_MAX,
});

export const authRateLimiter: RateLimitRequestHandler = createRateLimiter({
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  limit: env.RATE_LIMIT_AUTH_MAX,
});

export const publicBookingRateLimiter: RateLimitRequestHandler = createRateLimiter({
  windowMs: env.RATE_LIMIT_PUBLIC_BOOKING_WINDOW_MS,
  limit: env.RATE_LIMIT_PUBLIC_BOOKING_MAX,
});

const ONE_HOUR_MS = 60 * 60 * 1000;

export const forgotPasswordIpRateLimiter: RateLimitRequestHandler = createRateLimiter({
  windowMs: ONE_HOUR_MS,
  limit: 5,
});

export function hashEmailForRateLimit(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export const forgotPasswordEmailRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    if (typeof body?.email === 'string' && body.email.trim().length > 0) {
      return `email:${hashEmailForRateLimit(body.email)}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  },
  handler: (_req, _res, next) => {
    next(new AppError('RATE_LIMITED', 429, 'Too many requests, please try again later'));
  },
});

export function resetRateLimitersForTest(ip = '::ffff:127.0.0.1'): void {
  for (const key of [ip, '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    globalRateLimiter.resetKey(key);
    authRateLimiter.resetKey(key);
    publicBookingRateLimiter.resetKey(key);
    forgotPasswordIpRateLimiter.resetKey(key);
  }
}

export function resetForgotPasswordEmailRateLimitForTest(email: string): void {
  forgotPasswordEmailRateLimiter.resetKey(`email:${hashEmailForRateLimit(email)}`);
}
