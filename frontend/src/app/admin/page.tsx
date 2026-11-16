'use client';

import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CreditCard,
  MailWarning,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AdminOverviewMetricsDto,
  getAdminOverviewMetrics,
  getAdminSignupsSeries,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { formatPriceKgs } from '@/lib/i18n/ru';

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<AdminOverviewMetricsDto | null>(null);
  const [signups, setSignups] = useState<Array<{ date: string; count: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getAdminOverviewMetrics(), getAdminSignupsSeries(14)])
      .then(([m, s]) => {
        if (cancelled) return;
        setMetrics(m);
        setSignups(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">
          {error ?? 'Не удалось загрузить метрики'}
        </CardContent>
      </Card>
    );
  }

  const maxSignup = Math.max(1, ...signups.map((s) => s.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Обзор платформы</h1>
        <p className="text-sm text-muted-foreground">
          Ключевые показатели SaaS, регистрации и задачи, требующие внимания.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Компании</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalCompanies}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              +{metrics.signups7d} за 7 дн. • +{metrics.signups30d} за 30 дн.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              MRR (Active)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPriceKgs(metrics.mrr)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Оплачено за месяц: {formatPriceKgs(metrics.confirmedPaymentsThisMonth.amount)} (
              {metrics.confirmedPaymentsThisMonth.count})
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Записи (30 дн.)
            </CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.appointmentsLast30d}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Trial: {metrics.companiesByState.TRIAL} • Active: {metrics.companiesByState.ACTIVE}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Требуют внимания
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span>Заявки на оплату:</span>
              <Badge variant={metrics.pendingPaymentsCount > 0 ? 'destructive' : 'secondary'}>
                {metrics.pendingPaymentsCount}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Ошибки Outbox:</span>
              <Badge variant={metrics.failedOutboxCount > 0 ? 'destructive' : 'secondary'}>
                {metrics.failedOutboxCount}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Past Due / Locked:</span>
              <Badge variant="outline">
                {metrics.companiesByState.PAST_DUE} / {metrics.companiesByState.LOCKED}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Регистрации за последние 14 дней</CardTitle>
            <CardDescription>Новые компании по дням (UTC)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 items-end gap-1.5 pt-4">
              {signups.map((item) => {
                const heightPct = Math.max(4, Math.round((item.count / maxSignup) * 100));
                return (
                  <div
                    key={item.date}
                    className="flex flex-1 flex-col items-center gap-1"
                    title={`${item.date}: ${item.count}`}
                  >
                    <span className="text-[10px] text-muted-foreground">{item.count}</span>
                    <div
                      className="w-full rounded-t bg-primary/80 transition-all"
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground">{item.date.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Быстрые действия</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/payments">
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Очередь платежей
                </span>
                <Badge>{metrics.pendingPaymentsCount}</Badge>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/outbox?status=FAILED">
                <span className="flex items-center gap-2">
                  <MailWarning className="h-4 w-4" />
                  Ошибки отправки
                </span>
                <Badge variant={metrics.failedOutboxCount > 0 ? 'destructive' : 'secondary'}>
                  {metrics.failedOutboxCount}
                </Badge>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/companies?status=PAST_DUE">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Компании в Grace
                </span>
                <Badge variant="outline">{metrics.companiesByState.PAST_DUE}</Badge>
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/companies?status=LOCKED">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Заблокированные (Locked)
                </span>
                <Badge variant="outline">{metrics.companiesByState.LOCKED}</Badge>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
