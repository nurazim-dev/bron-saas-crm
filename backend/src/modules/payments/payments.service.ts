import { randomUUID } from 'node:crypto';
import {
  AuditActor,
  BusinessPaymentKind,
  BusinessPaymentStatus,
  Locale,
  NotificationChannel,
  type PaymentMethod,
  PaymentProofScope,
  PrepaymentStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { addDaysToLocalDate, localDateTimeToUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import { enqueue } from '../notifications/outbox.service.js';
import type {
  BusinessPaymentsSummaryQuery,
  CreateBusinessPaymentInput,
  ListBusinessPaymentsQuery,
} from './payments.schemas.js';
import type { PaymentProofSummaryDto } from './payment-proof.service.js';
import { getPaymentProvider } from './payment-provider.js';

export interface BusinessPaymentDto {
  id: string;
  companyId: string;
  appointmentId: string | null;
  clientId: string | null;
  kind: BusinessPaymentKind;
  status: BusinessPaymentStatus;
  amount: string;
  currency: string;
  method: PaymentMethod;
  providerCode: string;
  reference: string | null;
  note: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  client: { id: string; name: string; phone: string } | null;
  appointment: {
    id: string;
    startAt: string;
    price: string;
    status: string;
    serviceName: string;
  } | null;
  proofs: PaymentProofSummaryDto[];
}

const businessPaymentInclude = {
  client: { select: { id: true, name: true, phone: true } },
  appointment: {
    select: {
      id: true,
      startAt: true,
      price: true,
      status: true,
      packageName: true,
      service: { select: { name: true } },
    },
  },
  proofs: {
    where: { scope: PaymentProofScope.BUSINESS_PAYMENT },
    select: { id: true, fileName: true, mime: true, size: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type BusinessPaymentWithRelations = Prisma.BusinessPaymentGetPayload<{
  include: typeof businessPaymentInclude;
}>;

function serializeBusinessPayment(p: BusinessPaymentWithRelations): BusinessPaymentDto {
  return {
    id: p.id,
    companyId: p.companyId,
    appointmentId: p.appointmentId,
    clientId: p.clientId,
    kind: p.kind,
    status: p.status,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    method: p.method,
    providerCode: p.providerCode,
    reference: p.reference,
    note: p.note,
    rejectReason: p.rejectReason,
    reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    client: p.client,
    appointment: p.appointment
      ? {
          id: p.appointment.id,
          startAt: p.appointment.startAt.toISOString(),
          price: p.appointment.price.toFixed(2),
          status: p.appointment.status,
          serviceName: p.appointment.packageName ?? p.appointment.service.name,
        }
      : null,
    proofs: p.proofs.map((proof) => ({
      id: proof.id,
      fileName: proof.fileName,
      mime: proof.mime,
      size: proof.size,
      createdAt: proof.createdAt.toISOString(),
    })),
  };
}

function toMinorUnits(decimal: Prisma.Decimal | string | number): number {
  return Math.round(Number(decimal) * 100);
}

function formatMinorUnits(minor: number): string {
  return (minor / 100).toFixed(2);
}

async function assertRefundWithinConfirmedTotal(
  tx: TransactionClient,
  companyId: string,
  appointmentId: string,
  newRefundAmountMinor: number,
  excludePaymentId?: string,
): Promise<{ totalConfirmedMinor: number; existingRefundMinor: number }> {
  const rows = await tx.businessPayment.findMany({
    where: {
      companyId,
      appointmentId,
      ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
      OR: [
        {
          kind: { in: [BusinessPaymentKind.PAYMENT, BusinessPaymentKind.PREPAYMENT] },
          status: BusinessPaymentStatus.CONFIRMED,
        },
        {
          kind: BusinessPaymentKind.REFUND,
          status: { in: [BusinessPaymentStatus.CONFIRMED, BusinessPaymentStatus.PENDING] },
        },
      ],
    },
    select: { kind: true, status: true, amount: true },
  });

  let totalConfirmedMinor = 0;
  let existingRefundMinor = 0;
  for (const r of rows) {
    if (r.kind === BusinessPaymentKind.REFUND) {
      existingRefundMinor += toMinorUnits(r.amount);
    } else {
      totalConfirmedMinor += toMinorUnits(r.amount);
    }
  }

  if (existingRefundMinor + newRefundAmountMinor > totalConfirmedMinor) {
    throw new AppError(
      'CONFLICT',
      409,
      'Сумма возврата превышает сумму подтверждённых оплат по этой записи',
    );
  }
  return { totalConfirmedMinor, existingRefundMinor };
}

async function enqueueBusinessPaymentOutbox(
  tx: TransactionClient,
  companyId: string,
  actorUserId: string,
  kind: 'BUSINESS_PAYMENT_CONFIRMED' | 'BUSINESS_PAYMENT_REJECTED',
  payment: BusinessPaymentWithRelations,
) {
  const actorUser = await tx.user.findFirst({
    where: { companyId, id: actorUserId },
    select: { id: true, name: true, email: true },
  });
  const owner = actorUser?.email
    ? actorUser
    : await tx.user.findFirst({
        where: { companyId, role: Role.OWNER, isActive: true, email: { not: null } },
        select: { id: true, name: true, email: true },
      });
  const recipient = owner?.email ?? payment.client?.phone;
  if (!recipient) return;

  await enqueue(tx, {
    companyId,
    channel: owner?.email ? NotificationChannel.EMAIL : NotificationChannel.WHATSAPP,
    kind,
    recipient,
    toUserId: owner?.id ?? null,
    appointmentId: payment.appointmentId,
    locale: Locale.RU,
    payload: {
      paymentId: payment.id,
      kind: payment.kind,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      method: payment.method,
      clientName: payment.client?.name ?? null,
      appointmentId: payment.appointmentId,
      rejectReason: payment.rejectReason,
    },
    dedupeKey: `business-payment:${kind === 'BUSINESS_PAYMENT_CONFIRMED' ? 'confirmed' : 'rejected'}:${payment.id}`,
  });
}

async function confirmBusinessPaymentInTx(
  tx: TransactionClient,
  companyId: string,
  reviewerUserId: string,
  paymentId: string,
  currentTime: Date,
  auditContext?: AuditRequestContext,
): Promise<BusinessPaymentDto> {
  const lockedRows = await tx.$queryRaw<Array<{ id: string; status: BusinessPaymentStatus }>>(
    Prisma.sql`
      SELECT "id", "status"
      FROM "BusinessPayment"
      WHERE "id" = ${paymentId}::uuid
        AND "companyId" = ${companyId}::uuid
      FOR UPDATE
    `,
  );
  const locked = lockedRows[0];
  if (!locked) {
    throw new AppError('NOT_FOUND', 404, 'Payment not found');
  }
  if (locked.status !== BusinessPaymentStatus.PENDING) {
    throw new AppError('ALREADY_REVIEWED', 409, 'Payment has already been reviewed');
  }

  const current = await tx.businessPayment.findUniqueOrThrow({
    where: { id: locked.id },
    select: {
      id: true,
      kind: true,
      amount: true,
      appointmentId: true,
    },
  });

  if (current.kind === BusinessPaymentKind.REFUND && current.appointmentId) {
    await assertRefundWithinConfirmedTotal(
      tx,
      companyId,
      current.appointmentId,
      toMinorUnits(current.amount),
      current.id,
    );
  }

  const updated = await tx.businessPayment.update({
    where: { id: current.id },
    data: {
      status: BusinessPaymentStatus.CONFIRMED,
      reviewedByUserId: reviewerUserId,
      reviewedAt: currentTime,
      paidAt: currentTime,
      updatedAt: currentTime,
    },
    include: businessPaymentInclude,
  });

  if (updated.appointmentId) {
    const appt = await tx.appointment.findFirst({
      where: { id: updated.appointmentId, companyId },
      select: { id: true, prepaymentStatus: true, prepaymentAmount: true },
    });
    if (appt) {
      if (
        updated.kind === BusinessPaymentKind.PREPAYMENT &&
        appt.prepaymentStatus === PrepaymentStatus.PENDING
      ) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            prepaymentStatus: PrepaymentStatus.RECEIVED,
            prepaymentReceivedAt: currentTime,
            updatedAt: currentTime,
          },
        });
      } else if (
        updated.kind === BusinessPaymentKind.REFUND &&
        appt.prepaymentStatus === PrepaymentStatus.RECEIVED
      ) {
        const refundRows = await tx.businessPayment.findMany({
          where: {
            companyId,
            appointmentId: appt.id,
            kind: BusinessPaymentKind.REFUND,
            status: BusinessPaymentStatus.CONFIRMED,
          },
          select: { amount: true },
        });
        const refundedMinor = refundRows.reduce((s, r) => s + toMinorUnits(r.amount), 0);
        if (refundedMinor >= toMinorUnits(appt.prepaymentAmount ?? 0)) {
          await tx.appointment.update({
            where: { id: appt.id },
            data: {
              prepaymentStatus: PrepaymentStatus.REFUNDED,
              updatedAt: currentTime,
            },
          });
        }
      }
    }
  }

  await enqueueBusinessPaymentOutbox(
    tx,
    companyId,
    reviewerUserId,
    'BUSINESS_PAYMENT_CONFIRMED',
    updated,
  );

  await audit(tx, {
    actorType: AuditActor.USER,
    actorId: reviewerUserId,
    companyId,
    action: 'business_payment.confirm',
    entityType: 'BusinessPayment',
    entityId: updated.id,
    metadata: {
      kind: updated.kind,
      amount: updated.amount.toFixed(2),
      method: updated.method,
      appointmentId: updated.appointmentId,
    },
    context: auditContext,
  });

  return serializeBusinessPayment(updated);
}

export async function listBusinessPayments(companyId: string, query: ListBusinessPaymentsQuery) {
  let createdAtFilter: { gte?: Date; lt?: Date } | undefined;
  if (query.from || query.to) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    const timezone = company?.timezone ?? 'Asia/Bishkek';
    createdAtFilter = {
      ...(query.from ? { gte: localDateTimeToUtc(query.from, '00:00', timezone) } : {}),
      ...(query.to
        ? { lt: localDateTimeToUtc(addDaysToLocalDate(query.to, 1, timezone), '00:00', timezone) }
        : {}),
    };
  }

  const where: Prisma.BusinessPaymentWhereInput = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.businessPayment.findMany({
      where,
      include: businessPaymentInclude,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.businessPayment.count({ where }),
  ]);

  return {
    items: rows.map(serializeBusinessPayment),
    meta: { page: query.page, limit: query.limit, total },
  };
}

