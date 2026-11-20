import { DateTime } from 'luxon';
import { Prisma } from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { escapeCsvCell } from '../../lib/csv.js';
import { ACTIVE_SLOT_STATUSES } from '../appointments/status-transitions.js';
import { buildClientStatsCteSql, getClientSegmentCutoffs } from '../clients/clients.service.js';
import { addDaysToLocalDate, localDateTimeToUtc, utcToLocalParts } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AnalyticsRangeQuery, AnalyticsTimeseriesQuery } from './analytics.schemas.js';

export { escapeCsvCell };

interface SummaryAggRow {
  revenue: string | null;
  prepayments_received: string | null;
  total_count: number;
  scheduled_count: number;
  completed_count: number;
  cancelled_count: number;
  no_show_count: number;
  online_count: number;
  staff_count: number;
}

interface ClientSplitRow {
  new_clients: number;
  returning_clients: number;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function parseHmToMin(hm: string): number {
  const [hStr, mStr] = hm.split(':');
  return Number(hStr ?? 0) * 60 + Number(mStr ?? 0);
}

function subtractIntervals(
  base: Array<[number, number]>,
  sub: Array<[number, number]>,
): Array<[number, number]> {
  let current = base;
  for (const [s, e] of sub) {
    if (e <= s) continue;
    const next: Array<[number, number]> = [];
    for (const [bs, be] of current) {
      if (e <= bs || s >= be) {
        next.push([bs, be]);
      } else {
        if (s > bs) next.push([bs, s]);
        if (e < be) next.push([e, be]);
      }
    }
    current = next;
  }
  return current;
}

function sumIntervalMinutes(intervals: Array<[number, number]>): number {
  let total = 0;
  for (const [s, e] of intervals) {
    if (e > s) total += e - s;
  }
  return total;
}

function overlapMinutes(
  intervals: Array<[number, number]>,
  rangeStart: number,
  rangeEnd: number,
): number {
  let total = 0;
  for (const [s, e] of intervals) {
    const os = Math.max(s, rangeStart);
    const oe = Math.min(e, rangeEnd);
    if (oe > os) total += oe - os;
  }
  return total;
}

async function resolveCompanyRange(companyId: string, fromDate: string, toDate: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, timezone: true, currency: true },
  });
  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const nextDayAfterTo = addDaysToLocalDate(toDate, 1, company.timezone);
  const fromUtc = localDateTimeToUtc(fromDate, '00:00', company.timezone);
  const toUtc = localDateTimeToUtc(nextDayAfterTo, '00:00', company.timezone);

  const fromDt = DateTime.fromISO(fromDate, { zone: 'utc' });
  const toDt = DateTime.fromISO(toDate, { zone: 'utc' });
  const dayCount = Math.round(toDt.diff(fromDt, 'days').days) + 1;
  const prevFromDate = addDaysToLocalDate(fromDate, -dayCount, company.timezone);
  const prevFromUtc = localDateTimeToUtc(prevFromDate, '00:00', company.timezone);
  const prevToUtc = fromUtc;

  return {
    timezone: company.timezone,
    currency: company.currency,
    fromDate,
    toDate,
    dayCount,
    fromUtc,
    toUtc,
    prevFromUtc,
    prevToUtc,
  };
}

