import { DateTime } from 'luxon';
import {
  AuditActor,
  Locale,
  NotificationChannel,
  type PaymentMethod,
  PaymentSource,
  PaymentStatus,
  type Plan,
  Prisma,
  Role,
  type Subscription,
  type SubscriptionPayment,
  SubscriptionStatus,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { DbClient } from '../availability/availability.service.js';
import { createInAppNotification } from '../notifications/in-app.service.js';
import { enqueue } from '../notifications/outbox.service.js';
import { getPlatformSettings } from '../platform/platform-settings.service.js';
import { computeBillingState, computeConfirmedPeriod } from './billing-state.js';
import type { CreatePaymentClaimBody, ListPaymentsQuery } from './billing.schemas.js';

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  currency: string;
  maxStaff: number;
  maxRemindersPerMonth: number | null;
  featureAnalytics: boolean;
  featureAutoReminders: boolean;
  featurePrepayment: boolean;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
}

export interface SubscriptionPaymentDto {
  id: string;
  companyId: string;
  planId: string;
  planCode: string;
  planName: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  months: number;
  method: PaymentMethod;
  reference: string | null;
  comment: string | null;
  rejectReason: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  source: PaymentSource;
  reviewedAt: string | null;
  createdAt: string;
}

export interface BillingOverviewDto {
  subscription: {
    id: string;
    state: SubscriptionStatus;
    isTrial: boolean;
    daysLeft: number;
    periodStartsAt: string;
    periodEndsAt: string;
    graceEndsAt: string;
    plan: PlanDto;
  };
  usage: {
    activeStaffCount: number;
    maxStaff: number;
    isOverStaffLimit: boolean;
  };
  pendingClaim: SubscriptionPaymentDto | null;
  paymentInstructions: string;
}

export function serializePlan(plan: Plan): PlanDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    priceMonthly: plan.priceMonthly.toFixed(2),
    currency: plan.currency,
    maxStaff: plan.maxStaff,
    maxRemindersPerMonth: plan.maxRemindersPerMonth,
    featureAnalytics: plan.featureAnalytics,
    featureAutoReminders: plan.featureAutoReminders,
    featurePrepayment: plan.featurePrepayment,
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
  };
}

export function serializePayment(
  payment: SubscriptionPayment & { plan: Pick<Plan, 'code' | 'name'> },
): SubscriptionPaymentDto {
  return {
    id: payment.id,
    companyId: payment.companyId,
    planId: payment.planId,
    planCode: payment.plan.code,
    planName: payment.plan.name,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    months: payment.months,
    method: payment.method,
    reference: payment.reference,
    comment: payment.comment,
    rejectReason: payment.rejectReason,
    periodStart: payment.periodStart ? payment.periodStart.toISOString() : null,
    periodEnd: payment.periodEnd ? payment.periodEnd.toISOString() : null,
    source: payment.source,
    reviewedAt: payment.reviewedAt ? payment.reviewedAt.toISOString() : null,
    createdAt: payment.createdAt.toISOString(),
  };
}

export async function createTrialSubscriptionForCompany(
  tx: DbClient,
  companyId: string,
): Promise<Subscription> {
  const settings = await getPlatformSettings(tx);
  const currentNow = clockNow();

  let plan = await tx.plan.findFirst({
    where: { code: settings.trialPlanCode, isActive: true },
  });
  if (!plan) {
    plan = await tx.plan.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
  if (!plan) {
    throw new AppError('INTERNAL_ERROR', 500, 'No active subscription plan configured');
  }

  const periodEndsAt = DateTime.fromJSDate(currentNow, { zone: 'utc' })
    .plus({ days: settings.trialDays })
    .toJSDate();

  return tx.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      isTrial: true,
      periodStartsAt: currentNow,
      periodEndsAt,
      status: SubscriptionStatus.TRIAL,
    },
  });
}

async function loadSubscriptionWithPlanAndSettings(companyId: string, db: DbClient = prisma) {
  const [sub, settings] = await Promise.all([
    db.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    }),
    getPlatformSettings(db),
  ]);

  if (!sub) {
    throw new AppError('NOT_FOUND', 404, 'Subscription not found for company');
  }

  const computed = computeBillingState(sub, clockNow(), { graceDays: settings.graceDays });
  return { sub, settings, computed };
}

