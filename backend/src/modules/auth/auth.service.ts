import { createHash, randomUUID } from 'node:crypto';
import { addDurationMsUtc } from '../../lib/datetime.js';
import { env } from '../../config/env.js';
import { parseDurationToMs } from '../../lib/jwt.js';
import { LEGAL_VERSION } from '../../config/legal.js';
import {
  AuditActor,
  Prisma,
  Role,
  type Company,
  type User,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../../lib/password.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import { generateUniqueCompanySlug } from '../../lib/slug.js';
import {
  assertOptionalPlanFeature,
  createTrialSubscriptionForCompany,
} from '../billing/billing.service.js';
import { type CompanyDto, serializeCompany } from '../company/company.service.js';
import { getPlatformSettings } from '../platform/platform-settings.service.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import type {
  ChangePasswordBody,
  CreateAdditionalCompanyBody,
  LoginBody,
  RegisterBody,
} from './auth.schemas.js';
import { applyIdentityPassword, lockIdentity } from './identity.service.js';

export interface AuthUserDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  emailVerifiedAt: string | null;
  phone: string | null;
  isActive: boolean;
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
  company: CompanyDto;
}

export function serializeAuthUser(user: User): AuthUserDto {
  return {
    id: user.id,
    companyId: user.companyId,
    role: user.role,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phone: user.phone,
    isActive: user.isActive,
    isBookable: user.isBookable,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

type SessionDb = Pick<TransactionClient, 'authSession'>;

/**
 * Issues a new server-side session for exactly one membership (User row). The JWT carries
 * that membership's id, companyId, role and tokenVersion; nothing else grants access.
 */
export async function issueSessionTokens(
  user: User,
  company: Company,
  userAgent = '',
  db: SessionDb = prisma,
): Promise<AuthSessionResult> {
  if (user.companyId !== company.id) {
    throw new AppError('UNAUTHENTICATED', 401, 'Membership does not belong to company');
  }
  const sid = randomUUID();
  const tokenPayload = {
    sid,
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
    tv: user.tokenVersion,
  };
  const refreshToken = signRefreshToken(tokenPayload);
  const current = clockNow();
  await db.authSession.create({
    data: {
      id: sid,
      userId: user.id,
      companyId: company.id,
      refreshHash: hashSessionToken(refreshToken),
      userAgent: userAgent.slice(0, 500),
      createdAt: current,
      lastUsedAt: current,
      expiresAt: addDurationMsUtc(current, parseDurationToMs(env.JWT_REFRESH_TTL)),
    },
  });
  return {
    accessToken: signAccessToken(tokenPayload),
    refreshToken,
    user: serializeAuthUser(user),
    company: serializeCompany(company),
  };
}

export async function registerOwnerAndCompany(
  input: RegisterBody,
  userAgent = '',
): Promise<AuthSessionResult> {
  const platformSettings = await getPlatformSettings();
  if (!platformSettings.registrationOpen) {
    throw new AppError('REGISTRATION_CLOSED', 403, 'New registrations are currently closed');
  }

  const normalizedPhone =
    input.phone !== undefined && input.phone.length > 0
      ? normalizePhoneE164(input.phone, 'phone')
      : null;

  const existingIdentity = await prisma.identity.findUnique({ where: { email: input.email } });
  const existingEmail = await prismaUnfiltered.user.findFirst({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingIdentity || existingEmail) {
    throw new AppError('CONFLICT', 409, 'Email is already registered');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const { company, owner } = await prisma.$transaction(async (tx) => {
      const slug = await generateUniqueCompanySlug(input.companyName, async (candidate) => {
        const found = await prismaUnfiltered.company.findUnique({ where: { slug: candidate } });
        return found !== null;
      });

      const createdCompany = await tx.company.create({
        data: {
          name: input.companyName,
          slug,
          businessType: input.businessType,
          phone: normalizedPhone,
          timezone: 'Asia/Bishkek',
          currency: 'KGS',
          slotIntervalMin: 30,
          minLeadTimeMin: 60,
          maxAdvanceDays: 60,
          publicBookingEnabled: true,
        },
      });

      const identity = await tx.identity.create({
        data: { email: input.email, passwordHash, lastCompanyId: createdCompany.id },
      });

      const createdOwner = await tx.user.create({
        data: {
          companyId: createdCompany.id,
          identityId: identity.id,
          role: Role.OWNER,
          name: input.ownerName,
          email: input.email,
          passwordHash,
          phone: normalizedPhone,
          isActive: true,
          isBookable: true,
          termsAcceptedAt: clockNow(),
          termsVersion: LEGAL_VERSION,
        },
      });

      await createTrialSubscriptionForCompany(tx, createdCompany.id);

      return { company: createdCompany, owner: createdOwner };
    });

    return issueSessionTokens(owner, company, userAgent);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Email or company slug already exists');
    }
    throw err;
  }
}

export async function loginWithEmailPassword(
  input: LoginBody,
  userAgent = '',
): Promise<AuthSessionResult> {
  // Login resolves the Identity by email; access is granted only through its memberships.
  const identity = await prisma.identity.findUnique({
    where: { email: input.email },
    include: {
      members: {
        where: { deletedAt: null, isActive: true },
        include: { company: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  if (!identity || !identity.passwordHash) {
    await verifyDummyPassword(input.password);
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  const isPasswordValid = await verifyPassword(identity.passwordHash, input.password);
  if (!isPasswordValid) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  const memberships = identity.members.filter((member) => member.company.deletedAt === null);
  if (memberships.length === 0) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }
  const available = memberships.filter((member) => member.company.suspendedAt === null);
  if (available.length === 0) {
    throw new AppError('COMPANY_SUSPENDED', 403, 'Company account is suspended');
  }
  const selected =
    available.find((member) => member.companyId === identity.lastCompanyId) ?? available[0];
  if (!selected) throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');

  return issueSessionTokens(selected, selected.company, userAgent);
}

export async function refreshAuthSession(
  refreshToken: string | undefined,
): Promise<AuthSessionResult> {
  if (!refreshToken) {
    throw new AppError('UNAUTHENTICATED', 401, 'Missing refresh token cookie');
  }

  const claims = verifyRefreshToken(refreshToken);

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
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked refresh token');
  }

  if (user.company.suspendedAt !== null) {
    throw new AppError('COMPANY_SUSPENDED', 403, 'Company account is suspended');
  }

  if (!claims.sid) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in again');
  const sid = claims.sid;
  const payload = {
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
    tv: user.tokenVersion,
    sid,
  };
  const nextRefresh = signRefreshToken(payload);
  const current = clockNow();
  const refreshed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sid}::uuid AND "companyId" = ${user.companyId}::uuid AND "userId" = ${user.id}::uuid FOR UPDATE`;
    const session = await tx.authSession.findFirst({
      where: {
        id: sid,
        companyId: user.companyId,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: current },
      },
    });
    if (!session) return false;
    if (session.refreshHash !== hashSessionToken(refreshToken)) {
      await tx.authSession.updateMany({
        where: { id: sid, companyId: user.companyId, userId: user.id },
        data: { revokedAt: current },
      });
      await audit(tx, {
        actorType: AuditActor.USER,
        actorId: user.id,
        companyId: user.companyId,
        action: 'auth.session_replay',
        entityType: 'AuthSession',
        entityId: sid,
      });
      return false;
    }
    await tx.authSession.updateMany({
      where: { id: sid, companyId: user.companyId, userId: user.id },
      data: { refreshHash: hashSessionToken(nextRefresh), lastUsedAt: current },
    });
    return true;
  });
  if (!refreshed) throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked session');
  return {
    accessToken: signAccessToken(payload),
    refreshToken: nextRefresh,
    user: serializeAuthUser(user),
    company: serializeCompany(user.company),
  };
}

export async function getAuthenticatedProfile(
  userId: string,
  companyId: string,
): Promise<{ user: AuthUserDto; company: CompanyDto }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    include: { company: true },
  });

  if (!user || user.company.deletedAt !== null) {
    throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
  }

  return {
    user: serializeAuthUser(user),
    company: serializeCompany(user.company),
  };
}

export async function changeUserPassword(
  userId: string,
  companyId: string,
  input: ChangePasswordBody,
  auditContext?: AuditRequestContext,
  userAgent = '',
): Promise<AuthSessionResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    include: { company: true, identity: true },
  });

  const identity = user?.identity;
  if (!user || !identity || !identity.passwordHash || user.company.deletedAt !== null) {
    throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
  }

  const isCurrentValid = await verifyPassword(identity.passwordHash, input.currentPassword);
  if (!isCurrentValid) {
    throw new AppError('UNAUTHENTICATED', 401, 'Current password is incorrect');
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  const updatedUser = await prisma.$transaction(async (tx) => {
    // A concurrent reset/change must invalidate the password verified above.
    const changed = await tx.identity.updateMany({
      where: {
        id: identity.id,
        passwordHash: identity.passwordHash,
        credentialVersion: identity.credentialVersion,
      },
      data: { credentialVersion: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked session');
    }
    const stillActive = await tx.user.findFirst({
      where: {
        id: user.id,
        companyId,
        identityId: identity.id,
        tokenVersion: user.tokenVersion,
        isActive: true,
      },
      select: { id: true },
    });
    if (!stillActive) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid or revoked session');
    }

    // Password belongs to the identity: every membership's sessions are revoked.
    await applyIdentityPassword(tx, identity.id, newPasswordHash, clockNow());
    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: user.id,
      companyId,
      action: 'auth.password_change',
      entityType: 'User',
      entityId: user.id,
      context: auditContext,
    });

    return tx.user.findFirstOrThrow({ where: { id: user.id, companyId } });
  });

  return issueSessionTokens(updatedUser, user.company, userAgent);
}

export async function logoutAuthSession(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    const claims = verifyRefreshToken(token);
    if (claims.sid)
      await prisma.authSession.updateMany({
        where: { id: claims.sid, userId: claims.sub, companyId: claims.companyId, revokedAt: null },
        data: { revokedAt: clockNow() },
      });
  } catch (error) {
    if (!(error instanceof AppError && error.httpStatus === 401)) throw error;
  }
}

/**
 * Sessions are listed for the whole identity (all memberships of the same person), so a
 * device switched to another company remains visible and revocable.
 */
async function identityMemberScope(
  userId: string,
  companyId: string,
  restrictToCurrentCompany = false,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: { id: true, companyId: true, identityId: true },
  });
  if (!user) throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
  if (restrictToCurrentCompany || !user.identityId) {
    return [{ userId: user.id, companyId: user.companyId }];
  }
  const members = await prismaUnfiltered.user.findMany({
    where: { identityId: user.identityId },
    select: { id: true, companyId: true },
  });
  return members.map((member) => ({ userId: member.id, companyId: member.companyId }));
}

export async function listUserSessions(
  userId: string,
  companyId: string,
  sessionId?: string,
  isImpersonating = false,
) {
  const scope = await identityMemberScope(userId, companyId, isImpersonating);
  const rows = await prisma.authSession.findMany({
    where: { OR: scope, revokedAt: null, expiresAt: { gt: clockNow() } },
    orderBy: { lastUsedAt: 'desc' },
    take: 100,
  });
  const companyIds = [...new Set(rows.map((row) => row.companyId))];
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, name: true },
  });
  const names = new Map(companies.map((company) => [company.id, company.name]));
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    companyName: names.get(row.companyId) ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    current: row.id === sessionId,
  }));
}

export async function revokeUserSession(userId: string, companyId: string, id: string) {
  const scope = await identityMemberScope(userId, companyId);
  await prisma.$transaction(async (tx) => {
    const session = await tx.authSession.findFirst({
      where: { id, OR: scope, revokedAt: null },
      select: { id: true, companyId: true },
    });
    if (!session) throw new AppError('NOT_FOUND', 404, 'Session not found');
    const changed = await tx.authSession.updateMany({
      where: { id, companyId: session.companyId, OR: scope, revokedAt: null },
      data: { revokedAt: clockNow() },
    });
    if (!changed.count) throw new AppError('NOT_FOUND', 404, 'Session not found');
    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: userId,
      companyId: session.companyId,
      action: 'auth.session_revoke',
      entityType: 'AuthSession',
      entityId: id,
      metadata: { requestedFromCompanyId: companyId },
    });
  });
}

export interface CompanyMembershipDto {
  companyId: string;
  companyName: string;
  companySlug: string;
  businessType: Company['businessType'];
  role: Role;
  isCurrent: boolean;
  isSuspended: boolean;
}

const MAX_COMPANIES_PER_IDENTITY = 20;

export async function listUserMemberships(
  userId: string,
  companyId: string,
  isImpersonating = false,
): Promise<CompanyMembershipDto[]> {
  const current = await prisma.user.findFirst({
    where: { id: userId, companyId, isActive: true },
    include: { company: true },
  });
  if (!current || current.company.deletedAt !== null) {
    throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
  }

  if (isImpersonating || !current.identityId) {
    return [
      {
        companyId: current.company.id,
        companyName: current.company.name,
        companySlug: current.company.slug,
        businessType: current.company.businessType,
        role: current.role,
        isCurrent: true,
        isSuspended: current.company.suspendedAt !== null,
      },
    ];
  }

  const members = await prisma.user.findMany({
    where: {
      identityId: current.identityId,
      isActive: true,
      company: { deletedAt: null },
    },
    include: { company: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return members.map((member) => ({
    companyId: member.company.id,
    companyName: member.company.name,
    companySlug: member.company.slug,
    businessType: member.company.businessType,
    role: member.role,
    isCurrent: member.companyId === companyId,
    isSuspended: member.company.suspendedAt !== null,
  }));
}

export async function switchActiveCompany(
  userId: string,
  currentCompanyId: string,
  targetCompanyId: string,
  currentSessionId?: string,
  userAgent = '',
  auditContext?: AuditRequestContext,
): Promise<AuthSessionResult> {
  const currentNow = clockNow();

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: userId, companyId: currentCompanyId, isActive: true },
      select: { id: true, companyId: true, identityId: true },
    });
    if (!current) {
      throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
    }
    if (!current.identityId) {
      throw new AppError('NOT_FOUND', 404, 'Company not found');
    }

    await lockIdentity(tx, current.identityId);

    const target = await tx.user.findFirst({
      where: {
        identityId: current.identityId,
        companyId: targetCompanyId,
        isActive: true,
      },
      include: { company: true },
    });

    if (!target || target.company.deletedAt !== null) {
      throw new AppError('NOT_FOUND', 404, 'Company not found');
    }

    if (target.company.suspendedAt !== null) {
      throw new AppError('COMPANY_SUSPENDED', 403, 'Company account is suspended');
    }

    if (currentSessionId) {
      await tx.authSession.updateMany({
        where: {
          id: currentSessionId,
          userId: current.id,
          companyId: current.companyId,
          revokedAt: null,
        },
        data: { revokedAt: currentNow },
      });
    }

    await tx.identity.update({
      where: { id: current.identityId },
      data: { lastCompanyId: target.companyId },
    });

    const session = await issueSessionTokens(target, target.company, userAgent, tx);

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: target.id,
      companyId: target.companyId,
      action: 'auth.company_switch',
      entityType: 'Company',
      entityId: target.companyId,
      metadata: { fromCompanyId: currentCompanyId, role: target.role },
      context: auditContext,
    });

    return session;
  });
}

export async function createAdditionalCompany(
  userId: string,
  currentCompanyId: string,
  input: CreateAdditionalCompanyBody,
  currentSessionId?: string,
  userAgent = '',
  auditContext?: AuditRequestContext,
): Promise<AuthSessionResult> {
  const normalizedPhone =
    input.phone !== undefined && input.phone.length > 0
      ? normalizePhoneE164(input.phone, 'phone')
      : null;

  const currentNow = clockNow();

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id: userId, companyId: currentCompanyId, isActive: true },
        include: { identity: true },
      });
      if (!current || current.role !== Role.OWNER) {
        throw new AppError('FORBIDDEN', 403, 'Only owners can create additional companies');
      }
      if (!current.identityId || !current.identity) {
        throw new AppError('UNAUTHENTICATED', 401, 'User identity not found');
      }

      await assertOptionalPlanFeature(currentCompanyId, 'multiCompany');

      await lockIdentity(tx, current.identityId);

      const ownedCount = await tx.user.count({
        where: {
          identityId: current.identityId,
          role: Role.OWNER,
          isActive: true,
          company: { deletedAt: null },
        },
      });
      if (ownedCount >= MAX_COMPANIES_PER_IDENTITY) {
        throw new AppError(
          'COMPANY_LIMIT_REACHED',
          409,
          `Maximum number of companies (${MAX_COMPANIES_PER_IDENTITY}) reached`,
        );
      }

      const slug = await generateUniqueCompanySlug(input.companyName, async (candidate) => {
        const found = await prismaUnfiltered.company.findUnique({ where: { slug: candidate } });
        return found !== null;
      });

      const createdCompany = await tx.company.create({
        data: {
          name: input.companyName,
          slug,
          businessType: input.businessType,
          phone: normalizedPhone ?? current.phone,
          timezone: 'Asia/Bishkek',
          currency: 'KGS',
          slotIntervalMin: 30,
          minLeadTimeMin: 60,
          maxAdvanceDays: 60,
          publicBookingEnabled: true,
        },
      });

      const createdOwner = await tx.user.create({
        data: {
          companyId: createdCompany.id,
          identityId: current.identityId,
          role: Role.OWNER,
          name: current.name,
          email: current.identity.email,
          emailVerifiedAt: current.emailVerifiedAt,
          passwordHash: current.identity.passwordHash,
          phone: normalizedPhone ?? current.phone,
          isActive: true,
          isBookable: true,
          termsAcceptedAt: current.termsAcceptedAt ?? currentNow,
          termsVersion: current.termsVersion ?? LEGAL_VERSION,
        },
      });

      await createTrialSubscriptionForCompany(tx, createdCompany.id);

      if (currentSessionId) {
        await tx.authSession.updateMany({
          where: {
            id: currentSessionId,
            userId: current.id,
            companyId: current.companyId,
            revokedAt: null,
          },
          data: { revokedAt: currentNow },
        });
      }

      await tx.identity.update({
        where: { id: current.identityId },
        data: { lastCompanyId: createdCompany.id },
      });

      const session = await issueSessionTokens(createdOwner, createdCompany, userAgent, tx);

      await audit(tx, {
        actorType: AuditActor.USER,
        actorId: createdOwner.id,
        companyId: createdCompany.id,
        action: 'company.create_additional',
        entityType: 'Company',
        entityId: createdCompany.id,
        metadata: { fromCompanyId: currentCompanyId, businessType: createdCompany.businessType },
        context: auditContext,
      });

      return session;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Company slug already exists');
    }
    throw err;
  }
}
