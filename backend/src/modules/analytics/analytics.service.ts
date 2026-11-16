import { DateTime } from 'luxon';
import { AppointmentStatus, Prisma } from '../../generated/prisma/client.js';
import { addDaysToLocalDate, localDateTimeToUtc, utcToLocalParts } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AnalyticsRangeQuery, AnalyticsTimeseriesQuery } from './analytics.schemas.js';

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
      COUNT(*) FILTER (WHERE a."status" = 'SCHEDULED')::int AS scheduled_count,
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
    SELECT
      s."id" AS service_id,
      s."name" AS service_name,
      COALESCE(SUM(CASE WHEN a."status" = 'COMPLETED' THEN a."price" ELSE 0 END), 0)::text AS revenue,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a."status" = 'COMPLETED')::int AS completed
    FROM "Appointment" a
    JOIN "Service" s ON s."id" = a."serviceId"
    WHERE a."companyId" = ${companyId}::uuid
      AND a."deletedAt" IS NULL
      AND a."startAt" >= ${range.fromUtc}
      AND a."startAt" < ${range.toUtc}
      ${masterFilter}
    GROUP BY s."id", s."name"
    ORDER BY SUM(CASE WHEN a."status" = 'COMPLETED' THEN a."price" ELSE 0 END) DESC, COUNT(*) DESC
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
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
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

export function escapeCsvCell(raw: string | number | null | undefined): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
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
