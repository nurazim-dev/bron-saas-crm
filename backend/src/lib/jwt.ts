import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '../generated/prisma/client.js';
import { now as clockNow } from './clock.js';
import { AppError } from './errors.js';

export interface AccessTokenClaims {
  sub: string;
  companyId: string;
  role: Role;
  tv: number;
  typ: 'access';
  sid?: string;
  imp?: string;
}

export interface RefreshTokenClaims {
  sub: string;
  companyId: string;
  role: Role;
  tv: number;
  jti: string;
  typ: 'refresh';
  sid?: string;
}

export const REFRESH_COOKIE_NAME = 'zapis_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(duration.trim());
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'd').toLowerCase();
  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
    default:
      return amount * 24 * 60 * 60 * 1000;
  }
}

export function signAccessToken(payload: {
  sub: string;
  companyId: string;
  role: Role;
  tv: number;
  sid?: string;
}): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: AccessTokenClaims & { iat: number } = {
    ...(payload.sid ? { sid: payload.sid } : {}),
    sub: payload.sub,
    companyId: payload.companyId,
    role: payload.role,
    tv: payload.tv,
    typ: 'access',
    iat,
  };
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL as Exclude<SignOptions['expiresIn'], undefined>,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

export function signImpersonationAccessToken(payload: {
  sub: string;
  companyId: string;
  role: Role;
  tv: number;
  imp: string;
}): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: AccessTokenClaims & { iat: number } = {
    sub: payload.sub,
    companyId: payload.companyId,
    role: payload.role,
    tv: payload.tv,
    typ: 'access',
    imp: payload.imp,
    iat,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '30m',
  });
}

export function signRefreshToken(payload: {
  sub: string;
  companyId: string;
  role: Role;
  tv: number;
  sid?: string;
}): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: RefreshTokenClaims & { iat: number } = {
    ...(payload.sid ? { sid: payload.sid } : {}),
    sub: payload.sub,
    companyId: payload.companyId,
    role: payload.role,
    tv: payload.tv,
    jti: randomUUID(),
    typ: 'refresh',
    iat,
  };
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_REFRESH_TTL as Exclude<SignOptions['expiresIn'], undefined>,
  };
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, options);
}

function isValidRole(value: unknown): value is Role {
  return value === 'OWNER' || value === 'MASTER' || value === 'MANAGER';
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      clockTimestamp: Math.floor(clockNow().getTime() / 1000),
    });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid access token');
    }
    const record = decoded as Record<string, unknown>;
    if (
      record.typ !== 'access' ||
      typeof record.sub !== 'string' ||
      typeof record.companyId !== 'string' ||
      !isValidRole(record.role) ||
      typeof record.tv !== 'number'
    ) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid access token claims');
    }
    return {
      ...(typeof record.sid === 'string' ? { sid: record.sid } : {}),
      sub: record.sub,
      companyId: record.companyId,
      role: record.role,
      tv: record.tv,
      typ: 'access',
      ...(typeof record.imp === 'string' ? { imp: record.imp } : {}),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
      clockTimestamp: Math.floor(clockNow().getTime() / 1000),
    });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid refresh token');
    }
    const record = decoded as Record<string, unknown>;
    if (
      record.typ !== 'refresh' ||
      typeof record.sub !== 'string' ||
      typeof record.companyId !== 'string' ||
      !isValidRole(record.role) ||
      typeof record.tv !== 'number' ||
      typeof record.jti !== 'string'
    ) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid refresh token claims');
    }
    return {
      ...(typeof record.sid === 'string' ? { sid: record.sid } : {}),
      sub: record.sub,
      companyId: record.companyId,
      role: record.role,
      tv: record.tv,
      jti: record.jti,
      typ: 'refresh',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired refresh token');
  }
}
