import { createHash, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { env } from '../../config/env.js';
import {
  AuditActor,
  Locale,
  NotificationChannel,
  OutboxStatus,
  PasswordResetCreator,
  PaymentStatus,
  Prisma,
  Role,
  SubscriptionStatus,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import { computeBillingState } from '../billing/billing-state.js';
import { serializePlan, type PlanDto } from '../billing/billing.service.js';
import { enqueue } from '../notifications/outbox.service.js';
import {
  getPlatformSettings,
  invalidatePublicPlatformCache,
  type PlatformSettingsDto,
} from '../platform/platform-settings.service.js';
import type {
  AdminAuditQuery,
  AdminCompaniesQuery,
  AdminCreatePlanBody,
  AdminOutboxQuery,
  AdminPaymentsQuery,
  AdminUpdateCompanyBody,
  AdminUpdatePlanBody,
  AdminUpdateSettingsBody,
  AdminUpdateUserBody,
  AdminUsersQuery,
} from './admin.schemas.js';

export async function getAdminOverviewMetrics() {
  const currentNow = clockNow();
  const settings = await getPlatformSettings(prisma);
  const sevenDaysAgo = DateTime.fromJSDate(currentNow, { zone: 'utc' })
    .minus({ days: 7 })
    .toJSDate();
  const thirtyDaysAgo = DateTime.fromJSDate(currentNow, { zone: 'utc' })
    .minus({ days: 30 })
    .toJSDate();
  const monthStart = DateTime.fromJSDate(currentNow, { zone: 'utc' }).startOf('month').toJSDate();

  const [
    companies,
    signups7d,
    signups30d,
    confirmedPaymentsThisMonth,
    appointmentsLast30d,
    failedOutboxCount,
    pendingPaymentsCount,
  ] = await Promise.all([
    prismaUnfiltered.company.findMany({
      where: { deletedAt: null },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    }),
    prismaUnfiltered.company.count({
      where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
    }),
    prismaUnfiltered.company.count({
      where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } },
    }),
    prismaUnfiltered.subscriptionPayment.aggregate({
      where: {
        status: PaymentStatus.CONFIRMED,
        reviewedAt: { gte: monthStart },
      },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prismaUnfiltered.appointment.count({
      where: {
        deletedAt: null,
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    prismaUnfiltered.outboxMessage.count({
      where: { status: OutboxStatus.FAILED },
    }),
    prismaUnfiltered.subscriptionPayment.count({
      where: { status: PaymentStatus.PENDING },
    }),
  ]);

  const byState: Record<SubscriptionStatus, number> = {
    TRIAL: 0,
    ACTIVE: 0,
    PAST_DUE: 0,
    LOCKED: 0,
  };
  let mrr = new Prisma.Decimal('0.00');
  let suspendedCount = 0;

  for (const company of companies) {
    if (company.suspendedAt !== null) {
      suspendedCount += 1;
    }
    if (!company.subscription) {
      continue;
    }
    const computed = computeBillingState(company.subscription, currentNow, {
      graceDays: settings.graceDays,
    });
    byState[computed.state] += 1;
    if (computed.state === SubscriptionStatus.ACTIVE && !company.subscription.isTrial) {
      mrr = mrr.add(company.subscription.plan.priceMonthly);
    }
  }

  return {
    totalCompanies: companies.length,
    suspendedCount,
    companiesByState: byState,
    signups7d,
    signups30d,
    mrr: mrr.toFixed(2),
    confirmedPaymentsThisMonth: {
      count: confirmedPaymentsThisMonth._count.id,
      amount: (confirmedPaymentsThisMonth._sum.amount ?? new Prisma.Decimal('0')).toFixed(2),
    },
    appointmentsLast30d,
    failedOutboxCount,
    pendingPaymentsCount,
  };
}

export async function getAdminSignupsSeries(days: number) {
  const currentNow = clockNow();
  const startDt = DateTime.fromJSDate(currentNow, { zone: 'utc' })
    .startOf('day')
    .minus({ days: days - 1 });

  const rows = await prismaUnfiltered.company.findMany({
    where: {
      createdAt: { gte: startDt.toJSDate() },
    },
    select: { createdAt: true },
  });

  const counts = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const key = startDt.plus({ days: i }).toISODate() ?? '';
    counts.set(key, 0);
  }
  for (const row of rows) {
    const key = DateTime.fromJSDate(row.createdAt, { zone: 'utc' }).toISODate() ?? '';
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
}

export async function listAdminCompanies(query: AdminCompaniesQuery) {
  const currentNow = clockNow();
  const settings = await getPlatformSettings(prisma);

  const where: Prisma.CompanyWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.businessType ? { businessType: query.businessType } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
            {
              users: {
                some: {
                  role: Role.OWNER,
                  email: { contains: query.search, mode: 'insensitive' },
                },
              },
            },
          ],
        }
      : {}),
    ...(query.plan
      ? {
          subscription: {
            plan: { code: query.plan },
          },
        }
      : {}),
  };

  const companies = await prismaUnfiltered.company.findMany({
    where,
    include: {
      users: {
        where: { role: Role.OWNER, deletedAt: null },
        select: { id: true, name: true, email: true, phone: true },
        take: 1,
      },
      subscription: {
        include: { plan: { select: { id: true, code: true, name: true } } },
      },
      _count: {
        select: { users: true, appointments: true },
      },
    },
    orderBy: query.sortBy === 'name' ? { name: query.sortDir } : { createdAt: query.sortDir },
  });

  const mapped = companies
    .map((c) => {
      const computed = c.subscription
        ? computeBillingState(c.subscription, currentNow, { graceDays: settings.graceDays })
        : null;
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        businessType: c.businessType,
        publicBookingEnabled: c.publicBookingEnabled,
        suspendedAt: c.suspendedAt ? c.suspendedAt.toISOString() : null,
        suspendedReason: c.suspendedReason,
        deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
        createdAt: c.createdAt.toISOString(),
        owner: c.users[0] ?? null,
        subscription: c.subscription
          ? {
              state: computed?.state ?? c.subscription.status,
              isTrial: c.subscription.isTrial,
              daysLeft: computed?.daysLeft ?? 0,
              periodEndsAt: c.subscription.periodEndsAt.toISOString(),
              plan: c.subscription.plan,
            }
          : null,
        counts: {
          staff: c._count.users,
          appointments: c._count.appointments,
        },
      };
    })
    .filter((item) => (query.status ? item.subscription?.state === query.status : true));

  if (query.sortBy === 'periodEndsAt') {
    mapped.sort((a, b) => {
      const aTime = a.subscription ? Date.parse(a.subscription.periodEndsAt) : 0;
      const bTime = b.subscription ? Date.parse(b.subscription.periodEndsAt) : 0;
      return query.sortDir === 'asc' ? aTime - bTime : bTime - aTime;
    });
  }

  const total = mapped.length;
  const startIdx = (query.page - 1) * query.limit;
  const items = mapped.slice(startIdx, startIdx + query.limit);

  return { items, total };
}