async function queryPeriodSummary(
  companyId: string,
  fromUtc: Date,
  toUtc: Date,
  masterId?: string,
): Promise<SummaryAggRow> {
  const masterFilter = masterId ? Prisma.sql`AND a."masterId" = ${masterId}::uuid` : Prisma.empty;

  const rows = await prisma.$queryRaw<SummaryAggRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(CASE WHEN a."status" = 'COMPLETED' THEN a."price" ELSE 0 END), 0)::text AS revenue,
      COALESCE(SUM(CASE WHEN a."prepaymentStatus" = 'RECEIVED' THEN COALESCE(a."prepaymentAmount", 0) ELSE 0 END), 0)::text AS prepayments_received,
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE a."status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'))::int AS scheduled_count,
      COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS completed_count,
      COUNT(*) FILTER (WHERE a."status" = 'CANCELLED')::int AS cancelled_count,
      COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::int AS no_show_count,
      COUNT(*) FILTER (WHERE a."source" = 'ONLINE')::int AS online_count,
      COUNT(*) FILTER (WHERE a."source" = 'STAFF')::int AS staff_count
    FROM "Appointment" a
    WHERE a."companyId" = ${companyId}::uuid
      AND a."deletedAt" IS NULL
      AND a."startAt" >= ${fromUtc}
      AND a."startAt" < ${toUtc}
      ${masterFilter}
  `);

  return (
    rows[0] ?? {
      revenue: '0.00',
      prepayments_received: '0.00',
      total_count: 0,
      scheduled_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      no_show_count: 0,
      online_count: 0,
      staff_count: 0,
    }
  );
}

export async function getAnalyticsSummary(companyId: string, query: AnalyticsRangeQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const masterFilter = query.masterId
    ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid`
    : Prisma.empty;

  const [curr, prev, clientRows] = await Promise.all([
    queryPeriodSummary(companyId, range.fromUtc, range.toUtc, query.masterId),
    queryPeriodSummary(companyId, range.prevFromUtc, range.prevToUtc, query.masterId),
    prisma.$queryRaw<ClientSplitRow[]>(Prisma.sql`
      WITH period_clients AS (
        SELECT DISTINCT a."clientId"
        FROM "Appointment" a
        WHERE a."companyId" = ${companyId}::uuid
          AND a."deletedAt" IS NULL
          AND a."startAt" >= ${range.fromUtc}
          AND a."startAt" < ${range.toUtc}
          ${masterFilter}
      )
      SELECT
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM "Appointment" p
            WHERE p."companyId" = ${companyId}::uuid
              AND p."clientId" = pc."clientId"
              AND p."deletedAt" IS NULL
              AND p."startAt" < ${range.fromUtc}
          )
        )::int AS new_clients,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "Appointment" p
            WHERE p."companyId" = ${companyId}::uuid
              AND p."clientId" = pc."clientId"
              AND p."deletedAt" IS NULL
              AND p."startAt" < ${range.fromUtc}
          )
        )::int AS returning_clients
      FROM period_clients pc
    `),
  ]);

  const revenueNum = Number(curr.revenue ?? '0');
  const prevRevenueNum = Number(prev.revenue ?? '0');
  const avgTicketNum = curr.completed_count > 0 ? revenueNum / curr.completed_count : 0;

  const finishedOutcomeCount = curr.completed_count + curr.no_show_count;
  const noShowRate =
    finishedOutcomeCount > 0
      ? Math.round((curr.no_show_count / finishedOutcomeCount) * 1000) / 10
      : 0;
  const prevFinished = prev.completed_count + prev.no_show_count;
  const prevNoShowRate =
    prevFinished > 0 ? Math.round((prev.no_show_count / prevFinished) * 1000) / 10 : 0;

  const split = clientRows[0] ?? { new_clients: 0, returning_clients: 0 };

  return {
    period: { from: range.fromDate, to: range.toDate, timezone: range.timezone },
    revenue: revenueNum.toFixed(2),
    averageTicket: avgTicketNum.toFixed(2),
    prepaymentsReceived: Number(curr.prepayments_received ?? '0').toFixed(2),
    noShowRate,
    counts: {
      total: curr.total_count,
      scheduled: curr.scheduled_count,
      completed: curr.completed_count,
      cancelled: curr.cancelled_count,
      noShow: curr.no_show_count,
    },
    clients: {
      newCount: split.new_clients,
      returningCount: split.returning_clients,
    },
    sources: {
      online: curr.online_count,
      staff: curr.staff_count,
    },
    deltas: {
      revenuePct: pctDelta(revenueNum, prevRevenueNum),
      totalPct: pctDelta(curr.total_count, prev.total_count),
      completedPct: pctDelta(curr.completed_count, prev.completed_count),
      noShowRateDiff: Math.round((noShowRate - prevNoShowRate) * 10) / 10,
    },
  };
}

