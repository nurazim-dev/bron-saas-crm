import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';

export const ADMIN_JWT_AUDIENCE = 'zapis-admin';
export const ADMIN_REFRESH_COOKIE_NAME = 'zapis_admin_rt';
export const ADMIN_REFRESH_COOKIE_PATH = '/api/v1/admin/auth';

export interface AdminAccessClaims {
  sub: string;
  email: string;
  tv: number;
  aud: typeof ADMIN_JWT_AUDIENCE;
  typ: 'admin_access';
}

export interface AdminRefreshClaims {
  sub: string;
  tv: number;
  jti: string;
  aud: typeof ADMIN_JWT_AUDIENCE;
  typ: 'admin_refresh';
}

export type AdminMfaPurpose = 'mfa' | 'enroll';

export interface AdminMfaClaims {
  sub: string;
  tv: number;
  purpose: AdminMfaPurpose;
  aud: typeof ADMIN_JWT_AUDIENCE;
  typ: 'admin_mfa';
}

export function signAdminAccessToken(admin: {
  id: string;
  email: string;
  tokenVersion: number;
}): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: AdminAccessClaims & { iat: number } = {
    sub: admin.id,
    email: admin.email,
    tv: admin.tokenVersion,
    aud: ADMIN_JWT_AUDIENCE,
    typ: 'admin_access',
    iat,
  };
  return jwt.sign(claims, env.ADMIN_JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

export function signAdminRefreshToken(admin: { id: string; tokenVersion: number }): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: AdminRefreshClaims & { iat: number } = {
    sub: admin.id,
    tv: admin.tokenVersion,
    jti: randomUUID(),
    aud: ADMIN_JWT_AUDIENCE,
    typ: 'admin_refresh',
    iat,
  };
  return jwt.sign(claims, env.ADMIN_JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });
}

export function signAdminMfaToken(
  admin: { id: string; tokenVersion: number },
  purpose: AdminMfaPurpose,
): string {
  const iat = Math.floor(clockNow().getTime() / 1000);
  const claims: AdminMfaClaims & { iat: number } = {
    sub: admin.id,
    tv: admin.tokenVersion,
    purpose,
    aud: ADMIN_JWT_AUDIENCE,
    typ: 'admin_mfa',
    iat,
  };
  return jwt.sign(claims, env.ADMIN_JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

export function verifyAdminAccessToken(token: string): AdminAccessClaims {
  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: ADMIN_JWT_AUDIENCE,
      clockTimestamp: Math.floor(clockNow().getTime() / 1000),
    });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid admin access token');
    }
    const r = decoded as Record<string, unknown>;
    if (
      r.typ !== 'admin_access' ||
      typeof r.sub !== 'string' ||
      typeof r.email !== 'string' ||
      typeof r.tv !== 'number'
    ) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid admin access token claims');
    }
    return {
      sub: r.sub,
      email: r.email,
      tv: r.tv,
      aud: ADMIN_JWT_AUDIENCE,
      typ: 'admin_access',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired admin access token');
  }
}

export function verifyAdminRefreshToken(token: string): AdminRefreshClaims {
  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
      audience: ADMIN_JWT_AUDIENCE,
      clockTimestamp: Math.floor(clockNow().getTime() / 1000),
    });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid admin refresh token');
    }
    const r = decoded as Record<string, unknown>;
    if (
      r.typ !== 'admin_refresh' ||
      typeof r.sub !== 'string' ||
      typeof r.tv !== 'number' ||
      typeof r.jti !== 'string'
    ) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid admin refresh token claims');
    }
    return {
      sub: r.sub,
      tv: r.tv,
      jti: r.jti,
      aud: ADMIN_JWT_AUDIENCE,
      typ: 'admin_refresh',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired admin refresh token');
  }
}

export function verifyAdminMfaToken(
  token: string,
  expectedPurpose: AdminMfaPurpose,
): AdminMfaClaims {
  try {
    const decoded = jwt.verify(token, env.ADMIN_JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: ADMIN_JWT_AUDIENCE,
      clockTimestamp: Math.floor(clockNow().getTime() / 1000),
    });
    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid MFA token');
    }
    const r = decoded as Record<string, unknown>;
    if (r.typ !== 'admin_mfa' || typeof r.sub !== 'string' || typeof r.tv !== 'number') {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid MFA token claims');
    }
    if (r.purpose !== expectedPurpose) {
      throw new AppError('FORBIDDEN', 403, 'Token scope does not permit this action');
    }
    return {
      sub: r.sub,
      tv: r.tv,
      purpose: expectedPurpose,
      aud: ADMIN_JWT_AUDIENCE,
      typ: 'admin_mfa',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or expired MFA token');
  }
}

function getTotpKeyBuffer(): Buffer {
  return Buffer.from(env.ADMIN_TOTP_ENCRYPTION_KEY, 'base64');
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getTotpKeyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptTotpSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new AppError('INTERNAL_ERROR', 500, 'Corrupted encrypted TOTP secret');
  }
  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new AppError('INTERNAL_ERROR', 500, 'Corrupted encrypted TOTP secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getTotpKeyBuffer(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function hashSha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRecoveryCodes(count = 8): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = `${randomBytes(3).toString('hex').toUpperCase()}-${randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;
    plain.push(code);
    hashes.push(hashSha256Hex(code));
  }
  return { plain, hashes };
}
