import {
  AppointmentStatus,
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

export interface StaffDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  isActive: boolean;
  isBookable: boolean;
  serviceIds: string[];
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
  const activeServiceIds = user.services
    .filter((ms) => ms.service.deletedAt === null)
    .map((ms) => ms.serviceId);

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
    isActive: user.isActive,
    isBookable: user.isBookable,
    serviceIds: activeServiceIds,
    workingHours,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function listStaffForCompany(companyId: string): Promise<StaffDto[]> {
  const staff = await prisma.user.findMany({
    where: { companyId },
    include: staffInclude,
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return staff.map(serializeStaff);
}

export async function getStaffByIdForActor(
  actor: AuthenticatedActor,
  staffId: string,
): Promise<StaffDto> {
  if (actor.role === Role.MASTER && actor.userId !== staffId) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  const user = await prisma.user.findFirst({
    where: { id: staffId, companyId: actor.companyId },
    include: staffInclude,
  });
  if (!user) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  return serializeStaff(user);
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
    const existingByEmail = await prismaUnfiltered.user.findUnique({
      where: { email: input.email },
    });

    if (existingByEmail) {
      // §3.3: Creating a staff member whose email belongs to a soft-deleted user of the SAME
      // company restores and updates that record; any other collision is 409 CONFLICT.
      if (
        existingByEmail.companyId === companyId &&
        existingByEmail.deletedAt !== null &&
        existingByEmail.role === Role.MASTER
      ) {
        if (input.isActive !== false) {
          await assertWithinStaffLimit(companyId, 1);
        }
        await prismaUnfiltered.$transaction([
          prismaUnfiltered.masterService.deleteMany({ where: { userId: existingByEmail.id } }),
          prismaUnfiltered.workingHours.deleteMany({ where: { userId: existingByEmail.id } }),
          prismaUnfiltered.user.update({
            where: { id: existingByEmail.id },
            data: {
              name: input.name,
              phone: normalizedPhone,
              email: input.email,
              passwordHash,
              isActive: input.isActive,
              isBookable: input.isBookable,
              deletedAt: null,
              tokenVersion: { increment: 1 },
            },
          }),
        ]);

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

  if (input.isActive !== false) {
    await assertWithinStaffLimit(companyId, 1);
  }

  try {
    const created = await prisma.user.create({
      data: {
        companyId,
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

  // If enabling login on a user that currently has no passwordHash, require password
  if (
    nextEmail !== undefined &&
    nextEmail !== null &&
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
    const emailOwner = await prismaUnfiltered.user.findUnique({
      where: { email: nextEmail },
    });
    if (emailOwner && emailOwner.id !== existing.id) {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
  }

  let nextPasswordHash: string | null | undefined;
  if (nextEmail === null) {
    nextPasswordHash = null;
  } else if (input.password !== undefined) {
    nextPasswordHash = await hashPassword(input.password);
  }

  // BR-11: tokenVersion is incremented on password change, deactivation, or login removal
  const shouldBumpTokenVersion =
    input.password !== undefined ||
    nextEmail === null ||
    (input.isActive === false && existing.isActive);

  if (!existing.isActive && input.isActive === true) {
    await assertWithinStaffLimit(companyId, 1);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
        ...(nextEmail !== undefined ? { email: nextEmail } : {}),
        ...(nextPasswordHash !== undefined ? { passwordHash: nextPasswordHash } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isBookable !== undefined ? { isBookable: input.isBookable } : {}),
        ...(shouldBumpTokenVersion ? { tokenVersion: { increment: 1 } } : {}),
      },
      include: staffInclude,
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

  // BR-7: The OWNER can never delete himself; DELETE /staff/:id is for MASTER records only.
  if (existing.role === Role.OWNER) {
    throw new AppError('FORBIDDEN', 403, 'Owner account cannot be deleted');
  }

  const now = clockNow();
  const upcomingCount = await prisma.appointment.count({
    where: {
      companyId,
      masterId: staffId,
      status: AppointmentStatus.SCHEDULED,
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
    prisma.user.update({
      where: { id: staffId },
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

  await prisma.$transaction([
    prisma.masterService.deleteMany({ where: { userId: staffId } }),
    ...(input.serviceIds.length > 0
      ? [
          prisma.masterService.createMany({
            data: input.serviceIds.map((serviceId) => ({
              userId: staffId,
              serviceId,
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
