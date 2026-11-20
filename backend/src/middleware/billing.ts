import type { RequestHandler } from 'express';
import {
  assertOptionalPlanFeature,
  assertPlanFeature,
  assertWritableSubscription,
  type PlanFeatureKey,
} from '../modules/billing/billing.service.js';
import { getAuthActor } from './authenticate.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const LOCKED_ALLOWLIST_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/billing',
  '/api/v1/notifications',
  '/api/v1/me',
  '/api/v1/health',
  '/api/v1/exports',
];

export function isBillingWriteAllowlisted(method: string, originalUrl: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) {
    return true;
  }
  const path = originalUrl.split('?')[0] ?? originalUrl;
  return LOCKED_ALLOWLIST_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Blocks mutating staff requests with 402 SUBSCRIPTION_REQUIRED when the company is LOCKED,
 * unless the route is on the BR-19 allowlist.
 */
export const requireWritableSubscription: RequestHandler = async (req, _res, next) => {
  if (isBillingWriteAllowlisted(req.method, req.originalUrl)) {
    next();
    return;
  }

  const actor = getAuthActor(req);
  await assertWritableSubscription(actor.companyId);
  next();
};

export function requireFeature(feature: PlanFeatureKey): RequestHandler {
  return async (req, _res, next) => {
    const actor = getAuthActor(req);
    await assertPlanFeature(actor.companyId, feature);
    next();
  };
}

export function requireFeatureIfSubscribed(feature: PlanFeatureKey): RequestHandler {
  return async (req, _res, next) => {
    const actor = getAuthActor(req);
    await assertOptionalPlanFeature(actor.companyId, feature);
    next();
  };
}
