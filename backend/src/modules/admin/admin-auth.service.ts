import { generateSecret, generateURI, verifySync } from 'otplib';
import { env } from '../../config/env.js';
import { AuditActor, type PlatformAdmin } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashSha256Hex,
  signAdminAccessToken,
  signAdminMfaToken,
  signAdminRefreshToken,
  verifyAdminMfaToken,
  verifyAdminRefreshToken,
} from './admin-crypto.js';
import type {
  AdminChangePasswordBody,
  AdminLoginBody,
  AdminMfaBody,
} from './admin-auth.schemas.js';

const MAX_FAILED_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;
const TOTP_PERIOD_SEC = 30;
const TOTP_EPOCH_TOLERANCE_SEC = 30;

export interface AdminProfileDto {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type AdminLoginResult =
  | {
      status: 'authenticated';
      accessToken: string;
      refreshToken: string;
      admin: AdminProfileDto;
    }
  | {
      status: 'mfa_required' | 'enroll_required';
      mfaToken: string;
    };

export function serializeAdminProfile(admin: PlatformAdmin): AdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    isActive: admin.isActive,
    totpEnabled: admin.totpEnabledAt !== null,
    lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
    createdAt: admin.createdAt.toISOString(),
  };
}

function issueAdminSession(admin: PlatformAdmin): {
  accessToken: string;
  refreshToken: string;
  admin: AdminProfileDto;
} {
  return {
    accessToken: signAdminAccessToken(admin),
    refreshToken: signAdminRefreshToken(admin),
    admin: serializeAdminProfile(admin),
  };
}

export async function loginAdminWithPassword(
  input: AdminLoginBody,
  auditContext?: AuditRequestContext,
): Promise<AdminLoginResult> {
  const currentNow = clockNow();
  const admin = await prisma.platformAdmin.findUnique({
    where: { email: input.email },
  });

  if (
    !admin ||
    !admin.isActive ||
    (admin.lockedUntil !== null && admin.lockedUntil.getTime() > currentNow.getTime())
  ) {
    await verifyDummyPassword(input.password);
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  const isPasswordValid = await verifyPassword(admin.passwordHash, input.password);
  if (!isPasswordValid) {
    const nextFailedCount = admin.failedLoginCount + 1;
    const lockedUntil =
      nextFailedCount >= MAX_FAILED_LOGIN_ATTEMPTS
        ? addMinutesUtc(currentNow, LOCKOUT_DURATION_MINUTES)
        : null;

    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: nextFailedCount,
        ...(lockedUntil ? { lockedUntil } : {}),
      },
    });

    await audit(prisma, {
      actorType: AuditActor.ADMIN,
      actorId: admin.id,
      action: lockedUntil ? 'admin.login_locked' : 'admin.login_failed',
      entityType: 'PlatformAdmin',
      entityId: admin.id,
      metadata: { failedLoginCount: nextFailedCount },
      context: auditContext,
    });

    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  if (admin.totpEnabledAt !== null) {
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return {
      status: 'mfa_required',
      mfaToken: signAdminMfaToken(admin, 'mfa'),
    };
  }

  if (env.ADMIN_REQUIRE_2FA) {
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return {
      status: 'enroll_required',
      mfaToken: signAdminMfaToken(admin, 'enroll'),
    };
  }

  const updated = await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: currentNow,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: admin.id,
    action: 'admin.login',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    context: auditContext,
  });

  return {
    status: 'authenticated',
    ...issueAdminSession(updated),
  };
}

export async function verifyAdminMfa(
  input: AdminMfaBody,
  auditContext?: AuditRequestContext,
): Promise<{ accessToken: string; refreshToken: string; admin: AdminProfileDto }> {
  const claims = verifyAdminMfaToken(input.mfaToken, 'mfa');
  const currentNow = clockNow();

  const admin = await prisma.platformAdmin.findUnique({
    where: { id: claims.sub },
  });

  if (
    !admin ||
    !admin.isActive ||
    admin.tokenVersion !== claims.tv ||
    admin.totpEnabledAt === null ||
    admin.totpSecretEnc === null
  ) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid MFA session');
  }

  if (input.code !== undefined) {
    const secret = decryptTotpSecret(admin.totpSecretEnc);
    const epoch = Math.floor(currentNow.getTime() / 1000);
    const result = verifySync({
      strategy: 'totp',
      secret,
      token: input.code,
      epoch,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
      ...(admin.lastTotpStep !== null ? { afterTimeStep: admin.lastTotpStep } : {}),
    });

    if (!result.valid) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid or replayed 2FA code');
    }

    const delta = 'delta' in result && typeof result.delta === 'number' ? result.delta : 0;
    const matchedStep = Math.floor(epoch / TOTP_PERIOD_SEC) + delta;

    const updated = await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        lastTotpStep: matchedStep,
        lastLoginAt: currentNow,
      },
    });

    await audit(prisma, {
      actorType: AuditActor.ADMIN,
      actorId: admin.id,
      action: 'admin.mfa_verify',
      entityType: 'PlatformAdmin',
      entityId: admin.id,
      metadata: { method: 'totp' },
      context: auditContext,
    });

    return issueAdminSession(updated);
  }

  // Recovery code verification (single-use)
  const rawRecovery = (input.recoveryCode ?? '').trim().toUpperCase();
  const recoveryHash = hashSha256Hex(rawRecovery);
  const idx = admin.recoveryCodeHashes.indexOf(recoveryHash);
  if (idx === -1) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid recovery code');
  }

  const remainingHashes = admin.recoveryCodeHashes.filter((_, i) => i !== idx);
  const updated = await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      recoveryCodeHashes: remainingHashes,
      lastLoginAt: currentNow,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: admin.id,
    action: 'admin.mfa_verify',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    metadata: { method: 'recovery_code', remainingCodes: remainingHashes.length },
    context: auditContext,
  });

  return issueAdminSession(updated);
}