export async function getBillingOverview(companyId: string): Promise<BillingOverviewDto> {
  const [{ sub, settings, computed }, activeStaffCount, pendingClaim] = await Promise.all([
    loadSubscriptionWithPlanAndSettings(companyId),
    prisma.user.count({
      where: {
        companyId,
        isActive: true,
      },
    }),
    prisma.subscriptionPayment.findFirst({
      where: {
        companyId,
        status: PaymentStatus.PENDING,
      },
      include: {
        plan: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    subscription: {
      id: sub.id,
      state: computed.state,
      isTrial: computed.isTrial,
      daysLeft: computed.daysLeft,
      periodStartsAt: computed.periodStartsAt.toISOString(),
      periodEndsAt: computed.periodEndsAt.toISOString(),
      graceEndsAt: computed.graceEndsAt.toISOString(),
      plan: serializePlan(sub.plan),
    },
    usage: {
      activeStaffCount,
      maxStaff: sub.plan.maxStaff,
      isOverStaffLimit: activeStaffCount > sub.plan.maxStaff,
    },
    pendingClaim: pendingClaim ? serializePayment(pendingClaim) : null,
    paymentInstructions: settings.billingPaymentInstructions,
  };
}

export async function listActivePlans(): Promise<PlanDto[]> {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: { sortOrder: 'asc' },
  });
  return plans.map(serializePlan);
}

export async function listCompanyPayments(
  companyId: string,
  query: ListPaymentsQuery,
): Promise<{ items: SubscriptionPaymentDto[]; total: number }> {
  const where: Prisma.SubscriptionPaymentWhereInput = { companyId };
  const [rows, total] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where,
      include: {
        plan: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.subscriptionPayment.count({ where }),
  ]);

  return {
    items: rows.map(serializePayment),
    total,
  };
}

export async function createPaymentClaim(
  companyId: string,
  userId: string,
  body: CreatePaymentClaimBody,
  auditContext?: AuditRequestContext,
): Promise<SubscriptionPaymentDto> {
  const plan = await prisma.plan.findFirst({
    where: { id: body.planId, isActive: true },
  });
  if (!plan) {
    throw new AppError('NOT_FOUND', 404, 'Subscription plan not found');
  }

  const existingPending = await prisma.subscriptionPayment.findFirst({
    where: { companyId, status: PaymentStatus.PENDING },
  });
  if (existingPending) {
    throw new AppError(
      'PAYMENT_CLAIM_PENDING',
      409,
      'A pending payment claim already exists for this company',
    );
  }

  // Server computes amount from plan.priceMonthly * months; client value is never trusted (BR-19).
  const amount = new Prisma.Decimal(plan.priceMonthly).mul(body.months);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.create({
        data: {
          companyId,
          planId: plan.id,
          status: PaymentStatus.PENDING,
          amount,
          currency: plan.currency,
          months: body.months,
          method: body.method,
          reference: body.reference ?? null,
          comment: body.comment ?? null,
          claimedByUserId: userId,
          source: PaymentSource.CLAIM,
        },
        include: {
          plan: { select: { code: true, name: true } },
        },
      });

      await audit(tx, {
        actorType: AuditActor.USER,
        actorId: userId,
        companyId,
        action: 'billing.payment_claim_create',
        entityType: 'SubscriptionPayment',
        entityId: payment.id,
        metadata: {
          planCode: plan.code,
          months: body.months,
          amount: amount.toFixed(2),
          method: body.method,
        },
        context: auditContext,
      });

      return payment;
    });

    return serializePayment(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        'PAYMENT_CLAIM_PENDING',
        409,
        'A pending payment claim already exists for this company',
      );
    }
    throw err;
  }
}

export async function cancelPendingPaymentClaim(
  companyId: string,
  userId: string,
  paymentId: string,
  auditContext?: AuditRequestContext,
): Promise<SubscriptionPaymentDto> {
  const existing = await prisma.subscriptionPayment.findFirst({
    where: { id: paymentId, companyId },
    include: { plan: { select: { code: true, name: true } } },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Payment claim not found');
  }

  if (existing.status !== PaymentStatus.PENDING || existing.source !== PaymentSource.CLAIM) {
    throw new AppError('ALREADY_REVIEWED', 409, 'Only pending payment claims can be cancelled');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.subscriptionPayment.update({
      where: { id: existing.id },
      data: { status: PaymentStatus.CANCELLED },
      include: { plan: { select: { code: true, name: true } } },
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: userId,
      companyId,
      action: 'billing.payment_claim_cancel',
      entityType: 'SubscriptionPayment',
      entityId: existing.id,
      context: auditContext,
    });

    return res;
  });

  return serializePayment(updated);
}

