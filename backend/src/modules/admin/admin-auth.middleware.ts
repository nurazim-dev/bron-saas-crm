import type { Request, RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedAdmin } from '../../types/express.js';
import { verifyAdminAccessToken, verifyAdminMfaToken } from './admin-crypto.js';

function extractBearer(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new AppError('UNAUTHENTICATED', 401, 'Missing authorization header');
  }
  const parts = authorizationHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid authorization header format');
  }
  return parts[1];
}

export const authenticateAdmin: RequestHandler = async (req, _res, next) => {
  const token = extractBearer(req.get('Authorization'));
  const claims = verifyAdminAccessToken(token);

  const admin = await prisma.platformAdmin.findUnique({
    where: { id: claims.sub },
  });

  if (!admin || !admin.isActive || admin.tokenVersion !== claims.tv) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked admin session');
  }

  req.adminAuth = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    tokenVersion: admin.tokenVersion,
  };

  next();
};

/**
 * Allows either an active admin access token OR an enrollment-scoped MFA token (`purpose: 'enroll'`).
 */
export const authenticateAdminEnroll: RequestHandler = async (req, _res, next) => {
  const token = extractBearer(req.get('Authorization'));

  let sub: string;
  let tv: number;
  try {
    const access = verifyAdminAccessToken(token);
    sub = access.sub;
    tv = access.tv;
  } catch {
    const mfa = verifyAdminMfaToken(token, 'enroll');
    sub = mfa.sub;
    tv = mfa.tv;
  }

  const admin = await prisma.platformAdmin.findUnique({
    where: { id: sub },
  });

  if (!admin || !admin.isActive || admin.tokenVersion !== tv) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked admin session');
  }

  req.adminAuth = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    tokenVersion: admin.tokenVersion,
  };

  next();
};

export function getAdminActor(req: Request): AuthenticatedAdmin {
  if (!req.adminAuth) {
    throw new AppError('UNAUTHENTICATED', 401, 'Admin authentication required');
  }
  return req.adminAuth;
}
