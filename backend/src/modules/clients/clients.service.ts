import { randomUUID } from 'node:crypto';
import { type Locale, Prisma } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import type {
  GetClientDetailQuery,
  ListClientsQuery,
  UpdateClientInput,
} from './clients.schemas.js';

export interface ClientStatsDto {
  visits: number;
  noShows: number;
  cancellations: number;
  totalSpent: string;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  firstSeenAt: string;
}

export interface ClientListItemDto {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  isBlocked: boolean;
  blockedAt: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  stats: ClientStatsDto;
}

export async function upsertClientInTx(
  tx: TransactionClient,
  input: {
    companyId: string;
    name: string;
    phone: string;
    overwriteName: boolean;
    currentTime: Date;
    locale?: Locale;
  },
): Promise<{ id: string; isBlocked: boolean }> {
  const loc = input.locale ?? 'RU';
  const rows = await tx.$queryRaw<Array<{ id: string; isBlocked: boolean }>>(Prisma.sql`
    INSERT INTO "Client" ("id", "companyId", "name", "phone", "locale", "createdAt", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid, ${input.name}, ${input.phone}, ${loc}::"Locale", ${input.currentTime}, ${input.currentTime})
    ON CONFLICT ("companyId", "phone") DO UPDATE
    SET
      "name" = CASE WHEN ${input.overwriteName} THEN EXCLUDED."name" ELSE "Client"."name" END,
      "locale" = CASE WHEN ${input.locale !== undefined} THEN ${loc}::"Locale" ELSE "Client"."locale" END,
      "updatedAt" = ${input.currentTime}
    RETURNING "id", "isBlocked"
  `);

  const row = rows[0];
  if (!row) {
    throw new AppError('INTERNAL_ERROR', 500, 'Failed to upsert client record');
  }
  return row;
}

function formatMoney(value: Prisma.Decimal | string | number | null): string {
  if (value === null) return '0.00';
  return Number(value).toFixed(2);
}

export async function listClients(actor: AuthenticatedActor, query: ListClientsQuery) {
  const currentTime = now();
  const offset = (query.page - 1) * query.limit;
  const searchPattern = query.search ? `%${query.search}%` : null;
  const blockedFilter = query.blocked === 'true' ? true : query.blocked === 'false' ? false : null;
  const masterFilter = actor.role === 'MASTER' ? actor.userId : null;

  const orderByClause =
    query.sort === 'visits'
      ? Prisma.sql`ORDER BY COALESCE(s.visits, 0) DESC, c."createdAt" DESC`
      : query.sort === 'noShows'
        ? Prisma.sql`ORDER BY COALESCE(s."noShows", 0) DESC, c."createdAt" DESC`
        : query.sort === 'name'
          ? Prisma.sql`ORDER BY c."name" ASC, c."createdAt" DESC`
          : Prisma.sql`ORDER BY s."lastVisitAt" DESC NULLS LAST, c."createdAt" DESC`;

  const masterExistsSql = masterFilter
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Appointment" a_m
        WHERE a_m."companyId" = c."companyId"
          AND a_m."clientId" = c."id"
          AND a_m."masterId" = ${masterFilter}::uuid
          AND a_m."deletedAt" IS NULL
      )`
    : Prisma.empty;

  const searchSql = searchPattern
    ? Prisma.sql`AND (c."name" ILIKE ${searchPattern} OR c."phone" ILIKE ${searchPattern})`
    : Prisma.empty;

  const blockedSql =
    blockedFilter !== null ? Prisma.sql`AND c."isBlocked" = ${blockedFilter}` : Prisma.empty;

  const statsMasterSql = masterFilter
    ? Prisma.sql`AND a."masterId" = ${masterFilter}::uuid`
    : Prisma.empty;

  const [countRow] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total
    FROM "Client" c
    WHERE c."companyId" = ${actor.companyId}::uuid
      ${masterExistsSql}
      ${searchSql}
      ${blockedSql}
  `);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      phone: string;
      notes: string | null;
      isBlocked: boolean;
      blockedAt: Date | null;
      anonymizedAt: Date | null;
      createdAt: Date;
      visits: bigint | null;
      noShows: bigint | null;
      cancellations: bigint | null;
      totalSpent: Prisma.Decimal | null;
      lastVisitAt: Date | null;
      nextAppointmentAt: Date | null;
    }>
  >(Prisma.sql`
    WITH stats AS (
      SELECT
        a."clientId",
        COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::bigint AS visits,
        COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::bigint AS "noShows",
        COUNT(*) FILTER (WHERE a."status" = 'CANCELLED')::bigint AS cancellations,
        COALESCE(SUM(a."price") FILTER (WHERE a."status" = 'COMPLETED'), 0)::numeric(10,2) AS "totalSpent",
        MAX(a."startAt") FILTER (WHERE a."status" = 'COMPLETED') AS "lastVisitAt",
        MIN(a."startAt") FILTER (WHERE a."status" = 'SCHEDULED' AND a."startAt" >= ${currentTime}) AS "nextAppointmentAt"
      FROM "Appointment" a
      WHERE a."companyId" = ${actor.companyId}::uuid
        AND a."deletedAt" IS NULL
        ${statsMasterSql}
      GROUP BY a."clientId"
    )
    SELECT
      c."id",
      c."name",
      c."phone",
      c."notes",
      c."isBlocked",
      c."blockedAt",
      c."anonymizedAt",
      c."createdAt",
      s.visits,
      s."noShows",
      s.cancellations,
      s."totalSpent",
      s."lastVisitAt",
      s."nextAppointmentAt"
    FROM "Client" c
    LEFT JOIN stats s ON s."clientId" = c."id"
    WHERE c."companyId" = ${actor.companyId}::uuid
      ${masterExistsSql}
      ${searchSql}
      ${blockedSql}
    ${orderByClause}
    LIMIT ${query.limit}
    OFFSET ${offset}
  `);

  const items: ClientListItemDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    isBlocked: r.isBlocked,
    blockedAt: r.blockedAt ? r.blockedAt.toISOString() : null,
    anonymizedAt: r.anonymizedAt ? r.anonymizedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    stats: {
      visits: Number(r.visits ?? 0n),
      noShows: Number(r.noShows ?? 0n),
      cancellations: Number(r.cancellations ?? 0n),
      totalSpent: formatMoney(r.totalSpent),
      lastVisitAt: r.lastVisitAt ? r.lastVisitAt.toISOString() : null,
      nextAppointmentAt: r.nextAppointmentAt ? r.nextAppointmentAt.toISOString() : null,
      firstSeenAt: r.createdAt.toISOString(),
    },
  }));

  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total: Number(countRow?.total ?? 0n),
    },
  };
}

