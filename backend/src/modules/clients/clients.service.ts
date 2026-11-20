import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { Prisma } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { escapeCsvCell } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import type {
  ClientSegment,
  ExportClientsQuery,
  GetClientDetailQuery,
  ListClientsQuery,
  UpdateClientInput,
} from './clients.schemas.js';
import type { ClientTagDto } from './clients-tags.service.js';

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
  tags: ClientTagDto[];
  stats: ClientStatsDto;
}

export function getClientSegmentCutoffs(currentTime: Date) {
  const dt = DateTime.fromJSDate(currentTime, { zone: 'utc' });
  return {
    daysAgo30: dt.minus({ days: 30 }).toJSDate(),
    daysAgo45: dt.minus({ days: 45 }).toJSDate(),
    daysAgo90: dt.minus({ days: 90 }).toJSDate(),
  };
}

export function buildClientStatsCteSql(
  companyId: string,
  currentTime: Date,
  masterFilterUserId: string | null,
): Prisma.Sql {
  const statsMasterSql = masterFilterUserId
    ? Prisma.sql`AND a."masterId" = ${masterFilterUserId}::uuid`
    : Prisma.empty;

  return Prisma.sql`
    WITH stats AS (
      SELECT
        a."clientId",
        COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::bigint AS visits,
        COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::bigint AS "noShows",
        COUNT(*) FILTER (WHERE a."status" = 'CANCELLED')::bigint AS cancellations,
        COALESCE(SUM(a."price") FILTER (WHERE a."status" = 'COMPLETED'), 0)::numeric(10,2) AS "totalSpent",
        MAX(a."startAt") FILTER (WHERE a."status" = 'COMPLETED') AS "lastVisitAt",
        MIN(a."startAt") FILTER (
          WHERE a."status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a."startAt" >= ${currentTime}
        ) AS "nextAppointmentAt"
      FROM "Appointment" a
      WHERE a."companyId" = ${companyId}::uuid
        AND a."deletedAt" IS NULL
        ${statsMasterSql}
      GROUP BY a."clientId"
    )
  `;
}