async function notifyOwnerOfBillingDecision(
  tx: DbClient,
  companyId: string,
  kind: 'BILLING_PAYMENT_CONFIRMED' | 'BILLING_PAYMENT_REJECTED',
  dedupeKey: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const owner = await tx.user.findFirst({
    where: { companyId, role: Role.OWNER, isActive: true },
    include: { company: { select: { name: true } } },
  });
  if (!owner) {
    return;
  }

  await createInAppNotification(tx, {
    companyId,
    userId: owner.id,
    kind,
    title,
    body,
    data: payload,
  });

  if (owner.email) {
    await enqueue(tx, {
      companyId,
      channel: NotificationChannel.EMAIL,
      kind,
      recipient: owner.email,
      toUserId: owner.id,
      locale: Locale.RU,
      payload: {
        ...payload,
        userName: owner.name,
        companyName: owner.company.name,
      },
      dedupeKey,
    });
  }
}

export async function confirmPayment(
  paymentId: string,
  adminId: string | null,
  auditContext?: AuditRequestContext,
): Promise<SubscriptionPaymentDto> {
  const currentNow = clockNow();

  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string; status: PaymentStatus }>>(Prisma.sql`
      SELECT "id", "status"
      FROM "SubscriptionPayment"
      WHERE "id" = ${paymentId}::uuid
      FOR UPDATE
    `);
    const locked = lockedRows[0];
    if (!locked) {
      throw new AppError('NOT_FOUND', 404, 'Payment not found');
    }
    if (locked.status !== PaymentStatus.PENDING) {
      throw new AppError('ALREADY_REVIEWED', 409, 'Payment has already been reviewed');
    }

    const payment = await tx.subscriptionPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { plan: true },
    });

    const sub = await tx.subscription.findUniqueOrThrow({
      where: { companyId: payment.companyId },
    });

    const period = computeConfirmedPeriod(
      { planId: sub.planId, periodEndsAt: sub.periodEndsAt },
      payment.planId,
      payment.months,
      currentNow,
    );

    const updatedPayment = await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CONFIRMED,
        reviewedByAdminId: adminId,
        reviewedAt: currentNow,
        periodStart: period.periodStartsAt,
        periodEnd: period.periodEndsAt,
      },
      include: { plan: { select: { code: true, name: true } } },
    });

    await tx.subscription.update({
      where: { companyId: payment.companyId },
      data: {
        planId: payment.planId,
        isTrial: false,
        periodStartsAt: period.periodStartsAt,
        periodEndsAt: period.periodEndsAt,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    await notifyOwnerOfBillingDecision(
      tx,
      payment.companyId,
      'BILLING_PAYMENT_CONFIRMED',
      `billing:payment-confirmed:${payment.id}`,
      'Оплата подписки подтверждена',
      `Тариф «${payment.plan.name}» активирован до ${period.periodEndsAt.toISOString().slice(0, 10)}.`,
      {
        paymentId: payment.id,
        planName: payment.plan.name,
        months: payment.months,
        amount: payment.amount.toFixed(2),
        periodEndIso: period.periodEndsAt.toISOString(),
      },
    );

    await audit(tx, {
      actorType: adminId ? AuditActor.ADMIN : AuditActor.SYSTEM,
      actorId: adminId,
      companyId: payment.companyId,
      action: 'billing.payment_confirm',
      entityType: 'SubscriptionPayment',
      entityId: payment.id,
      metadata: {
        planCode: payment.plan.code,
        months: payment.months,
        periodStart: period.periodStartsAt.toISOString(),
        periodEnd: period.periodEndsAt.toISOString(),
      },
      context: auditContext,
    });

    return serializePayment(updatedPayment);
  });
}