export async function enrollAdminTotp(
  adminId: string,
  auditContext?: AuditRequestContext,
): Promise<{ secret: string; otpauthUrl: string }> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.isActive) {
    throw new AppError('UNAUTHENTICATED', 401, 'Admin account not found');
  }

  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: 'Zapis.kg Admin',
    label: admin.email,
    secret,
  });

  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      totpSecretEnc: encryptTotpSecret(secret),
      totpEnabledAt: null,
      lastTotpStep: null,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: admin.id,
    action: 'admin.2fa_enroll_start',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    context: auditContext,
  });

  return { secret, otpauthUrl };
}

export async function verifyAndEnableAdminTotp(
  adminId: string,
  code: string,
  auditContext?: AuditRequestContext,
): Promise<{
  accessToken: string;
  refreshToken: string;
  admin: AdminProfileDto;
  recoveryCodes: string[];
}> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.isActive || !admin.totpSecretEnc) {
    throw new AppError('VALIDATION_ERROR', 400, '2FA enrollment has not been started');
  }

  const currentNow = clockNow();
  const secret = decryptTotpSecret(admin.totpSecretEnc);
  const epoch = Math.floor(currentNow.getTime() / 1000);
  const result = verifySync({
    strategy: 'totp',
    secret,
    token: code,
    epoch,
    epochTolerance: TOTP_EPOCH_TOLERANCE_SEC,
  });

  if (!result.valid) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid 2FA verification code');
  }

  const delta = 'delta' in result && typeof result.delta === 'number' ? result.delta : 0;
  const matchedStep = Math.floor(epoch / TOTP_PERIOD_SEC) + delta;
  const { plain, hashes } = generateRecoveryCodes(8);

  const updated = await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      totpEnabledAt: currentNow,
      lastTotpStep: matchedStep,
      recoveryCodeHashes: hashes,
      lastLoginAt: currentNow,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: admin.id,
    action: 'admin.2fa_enable',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    context: auditContext,
  });

  return {
    ...issueAdminSession(updated),
    recoveryCodes: plain,
  };
}

export async function refreshAdminSession(
  refreshToken: string | undefined,
): Promise<{ accessToken: string; refreshToken: string; admin: AdminProfileDto }> {
  if (!refreshToken) {
    throw new AppError('UNAUTHENTICATED', 401, 'Missing admin refresh token cookie');
  }
  const claims = verifyAdminRefreshToken(refreshToken);

  const admin = await prisma.platformAdmin.findUnique({ where: { id: claims.sub } });
  if (!admin || !admin.isActive || admin.tokenVersion !== claims.tv) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked admin refresh token');
  }

  return issueAdminSession(admin);
}

export async function getAdminProfile(adminId: string): Promise<AdminProfileDto> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.isActive) {
    throw new AppError('UNAUTHENTICATED', 401, 'Admin account not found');
  }
  return serializeAdminProfile(admin);
}

export async function changeAdminPassword(
  adminId: string,
  input: AdminChangePasswordBody,
  auditContext?: AuditRequestContext,
): Promise<{ accessToken: string; refreshToken: string; admin: AdminProfileDto }> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.isActive) {
    throw new AppError('UNAUTHENTICATED', 401, 'Admin account not found');
  }

  const validCurrent = await verifyPassword(admin.passwordHash, input.currentPassword);
  if (!validCurrent) {
    throw new AppError('UNAUTHENTICATED', 401, 'Current password is incorrect');
  }

  const newHash = await hashPassword(input.newPassword);
  const updated = await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      passwordHash: newHash,
      tokenVersion: { increment: 1 },
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: admin.id,
    action: 'admin.password_change',
    entityType: 'PlatformAdmin',
    entityId: admin.id,
    context: auditContext,
  });

  return issueAdminSession(updated);
}