export async function getBusinessPaymentsSummary(
  companyId: string,
  query: BusinessPaymentsSummaryQuery,
) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { timezone: true, currency: true },
  });
  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const fromUtc = localDateTimeToUtc(query.from, '00:00', company.timezone);
  const toUtc = localDateTimeToUtc(
    addDaysToLocalDate(query.to, 1, company.timezone),
    '00:00',
    company.timezone,
  );

  const [confirmedRows, pendingRows, completedApptRows] = await Promise.all([
    prisma.businessPayment.findMany({
      where: {
        companyId,
        status: BusinessPaymentStatus.CONFIRMED,
        paidAt: { gte: fromUtc, lt: toUtc },
      },
      select: { kind: true, method: true, amount: true },
    }),
    prisma.businessPayment.findMany({
      where: {
        companyId,
        status: BusinessPaymentStatus.PENDING,
        createdAt: { gte: fromUtc, lt: toUtc },
      },
      select: { kind: true, amount: true },
    }),
    prisma.$queryRaw<Array<{ estimate: string | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(a."price"), 0)::numeric(10,2)::text AS estimate
      FROM "Appointment" a
      WHERE a."companyId" = ${companyId}::uuid
        AND a."deletedAt" IS NULL
        AND a."status" = 'COMPLETED'
        AND a."startAt" >= ${fromUtc}
        AND a."startAt" < ${toUtc}
    `),
  ]);

  let confirmedPaymentsMinor = 0;
  let confirmedRefundsMinor = 0;
  const methodMap = new Map<PaymentMethod, { paymentsMinor: number; refundsMinor: number }>();

  for (const row of confirmedRows) {
    const minor = toMinorUnits(row.amount);
    const entry = methodMap.get(row.method) ?? { paymentsMinor: 0, refundsMinor: 0 };
    if (row.kind === BusinessPaymentKind.REFUND) {
      confirmedRefundsMinor += minor;
      entry.refundsMinor += minor;
    } else {
      confirmedPaymentsMinor += minor;
      entry.paymentsMinor += minor;
    }
    methodMap.set(row.method, entry);
  }

  let pendingAmountMinor = 0;
  for (const row of pendingRows) {
    if (row.kind !== BusinessPaymentKind.REFUND) {
      pendingAmountMinor += toMinorUnits(row.amount);
    }
  }

  return {
    period: { from: query.from, to: query.to, timezone: company.timezone },
    currency: company.currency,
    confirmedPayments: formatMinorUnits(confirmedPaymentsMinor),
    confirmedRefunds: formatMinorUnits(confirmedRefundsMinor),
    netConfirmedRevenue: formatMinorUnits(confirmedPaymentsMinor - confirmedRefundsMinor),
    pendingAmount: formatMinorUnits(pendingAmountMinor),
    pendingCount: pendingRows.length,
    completedAppointmentsEstimate: Number(completedApptRows[0]?.estimate ?? '0').toFixed(2),
    byMethod: Array.from(methodMap.entries()).map(([method, entry]) => ({
      method,
      confirmedPayments: formatMinorUnits(entry.paymentsMinor),
      confirmedRefunds: formatMinorUnits(entry.refundsMinor),
      netAmount: formatMinorUnits(entry.paymentsMinor - entry.refundsMinor),
    })),
  };
}

export async function createBusinessPayment(
  actor: AuthenticatedActor,
  input: CreateBusinessPaymentInput,
  auditContext?: AuditRequestContext,
): Promise<BusinessPaymentDto> {
  const provider = getPaymentProvider('MANUAL');
  const currentTime = clockNow();

  return prisma.$transaction(async (tx) => {
    let resolvedClientId = input.clientId ?? null;

    if (input.appointmentId) {
      const appt = await tx.appointment.findFirst({
        where: { id: input.appointmentId, companyId: actor.companyId },
        select: { id: true, clientId: true },
      });
      if (!appt) {
        throw new AppError('NOT_FOUND', 404, 'Appointment not found');
      }
      if (resolvedClientId && resolvedClientId !== appt.clientId) {
        throw new AppError(
          'CONFLICT',
          409,
          'Указанный клиент не совпадает с клиентом выбранной записи',
        );
      }
      resolvedClientId = appt.clientId;
    } else if (resolvedClientId) {
      const client = await tx.client.findFirst({
        where: { id: resolvedClientId, companyId: actor.companyId, mergedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new AppError('NOT_FOUND', 404, 'Client not found');
      }
    }

    if (input.kind === BusinessPaymentKind.REFUND && input.appointmentId) {
      await assertRefundWithinConfirmedTotal(
        tx,
        actor.companyId,
        input.appointmentId,
        toMinorUnits(input.amount),
      );
    }

    const company = await tx.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { currency: true },
    });

    const created = await tx.businessPayment.create({
      data: {
        id: randomUUID(),
        companyId: actor.companyId,
        appointmentId: input.appointmentId ?? null,
        clientId: resolvedClientId,
        kind: input.kind,
        status: provider.initialStatus(),
        amount: new Prisma.Decimal(input.amount),
        currency: company.currency,
        method: input.method,
        providerCode: provider.code,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedByUserId: actor.userId,
        createdAt: currentTime,
        updatedAt: currentTime,
      },
      include: businessPaymentInclude,
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'business_payment.create',
      entityType: 'BusinessPayment',
      entityId: created.id,
      metadata: {
        kind: created.kind,
        amount: created.amount.toFixed(2),
        method: created.method,
        providerCode: provider.code,
        appointmentId: created.appointmentId,
      },
      context: auditContext,
    });

    if (input.confirmImmediately) {
      return confirmBusinessPaymentInTx(
        tx,
        actor.companyId,
        actor.userId,
        created.id,
        currentTime,
        auditContext,
      );
    }

    return serializeBusinessPayment(created);
  });
}

export async function confirmBusinessPayment(
  actor: AuthenticatedActor,
  paymentId: string,
  auditContext?: AuditRequestContext,
): Promise<BusinessPaymentDto> {
  const currentTime = clockNow();
  return prisma.$transaction((tx) =>
    confirmBusinessPaymentInTx(
      tx,
      actor.companyId,
      actor.userId,
      paymentId,
      currentTime,
      auditContext,
    ),
  );
}

export async function rejectBusinessPayment(
  actor: AuthenticatedActor,
  paymentId: string,
  reason: string,
  auditContext?: AuditRequestContext,
): Promise<BusinessPaymentDto> {
  const currentTime = clockNow();
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string; status: BusinessPaymentStatus }>>(
      Prisma.sql`
        SELECT "id", "status"
        FROM "BusinessPayment"
        WHERE "id" = ${paymentId}::uuid
          AND "companyId" = ${actor.companyId}::uuid
        FOR UPDATE
      `,
    );
    const locked = lockedRows[0];
    if (!locked) {
      throw new AppError('NOT_FOUND', 404, 'Payment not found');
    }
    if (locked.status !== BusinessPaymentStatus.PENDING) {
      throw new AppError('ALREADY_REVIEWED', 409, 'Payment has already been reviewed');
    }

    const updated = await tx.businessPayment.update({
      where: { id: locked.id },
      data: {
        status: BusinessPaymentStatus.REJECTED,
        rejectReason: reason,
        reviewedByUserId: actor.userId,
        reviewedAt: currentTime,
        updatedAt: currentTime,
      },
      include: businessPaymentInclude,
    });

    await enqueueBusinessPaymentOutbox(
      tx,
      actor.companyId,
      actor.userId,
      'BUSINESS_PAYMENT_REJECTED',
      updated,
    );

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'business_payment.reject',
      entityType: 'BusinessPayment',
      entityId: updated.id,
      metadata: { reason },
      context: auditContext,
    });

    return serializeBusinessPayment(updated);
  });
}
