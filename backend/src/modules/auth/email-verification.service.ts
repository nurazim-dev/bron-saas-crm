import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { now } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { enqueue } from '../notifications/outbox.service.js';
import { hashSessionToken } from './auth.service.js';

export async function requestEmailVerification(userId: string, companyId: string) {
  const raw = randomBytes(32).toString('base64url');
  const current = now();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    const user = await tx.user.findFirst({ where: { id: userId, companyId, isActive: true } });
    if (!user || !user.email) throw new AppError('NOT_FOUND', 404, 'Email not found');
    if (user.emailVerifiedAt) return;
    if (user.emailVerifyExpiresAt && user.emailVerifyExpiresAt > addMinutesUtc(current, 59))
      throw new AppError('RATE_LIMITED', 429, 'Please wait before requesting another email');
    await tx.user.update({
      where: { id: userId, companyId },
      data: {
        emailVerifyHash: hashSessionToken(raw),
        emailVerifyExpiresAt: addMinutesUtc(current, 60),
      },
    });
    await enqueue(tx, {
      companyId,
      channel: 'EMAIL',
      kind: 'EMAIL_VERIFICATION',
      toUserId: userId,
      recipient: user.email,
      payload: { verifyUrl: `${env.APP_URL.replace(/\/+$/, '')}/verify-email#${raw}` },
      dedupeKey: `verify-email:${hashSessionToken(raw)}`,
    });
  });
}

export async function confirmEmailVerification(raw: string) {
  const current = now();
  const hash = hashSessionToken(raw);
  const user = await prisma.user.findFirst({
    where: {
      emailVerifyHash: hash,
      isActive: true,
      company: { deletedAt: null, suspendedAt: null },
    },
    select: { id: true, companyId: true, identityId: true, email: true },
  });
  if (!user)
    throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, 'Verification link is invalid or expired');

  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: {
        id: user.id,
        companyId: user.companyId,
        emailVerifyHash: hash,
        emailVerifyExpiresAt: { gt: current },
        emailVerifiedAt: null,
        isActive: true,
        company: { deletedAt: null, suspendedAt: null },
      },
      data: { emailVerifiedAt: current, emailVerifyHash: null, emailVerifyExpiresAt: null },
    });
    if (changed.count !== 1)
      throw new AppError(
        'INVALID_OR_EXPIRED_TOKEN',
        400,
        'Verification link is invalid or expired',
      );

    if (user.identityId && user.email) {
      await tx.user.updateMany({
        where: {
          identityId: user.identityId,
          email: user.email,
          emailVerifiedAt: null,
        },
        data: { emailVerifiedAt: current, emailVerifyHash: null, emailVerifyExpiresAt: null },
      });
    }
  });
}
