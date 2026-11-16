'use client';

import { AlertCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { type AdminCompanyListItem, listAdminCompanies } from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import type { BusinessType, SubscriptionStatus } from '@/types/api';

function AdminCompaniesContent() {
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get('status') as SubscriptionStatus | null) ?? '';

  const [items, setItems] = useState<AdminCompanyListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>(initialStatus);
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAdminCompanies({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status ? { status } : {}),
      ...(businessType ? { businessType } : {}),
      includeDeleted,
      page,
      limit: 20,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.meta.total);
        setError(null);
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
  }, [search, status, businessType, includeDeleted, page]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Компании</h1>
        <p className="text-sm text-muted-foreground">
          Поиск, фильтрация и управление тенантами платформы.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Название, slug или email владельца"
              className="pl-9"
            />
          </div>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SubscriptionStatus | '');
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все статусы подписки</option>
            <option value="TRIAL">TRIAL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAST_DUE">PAST_DUE</option>
            <option value="LOCKED">LOCKED</option>
          </select>

          <select
            value={businessType}
            onChange={(e) => {
              setBusinessType(e.target.value as BusinessType | '');
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все типы бизнеса</option>
            <option value="BARBERSHOP">Барбершоп</option>
            <option value="BEAUTY_SALON">Салон красоты</option>
          </select>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => {
                setIncludeDeleted(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4"
            />
            <span>Показывать удалённые</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 py-8 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Компании не найдены</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Компания</th>
                    <th className="py-2 pr-4">Тип</th>
                    <th className="py-2 pr-4">Владелец</th>
                    <th className="py-2 pr-4">Тариф / Статус</th>
                    <th className="py-2 pr-4">Записи / Штат</th>
                    <th className="py-2">Состояние</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/admin/companies/${c.id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">/{c.slug}</div>
                      </td>
                      <td className="py-3 pr-4 text-xs">{ru.businessTypes[c.businessType]}</td>
                      <td className="py-3 pr-4 text-xs">
                        <div>{c.owner?.name ?? '—'}</div>
                        <div className="text-muted-foreground">{c.owner?.email ?? '—'}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {c.subscription ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline">{c.subscription.plan.name}</Badge>
                            <Badge
                              variant={
                                c.subscription.state === 'LOCKED' ? 'destructive' : 'secondary'
                              }
                            >
                              {c.subscription.state}
                            </Badge>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {c.counts.appointments} / {c.counts.staff}
                      </td>
                      <td className="py-3">
                        {c.deletedAt ? (
                          <Badge variant="destructive">Удалена</Badge>
                        ) : c.suspendedAt ? (
                          <Badge variant="destructive">Заблокирована</Badge>
                        ) : (
                          <Badge variant="outline">Активна</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4 text-xs">
              <span>
                Страница {page} из {totalPages} (всего {total})
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Назад
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Вперёд
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminCompaniesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AdminCompaniesContent />
    </Suspense>
  );
}