export async function rejectPayment(
  paymentId: string,
  adminId: string | null,
  reason: string,
  auditContext?: AuditRequestContext,
): Promise<SubscriptionPaymentDto> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    throw new AppError('VALIDATION_ERROR', 400, 'Reject reason is required');
  }

  const currentNow = clockNow();

  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string; status: PaymentStatus }>>(Prisma.sql`
      SELECT "id", "status"
      FROM "SubscriptionPayment"
      WHERE "id" = ${paymentId}::uuid
      FOR UPDATE
    `);
    const locked = lockedRows[0];
    if (!locked) {
      throw new AppError('NOT_FOUND', 404, 'Payment not found');
    }
    if (locked.status !== PaymentStatus.PENDING) {
      throw new AppError('ALREADY_REVIEWED', 409, 'Payment has already been reviewed');
    }

    const updatedPayment = await tx.subscriptionPayment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.REJECTED,
        reviewedByAdminId: adminId,
        reviewedAt: currentNow,
        rejectReason: trimmedReason,
      },
      include: { plan: { select: { code: true, name: true } } },
    });

    await notifyOwnerOfBillingDecision(
      tx,
      updatedPayment.companyId,
      'BILLING_PAYMENT_REJECTED',
      `billing:payment-rejected:${updatedPayment.id}`,
      'Заявка на оплату отклонена',
      `Причина: ${trimmedReason}`,
      {
        paymentId: updatedPayment.id,
        planName: updatedPayment.plan.name,
        reason: trimmedReason,
      },
    );

    await audit(tx, {
      actorType: adminId ? AuditActor.ADMIN : AuditActor.SYSTEM,
      actorId: adminId,
      companyId: updatedPayment.companyId,
      action: 'billing.payment_reject',
      entityType: 'SubscriptionPayment',
      entityId: updatedPayment.id,
      metadata: { reason: trimmedReason },
      context: auditContext,
    });

    return serializePayment(updatedPayment);
  });
}

export async function adjustSubscription(
  companyId: string,
  adminId: string | null,
  input: {
    planId?: string;
    periodEndsAt?: Date;
    isTrial?: boolean;
    reason: string;
  },
  auditContext?: AuditRequestContext,
): Promise<BillingOverviewDto> {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 3) {
    throw new AppError('VALIDATION_ERROR', 400, 'Reason is required for subscription adjustment');
  }

  const currentNow = clockNow();

  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { companyId } });
    if (!sub) {
      throw new AppError('NOT_FOUND', 404, 'Subscription not found');
    }

    if (input.planId !== undefined) {
      const plan = await tx.plan.findUnique({ where: { id: input.planId } });
      if (!plan) {
        throw new AppError('NOT_FOUND', 404, 'Plan not found');
      }
    }

    const settings = await getPlatformSettings(tx);
    const nextPlanId = input.planId ?? sub.planId;
    const nextPeriodEndsAt = input.periodEndsAt ?? sub.periodEndsAt;
    const nextIsTrial = input.isTrial ?? sub.isTrial;
    const nextPeriodStartsAt =
      nextPeriodEndsAt.getTime() <= sub.periodStartsAt.getTime() ? currentNow : sub.periodStartsAt;

    const computed = computeBillingState(
      {
        planId: nextPlanId,
        isTrial: nextIsTrial,
        periodStartsAt: nextPeriodStartsAt,
        periodEndsAt: nextPeriodEndsAt,
      },
      currentNow,
      { graceDays: settings.graceDays },
    );

    await tx.subscription.update({
      where: { companyId },
      data: {
        planId: nextPlanId,
        isTrial: nextIsTrial,
        periodStartsAt: nextPeriodStartsAt,
        periodEndsAt: nextPeriodEndsAt,
        status: computed.state,
      },
    });

    await audit(tx, {
      actorType: adminId ? AuditActor.ADMIN : AuditActor.SYSTEM,
      actorId: adminId,
      companyId,
      action: 'billing.subscription_adjust',
      entityType: 'Subscription',
      entityId: sub.id,
      metadata: {
        reason: trimmedReason,
        planId: nextPlanId,
        isTrial: nextIsTrial,
        periodEndsAt: nextPeriodEndsAt.toISOString(),
        resultingState: computed.state,
      },
      context: auditContext,
    });
  });

  return getBillingOverview(companyId);
}

