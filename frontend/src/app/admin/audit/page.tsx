'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { type AdminAuditItem, listAdminAudit } from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';

export default function AdminAuditPage() {
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminAuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAdminAudit({
      ...(actorType ? { actorType } : {}),
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(companyId.trim() ? { companyId: companyId.trim() } : {}),
      page,
      limit: 30,
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
  }, [actorType, action, companyId, page]);

  const totalPages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Журнал аудита</h1>
        <p className="text-sm text-muted-foreground">
          Неизменяемый лог административных действий и событий безопасности.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
          <select
            value={actorType}
            onChange={(e) => {
              setActorType(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все акторы</option>
            <option value="ADMIN">ADMIN</option>
            <option value="USER">USER</option>
            <option value="SYSTEM">SYSTEM</option>
          </select>
          <Input
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="Действие (напр. company.suspend)"
          />
          <Input
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setPage(1);
            }}
            placeholder="ID компании (UUID)"
          />
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Событий: {total}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Записей нет.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.actorType}</Badge>
                      <span className="font-semibold">{item.action}</span>
                      {item.entityType && (
                        <span className="text-muted-foreground">
                          {item.entityType} {item.entityId ? `(${item.entityId.slice(0, 8)}…)` : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString('ru-RU')}
                    </span>
                  </div>
                  {item.metadata != null && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                      {JSON.stringify(item.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Страница {page} из {totalPages}
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