function buildSegmentFilterSql(
  segment: ClientSegment | undefined,
  cutoffs: ReturnType<typeof getClientSegmentCutoffs>,
): Prisma.Sql {
  switch (segment) {
    case 'NEW':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND COALESCE(s.visits, 0) <= 1 AND c."createdAt" >= ${cutoffs.daysAgo30}`;
    case 'REPEAT':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND COALESCE(s.visits, 0) >= 2`;
    case 'VIP':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND (COALESCE(s.visits, 0) >= 5 OR COALESCE(s."totalSpent", 0) >= 5000)`;
    case 'AT_RISK':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND COALESCE(s.visits, 0) >= 2 AND s."lastVisitAt" IS NOT NULL AND s."lastVisitAt" < ${cutoffs.daysAgo45} AND s."lastVisitAt" >= ${cutoffs.daysAgo90} AND s."nextAppointmentAt" IS NULL`;
    case 'LOST':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND COALESCE(s.visits, 0) >= 1 AND s."lastVisitAt" IS NOT NULL AND s."lastVisitAt" < ${cutoffs.daysAgo90} AND s."nextAppointmentAt" IS NULL`;
    case 'NO_SHOW_RISK':
      return Prisma.sql`AND c."isBlocked" = false AND c."anonymizedAt" IS NULL AND COALESCE(s."noShows", 0) >= 2`;
    case 'BLOCKED':
      return Prisma.sql`AND c."isBlocked" = true`;
    case 'ALL':
    case undefined:
      return Prisma.empty;
  }
}

export async function upsertClientInTx(
  tx: TransactionClient,
  input: {
    companyId: string;
    name: string;
    phone: string;
    overwriteName: boolean;
    currentTime: Date;
  },
): Promise<{ id: string; isBlocked: boolean }> {
  const rows = await tx.$queryRaw<Array<{ id: string; isBlocked: boolean }>>(Prisma.sql`
    INSERT INTO "Client" ("id", "companyId", "name", "phone", "locale", "createdAt", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid, ${input.name}, ${input.phone}, 'RU'::"Locale", ${input.currentTime}, ${input.currentTime})
    ON CONFLICT ("companyId", "phone") DO UPDATE
    SET
      "name" = CASE WHEN ${input.overwriteName} THEN EXCLUDED."name" ELSE "Client"."name" END,
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

interface RawClientListRow {
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
}

async function loadTagsMapForClients(
  companyId: string,
  clientIds: string[],
): Promise<Map<string, ClientTagDto[]>> {
  const map = new Map<string, ClientTagDto[]>();
  if (clientIds.length === 0) return map;

  const assignments = await prisma.clientTagAssignment.findMany({
    where: { companyId, clientId: { in: clientIds } },
    include: { tag: { select: { id: true, name: true, color: true } } },
    orderBy: { tag: { name: 'asc' } },
  });

  for (const item of assignments) {
    const list = map.get(item.clientId) ?? [];
    list.push({ id: item.tag.id, name: item.tag.name, color: item.tag.color });
    map.set(item.clientId, list);
  }
  return map;
}

function buildWhereFilterSql(
  actor: AuthenticatedActor,
  query: ExportClientsQuery,
  currentTime: Date,
): { cteSql: Prisma.Sql; whereSql: Prisma.Sql } {
  const masterFilter = actor.role === 'MASTER' ? actor.userId : null;
  const searchPattern = query.search ? `%${query.search}%` : null;
  const blockedFilter = query.blocked === 'true' ? true : query.blocked === 'false' ? false : null;
  const cutoffs = getClientSegmentCutoffs(currentTime);

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

  const tagSql = query.tagId
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "ClientTagAssignment" cta
        WHERE cta."companyId" = c."companyId"
          AND cta."clientId" = c."id"
          AND cta."tagId" = ${query.tagId}::uuid
      )`
    : Prisma.empty;

  const minVisitsSql =
    query.minVisits !== undefined
      ? Prisma.sql`AND COALESCE(s.visits, 0) >= ${query.minVisits}`
      : Prisma.empty;

  const inactiveCutoff =
    query.inactiveDays !== undefined
      ? DateTime.fromJSDate(currentTime, { zone: 'utc' })
          .minus({ days: query.inactiveDays })
          .toJSDate()
      : null;

  const inactiveSql = inactiveCutoff
    ? Prisma.sql`AND (s."lastVisitAt" IS NULL OR s."lastVisitAt" < ${inactiveCutoff}) AND s."nextAppointmentAt" IS NULL`
    : Prisma.empty;

  const segmentSql = buildSegmentFilterSql(query.segment, cutoffs);

  const cteSql = buildClientStatsCteSql(actor.companyId, currentTime, masterFilter);
  const whereSql = Prisma.sql`
    WHERE c."companyId" = ${actor.companyId}::uuid
      AND c."mergedAt" IS NULL
      ${masterExistsSql}
      ${searchSql}
      ${blockedSql}
      ${tagSql}
      ${minVisitsSql}
      ${inactiveSql}
      ${segmentSql}
  `;

  return { cteSql, whereSql };
}

export async function listClients(actor: AuthenticatedActor, query: ListClientsQuery) {
  const currentTime = now();
  const offset = (query.page - 1) * query.limit;
  const { cteSql, whereSql } = buildWhereFilterSql(actor, query, currentTime);

  const orderByClause =
    query.sort === 'visits'
      ? Prisma.sql`ORDER BY COALESCE(s.visits, 0) DESC, c."createdAt" DESC`
      : query.sort === 'noShows'
        ? Prisma.sql`ORDER BY COALESCE(s."noShows", 0) DESC, c."createdAt" DESC`
        : query.sort === 'name'
          ? Prisma.sql`ORDER BY c."name" ASC, c."createdAt" DESC`
          : query.sort === 'totalSpent'
            ? Prisma.sql`ORDER BY COALESCE(s."totalSpent", 0) DESC, c."createdAt" DESC`
            : Prisma.sql`ORDER BY s."lastVisitAt" DESC NULLS LAST, c."createdAt" DESC`;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      ${cteSql}
      SELECT COUNT(*)::bigint AS total
      FROM "Client" c
      LEFT JOIN stats s ON s."clientId" = c."id"
      ${whereSql}
    `),
    prisma.$queryRaw<RawClientListRow[]>(Prisma.sql`
      ${cteSql}
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
      ${whereSql}
      ${orderByClause}
      LIMIT ${query.limit}
      OFFSET ${offset}
    `),
  ]);

  const tagsMap = await loadTagsMapForClients(
    actor.companyId,
    rows.map((r) => r.id),
  );

  const items: ClientListItemDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    isBlocked: r.isBlocked,
    blockedAt: r.blockedAt ? r.blockedAt.toISOString() : null,
    anonymizedAt: r.anonymizedAt ? r.anonymizedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    tags: tagsMap.get(r.id) ?? [],
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
      total: Number(countRows[0]?.total ?? 0n),
    },
  };
}

