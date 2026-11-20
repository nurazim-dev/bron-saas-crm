import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isLoginEmailTaken } from '../auth/identity.service.js';
import { hashPasswordResetToken } from '../auth/password-reset.service.js';
import { enqueue } from '../notifications/outbox.service.js';
import type { InviteStaffBody } from './staff.schemas.js';

export async function inviteStaff(
  companyId: string,
  ownerId: string,
  input: { name: string; email: string; role?: InviteStaffBody['role'] },
  context?: AuditRequestContext,
) {
  const current = now();
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = addMinutesUtc(current, 60);
  const url = `${env.APP_URL.replace(/\/+$/, '')}/reset-password#${raw}`;
  const role = input.role ?? 'MASTER';
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE`;
    const subscription = await tx.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
    const count = await tx.user.count({ where: { companyId, isActive: true } });
    if (!subscription || count >= subscription.plan.maxStaff)
      throw new AppError('PLAN_LIMIT_REACHED', 402, 'Staff limit reached');
    if (await isLoginEmailTaken(tx, input.email)) {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
    const identity = await tx.identity.create({
      data: {
        email: input.email,
        passwordHash: null,
        lastCompanyId: companyId,
      },
    });
    const user = await tx.user.create({
      data: {
        companyId,
        identityId: identity.id,
        role,
        name: input.name,
        email: input.email,
        isActive: true,
        isBookable: role === 'MASTER',
        passwordHash: null,
      },
    });
    const token = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashPasswordResetToken(raw),
        expiresAt,
        createdBy: 'OWNER',
        createdById: ownerId,
        createdAt: current,
      },
    });
    await enqueue(tx, {
      companyId,
      channel: 'EMAIL',
      kind: 'STAFF_INVITATION',
      recipient: input.email,
      toUserId: user.id,
      payload: { inviteUrl: url, name: input.name },
      dedupeKey: `staff-invite:${token.id}`,
    });
    await audit(tx, {
      actorType: 'USER',
      actorId: ownerId,
      companyId,
      action: 'staff.invite',
      entityType: 'User',
      entityId: user.id,
      metadata: { role },
      context,
    });
    return { id: user.id, url, expiresAt: expiresAt.toISOString() };
  });
}