export async function getAdminCompanyDetail(companyId: string) {
  const currentNow = clockNow();
  const settings = await getPlatformSettings(prisma);

  const company = await prismaUnfiltered.company.findUnique({
    where: { id: companyId },
    include: {
      users: {
        where: { deletedAt: null },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          isBookable: true,
          createdAt: true,
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
      subscription: {
        include: { plan: true },
      },
      _count: {
        select: { appointments: true, services: true },
      },
    },
  });

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const lastAppointment = await prismaUnfiltered.appointment.findFirst({
    where: { companyId: company.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const computed = company.subscription
    ? computeBillingState(company.subscription, currentNow, { graceDays: settings.graceDays })
    : null;

  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    businessType: company.businessType,
    phone: company.phone,
    address: company.address,
    timezone: company.timezone,
    currency: company.currency,
    publicBookingEnabled: company.publicBookingEnabled,
    suspendedAt: company.suspendedAt ? company.suspendedAt.toISOString() : null,
    suspendedReason: company.suspendedReason,
    deletedAt: company.deletedAt ? company.deletedAt.toISOString() : null,
    createdAt: company.createdAt.toISOString(),
    owner: company.users.find((u) => u.role === Role.OWNER) ?? null,
    staff: company.users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })),
    subscription: company.subscription
      ? {
          id: company.subscription.id,
          state: computed?.state ?? company.subscription.status,
          isTrial: company.subscription.isTrial,
          daysLeft: computed?.daysLeft ?? 0,
          periodStartsAt: company.subscription.periodStartsAt.toISOString(),
          periodEndsAt: company.subscription.periodEndsAt.toISOString(),
          graceEndsAt: computed?.graceEndsAt.toISOString() ?? null,
          plan: serializePlan(company.subscription.plan),
        }
      : null,
    counts: {
      appointments: company._count.appointments,
      services: company._count.services,
      staff: company.users.length,
    },
    lastActivityAt: lastAppointment ? lastAppointment.createdAt.toISOString() : null,
  };
}

