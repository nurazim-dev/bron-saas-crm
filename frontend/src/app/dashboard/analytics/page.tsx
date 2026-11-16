'use client';

import { BarChart3, Download, Lock } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AnalyticsHeatmapCellDto,
  type AnalyticsMasterRowDto,
  type AnalyticsServiceRowDto,
  type AnalyticsSummaryDto,
  type AnalyticsTimeseriesDto,
  downloadAppointmentsCsv,
  getAnalyticsHeatmap,
  getAnalyticsMasters,
  getAnalyticsServices,
  getAnalyticsSummary,
  getAnalyticsTimeseries,
} from '@/lib/api/analytics.api';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api/client';
import { listStaff } from '@/lib/api/staff.api';
import { addDaysToLocalDateInTz, getTodayLocalDateInTz } from '@/lib/datetime';
import { formatPriceKgs } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { StaffDto } from '@/types/api';

type PresetKey = 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HEATMAP_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function formatDelta(pct: number | null, suffix = '%'): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}${suffix}`;
}

function AnalyticsContent() {
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';
  const today = useMemo(() => getTodayLocalDateInTz(timezone), [timezone]);

  const [preset, setPreset] = useState<PresetKey>('30d');
  const [fromDate, setFromDate] = useState(() => addDaysToLocalDateInTz(today, -29, timezone));
  const [toDate, setToDate] = useState(() => today);
  const [masterId, setMasterId] = useState<string>('ALL');
  const [staffList, setStaffList] = useState<StaffDto[]>([]);

  const [summary, setSummary] = useState<AnalyticsSummaryDto | null>(null);
  const [timeseries, setTimeseries] = useState<AnalyticsTimeseriesDto | null>(null);
  const [services, setServices] = useState<AnalyticsServiceRowDto[]>([]);
  const [masters, setMasters] = useState<AnalyticsMasterRowDto[]>([]);
  const [heatmap, setHeatmap] = useState<AnalyticsHeatmapCellDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlanLocked, setIsPlanLocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    void listStaff()
      .then((list) => setStaffList(list.filter((s) => s.isBookable)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setErrorMsg(null);
      setIsPlanLocked(false);
      const params = {
        from: fromDate,
        to: toDate,
        ...(masterId !== 'ALL' ? { masterId } : {}),
      };
      try {
        const [sumRes, tsRes, svcRes, mstRes, heatRes] = await Promise.all([
          getAnalyticsSummary(params),
          getAnalyticsTimeseries({ ...params, granularity: 'day' }),
          getAnalyticsServices(params),
          getAnalyticsMasters(params),
          getAnalyticsHeatmap(params),
        ]);
        if (!cancelled) {
          setSummary(sumRes);
          setTimeseries(tsRes);
          setServices(svcRes);
          setMasters(mstRes);
          setHeatmap(heatRes);
        }
      } catch (err) {
        if (!cancelled) {
          if (getApiErrorCode(err) === 'FEATURE_NOT_IN_PLAN') {
            setIsPlanLocked(true);
          } else {
            setErrorMsg(getApiErrorMessage(err));
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fromDate, masterId, toDate]);

  function applyPreset(next: PresetKey) {
    setPreset(next);
    const nowDt = DateTime.fromISO(today, { zone: timezone });
    if (next === 'today') {
      setFromDate(today);
      setToDate(today);
    } else if (next === '7d') {
      setFromDate(addDaysToLocalDateInTz(today, -6, timezone));
      setToDate(today);
    } else if (next === '30d') {
      setFromDate(addDaysToLocalDateInTz(today, -29, timezone));
      setToDate(today);
    } else if (next === 'this_month') {
      setFromDate(nowDt.startOf('month').toISODate() ?? today);
      setToDate(today);
    } else if (next === 'last_month') {
      const prev = nowDt.minus({ months: 1 });
      setFromDate(prev.startOf('month').toISODate() ?? today);
      setToDate(prev.endOf('month').toISODate() ?? today);
    }
  }

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      await downloadAppointmentsCsv({
        from: fromDate,
        to: toDate,
        ...(masterId !== 'ALL' ? { masterId } : {}),
      });
      toast.success('CSV-файл выгружен');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  const chartData = useMemo(
    () =>
      (timeseries?.points ?? []).map((p) => ({
        date: p.date.slice(5),
        revenue: Number(p.revenue),
        total: p.total,
      })),
    [timeseries],
  );

  const heatmapMap = useMemo(() => {
    const map = new Map<string, number>();
    let maxCount = 0;
    for (const cell of heatmap) {
      map.set(`${cell.weekday}:${cell.hour}`, cell.count);
      if (cell.count > maxCount) maxCount = cell.count;
    }
    return { map, maxCount };
  }, [heatmap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="h-6 w-6 text-primary" aria-hidden="true" />
            Аналитика
          </h1>
          <p className="text-sm text-muted-foreground">
            Выручка, загрузка мастеров, популярные услуги и пиковые часы.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isExporting}
          onClick={() => void handleExportCsv()}
          className="min-h-11 gap-2 self-start sm:self-auto"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {isExporting ? 'Экспорт...' : 'Экспорт CSV'}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['today', 'Сегодня'],
                ['7d', '7 дней'],
                ['30d', '30 дней'],
                ['this_month', 'Этот месяц'],
                ['last_month', 'Прошлый месяц'],
                ['custom', 'Свой период'],
              ] as Array<[PresetKey, string]>
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={preset === key ? 'default' : 'outline'}
                onClick={() => applyPreset(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {preset === 'custom' && (
              <>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 w-36"
                />
                <span className="text-xs text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 w-36"
                />
              </>
            )}
            <select
              aria-label="Фильтр по мастеру"
              value={masterId}
              onChange={(e) => setMasterId(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="ALL">Все мастера</option>
              {staffList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {isPlanLocked ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-5 w-5 text-amber-600" aria-hidden="true" />
              Аналитика доступна на тарифах «Бизнес» и «Про»
            </CardTitle>
            <CardDescription>
              Перейдите на старший тариф, чтобы видеть динамику выручки, загрузку мастеров и
              тепловую карту. Экспорт CSV доступен всегда.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/billing">Перейти к тарифам</Link>
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : errorMsg ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Ошибка загрузки аналитики</CardTitle>
            <CardDescription>{errorMsg}</CardDescription>
          </CardHeader>
        </Card>
      ) : summary ? (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Выручка (завершённые)</CardDescription>
                <CardTitle className="text-2xl">{formatPriceKgs(summary.revenue)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                К прошлому периоду: {formatDelta(summary.deltas.revenuePct)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Всего записей</CardDescription>
                <CardTitle className="text-2xl">{summary.counts.total}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Завершено: {summary.counts.completed} • Дельта:{' '}
                {formatDelta(summary.deltas.totalPct)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Средний чек</CardDescription>
                <CardTitle className="text-2xl">{formatPriceKgs(summary.averageTicket)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Предоплат получено: {formatPriceKgs(summary.prepaymentsReceived)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Неявки (No-show)</CardDescription>
                <CardTitle className="text-2xl">{summary.noShowRate}%</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Онлайн: {summary.sources.online} • Персонал: {summary.sources.staff}
              </CardContent>
            </Card>
          </div>

          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Динамика выручки</CardTitle>
              <CardDescription>По дням в часовом поясе компании ({timezone})</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  За выбранный период записей нет
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Bar
                      dataKey="revenue"
                      name="Выручка (сом)"
                      fill="currentColor"
                      className="fill-primary"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Services & Masters */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Топ услуг</CardTitle>
              </CardHeader>
              <CardContent>
                {services.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет данных</p>
                ) : (
                  <div className="divide-y text-sm">
                    {services.slice(0, 8).map((s) => (
                      <div key={s.serviceId} className="flex items-center justify-between py-2">
                        <div>
                          <div className="font-medium">{s.serviceName}</div>
                          <div className="text-xs text-muted-foreground">
                            Записей: {s.total} (завершено {s.completed})
                          </div>
                        </div>
                        <div className="font-semibold">{formatPriceKgs(s.revenue)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Мастера и загрузка</CardTitle>
              </CardHeader>
              <CardContent>
                {masters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет данных</p>
                ) : (
                  <div className="divide-y text-sm">
                    {masters.map((m) => (
                      <div key={m.masterId} className="flex items-center justify-between py-2">
                        <div>
                          <div className="font-medium">{m.masterName}</div>
                          <div className="text-xs text-muted-foreground">
                            Завершено: {m.completed} • Неявки: {m.noShow}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary">{m.utilizationPct}%</Badge>
                          <span className="font-semibold">{formatPriceKgs(m.revenue)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Heatmap */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Тепловая карта записи (дни недели × часы)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <div className="min-w-[540px] space-y-1 text-xs">
                <div className="grid grid-cols-13 gap-1 text-center text-muted-foreground">
                  <div />
                  {HEATMAP_HOURS.map((h) => (
                    <div key={h}>{h}:00</div>
                  ))}
                </div>
                {WEEKDAYS.map((dayLabel, idx) => {
                  const weekday = idx + 1;
                  return (
                    <div key={dayLabel} className="grid grid-cols-13 items-center gap-1">
                      <div className="font-medium text-muted-foreground">{dayLabel}</div>
                      {HEATMAP_HOURS.map((h) => {
                        const count = heatmapMap.map.get(`${weekday}:${h}`) ?? 0;
                        const intensity = heatmapMap.maxCount > 0 ? count / heatmapMap.maxCount : 0;
                        return (
                          <div
                            key={h}
                            title={`${dayLabel} ${h}:00 — ${count}`}
                            className="flex h-7 items-center justify-center rounded border text-[11px]"
                            style={{
                              backgroundColor:
                                count > 0
                                  ? `rgba(16, 185, 129, ${0.15 + intensity * 0.7})`
                                  : undefined,
                            }}
                          >
                            {count > 0 ? count : ''}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function DashboardAnalyticsPage() {
  return (
    <OwnerGuard>
      <AnalyticsContent />
    </OwnerGuard>
  );
}
