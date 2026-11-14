import type { RequestHandler } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';

export function requireRole(...allowedRoles: Role[]): RequestHandler {
  const allowedSet = new Set<Role>(allowedRoles);
  return (req, _res, next) => {
    if (!req.auth) {
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    }
    if (!allowedSet.has(req.auth.role)) {
      throw new AppError('FORBIDDEN', 403, 'Insufficient permissions');
    }
    next();
  };
}
