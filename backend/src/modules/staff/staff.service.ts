import {
  AuditActor,
  Prisma,
  Role,
  type MasterService,
  type User,
  type WorkingHours,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import { UPCOMING_ACTIVE_STATUSES } from '../appointments/status-transitions.js';
import {
  applyIdentityEmail,
  applyIdentityPassword,
  assertIdentityNotShared,
  deleteIdentityIfOrphan,
  isLoginEmailTaken,
  lockIdentity,
} from '../auth/identity.service.js';
import { assertWithinStaffLimit } from '../billing/billing.service.js';
import type {
  CreateStaffBody,
  ReplaceStaffServicesBody,
  ReplaceWorkingHoursBody,
  UpdateStaffBody,
} from './staff.schemas.js';

export interface WorkingHoursDto {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface StaffServiceOverrideDto {
  serviceId: string;
  customPrice: string | null;
  customDurationMin: number | null;
}

export interface StaffDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  telegramConnected: boolean;
  notifyTelegram: boolean;
  isActive: boolean;
  isBookable: boolean;
  serviceIds: string[];
  serviceOverrides: StaffServiceOverrideDto[];
  workingHours: WorkingHoursDto[];
  createdAt: string;
  updatedAt: string;
}

type UserWithRelations = User & {
  services: (MasterService & { service: { deletedAt: Date | null } })[];
  workingHours: WorkingHours[];
};

const staffInclude = {
  services: {
    include: {
      service: {
        select: { deletedAt: true },
      },
    },
  },
  workingHours: {
    orderBy: { dayOfWeek: 'asc' as const },
  },
};

export function serializeStaff(user: UserWithRelations): StaffDto {
  const activeLinks = user.services.filter((ms) => ms.service.deletedAt === null);
  const activeServiceIds = activeLinks.map((ms) => ms.serviceId);
  const serviceOverrides: StaffServiceOverrideDto[] = activeLinks
    .filter((ms) => ms.customPrice !== null || ms.customDurationMin !== null)
    .map((ms) => ({
      serviceId: ms.serviceId,
      customPrice: ms.customPrice !== null ? ms.customPrice.toFixed(2) : null,
      customDurationMin: ms.customDurationMin,
    }));

  const workingHours = [...user.workingHours]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((wh) => ({
      dayOfWeek: wh.dayOfWeek,
      startTime: wh.startTime,
      endTime: wh.endTime,
      breakStart: wh.breakStart,
      breakEnd: wh.breakEnd,
    }));

  return {
    id: user.id,
    companyId: user.companyId,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone,
    hasLogin: user.email !== null && user.passwordHash !== null,
    telegramConnected: Boolean(user.telegramChatId),
    notifyTelegram: user.notifyTelegram,
    isActive: user.isActive,
    isBookable: user.isBookable,
    serviceIds: activeServiceIds,
    serviceOverrides,
    workingHours,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function serializeStaffForActor(user: UserWithRelations, actor: AuthenticatedActor): StaffDto {
  const staff = serializeStaff(user);
  if (actor.role === Role.MANAGER && user.id !== actor.userId) {
    return {
      ...staff,
      email: null,
      phone: null,
      hasLogin: false,
      telegramConnected: false,
      notifyTelegram: false,
    };
  }
  return staff;
}

export async function listStaffForCompany(actor: AuthenticatedActor): Promise<StaffDto[]> {
  const staff = await prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      ...(actor.role === Role.MANAGER ? { isBookable: true } : {}),
    },
    include: staffInclude,
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return staff.map((user) => serializeStaffForActor(user, actor));
}

export async function getStaffByIdForActor(
  actor: AuthenticatedActor,
  staffId: string,
): Promise<StaffDto> {
  if (actor.role === Role.MASTER && actor.userId !== staffId) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  const user = await prisma.user.findFirst({
    where: {
      id: staffId,
      companyId: actor.companyId,
      ...(actor.role === Role.MANAGER && actor.userId !== staffId ? { isBookable: true } : {}),
    },
    include: staffInclude,
  });
  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  return serializeStaffForActor(user, actor);
}

export async function createStaffForCompany(
  companyId: string,
  input: CreateStaffBody,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<StaffDto> {
  const normalizedPhone =
    input.phone !== undefined && input.phone !== null && input.phone.length > 0
      ? normalizePhoneE164(input.phone, 'phone')
      : null;

  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : null;

  if (input.email !== undefined) {
    const existingIdentity = await prismaUnfiltered.identity.findUnique({
      where: { email: input.email },
      include: { members: true },
    });
    const existingByEmail =
      existingIdentity?.members.find((m) => m.companyId === companyId) ??
      (await prismaUnfiltered.user.findFirst({
        where: { email: input.email },
      }));

    if (existingIdentity || existingByEmail) {
      // §3.3: Creating a staff member whose email belongs to a soft-deleted MASTER of the
      // SAME company (and not shared with any other company) restores and updates that record;
      // any other collision is 409 CONFLICT — email match alone never grants company access.
      const onlyThisCompany =
        !existingIdentity || existingIdentity.members.every((m) => m.companyId === companyId);

      if (
        onlyThisCompany &&
        existingByEmail &&
        existingByEmail.companyId === companyId &&
        existingByEmail.deletedAt !== null &&
        existingByEmail.role === Role.MASTER
      ) {
        await prismaUnfiltered.$transaction(async (tx) => {
          if (input.isActive !== false) {
            await assertWithinStaffLimit(companyId, 1);
          }
          await tx.masterService.deleteMany({ where: { userId: existingByEmail.id } });
          await tx.workingHours.deleteMany({ where: { userId: existingByEmail.id } });
          let targetIdentityId = existingByEmail.identityId ?? existingIdentity?.id ?? null;
          if (targetIdentityId) {
            await tx.identity.update({
              where: { id: targetIdentityId },
              data: {
                passwordHash,
                credentialVersion: { increment: 1 },
                lastCompanyId: companyId,
              },
            });
          } else {
            const createdIdentity = await tx.identity.create({
              data: {
                email: input.email as string,
                passwordHash,
                lastCompanyId: companyId,
              },
            });
            targetIdentityId = createdIdentity.id;
          }
          await tx.user.update({
            where: { id: existingByEmail.id },
            data: {
              identityId: targetIdentityId,
              name: input.name,
              phone: normalizedPhone,
              email: input.email,
              passwordHash,
              isActive: input.isActive,
              isBookable: input.isBookable,
              deletedAt: null,
              tokenVersion: { increment: 1 },
            },
          });
        });

        const restored = await prisma.user.findUniqueOrThrow({
          where: { id: existingByEmail.id },
          include: staffInclude,
        });
        await audit(prisma, {
          actorType: AuditActor.USER,
          actorId: auditMeta?.actorId ?? null,
          companyId,
          action: 'staff.create',
          entityType: 'User',
          entityId: restored.id,
          metadata: { restored: true, role: restored.role, name: restored.name },
          context: auditMeta?.context,
        });
        return serializeStaff(restored);
      }

      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (input.isActive !== false) {
        await assertWithinStaffLimit(companyId, 1, tx);
      }
      let identityId: string | null = null;
      if (input.email !== undefined) {
        const identity = await tx.identity.create({
          data: {
            email: input.email,
            passwordHash,
            lastCompanyId: companyId,
          },
        });
        identityId = identity.id;
      }
      return tx.user.create({
        data: {
          companyId,
          identityId,
          role: Role.MASTER,
          name: input.name,
          phone: normalizedPhone,
          email: input.email ?? null,
          passwordHash,
          isActive: input.isActive,
          isBookable: input.isBookable,
        },
        include: staffInclude,
      });
    });
    await audit(prisma, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: 'staff.create',
      entityType: 'User',
      entityId: created.id,
      metadata: { restored: false, role: created.role, name: created.name },
      context: auditMeta?.context,
    });
    return serializeStaff(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
    throw err;
  }
}

export async function updateStaffForCompany(
  companyId: string,
  staffId: string,
  input: UpdateStaffBody,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<StaffDto> {
  const existing = await prisma.user.findFirst({
    where: { id: staffId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  // The OWNER's own record may never have isActive set to false or its login removed.
  if (existing.role === Role.OWNER && input.isActive === false) {
    throw new AppError('VALIDATION_ERROR', 400, 'Owner account cannot be deactivated', [
      { path: 'isActive', message: 'Owner account cannot be deactivated' },
    ]);
  }
  if (existing.role === Role.MANAGER && input.isBookable === true) {
    throw new AppError('VALIDATION_ERROR', 400, 'Managers cannot be booked');
  }

  let normalizedPhone: string | null | undefined;
  if (input.phone !== undefined) {
    normalizedPhone =
      input.phone === null || input.phone.length === 0
        ? null
        : normalizePhoneE164(input.phone, 'phone');
  }

  let nextEmail: string | null | undefined;
  if (input.email !== undefined) {
    nextEmail = input.email === null || input.email === '' ? null : input.email;
  }

  if (existing.role === Role.OWNER && nextEmail === null) {
    throw new AppError('VALIDATION_ERROR', 400, 'Owner email cannot be removed', [
      { path: 'email', message: 'Owner must keep a login email' },
    ]);
  }
  if (existing.role === Role.MANAGER && nextEmail === null) {
    throw new AppError('VALIDATION_ERROR', 400, 'Manager must keep a login email');
  }

  // If enabling login on a user that currently has no passwordHash, require password
  if (
    nextEmail !== undefined &&
    nextEmail !== null &&
    nextEmail !== existing.email &&
    existing.passwordHash === null &&
    input.password === undefined
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Password is required when setting an email for a staff member without a login',
      [{ path: 'password', message: 'Password is required when adding a login email' }],
    );
  }

  if (nextEmail !== undefined && nextEmail !== null && nextEmail !== existing.email) {
    const emailIdentity = await prismaUnfiltered.identity.findUnique({
      where: { email: nextEmail },
    });
    const emailOwner = await prismaUnfiltered.user.findFirst({
      where: { email: nextEmail },
    });
    if (
      (emailIdentity && emailIdentity.id !== existing.identityId) ||
      (emailOwner && emailOwner.id !== existing.id)
    ) {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
  }

  let nextPasswordHash: string | null | undefined;
  if (nextEmail === null) {
    nextPasswordHash = null;
  } else if (input.password !== undefined) {
    nextPasswordHash = await hashPassword(input.password);
  }

  const emailChanged = nextEmail !== undefined && nextEmail !== existing.email;
  const credentialsChanging =
    emailChanged || input.password !== undefined || (nextEmail === null && existing.email !== null);
  const shouldBumpTokenVersion =
    credentialsChanging || (input.isActive === false && existing.isActive);

  const currentNow = clockNow();

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (!existing.isActive && input.isActive === true) {
        await assertWithinStaffLimit(companyId, 1, tx);
      }
      if (credentialsChanging && existing.identityId) {
        await lockIdentity(tx, existing.identityId);
        await assertIdentityNotShared(tx, existing.identityId, companyId);
      }

      let nextIdentityId: string | null | undefined;
      let identityPasswordHandled = false;

      if (nextEmail === null) {
        nextIdentityId = null;
      } else if (emailChanged && nextEmail !== undefined) {
        if (await isLoginEmailTaken(tx, nextEmail)) {
          throw new AppError('CONFLICT', 409, 'Email is already in use');
        }
        if (existing.identityId) {
          await applyIdentityEmail(tx, existing.identityId, nextEmail, currentNow);
          if (nextPasswordHash !== undefined) {
            await applyIdentityPassword(tx, existing.identityId, nextPasswordHash, currentNow);
            identityPasswordHandled = true;
          }
        } else {
          const createdIdentity = await tx.identity.create({
            data: {
              email: nextEmail,
              passwordHash: nextPasswordHash ?? null,
              lastCompanyId: companyId,
            },
          });
          nextIdentityId = createdIdentity.id;
        }
      } else if (input.password !== undefined && existing.identityId) {
        await applyIdentityPassword(tx, existing.identityId, nextPasswordHash ?? null, currentNow);
        identityPasswordHandled = true;
      }

      if (shouldBumpTokenVersion && !identityPasswordHandled) {
        await tx.authSession.updateMany({
          where: { userId: existing.id, companyId, revokedAt: null },
          data: { revokedAt: currentNow },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: existing.id, user: { companyId }, usedAt: null },
          data: { usedAt: currentNow },
        });
      }

      const saved = await tx.user.update({
        where: { id: existing.id, companyId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
          ...(nextIdentityId !== undefined ? { identityId: nextIdentityId } : {}),
          ...(nextEmail !== undefined && !existing.identityId
            ? {
                email: nextEmail,
                ...(emailChanged
                  ? { emailVerifiedAt: null, emailVerifyHash: null, emailVerifyExpiresAt: null }
                  : {}),
              }
            : nextEmail === null
              ? {
                  email: null,
                  emailVerifiedAt: null,
                  emailVerifyHash: null,
                  emailVerifyExpiresAt: null,
                }
              : {}),
          ...(!identityPasswordHandled && nextPasswordHash !== undefined
            ? { passwordHash: nextPasswordHash }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.isBookable !== undefined ? { isBookable: input.isBookable } : {}),
          ...(shouldBumpTokenVersion && !identityPasswordHandled
            ? { tokenVersion: { increment: 1 } }
            : {}),
        },
        include: staffInclude,
      });

      if (nextEmail === null && existing.identityId) {
        await deleteIdentityIfOrphan(tx, existing.identityId);
      }

      return saved;
    });
    const isDeactivation = input.isActive === false && existing.isActive;
    await audit(prisma, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: isDeactivation ? 'staff.deactivate' : 'staff.update',
      entityType: 'User',
      entityId: updated.id,
      metadata: {
        updatedFields: Object.keys(input).filter(
          (k) => input[k as keyof UpdateStaffBody] !== undefined,
        ),
        isActive: updated.isActive,
      },
      context: auditMeta?.context,
    });
    return serializeStaff(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
    throw err;
  }
}

export async function deleteStaffForCompany(
  companyId: string,
  staffId: string,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { id: staffId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  // BR-7: The OWNER can never delete himself.
  if (existing.role === Role.OWNER) {
    throw new AppError('FORBIDDEN', 403, 'Owner account cannot be deleted');
  }

  const now = clockNow();
  const upcomingCount = await prisma.appointment.count({
    where: {
      companyId,
      masterId: staffId,
      status: { in: [...UPCOMING_ACTIVE_STATUSES] },
      startAt: { gte: now },
    },
  });

  if (upcomingCount > 0) {
    throw new AppError(
      'HAS_UPCOMING_APPOINTMENTS',
      409,
      `Cannot delete staff member with ${upcomingCount} upcoming scheduled appointment(s)`,
      [
        {
          message: `Staff member has ${upcomingCount} upcoming scheduled appointment(s)`,
          upcomingAppointmentsCount: upcomingCount,
        },
      ],
    );
  }

  // Soft delete and bump tokenVersion so existing sessions stop working immediately (BR-11)
  await prisma.$transaction([
    prisma.masterService.deleteMany({ where: { userId: staffId } }),
    prisma.workingHours.deleteMany({ where: { userId: staffId } }),
    prisma.staffMedia.deleteMany({ where: { companyId, userId: staffId } }),
    prisma.authSession.updateMany({
      where: { userId: staffId, companyId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: staffId, user: { companyId }, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.user.update({
      where: { id: staffId, companyId },
      data: {
        deletedAt: now,
        tokenVersion: { increment: 1 },
      },
    }),
  ]);

  await audit(prisma, {
    actorType: AuditActor.USER,
    actorId: auditMeta?.actorId ?? null,
    companyId,
    action: 'staff.delete',
    entityType: 'User',
    entityId: staffId,
    metadata: { name: existing.name },
    context: auditMeta?.context,
  });
}

export async function replaceStaffServicesForCompany(
  companyId: string,
  staffId: string,
  input: ReplaceStaffServicesBody,
): Promise<StaffDto> {
  const staff = await prisma.user.findFirst({
    where: { id: staffId, companyId },
  });
  if (!staff) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }
  if (staff.role === Role.MANAGER) {
    throw new AppError('VALIDATION_ERROR', 400, 'Managers do not provide booking services');
  }

  if (input.serviceIds.length > 0) {
    const matchingServices = await prisma.service.findMany({
      where: {
        companyId,
        id: { in: input.serviceIds },
      },
      select: { id: true },
    });

    if (matchingServices.length !== input.serviceIds.length) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'One or more serviceIds do not belong to this company or have been deleted',
        [
          {
            path: 'serviceIds',
            message: 'All services must belong to the company and not be deleted',
          },
        ],
      );
    }
  }

  const overrideByServiceId = new Map(
    (input.serviceOverrides ?? []).map((item) => [item.serviceId, item]),
  );

  await prisma.$transaction([
    prisma.masterService.deleteMany({ where: { userId: staffId } }),
    ...(input.serviceIds.length > 0
      ? [
          prisma.masterService.createMany({
            data: input.serviceIds.map((serviceId) => {
              const override = overrideByServiceId.get(serviceId);
              return {
                userId: staffId,
                serviceId,
                customPrice:
                  override?.customPrice !== undefined && override.customPrice !== null
                    ? new Prisma.Decimal(override.customPrice)
                    : null,
                customDurationMin: override?.customDurationMin ?? null,
              };
            }),
          }),
        ]
      : []),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: staffId },
    include: staffInclude,
  });
  return serializeStaff(updated);
}

export async function replaceStaffWorkingHoursForCompany(
  companyId: string,
  staffId: string,
  input: ReplaceWorkingHoursBody,
): Promise<StaffDto> {
  const staff = await prisma.user.findFirst({
    where: { id: staffId, companyId },
  });
  if (!staff) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }
  if (staff.role === Role.MANAGER) {
    throw new AppError('VALIDATION_ERROR', 400, 'Managers do not have bookable hours');
  }

  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { userId: staffId } }),
    ...(input.days.length > 0
      ? [
          prisma.workingHours.createMany({
            data: input.days.map((day) => ({
              userId: staffId,
              dayOfWeek: day.dayOfWeek,
              startTime: day.startTime,
              endTime: day.endTime,
              breakStart: day.breakStart ?? null,
              breakEnd: day.breakEnd ?? null,
            })),
          }),
        ]
      : []),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: staffId },
    include: staffInclude,
  });
  return serializeStaff(updated);
}
