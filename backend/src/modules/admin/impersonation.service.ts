import { randomBytes } from 'node:crypto';
import { AuditActor, Role } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { addDurationMsUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { signImpersonationAccessToken } from '../../lib/jwt.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import { type AuthUserDto, serializeAuthUser } from '../auth/auth.service.js';
import { type CompanyDto, serializeCompany } from '../company/company.service.js';
import { hashSha256Hex } from './admin-crypto.js';

const IMPERSONATION_CODE_TTL_MS = 60_000;

export async function startCompanyImpersonation(
  adminId: string,
  companyId: string,
  reason: string,
  auditContext?: AuditRequestContext,
): Promise<{ code: string; expiresAt: string }> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    throw new AppError('VALIDATION_ERROR', 400, 'Impersonation reason is required');
  }

  const company = await prismaUnfiltered.company.findUnique({
    where: { id: companyId },
  });
  if (!company || company.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
  if (company.suspendedAt !== null) {
    throw new AppError('COMPANY_SUSPENDED', 403, 'Cannot impersonate a suspended company');
  }

  const owner = await prisma.user.findFirst({
    where: {
      companyId: company.id,
      role: Role.OWNER,
      isActive: true,
    },
  });
  if (!owner) {
    throw new AppError('NOT_FOUND', 404, 'Active company owner not found');
  }

  const currentNow = clockNow();
  const expiresAt = addDurationMsUtc(currentNow, IMPERSONATION_CODE_TTL_MS);
  const rawCode = randomBytes(32).toString('base64url');
  const codeHash = hashSha256Hex(rawCode);

  await prisma.$transaction(async (tx) => {
    await tx.impersonationCode.create({
      data: {
        adminId,
        companyId: company.id,
        targetUserId: owner.id,
        codeHash,
        expiresAt,
        createdAt: currentNow,
      },
    });

    await audit(tx, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      companyId: company.id,
      action: 'admin.impersonation_start',
      entityType: 'Company',
      entityId: company.id,
      metadata: {
        targetUserId: owner.id,
        reason: trimmedReason,
      },
      context: auditContext,
    });
  });

  return {
    code: rawCode,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function exchangeImpersonationCode(
  rawCode: string,
  auditContext?: AuditRequestContext,
): Promise<{
  accessToken: string;
  user: AuthUserDto;
  company: CompanyDto;
  impersonating: true;
}> {
  const currentNow = clockNow();
  const codeHash = hashSha256Hex(rawCode.trim());

  const record = await prisma.impersonationCode.findUnique({
    where: { codeHash },
    include: { company: true },
  });

  if (
    !record ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= currentNow.getTime() ||
    record.company.deletedAt !== null ||
    record.company.suspendedAt !== null
  ) {
    throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, 'Impersonation code is invalid or expired');
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: record.targetUserId },
  });

  if (!targetUser || targetUser.deletedAt !== null || !targetUser.isActive) {
    throw new AppError(
      'INVALID_OR_EXPIRED_TOKEN',
      400,
      'Impersonation target user is no longer active',
    );
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.impersonationCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: currentNow },
    });
    if (claimed.count === 0) {
      throw new AppError(
        'INVALID_OR_EXPIRED_TOKEN',
        400,
        'Impersonation code has already been used',
      );
    }

    await audit(tx, {
      actorType: AuditActor.ADMIN,
      actorId: record.adminId,
      companyId: record.companyId,
      action: 'admin.impersonation_exchange',
      entityType: 'Company',
      entityId: record.companyId,
      metadata: { targetUserId: targetUser.id },
      context: auditContext,
    });
  });

  const accessToken = signImpersonationAccessToken({
    sub: targetUser.id,
    companyId: targetUser.companyId,
    role: targetUser.role,
    tv: targetUser.tokenVersion,
    imp: record.adminId,
  });

  return {
    accessToken,
    user: serializeAuthUser(targetUser),
    company: serializeCompany(record.company),
    impersonating: true,
  };
}

export async function exitImpersonationSession(
  actor: AuthenticatedActor,
  auditContext?: AuditRequestContext,
): Promise<void> {
  if (!actor.imp) {
    return;
  }

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: actor.imp,
    companyId: actor.companyId,
    action: 'admin.impersonation_exit',
    entityType: 'Company',
    entityId: actor.companyId,
    metadata: { targetUserId: actor.userId },
    context: auditContext,
  });
}
