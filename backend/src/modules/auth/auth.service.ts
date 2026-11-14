import { Prisma, Role, type Company, type User } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../../lib/password.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import { generateUniqueCompanySlug } from '../../lib/slug.js';
import { type CompanyDto, serializeCompany } from '../company/company.service.js';
import type { ChangePasswordBody, LoginBody, RegisterBody } from './auth.schemas.js';

export interface AuthUserDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
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
    phone: user.phone,
    isActive: user.isActive,
    isBookable: user.isBookable,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function issueSessionTokens(user: User, company: Company): AuthSessionResult {
  const tokenPayload = {
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
    tv: user.tokenVersion,
  };
  return {
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
    user: serializeAuthUser(user),
    company: serializeCompany(company),
  };
}

export async function registerOwnerAndCompany(input: RegisterBody): Promise<AuthSessionResult> {
  const normalizedPhone =
    input.phone !== undefined && input.phone.length > 0
      ? normalizePhoneE164(input.phone, 'phone')
      : null;

  const existingEmail = await prismaUnfiltered.user.findUnique({
    where: { email: input.email },
  });
  if (existingEmail) {
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

      const createdOwner = await tx.user.create({
        data: {
          companyId: createdCompany.id,
          role: Role.OWNER,
          name: input.ownerName,
          email: input.email,
          passwordHash,
          phone: normalizedPhone,
          isActive: true,
          isBookable: true,
        },
      });

      return { company: createdCompany, owner: createdOwner };
    });

    return issueSessionTokens(owner, company);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Email or company slug already exists');
    }
    throw err;
  }
}

export async function loginWithEmailPassword(input: LoginBody): Promise<AuthSessionResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { company: true },
  });

  if (
    !user ||
    user.deletedAt !== null ||
    !user.isActive ||
    !user.passwordHash ||
    user.company.deletedAt !== null
  ) {
    await verifyDummyPassword(input.password);
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  const isPasswordValid = await verifyPassword(user.passwordHash, input.password);
  if (!isPasswordValid) {
    throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
  }

  return issueSessionTokens(user, user.company);
}

export async function refreshAuthSession(
  refreshToken: string | undefined,
): Promise<AuthSessionResult> {
  if (!refreshToken) {
    throw new AppError('UNAUTHENTICATED', 401, 'Missing refresh token cookie');
  }

  const claims = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
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

  return issueSessionTokens(user, user.company);
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
): Promise<AuthSessionResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    include: { company: true },
  });

  if (!user || !user.passwordHash || user.company.deletedAt !== null) {
    throw new AppError('UNAUTHENTICATED', 401, 'User session not found');
  }

  const isCurrentValid = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!isCurrentValid) {
    throw new AppError('UNAUTHENTICATED', 401, 'Current password is incorrect');
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newPasswordHash,
      tokenVersion: { increment: 1 },
    },
  });

  return issueSessionTokens(updatedUser, user.company);
}
