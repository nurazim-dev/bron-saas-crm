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
  const user = await prisma.user.findUnique({
    where: { email },
    include: { company: true },
  });

  const isEligible =
    user !== null &&
    user.deletedAt === null &&
    user.isActive &&
    user.passwordHash !== null &&
    user.email !== null &&
    user.company.deletedAt === null;

  if (!isEligible || user === null || user.email === null) {
    // Equalize response timing so account existence cannot be inferred.
    await verifyDummyPassword('timing-equalization-dummy');
    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }

  const currentNow = clockNow();
  const expiresAt = addMinutesUtc(currentNow, PASSWORD_RESET_TTL_MINUTES);
  const rawToken = generateRawResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const resetUrl = buildResetUrl(rawToken);
  const recipientEmail = user.email;

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
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
        include: { company: true },
      },
    },
  });

  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= currentNow.getTime() ||
    record.user.deletedAt !== null ||
    !record.user.isActive ||
    record.user.passwordHash === null ||
    record.user.company.deletedAt !== null
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
        include: { company: true },
      },
    },
  });

  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= currentNow.getTime() ||
    record.user.deletedAt !== null ||
    !record.user.isActive ||
    record.user.passwordHash === null ||
    record.user.company.deletedAt !== null
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

    await tx.passwordResetToken.updateMany({
      where: {
        userId: record.userId,
        usedAt: null,
      },
      data: {
        usedAt: currentNow,
      },
    });

    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
      },
    });

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
      role: Role.MASTER,
      isActive: true,
      email: { not: null },
      passwordHash: { not: null },
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