export async function getAnalyticsTimeseries(companyId: string, query: AnalyticsTimeseriesQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const masterFilter = query.masterId
    ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid`
    : Prisma.empty;
  const truncUnit = query.granularity;

  const rows = await prisma.$queryRaw<
    Array<{
      bucket: Date;
      revenue: string | null;
      total: number;
      completed: number;
      cancelled: number;
      no_show: number;
    }>
  >(Prisma.sql`
    SELECT
      date_trunc(${truncUnit}, a."startAt" AT TIME ZONE ${range.timezone}) AS bucket,
      COALESCE(SUM(CASE WHEN a."status" = 'COMPLETED' THEN a."price" ELSE 0 END), 0)::text AS revenue,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE a."status" = 'CANCELLED')::int AS cancelled,
      COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::int AS no_show
    FROM "Appointment" a
    WHERE a."companyId" = ${companyId}::uuid
      AND a."deletedAt" IS NULL
      AND a."startAt" >= ${range.fromUtc}
      AND a."startAt" < ${range.toUtc}
      ${masterFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  return {
    granularity: query.granularity,
    points: rows.map((r) => ({
      date: DateTime.fromJSDate(r.bucket, { zone: 'utc' }).toISODate() ?? '',
      revenue: Number(r.revenue ?? '0').toFixed(2),
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      noShow: r.no_show,
    })),
  };
}

export async function getAnalyticsServices(companyId: string, query: AnalyticsRangeQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const masterFilter = query.masterId
    ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      service_id: string;
      service_name: string;
      revenue: string | null;
      total: number;
      completed: number;
    }>
  >(Prisma.sql`
    WITH composition AS (
      SELECT a."id", a."price", a."status",
        COALESCE(i."serviceId", a."serviceId") AS service_id,
        COALESCE(i."position", 0) AS position,
        COALESCE(i."price", a."price") AS weight,
        SUM(COALESCE(i."price", a."price")) OVER (PARTITION BY a."id") AS weights,
        COUNT(*) OVER (PARTITION BY a."id") AS item_count
      FROM "Appointment" a
      LEFT JOIN "AppointmentService" i ON i."appointmentId" = a."id" AND i."companyId" = a."companyId"
      WHERE a."companyId" = ${companyId}::uuid
        AND a."deletedAt" IS NULL
        AND a."startAt" >= ${range.fromUtc}
        AND a."startAt" < ${range.toUtc}
        ${masterFilter}
    ), rounded AS (
      SELECT *, FLOOR(CASE WHEN weights > 0 THEN "price" * 100 * weight / weights
        ELSE "price" * 100 / item_count END) AS cents FROM composition
    ), allocated AS (
      SELECT *, cents + CASE WHEN position = 0 THEN "price" * 100 - SUM(cents) OVER (PARTITION BY "id")
        ELSE 0 END AS allocated_cents FROM rounded
    )
    SELECT s."id" AS service_id, s."name" AS service_name,
      (COALESCE(SUM(CASE WHEN a."status" = 'COMPLETED' THEN a.allocated_cents ELSE 0 END), 0) / 100)::text AS revenue,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS completed
    FROM allocated a
    JOIN "Service" s ON s."id" = a.service_id AND s."companyId" = ${companyId}::uuid
    GROUP BY s."id", s."name"
    ORDER BY SUM(CASE WHEN a."status" = 'COMPLETED' THEN a.allocated_cents ELSE 0 END) DESC, COUNT(*) DESC
  `);

  return rows.map((r) => ({
    serviceId: r.service_id,
    serviceName: r.service_name,
    revenue: Number(r.revenue ?? '0').toFixed(2),
    total: r.total,
    completed: r.completed,
  }));
}