export async function getClientDetail(
  actor: AuthenticatedActor,
  clientId: string,
  query: GetClientDetailQuery,
) {
  const currentTime = now();
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId: actor.companyId },
  });
  if (!client) {
    throw new AppError('NOT_FOUND', 404, 'Client not found');
  }

  const masterWhere = actor.role === 'MASTER' ? { masterId: actor.userId } : {};

  if (actor.role === 'MASTER') {
    const hasAccess = await prisma.appointment.findFirst({
      where: {
        companyId: actor.companyId,
        clientId: client.id,
        masterId: actor.userId,
      },
      select: { id: true },
    });
    if (!hasAccess) {
      throw new AppError('NOT_FOUND', 404, 'Client not found');
    }
  }

  const statsMasterSql =
    actor.role === 'MASTER' ? Prisma.sql`AND a."masterId" = ${actor.userId}::uuid` : Prisma.empty;

  const [statsRows, totalAppointments, appointments] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        visits: bigint;
        noShows: bigint;
        cancellations: bigint;
        totalSpent: Prisma.Decimal;
        lastVisitAt: Date | null;
        nextAppointmentAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::bigint AS visits,
        COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::bigint AS "noShows",
        COUNT(*) FILTER (WHERE a."status" = 'CANCELLED')::bigint AS cancellations,
        COALESCE(SUM(a."price") FILTER (WHERE a."status" = 'COMPLETED'), 0)::numeric(10,2) AS "totalSpent",
        MAX(a."startAt") FILTER (WHERE a."status" = 'COMPLETED') AS "lastVisitAt",
        MIN(a."startAt") FILTER (WHERE a."status" = 'SCHEDULED' AND a."startAt" >= ${currentTime}) AS "nextAppointmentAt"
      FROM "Appointment" a
      WHERE a."companyId" = ${actor.companyId}::uuid
        AND a."clientId" = ${client.id}::uuid
        AND a."deletedAt" IS NULL
        ${statsMasterSql}
    `),
    prisma.appointment.count({
      where: { companyId: actor.companyId, clientId: client.id, ...masterWhere },
    }),
    prisma.appointment.findMany({
      where: { companyId: actor.companyId, clientId: client.id, ...masterWhere },
      orderBy: { startAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        price: true,
        status: true,
        source: true,
        clientNote: true,
        internalNote: true,
        master: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, durationMin: true } },
      },
    }),
  ]);

  const s = statsRows[0];

  return {
    client: {
      id: client.id,
      name: client.name,
      phone: client.phone,
      notes: client.notes,
      isBlocked: client.isBlocked,
      blockedAt: client.blockedAt ? client.blockedAt.toISOString() : null,
      locale: client.locale,
      anonymizedAt: client.anonymizedAt ? client.anonymizedAt.toISOString() : null,
      createdAt: client.createdAt.toISOString(),
      stats: {
        visits: Number(s?.visits ?? 0n),
        noShows: Number(s?.noShows ?? 0n),
        cancellations: Number(s?.cancellations ?? 0n),
        totalSpent: formatMoney(s?.totalSpent ?? 0),
        lastVisitAt: s?.lastVisitAt ? s.lastVisitAt.toISOString() : null,
        nextAppointmentAt: s?.nextAppointmentAt ? s.nextAppointmentAt.toISOString() : null,
        firstSeenAt: client.createdAt.toISOString(),
      },
    },
    appointments: appointments.map((a) => ({
      id: a.id,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      price: a.price.toFixed(2),
      status: a.status,
      source: a.source,
      clientNote: a.clientNote,
      internalNote: a.internalNote,
      master: a.master,
      service: a.service,
    })),
    meta: {
      page: query.page,
      limit: query.limit,
      total: totalAppointments,
    },
  };
}

export async function updateClient(
  actor: AuthenticatedActor,
  clientId: string,
  input: UpdateClientInput,
  auditCtx?: AuditRequestContext,
) {
  const currentTime = now();
  const existing = await prisma.client.findFirst({
    where: { id: clientId, companyId: actor.companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Client not found');
  }
  if (existing.anonymizedAt) {
    throw new AppError('CONFLICT', 409, 'Anonymized client cannot be modified');
  }

  const updated = await prisma.client.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.isBlocked !== undefined
        ? {
            isBlocked: input.isBlocked,
            blockedAt: input.isBlocked ? currentTime : null,
          }
        : {}),
      updatedAt: currentTime,
    },
  });

  if (input.isBlocked !== undefined && input.isBlocked !== existing.isBlocked) {
    await audit(prisma, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: input.isBlocked ? 'client.block' : 'client.unblock',
      entityType: 'Client',
      entityId: updated.id,
      ...auditCtx,
    });
  } else {
    await audit(prisma, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.update',
      entityType: 'Client',
      entityId: updated.id,
      ...auditCtx,
    });
  }

  return {
    id: updated.id,
    name: updated.name,
    phone: updated.phone,
    notes: updated.notes,
    isBlocked: updated.isBlocked,
    blockedAt: updated.blockedAt ? updated.blockedAt.toISOString() : null,
    locale: updated.locale,
    anonymizedAt: updated.anonymizedAt ? updated.anonymizedAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function anonymizeClient(
  actor: AuthenticatedActor,
  clientId: string,
  auditCtx?: AuditRequestContext,
) {
  const currentTime = now();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.client.findFirst({
      where: { id: clientId, companyId: actor.companyId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', 404, 'Client not found');
    }
    if (existing.anonymizedAt) {
      throw new AppError('CONFLICT', 409, 'Client is already anonymized');
    }

    const anonPhone = `anon-${existing.id}`;

    const updated = await tx.client.update({
      where: { id: existing.id },
      data: {
        name: 'Deleted client',
        phone: anonPhone,
        notes: null,
        locale: 'RU',
        isBlocked: false,
        blockedAt: null,
        anonymizedAt: currentTime,
        updatedAt: currentTime,
      },
    });

    await tx.$executeRaw(Prisma.sql`
      UPDATE "Appointment"
      SET
        "clientName" = 'Deleted client',
        "clientPhone" = ${anonPhone},
        "clientNote" = NULL,
        "internalNote" = NULL,
        "updatedAt" = ${currentTime}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "clientId" = ${existing.id}::uuid
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "OutboxMessage"
      SET
        "status" = 'CANCELLED'::"OutboxStatus",
        "lastError" = 'Client anonymized',
        "updatedAt" = ${currentTime}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "status" = 'PENDING'::"OutboxStatus"
        AND "appointmentId" IN (
          SELECT "id" FROM "Appointment"
          WHERE "companyId" = ${actor.companyId}::uuid
            AND "clientId" = ${existing.id}::uuid
        )
    `);

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.anonymize',
      entityType: 'Client',
      entityId: updated.id,
      ...auditCtx,
    });

    return {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      notes: updated.notes,
      isBlocked: updated.isBlocked,
      anonymizedAt: updated.anonymizedAt ? updated.anonymizedAt.toISOString() : null,
    };
  });
}