export async function recordOfflinePayment(
  companyId: string,
  adminId: string | null,
  input: {
    planId: string;
    months: 1 | 3 | 6 | 12;
    method: PaymentMethod;
    amount?: string;
    reference?: string;
    comment?: string;
    reason: string;
  },
  auditContext?: AuditRequestContext,
): Promise<SubscriptionPaymentDto> {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 3) {
    throw new AppError('VALIDATION_ERROR', 400, 'Reason is required');
  }

  const currentNow = clockNow();

  return prisma.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan) {
      throw new AppError('NOT_FOUND', 404, 'Plan not found');
    }

    const sub = await tx.subscription.findUnique({ where: { companyId } });
    if (!sub) {
      throw new AppError('NOT_FOUND', 404, 'Subscription not found');
    }

    const amount =
      input.amount !== undefined
        ? new Prisma.Decimal(input.amount)
        : new Prisma.Decimal(plan.priceMonthly).mul(input.months);

    const period = computeConfirmedPeriod(
      { planId: sub.planId, periodEndsAt: sub.periodEndsAt },
      plan.id,
      input.months,
      currentNow,
    );

    const payment = await tx.subscriptionPayment.create({
      data: {
        companyId,
        planId: plan.id,
        status: PaymentStatus.CONFIRMED,
        amount,
        currency: plan.currency,
        months: input.months,
        method: input.method,
        reference: input.reference ?? null,
        comment: input.comment ?? null,
        reviewedByAdminId: adminId,
        reviewedAt: currentNow,
        periodStart: period.periodStartsAt,
        periodEnd: period.periodEndsAt,
        source: PaymentSource.ADMIN_MANUAL,
      },
      include: { plan: { select: { code: true, name: true } } },
    });

    await tx.subscription.update({
      where: { companyId },
      data: {
        planId: plan.id,
        isTrial: false,
        periodStartsAt: period.periodStartsAt,
        periodEndsAt: period.periodEndsAt,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    await notifyOwnerOfBillingDecision(
      tx,
      companyId,
      'BILLING_PAYMENT_CONFIRMED',
      `billing:payment-confirmed:${payment.id}`,
      'Подписка продлена',
      `Тариф «${plan.name}» активирован до ${period.periodEndsAt.toISOString().slice(0, 10)}.`,
      {
        paymentId: payment.id,
        planName: plan.name,
        months: input.months,
        amount: amount.toFixed(2),
        periodEndIso: period.periodEndsAt.toISOString(),
      },
    );

    await audit(tx, {
      actorType: adminId ? AuditActor.ADMIN : AuditActor.SYSTEM,
      actorId: adminId,
      companyId,
      action: 'billing.offline_payment_record',
      entityType: 'SubscriptionPayment',
      entityId: payment.id,
      metadata: {
        reason: trimmedReason,
        planCode: plan.code,
        months: input.months,
        amount: amount.toFixed(2),
        method: input.method,
      },
      context: auditContext,
    });

    return serializePayment(payment);
  });
}

export type PlanFeatureKey = 'analytics' | 'autoReminders' | 'prepayment';

export async function assertWritableSubscription(companyId: string): Promise<void> {
  const { computed } = await loadSubscriptionWithPlanAndSettings(companyId);
  if (computed.state === SubscriptionStatus.LOCKED) {
    throw new AppError(
      'SUBSCRIPTION_REQUIRED',
      402,
      'Subscription has expired. Renew your plan to make changes.',
    );
  }
}

export async function isCompanyBookingLocked(
  companyId: string,
  db: DbClient = prisma,
): Promise<boolean> {
  const sub = await db.subscription.findUnique({ where: { companyId } });
  if (!sub) {
    return false;
  }
  const settings = await getPlatformSettings(db);
  const computed = computeBillingState(sub, clockNow(), { graceDays: settings.graceDays });
  return computed.state === SubscriptionStatus.LOCKED;
}

export async function assertPlanFeature(companyId: string, feature: PlanFeatureKey): Promise<void> {
  const { sub, computed } = await loadSubscriptionWithPlanAndSettings(companyId);
  if (computed.state === SubscriptionStatus.LOCKED) {
    throw new AppError(
      'SUBSCRIPTION_REQUIRED',
      402,
      'Subscription has expired. Renew your plan to make changes.',
    );
  }

  const enabled =
    feature === 'analytics'
      ? sub.plan.featureAnalytics
      : feature === 'autoReminders'
        ? sub.plan.featureAutoReminders
        : sub.plan.featurePrepayment;

  if (!enabled) {
    throw new AppError(
      'FEATURE_NOT_IN_PLAN',
      402,
      `Your current plan (${sub.plan.name}) does not include this feature`,
    );
  }
}

export async function assertWithinStaffLimit(
  companyId: string,
  additionalCount = 1,
): Promise<void> {
  const [{ sub }, activeStaffCount] = await Promise.all([
    loadSubscriptionWithPlanAndSettings(companyId),
    prisma.user.count({
      where: {
        companyId,
        isActive: true,
      },
    }),
  ]);

  if (activeStaffCount + additionalCount > sub.plan.maxStaff) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      402,
      `Active staff limit (${sub.plan.maxStaff}) reached for plan ${sub.plan.name}`,
    );
  }
}
