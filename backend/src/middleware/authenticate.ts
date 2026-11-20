import { now as clockNow } from '../lib/clock.js';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import type { AuthenticatedActor } from '../types/express.js';

function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new AppError('UNAUTHENTICATED', 401, 'Missing authorization header');
  }
  const parts = authorizationHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid authorization header format');
  }
  return parts[1];
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = extractBearerToken(req.get('Authorization'));
  const claims = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: claims.sub, companyId: claims.companyId },
    include: { company: true },
  });

  if (
    !user ||
    user.deletedAt !== null ||
    !user.isActive ||
    user.companyId !== claims.companyId ||
    user.role !== claims.role ||
    user.tokenVersion !== claims.tv ||
    user.company.deletedAt !== null
  ) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked session');
  }

  if (user.company.suspendedAt !== null) {
    throw new AppError('COMPANY_SUSPENDED', 403, 'Company account is suspended');
  }

  if (claims.sid) {
    const session = await prisma.authSession.findFirst({
      where: {
        id: claims.sid,
        companyId: user.companyId,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: clockNow() },
      },
      select: { id: true },
    });
    if (!session) throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked session');
  }

  const isReadMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  const reqPath = req.originalUrl.split('?')[0] ?? req.originalUrl;
  if (claims.imp !== undefined && !isReadMethod && reqPath !== '/api/v1/auth/impersonate/exit') {
    throw new AppError(
      'IMPERSONATION_READ_ONLY',
      403,
      'Support impersonation session is read-only',
    );
  }

  req.auth = {
    ...(claims.sid ? { sessionId: claims.sid } : {}),
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    tokenVersion: user.tokenVersion,
    ...(claims.imp !== undefined ? { imp: claims.imp } : {}),
  };

  next();
};

export function getAuthActor(req: Request): AuthenticatedActor {
  if (!req.auth) {
    throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
  }
  return req.auth;
}