export async function exportClientsCsv(
  actor: AuthenticatedActor,
  query: ExportClientsQuery,
): Promise<string> {
  const currentTime = now();
  const company = await prisma.company.findUnique({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const timezone = company?.timezone ?? 'Asia/Bishkek';
  const { cteSql, whereSql } = buildWhereFilterSql(actor, query, currentTime);

  const rows = await prisma.$queryRaw<RawClientListRow[]>(Prisma.sql`
    ${cteSql}
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
    ${whereSql}
    ORDER BY s."lastVisitAt" DESC NULLS LAST, c."createdAt" DESC
    LIMIT 5000
  `);

  const tagsMap = await loadTagsMapForClients(
    actor.companyId,
    rows.map((r) => r.id),
  );

  const header = [
    'Имя',
    'Телефон',
    'Теги',
    'Визиты',
    'Неявки',
    'Отмены',
    'Сумма завершённых визитов',
    'Последний визит',
    'Заблокирован',
    'Заметки',
  ].join(',');

  const lines = rows.map((r) => {
    const tagsStr = (tagsMap.get(r.id) ?? []).map((t) => t.name).join(' | ');
    const lastVisitLocal = r.lastVisitAt
      ? DateTime.fromJSDate(r.lastVisitAt, { zone: 'utc' }).setZone(timezone).toFormat('yyyy-MM-dd')
      : '';
    return [
      escapeCsvCell(r.name),
      escapeCsvCell(r.phone),
      escapeCsvCell(tagsStr),
      escapeCsvCell(Number(r.visits ?? 0n)),
      escapeCsvCell(Number(r.noShows ?? 0n)),
      escapeCsvCell(Number(r.cancellations ?? 0n)),
      escapeCsvCell(formatMoney(r.totalSpent)),
      escapeCsvCell(lastVisitLocal),
      escapeCsvCell(r.isBlocked ? 'Да' : 'Нет'),
      escapeCsvCell(r.notes ?? ''),
    ].join(',');
  });

  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export async function getClientDetail(
  actor: AuthenticatedActor,
  clientId: string,
  query: GetClientDetailQuery,
) {
  const currentTime = now();
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId: actor.companyId, mergedAt: null },
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

  const [statsRows, totalAppointments, appointments, tagsMap] = await Promise.all([
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
        MIN(a."startAt") FILTER (
          WHERE a."status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a."startAt" >= ${currentTime}
        ) AS "nextAppointmentAt"
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
        packageName: true,
        master: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, durationMin: true } },
        items: { orderBy: { position: 'asc' }, select: { name: true } },
      },
    }),
    loadTagsMapForClients(actor.companyId, [client.id]),
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
      tags: tagsMap.get(client.id) ?? [],
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
      service: {
        ...a.service,
        name:
          a.packageName ??
          (a.items.length ? a.items.map((item) => item.name).join(' + ') : a.service.name),
        durationMin: (a.endAt.getTime() - a.startAt.getTime()) / 60000,
      },
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
    where: { id: clientId, companyId: actor.companyId, mergedAt: null },
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
      context: auditCtx,
    });
  } else {
    await audit(prisma, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.update',
      entityType: 'Client',
      entityId: updated.id,
      context: auditCtx,
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
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        phone: string;
        telegramChatId: string | null;
        anonymizedAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT "id", "name", "phone", "telegramChatId", "anonymizedAt"
      FROM "Client"
      WHERE "id" = ${clientId}::uuid
        AND "companyId" = ${actor.companyId}::uuid
        AND "mergedAt" IS NULL
      FOR UPDATE
    `);
    const existing = locked[0];
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
        telegramChatId: null,
        notes: null,
        locale: 'RU',
        isBlocked: false,
        blockedAt: null,
        anonymizedAt: currentTime,
        updatedAt: currentTime,
      },
    });

    await tx.clientTagAssignment.deleteMany({
      where: { companyId: actor.companyId, clientId: existing.id },
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
        "status" = CASE
          WHEN "status" = 'PENDING'::"OutboxStatus" THEN 'CANCELLED'::"OutboxStatus"
          ELSE "status"
        END,
        "lastError" = CASE
          WHEN "status" = 'PENDING'::"OutboxStatus" THEN 'Client anonymized'
          ELSE "lastError"
        END,
        "recipient" = CASE
          WHEN "recipient" = ${existing.phone} THEN ${anonPhone}
          ELSE "recipient"
        END,
        "payload" = replace(
          replace("payload"::text, ${existing.name}, 'Deleted client'),
          ${existing.phone},
          ${anonPhone}
        )::jsonb,
        "updatedAt" = ${currentTime}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND (
          "recipient" = ${existing.phone}
          OR "payload"::text LIKE ${'%' + existing.phone + '%'}
          OR "payload"::text LIKE ${'%' + existing.name + '%'}
          OR "appointmentId" IN (
            SELECT "id" FROM "Appointment"
            WHERE "companyId" = ${actor.companyId}::uuid
              AND "clientId" = ${existing.id}::uuid
          )
        )
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "InAppNotification"
      SET
        "title" = replace(replace("title", ${existing.name}, 'Deleted client'), ${existing.phone}, ${anonPhone}),
        "body" = replace(replace("body", ${existing.name}, 'Deleted client'), ${existing.phone}, ${anonPhone})
      WHERE "companyId" = ${actor.companyId}::uuid
        AND (
          "title" LIKE ${'%' + existing.name + '%'}
          OR "title" LIKE ${'%' + existing.phone + '%'}
          OR "body" LIKE ${'%' + existing.name + '%'}
          OR "body" LIKE ${'%' + existing.phone + '%'}
        )
    `);

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.anonymize',
      entityType: 'Client',
      entityId: updated.id,
      context: auditCtx,
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