export async function getAnalyticsMasters(companyId: string, query: AnalyticsRangeQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const masterWhere = query.masterId ? { id: query.masterId } : {};

  const [aggRows, masters, timeOffs, blockingAppts] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        master_id: string;
        revenue: string | null;
        total: number;
        completed: number;
        no_show: number;
      }>
    >(Prisma.sql`
      SELECT
        a."masterId" AS master_id,
        COALESCE(SUM(CASE WHEN a."status" = 'COMPLETED' THEN a."price" ELSE 0 END), 0)::text AS revenue,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE a."status" = 'NO_SHOW')::int AS no_show
      FROM "Appointment" a
      WHERE a."companyId" = ${companyId}::uuid
        AND a."deletedAt" IS NULL
        AND a."startAt" >= ${range.fromUtc}
        AND a."startAt" < ${range.toUtc}
        ${query.masterId ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid` : Prisma.empty}
      GROUP BY a."masterId"
    `),
    prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        ...masterWhere,
      },
      include: {
        workingHours: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.timeOff.findMany({
      where: {
        companyId,
        startAt: { lt: range.toUtc },
        endAt: { gt: range.fromUtc },
        ...(query.masterId ? { userId: query.masterId } : {}),
      },
    }),
    prisma.appointment.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: [...ACTIVE_SLOT_STATUSES] },
        startAt: { lt: range.toUtc },
        endAt: { gt: range.fromUtc },
        ...(query.masterId ? { masterId: query.masterId } : {}),
      },
      select: { masterId: true, startAt: true, endAt: true },
    }),
  ]);

  const aggMap = new Map(aggRows.map((r) => [r.master_id, r]));

  return masters
    .filter((m) => m.isBookable || aggMap.has(m.id))
    .map((m) => {
      const agg = aggMap.get(m.id);
      const hoursByDay = new Map(m.workingHours.map((wh) => [wh.dayOfWeek, wh]));
      const mTimeOffs = timeOffs.filter((t) => t.userId === m.id);
      const mAppts = blockingAppts.filter((a) => a.masterId === m.id);

      let availableMin = 0;
      let bookedMin = 0;

      for (let d = 0; d < range.dayCount; d += 1) {
        const localDate = addDaysToLocalDate(range.fromDate, d, range.timezone);
        const dayStartUtc = localDateTimeToUtc(localDate, '00:00', range.timezone);
        const weekday = DateTime.fromISO(localDate, { zone: range.timezone }).weekday;
        const wh = hoursByDay.get(weekday);
        if (!wh) continue;

        const winStart = parseHmToMin(wh.startTime);
        const winEnd = parseHmToMin(wh.endTime);
        if (winEnd <= winStart) continue;

        const subs: Array<[number, number]> = [];
        if (wh.breakStart && wh.breakEnd) {
          subs.push([parseHmToMin(wh.breakStart), parseHmToMin(wh.breakEnd)]);
        }

        const dayStartMs = dayStartUtc.getTime();
        for (const to of mTimeOffs) {
          const ts = Math.round((to.startAt.getTime() - dayStartMs) / 60_000);
          const te = Math.round((to.endAt.getTime() - dayStartMs) / 60_000);
          subs.push([ts, te]);
        }

        const openIntervals = subtractIntervals([[winStart, winEnd]], subs);
        availableMin += sumIntervalMinutes(openIntervals);

        for (const appt of mAppts) {
          const as = Math.round((appt.startAt.getTime() - dayStartMs) / 60_000);
          const ae = Math.round((appt.endAt.getTime() - dayStartMs) / 60_000);
          bookedMin += overlapMinutes(openIntervals, as, ae);
        }
      }

      const utilizationPct =
        availableMin > 0 ? Math.min(100, Math.round((bookedMin / availableMin) * 1000) / 10) : 0;

      return {
        masterId: m.id,
        masterName: m.name,
        revenue: Number(agg?.revenue ?? '0').toFixed(2),
        total: agg?.total ?? 0,
        completed: agg?.completed ?? 0,
        noShow: agg?.no_show ?? 0,
        availableMinutes: availableMin,
        bookedMinutes: bookedMin,
        utilizationPct,
      };
    });
}

export async function getAnalyticsHeatmap(companyId: string, query: AnalyticsRangeQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const masterFilter = query.masterId
    ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{ weekday: number; hour: number; count: number }>
  >(Prisma.sql`
    SELECT
      EXTRACT(ISODOW FROM a."startAt" AT TIME ZONE ${range.timezone})::int AS weekday,
      EXTRACT(HOUR FROM a."startAt" AT TIME ZONE ${range.timezone})::int AS hour,
      COUNT(*)::int AS count
    FROM "Appointment" a
    WHERE a."companyId" = ${companyId}::uuid
      AND a."deletedAt" IS NULL
      AND a."startAt" >= ${range.fromUtc}
      AND a."startAt" < ${range.toUtc}
      ${masterFilter}
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `);

  return rows;
}

export async function exportAppointmentsCsv(
  companyId: string,
  query: AnalyticsRangeQuery,
): Promise<string> {
  const range = await resolveCompanyRange(companyId, query.from, query.to);

  const rows = await prisma.appointment.findMany({
    where: {
      companyId,
      startAt: { gte: range.fromUtc, lt: range.toUtc },
      ...(query.masterId ? { masterId: query.masterId } : {}),
    },
    include: {
      service: { select: { name: true } },
      master: { select: { name: true } },
    },
    orderBy: [{ startAt: 'asc' }],
  });

  const header = [
    'Дата',
    'Время',
    'Клиент',
    'Телефон',
    'Услуга',
    'Мастер',
    'Цена',
    'Статус',
    'Предоплата',
    'Сумма предоплаты',
    'Источник',
  ].join(',');

  const lines = rows.map((r) => {
    const local = utcToLocalParts(r.startAt, range.timezone);
    return [
      escapeCsvCell(local.date),
      escapeCsvCell(local.time),
      escapeCsvCell(r.clientName),
      escapeCsvCell(r.clientPhone),
      escapeCsvCell(r.service.name),
      escapeCsvCell(r.master.name),
      escapeCsvCell(r.price.toFixed(2)),
      escapeCsvCell(r.status),
      escapeCsvCell(r.prepaymentStatus),
      escapeCsvCell(r.prepaymentAmount ? r.prepaymentAmount.toFixed(2) : ''),
      escapeCsvCell(r.source),
    ].join(',');
  });

  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export async function exportPaymentsCsv(
  companyId: string,
  query: AnalyticsRangeQuery,
): Promise<string> {
  const range = await resolveCompanyRange(companyId, query.from, query.to);

  const rows = await prisma.businessPayment.findMany({
    where: {
      companyId,
      createdAt: { gte: range.fromUtc, lt: range.toUtc },
    },
    include: {
      client: { select: { name: true, phone: true } },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  const header = [
    'Дата',
    'Время',
    'Тип',
    'Статус',
    'Сумма',
    'Валюта',
    'Способ',
    'Клиент',
    'Телефон',
    'Референс',
    'Комментарий',
  ].join(',');

  const lines = rows.map((r) => {
    const local = utcToLocalParts(r.createdAt, range.timezone);
    return [
      escapeCsvCell(local.date),
      escapeCsvCell(local.time),
      escapeCsvCell(r.kind),
      escapeCsvCell(r.status),
      escapeCsvCell(r.amount.toFixed(2)),
      escapeCsvCell(r.currency),
      escapeCsvCell(r.method),
      escapeCsvCell(r.client?.name ?? ''),
      escapeCsvCell(r.client?.phone ?? ''),
      escapeCsvCell(r.reference ?? ''),
      escapeCsvCell(r.note ?? ''),
    ].join(',');
  });

  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export async function getAnalyticsCrm(companyId: string, query: AnalyticsRangeQuery) {
  const range = await resolveCompanyRange(companyId, query.from, query.to);
  const currentTime = clockNow();
  const cutoffs = getClientSegmentCutoffs(currentTime);
  const statsCte = buildClientStatsCteSql(companyId, currentTime, query.masterId ?? null);
  const masterFilter = query.masterId
    ? Prisma.sql`AND a."masterId" = ${query.masterId}::uuid`
    : Prisma.empty;
  const masterClientScopeSql = query.masterId
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Appointment" a_m
        WHERE a_m."companyId" = c."companyId"
          AND a_m."clientId" = c."id"
          AND a_m."masterId" = ${query.masterId}::uuid
          AND a_m."deletedAt" IS NULL
      )`
    : Prisma.empty;

  const [segmentRows, retentionRows, topClientRows, tagRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        total_active: number;
        new_clients: number;
        repeat_clients: number;
        vip_clients: number;
        at_risk_clients: number;
        lost_clients: number;
        no_show_risk_clients: number;
        blocked_clients: number;
      }>
    >(Prisma.sql`
      ${statsCte}
      SELECT
        COUNT(*) FILTER (WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL)::int AS total_active,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND COALESCE(s.visits, 0) <= 1 AND c."createdAt" >= ${cutoffs.daysAgo30}
        )::int AS new_clients,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND COALESCE(s.visits, 0) >= 2
        )::int AS repeat_clients,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND (COALESCE(s.visits, 0) >= 5 OR COALESCE(s."totalSpent", 0) >= 5000)
        )::int AS vip_clients,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND COALESCE(s.visits, 0) >= 2
            AND s."lastVisitAt" IS NOT NULL
            AND s."lastVisitAt" < ${cutoffs.daysAgo45}
            AND s."lastVisitAt" >= ${cutoffs.daysAgo90}
            AND s."nextAppointmentAt" IS NULL
        )::int AS at_risk_clients,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND COALESCE(s.visits, 0) >= 1
            AND s."lastVisitAt" IS NOT NULL
            AND s."lastVisitAt" < ${cutoffs.daysAgo90}
            AND s."nextAppointmentAt" IS NULL
        )::int AS lost_clients,
        COUNT(*) FILTER (
          WHERE c."isBlocked" = false AND c."anonymizedAt" IS NULL
            AND COALESCE(s."noShows", 0) >= 2
        )::int AS no_show_risk_clients,
        COUNT(*) FILTER (WHERE c."isBlocked" = true)::int AS blocked_clients
      FROM "Client" c
      LEFT JOIN stats s ON s."clientId" = c."id"
      WHERE c."companyId" = ${companyId}::uuid
        AND c."mergedAt" IS NULL
        ${masterClientScopeSql}
    `),
    prisma.$queryRaw<
      Array<{
        prior_clients: number;
        retained_clients: number;
        overall_with_visit: number;
        overall_repeat: number;
      }>
    >(Prisma.sql`
      ${statsCte},
      period_flags AS (
        SELECT
          c."id",
          c."isBlocked",
          c."anonymizedAt",
          COALESCE(s.visits, 0) AS total_visits,
          EXISTS (
            SELECT 1 FROM "Appointment" a
            WHERE a."companyId" = c."companyId"
              AND a."clientId" = c."id"
              AND a."deletedAt" IS NULL
              AND a."status" = 'COMPLETED'
              AND a."startAt" < ${range.fromUtc}
              ${masterFilter}
          ) AS had_prior,
          EXISTS (
            SELECT 1 FROM "Appointment" a
            WHERE a."companyId" = c."companyId"
              AND a."clientId" = c."id"
              AND a."deletedAt" IS NULL
              AND a."status" = 'COMPLETED'
              AND a."startAt" >= ${range.fromUtc}
              AND a."startAt" < ${range.toUtc}
              ${masterFilter}
          ) AS had_current
        FROM "Client" c
        LEFT JOIN stats s ON s."clientId" = c."id"
        WHERE c."companyId" = ${companyId}::uuid
          AND c."mergedAt" IS NULL
          ${masterClientScopeSql}
      )
      SELECT
        COUNT(*) FILTER (WHERE had_prior)::int AS prior_clients,
        COUNT(*) FILTER (WHERE had_prior AND had_current)::int AS retained_clients,
        COUNT(*) FILTER (WHERE "isBlocked" = false AND "anonymizedAt" IS NULL AND total_visits >= 1)::int AS overall_with_visit,
        COUNT(*) FILTER (WHERE "isBlocked" = false AND "anonymizedAt" IS NULL AND total_visits >= 2)::int AS overall_repeat
      FROM period_flags
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        phone: string;
        visits: number;
        completed_value: string;
        last_visit_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        c."id",
        c."name",
        c."phone",
        COUNT(a."id")::int AS visits,
        COALESCE(SUM(a."price"), 0)::numeric(10,2)::text AS completed_value,
        MAX(a."startAt") AS last_visit_at
      FROM "Appointment" a
      JOIN "Client" c ON c."id" = a."clientId" AND c."companyId" = a."companyId"
      WHERE a."companyId" = ${companyId}::uuid
        AND a."deletedAt" IS NULL
        AND a."status" = 'COMPLETED'
        AND a."startAt" >= ${range.fromUtc}
        AND a."startAt" < ${range.toUtc}
        AND c."mergedAt" IS NULL
        AND c."anonymizedAt" IS NULL
        ${masterFilter}
      GROUP BY c."id", c."name", c."phone"
      ORDER BY COALESCE(SUM(a."price"), 0) DESC, COUNT(a."id") DESC, c."name" ASC
      LIMIT 10
    `),
    prisma.$queryRaw<
      Array<{
        tag_id: string;
        name: string;
        color: string;
        client_count: number;
        visits_in_period: number;
        completed_value_in_period: string;
      }>
    >(Prisma.sql`
      SELECT
        t."id" AS tag_id,
        t."name",
        t."color",
        COUNT(DISTINCT c."id")::int AS client_count,
        COUNT(a."id")::int AS visits_in_period,
        COALESCE(SUM(a."price"), 0)::numeric(10,2)::text AS completed_value_in_period
      FROM "ClientTag" t
      LEFT JOIN "ClientTagAssignment" cta
        ON cta."tagId" = t."id" AND cta."companyId" = t."companyId"
      LEFT JOIN "Client" c
        ON c."id" = cta."clientId" AND c."companyId" = cta."companyId" AND c."mergedAt" IS NULL
      LEFT JOIN "Appointment" a
        ON a."companyId" = c."companyId"
        AND a."clientId" = c."id"
        AND a."deletedAt" IS NULL
        AND a."status" = 'COMPLETED'
        AND a."startAt" >= ${range.fromUtc}
        AND a."startAt" < ${range.toUtc}
        ${masterFilter}
      WHERE t."companyId" = ${companyId}::uuid
      GROUP BY t."id", t."name", t."color"
      ORDER BY lower(t."name") ASC, t."createdAt" ASC
    `),
  ]);

  const topClientIds = topClientRows.map((r) => r.id);
  const topClientTags =
    topClientIds.length > 0
      ? await prisma.clientTagAssignment.findMany({
          where: { companyId, clientId: { in: topClientIds } },
          include: { tag: { select: { id: true, name: true, color: true } } },
          orderBy: { tag: { name: 'asc' } },
        })
      : [];
  const topTagsMap = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const row of topClientTags) {
    const arr = topTagsMap.get(row.clientId) ?? [];
    arr.push(row.tag);
    topTagsMap.set(row.clientId, arr);
  }

  const seg = segmentRows[0];
  const ret = retentionRows[0];
  const prior = ret?.prior_clients ?? 0;
  const retained = ret?.retained_clients ?? 0;
  const withVisit = ret?.overall_with_visit ?? 0;
  const repeat = ret?.overall_repeat ?? 0;

  return {
    period: { from: range.fromDate, to: range.toDate, timezone: range.timezone },
    revenueBasis: 'COMPLETED_VISITS_ESTIMATE' as const,
    segments: {
      totalActive: seg?.total_active ?? 0,
      newClients: seg?.new_clients ?? 0,
      repeatClients: seg?.repeat_clients ?? 0,
      vipClients: seg?.vip_clients ?? 0,
      atRiskClients: seg?.at_risk_clients ?? 0,
      lostClients: seg?.lost_clients ?? 0,
      noShowRiskClients: seg?.no_show_risk_clients ?? 0,
      blockedClients: seg?.blocked_clients ?? 0,
    },
    retentionRate: prior > 0 ? Math.round((retained / prior) * 1000) / 10 : 0,
    repeatRate: withVisit > 0 ? Math.round((repeat / withVisit) * 1000) / 10 : 0,
    topClients: topClientRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      visits: c.visits,
      completedValue: Number(c.completed_value).toFixed(2),
      lastVisitAt: c.last_visit_at ? c.last_visit_at.toISOString() : null,
      tags: topTagsMap.get(c.id) ?? [],
    })),
    byTag: tagRows.map((t) => ({
      tagId: t.tag_id,
      name: t.name,
      color: t.color,
      clientCount: t.client_count,
      visitsInPeriod: t.visits_in_period,
      completedValueInPeriod: Number(t.completed_value_in_period).toFixed(2),
    })),
  };
}
