import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  AuditActor,
  Locale,
  NotificationChannel,
  PasswordResetCreator,
  Role,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyDummyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { enqueue } from '../notifications/outbox.service.js';
import {
  applyIdentityPassword,
  assertIdentityNotShared,
  lockIdentity,
} from './identity.service.js';

export const PASSWORD_RESET_TTL_MINUTES = 60;

export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account with that email exists, we have sent password reset instructions.';

export function hashPasswordResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function generateRawResetToken(): string {
  return randomBytes(32).toString('base64url');
}

function buildResetUrl(rawToken: string): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export async function requestPasswordResetByEmail(
  email: string,
  auditContext?: AuditRequestContext,
): Promise<{ message: string }> {
  const identity = await prisma.identity.findUnique({
    where: { email },
    include: {
      members: {
        where: { deletedAt: null, isActive: true },
        include: { company: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  const eligibleMembers =
    identity && identity.passwordHash !== null
      ? identity.members.filter(
          (member) =>
            member.email !== null &&
            member.company.deletedAt === null &&
            member.company.suspendedAt === null,
        )
      : [];

  const user =
    eligibleMembers.find((member) => member.companyId === identity?.lastCompanyId) ??
    eligibleMembers[0] ??
    null;

  if (!identity || !user || user.email === null) {
    // Equalize response timing so account existence cannot be inferred.
    await verifyDummyPassword('timing-equalization-dummy');
    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }

  const currentNow = clockNow();
  const expiresAt = addMinutesUtc(currentNow, PASSWORD_RESET_TTL_MINUTES);
  const rawToken = generateRawResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const resetUrl = buildResetUrl(rawToken);
  const recipientEmail = identity.email;
  const memberIds = identity.members.map((m) => m.id);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: { in: memberIds }, usedAt: null },
      data: { usedAt: currentNow },
    });

    const tokenRecord = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        createdBy: PasswordResetCreator.SELF,
        createdById: user.id,
        createdAt: currentNow,
      },
    });

    await enqueue(tx, {
      companyId: user.companyId,
      channel: NotificationChannel.EMAIL,
      kind: 'PASSWORD_RESET',
      recipient: recipientEmail,
      toUserId: user.id,
      locale: Locale.RU,
      payload: {
        resetUrl,
        userName: user.name,
        companyName: user.company.name,
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
      },
      dedupeKey: `password-reset:${tokenRecord.id}`,
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: user.id,
      companyId: user.companyId,
      action: 'auth.password_reset_request',
      entityType: 'User',
      entityId: user.id,
      metadata: { createdBy: PasswordResetCreator.SELF },
      context: auditContext,
    });
  });

  return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
}

export async function validatePasswordResetToken(
  rawToken: string | undefined,
): Promise<{ valid: boolean }> {
  if (!rawToken || rawToken.trim().length === 0) {
    return { valid: false };
  }

  const currentNow = clockNow();
  const tokenHash = hashPasswordResetToken(rawToken);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { company: true, identity: true },
      },
    },
  });

  const effectivePasswordHash =
    record?.user.identity?.passwordHash ?? record?.user.passwordHash ?? null;

  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= currentNow.getTime() ||
    record.user.deletedAt !== null ||
    !record.user.isActive ||
    (effectivePasswordHash === null && record.createdBy !== PasswordResetCreator.OWNER) ||
    record.user.company.deletedAt !== null ||
    record.user.company.suspendedAt !== null
  ) {
    return { valid: false };
  }

  return { valid: true };
}

export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
  auditContext?: AuditRequestContext,
): Promise<void> {
  const currentNow = clockNow();
  const tokenHash = hashPasswordResetToken(rawToken);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { company: true, identity: true },
      },
    },
  });

  const effectivePasswordHash =
    record?.user.identity?.passwordHash ?? record?.user.passwordHash ?? null;

  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= currentNow.getTime() ||
    record.user.deletedAt !== null ||
    !record.user.isActive ||
    (effectivePasswordHash === null && record.createdBy !== PasswordResetCreator.OWNER) ||
    record.user.company.deletedAt !== null ||
    record.user.company.suspendedAt !== null
  ) {
    throw new AppError(
      'INVALID_OR_EXPIRED_TOKEN',
      400,
      'Password reset link is invalid or has expired',
    );
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
      },
      data: {
        usedAt: currentNow,
      },
    });

    if (claimed.count === 0) {
      throw new AppError(
        'INVALID_OR_EXPIRED_TOKEN',
        400,
        'Password reset link is invalid or has expired',
      );
    }

    if (record.user.identityId) {
      await lockIdentity(tx, record.user.identityId);
      await applyIdentityPassword(tx, record.user.identityId, newPasswordHash, currentNow);
    } else {
      await tx.passwordResetToken.updateMany({
        where: {
          userId: record.userId,
          usedAt: null,
        },
        data: {
          usedAt: currentNow,
        },
      });

      await tx.authSession.updateMany({
        where: { userId: record.userId, companyId: record.user.companyId, revokedAt: null },
        data: { revokedAt: currentNow },
      });
      await tx.user.update({
        where: { id: record.userId, companyId: record.user.companyId },
        data: {
          passwordHash: newPasswordHash,
          tokenVersion: { increment: 1 },
        },
      });
    }

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: record.userId,
      companyId: record.user.companyId,
      action: 'auth.password_reset_complete',
      entityType: 'User',
      entityId: record.userId,
      metadata: { createdBy: record.createdBy },
      context: auditContext,
    });
  });
}

export async function generateStaffPasswordResetLink(
  companyId: string,
  ownerId: string,
  staffId: string,
  sendEmail: boolean,
  auditContext?: AuditRequestContext,
): Promise<{ url: string; expiresAt: string }> {
  const target = await prisma.user.findFirst({
    where: {
      id: staffId,
      companyId,
      role: { in: [Role.MASTER, Role.MANAGER] },
      isActive: true,
      email: { not: null },
    },
    include: { company: true },
  });

  if (!target || target.company.deletedAt !== null || target.email === null) {
    throw new AppError('NOT_FOUND', 404, 'Staff member with login not found');
  }

  const currentNow = clockNow();
  const expiresAt = addMinutesUtc(currentNow, PASSWORD_RESET_TTL_MINUTES);
  const rawToken = generateRawResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const url = buildResetUrl(rawToken);
  const targetEmail = target.email;

  await prisma.$transaction(async (tx) => {
    if (target.identityId) {
      await lockIdentity(tx, target.identityId);
      await assertIdentityNotShared(tx, target.identityId, companyId);
    }

    await tx.passwordResetToken.updateMany({
      where: { userId: target.id, usedAt: null },
      data: { usedAt: currentNow },
    });

    const created = await tx.passwordResetToken.create({
      data: {
        userId: target.id,
        tokenHash,
        expiresAt,
        createdBy: PasswordResetCreator.OWNER,
        createdById: ownerId,
        createdAt: currentNow,
      },
    });

    if (sendEmail) {
      await enqueue(tx, {
        companyId,
        channel: NotificationChannel.EMAIL,
        kind: 'PASSWORD_RESET',
        recipient: targetEmail,
        toUserId: target.id,
        locale: Locale.RU,
        payload: {
          resetUrl: url,
          userName: target.name,
          companyName: target.company.name,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        },
        dedupeKey: `password-reset:${created.id}`,
      });
    }

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: ownerId,
      companyId,
      action: 'staff.password_reset_link',
      entityType: 'User',
      entityId: target.id,
      metadata: { sendEmail },
      context: auditContext,
    });
  });

  return {
    url,
    expiresAt: expiresAt.toISOString(),
  };
}
