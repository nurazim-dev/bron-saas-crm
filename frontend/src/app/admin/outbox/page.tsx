'use client';

import { AlertCircle, RotateCcw, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AdminOutboxItem,
  cancelAdminOutbox,
  listAdminOutbox,
  retryAdminOutbox,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';

function AdminOutboxContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') ?? '';

  const [status, setStatus] = useState(initialStatus);
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminOutboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const loadOutbox = useCallback(async () => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAdminOutbox({
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
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
  }, [status, channel, page, reloadTick]);

  async function handleRetry(id: string) {
    setIsSubmitting(true);
    try {
      await retryAdminOutbox(id);
      toast.success('Сообщение поставлено в очередь повторно');
      await loadOutbox();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    setIsSubmitting(true);
    try {
      await cancelAdminOutbox(id);
      toast.success('Сообщение отменено');
      await loadOutbox();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Очередь уведомлений (Outbox)</h1>
        <p className="text-sm text-muted-foreground">
          Мониторинг отправки Email, Telegram и WhatsApp сообщений.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все статусы</option>
            <option value="PENDING">PENDING</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="SENT">SENT</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>

          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все каналы</option>
            <option value="EMAIL">EMAIL</option>
            <option value="TELEGRAM">TELEGRAM</option>
            <option value="WHATSAPP_AUTO">WHATSAPP_AUTO</option>
          </select>
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
          <CardTitle className="text-base">Сообщений: {total}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Сообщений нет.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.channel}</Badge>
                      <Badge
                        variant={
                          item.status === 'FAILED'
                            ? 'destructive'
                            : item.status === 'SENT'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {item.status}
                      </Badge>
                      <span className="font-medium">{item.kind}</span>
                      <span className="text-xs text-muted-foreground">→ {item.recipient}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Попытки: {item.attempts}/{item.maxAttempts} • Запланировано:{' '}
                      {new Date(item.scheduledFor).toLocaleString('ru-RU')}
                    </div>
                    {item.lastError && (
                      <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                        {item.lastError}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {(item.status === 'FAILED' || item.status === 'CANCELLED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetry(item.id)}
                        disabled={isSubmitting}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Повторить
                      </Button>
                    )}
                    {(item.status === 'PENDING' || item.status === 'FAILED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancel(item.id)}
                        disabled={isSubmitting}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Отменить
                      </Button>
                    )}
                  </div>
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

export default function AdminOutboxPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AdminOutboxContent />
    </Suspense>
  );
}