export async function updateAdminCompany(
  adminId: string,
  companyId: string,
  body: AdminUpdateCompanyBody,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.company.findUnique({ where: { id: companyId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  if (body.slug && body.slug !== existing.slug) {
    const slugCollision = await prismaUnfiltered.company.findUnique({ where: { slug: body.slug } });
    if (slugCollision && slugCollision.id !== companyId) {
      throw new AppError('CONFLICT', 409, 'Company slug is already taken');
    }
  }

  await prismaUnfiltered.company.update({
    where: { id: companyId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.businessType !== undefined ? { businessType: body.businessType } : {}),
      ...(body.publicBookingEnabled !== undefined
        ? { publicBookingEnabled: body.publicBookingEnabled }
        : {}),
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId,
    action: 'admin.company_update',
    entityType: 'Company',
    entityId: companyId,
    metadata: { updatedFields: Object.keys(body) },
    context: auditContext,
  });

  return getAdminCompanyDetail(companyId);
}

export async function suspendCompany(
  adminId: string,
  companyId: string,
  reason: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.company.findUnique({ where: { id: companyId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const currentNow = clockNow();
  await prismaUnfiltered.company.update({
    where: { id: companyId },
    data: {
      suspendedAt: currentNow,
      suspendedReason: reason,
      suspendedByAdminId: adminId,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId,
    action: 'admin.company_suspend',
    entityType: 'Company',
    entityId: companyId,
    metadata: { reason },
    context: auditContext,
  });

  return getAdminCompanyDetail(companyId);
}

export async function unsuspendCompany(
  adminId: string,
  companyId: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.company.findUnique({ where: { id: companyId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  await prismaUnfiltered.company.update({
    where: { id: companyId },
    data: {
      suspendedAt: null,
      suspendedReason: null,
      suspendedByAdminId: null,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId,
    action: 'admin.company_unsuspend',
    entityType: 'Company',
    entityId: companyId,
    context: auditContext,
  });

  return getAdminCompanyDetail(companyId);
}

export async function softDeleteAdminCompany(
  adminId: string,
  companyId: string,
  confirmSlug: string,
  auditContext?: AuditRequestContext,
): Promise<void> {
  const existing = await prismaUnfiltered.company.findUnique({ where: { id: companyId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  if (confirmSlug !== existing.slug) {
    throw new AppError('VALIDATION_ERROR', 400, 'confirmSlug does not match company slug');
  }

  const currentNow = clockNow();
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { deletedAt: currentNow },
    });

    await tx.user.updateMany({
      where: { companyId },
      data: { tokenVersion: { increment: 1 } },
    });

    await audit(tx, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      companyId,
      action: 'admin.company_delete',
      entityType: 'Company',
      entityId: companyId,
      metadata: { slug: existing.slug },
      context: auditContext,
    });
  });
}

export async function restoreAdminCompany(
  adminId: string,
  companyId: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.company.findUnique({ where: { id: companyId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  await prismaUnfiltered.company.update({
    where: { id: companyId },
    data: { deletedAt: null },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId,
    action: 'admin.company_restore',
    entityType: 'Company',
    entityId: companyId,
    context: auditContext,
  });

  return getAdminCompanyDetail(companyId);
}

export async function listAdminPayments(query: AdminPaymentsQuery) {
  const where: Prisma.SubscriptionPaymentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
  };

  const [rows, total] = await Promise.all([
    prismaUnfiltered.subscriptionPayment.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, slug: true } },
        plan: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prismaUnfiltered.subscriptionPayment.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      company: r.company,
      plan: r.plan,
      status: r.status,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      months: r.months,
      method: r.method,
      reference: r.reference,
      comment: r.comment,
      rejectReason: r.rejectReason,
      periodStart: r.periodStart ? r.periodStart.toISOString() : null,
      periodEnd: r.periodEnd ? r.periodEnd.toISOString() : null,
      source: r.source,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}

export async function listAdminPlans(): Promise<PlanDto[]> {
  const plans = await prismaUnfiltered.plan.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return plans.map(serializePlan);
}

export async function createAdminPlan(
  adminId: string,
  body: AdminCreatePlanBody,
  auditContext?: AuditRequestContext,
): Promise<PlanDto> {
  try {
    const created = await prismaUnfiltered.plan.create({
      data: {
        code: body.code,
        name: body.name,
        priceMonthly: new Prisma.Decimal(body.priceMonthly),
        maxStaff: body.maxStaff,
        maxRemindersPerMonth: body.maxRemindersPerMonth ?? null,
        featureAnalytics: body.featureAnalytics,
        featureAutoReminders: body.featureAutoReminders,
        featurePrepayment: body.featurePrepayment,
        isPublic: body.isPublic,
        sortOrder: body.sortOrder,
      },
    });

    invalidatePublicPlatformCache();

    await audit(prisma, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      action: 'admin.plan_create',
      entityType: 'Plan',
      entityId: created.id,
      metadata: { code: created.code, priceMonthly: created.priceMonthly.toFixed(2) },
      context: auditContext,
    });

    return serializePlan(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Plan code already exists');
    }
    throw err;
  }
}

export async function updateAdminPlan(
  adminId: string,
  planId: string,
  body: AdminUpdatePlanBody,
  auditContext?: AuditRequestContext,
): Promise<PlanDto> {
  const existing = await prismaUnfiltered.plan.findUnique({ where: { id: planId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Plan not found');
  }

  const updated = await prismaUnfiltered.plan.update({
    where: { id: planId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.priceMonthly !== undefined
        ? { priceMonthly: new Prisma.Decimal(body.priceMonthly) }
        : {}),
      ...(body.maxStaff !== undefined ? { maxStaff: body.maxStaff } : {}),
      ...(body.maxRemindersPerMonth !== undefined
        ? { maxRemindersPerMonth: body.maxRemindersPerMonth }
        : {}),
      ...(body.featureAnalytics !== undefined ? { featureAnalytics: body.featureAnalytics } : {}),
      ...(body.featureAutoReminders !== undefined
        ? { featureAutoReminders: body.featureAutoReminders }
        : {}),
      ...(body.featurePrepayment !== undefined
        ? { featurePrepayment: body.featurePrepayment }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    },
  });

  invalidatePublicPlatformCache();

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    action: 'admin.plan_update',
    entityType: 'Plan',
    entityId: updated.id,
    metadata: { updatedFields: Object.keys(body) },
    context: auditContext,
  });

  return serializePlan(updated);
}

export async function listAdminUsers(query: AdminUsersQuery) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prismaUnfiltered.user.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prismaUnfiltered.user.count({ where }),
  ]);

  return {
    items: rows.map((u) => ({
      id: u.id,
      company: u.company,
      role: u.role,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      isBookable: u.isBookable,
      hasLogin: u.passwordHash !== null && u.email !== null,
      createdAt: u.createdAt.toISOString(),
    })),
    total,
  };
}

export async function updateAdminUser(
  adminId: string,
  userId: string,
  body: AdminUpdateUserBody,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.user.findUnique({ where: { id: userId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'User not found');
  }

  let normalizedPhone: string | null | undefined;
  if (body.phone !== undefined) {
    normalizedPhone =
      body.phone === null || body.phone.length === 0
        ? null
        : normalizePhoneE164(body.phone, 'phone');
  }

  try {
    const updated = await prismaUnfiltered.user.update({
      where: { id: userId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
      },
      include: {
        company: { select: { id: true, name: true, slug: true } },
      },
    });

    await audit(prisma, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      companyId: existing.companyId,
      action: 'admin.user_update',
      entityType: 'User',
      entityId: userId,
      metadata: { updatedFields: Object.keys(body) },
      context: auditContext,
    });

    return {
      id: updated.id,
      company: updated.company,
      role: updated.role,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      isActive: updated.isActive,
      isBookable: updated.isBookable,
      createdAt: updated.createdAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Email is already in use');
    }
    throw err;
  }
}

export async function setAdminUserActive(
  adminId: string,
  userId: string,
  isActive: boolean,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.user.findUnique({ where: { id: userId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'User not found');
  }

  await prismaUnfiltered.user.update({
    where: { id: userId },
    data: {
      isActive,
      ...(isActive ? {} : { tokenVersion: { increment: 1 } }),
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId: existing.companyId,
    action: isActive ? 'admin.user_activate' : 'admin.user_deactivate',
    entityType: 'User',
    entityId: userId,
    context: auditContext,
  });
}

export async function revokeAdminUserSessions(
  adminId: string,
  userId: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.user.findUnique({ where: { id: userId } });
  if (!existing || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'User not found');
  }

  await prismaUnfiltered.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId: existing.companyId,
    action: 'admin.user_revoke_sessions',
    entityType: 'User',
    entityId: userId,
    context: auditContext,
  });
}

export async function generateAdminUserPasswordResetLink(
  adminId: string,
  userId: string,
  sendEmail: boolean,
  auditContext?: AuditRequestContext,
): Promise<{ url: string; expiresAt: string }> {
  const target = await prismaUnfiltered.user.findUnique({
    where: { id: userId },
    include: { company: true },
  });

  if (
    !target ||
    target.deletedAt !== null ||
    !target.isActive ||
    target.email === null ||
    target.passwordHash === null ||
    target.company.deletedAt !== null
  ) {
    throw new AppError('NOT_FOUND', 404, 'Active user with login not found');
  }

  const currentNow = clockNow();
  const expiresAt = addMinutesUtc(currentNow, 60);
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const base = env.APP_URL.replace(/\/+$/, '');
  const url = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
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
        createdBy: PasswordResetCreator.ADMIN,
        createdById: adminId,
        createdAt: currentNow,
      },
    });

    if (sendEmail) {
      await enqueue(tx, {
        companyId: target.companyId,
        channel: NotificationChannel.EMAIL,
        kind: 'PASSWORD_RESET',
        recipient: targetEmail,
        toUserId: target.id,
        locale: Locale.RU,
        payload: {
          resetUrl: url,
          userName: target.name,
          companyName: target.company.name,
          expiresInMinutes: 60,
        },
        dedupeKey: `password-reset:${created.id}`,
      });
    }

    await audit(tx, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      companyId: target.companyId,
      action: 'admin.user_password_reset_link',
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

export async function listAdminOutbox(query: AdminOutboxQuery) {
  const where: Prisma.OutboxMessageWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
  };

  const [rows, total] = await Promise.all([
    prismaUnfiltered.outboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prismaUnfiltered.outboxMessage.count({ where }),
  ]);

  return {
    items: rows.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      channel: m.channel,
      kind: m.kind,
      recipient: m.recipient,
      status: m.status,
      attempts: m.attempts,
      maxAttempts: m.maxAttempts,
      scheduledFor: m.scheduledFor.toISOString(),
      sentAt: m.sentAt ? m.sentAt.toISOString() : null,
      lastError: m.lastError,
      createdAt: m.createdAt.toISOString(),
    })),
    total,
  };
}

export async function retryAdminOutboxMessage(
  adminId: string,
  outboxId: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.outboxMessage.findUnique({ where: { id: outboxId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Outbox message not found');
  }

  const currentNow = clockNow();
  const updated = await prismaUnfiltered.outboxMessage.update({
    where: { id: outboxId },
    data: {
      status: OutboxStatus.PENDING,
      scheduledFor: currentNow,
      lockedAt: null,
      lastError: null,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId: existing.companyId,
    action: 'admin.outbox_retry',
    entityType: 'OutboxMessage',
    entityId: outboxId,
    context: auditContext,
  });

  return { id: updated.id, status: updated.status };
}

export async function cancelAdminOutboxMessage(
  adminId: string,
  outboxId: string,
  auditContext?: AuditRequestContext,
) {
  const existing = await prismaUnfiltered.outboxMessage.findUnique({ where: { id: outboxId } });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Outbox message not found');
  }

  const updated = await prismaUnfiltered.outboxMessage.update({
    where: { id: outboxId },
    data: {
      status: OutboxStatus.CANCELLED,
      lockedAt: null,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.ADMIN,
    actorId: adminId,
    companyId: existing.companyId,
    action: 'admin.outbox_cancel',
    entityType: 'OutboxMessage',
    entityId: outboxId,
    context: auditContext,
  });

  return { id: updated.id, status: updated.status };
}

export async function listAdminAuditLogs(query: AdminAuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.actorType ? { actorType: query.actorType } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
  };

  const [rows, total] = await Promise.all([
    prismaUnfiltered.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prismaUnfiltered.auditLog.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId,
      companyId: r.companyId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}

export async function getAdminSettings(): Promise<PlatformSettingsDto> {
  return getPlatformSettings(prisma);
}

export async function updateAdminSettings(
  adminId: string,
  body: AdminUpdateSettingsBody,
  auditContext?: AuditRequestContext,
): Promise<PlatformSettingsDto> {
  if (body.trialPlanCode !== undefined) {
    const plan = await prismaUnfiltered.plan.findUnique({ where: { code: body.trialPlanCode } });
    if (!plan || !plan.isActive) {
      throw new AppError('VALIDATION_ERROR', 400, 'trialPlanCode must reference an active plan');
    }
  }

  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.platformSetting.upsert({
        where: { key },
        update: {
          value: value as Prisma.InputJsonValue,
          updatedByAdminId: adminId,
        },
        create: {
          key,
          value: value as Prisma.InputJsonValue,
          updatedByAdminId: adminId,
        },
      });
    }

    await audit(tx, {
      actorType: AuditActor.ADMIN,
      actorId: adminId,
      action: 'admin.settings_update',
      entityType: 'PlatformSetting',
      metadata: { updatedKeys: entries.map(([k]) => k) },
      context: auditContext,
    });
  });

  invalidatePublicPlatformCache();
  return getPlatformSettings(prisma);
}
