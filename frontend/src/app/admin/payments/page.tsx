'use client';

import { AlertCircle, Check, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AdminPaymentItem,
  confirmAdminPayment,
  fetchAdminSubscriptionProofBlob,
  listAdminPayments,
  rejectAdminPayment,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import type { PaymentStatus } from '@/types/api';

export default function AdminPaymentsPage() {
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | ''>('PENDING');
  const [items, setItems] = useState<AdminPaymentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [confirmTarget, setConfirmTarget] = useState<AdminPaymentItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminPaymentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadPayments = useCallback(async () => {
    setReloadTick((t) => t + 1);
  }, []);

  async function handleOpenProof(paymentId: string, proofId: string) {
    try {
      const blob = await fetchAdminSubscriptionProofBlob(paymentId, proofId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void listAdminPayments({
      ...(statusFilter ? { status: statusFilter } : {}),
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
  }, [statusFilter, page, reloadTick]);

  async function handleConfirm() {
    if (!confirmTarget) return;
    setIsSubmitting(true);
    try {
      await confirmAdminPayment(confirmTarget.id);
      toast.success('Платёж подтверждён, подписка продлена');
      setConfirmTarget(null);
      await loadPayments();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReject() {
    if (!rejectTarget || !rejectReason.trim()) return;
    setIsSubmitting(true);
    try {
      await rejectAdminPayment(rejectTarget.id, rejectReason.trim());
      toast.success('Платёж отклонён');
      setRejectTarget(null);
      setRejectReason('');
      await loadPayments();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Платежи и заявки</h1>
          <p className="text-sm text-muted-foreground">
            Проверка заявок на продление и история всех платежей.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['PENDING', 'Ожидают проверки'],
              ['CONFIRMED', 'Подтверждённые'],
              ['REJECTED', 'Отклонённые'],
              ['', 'Все'],
            ] as const
          ).map(([val, label]) => (
            <Button
              key={val || 'all'}
              size="sm"
              variant={statusFilter === val ? 'default' : 'outline'}
              onClick={() => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Найдено: {total}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Платежей с таким статусом нет.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Компания</th>
                    <th className="py-2 pr-4">Тариф</th>
                    <th className="py-2 pr-4">Сумма</th>
                    <th className="py-2 pr-4">Референс / Комментарий</th>
                    <th className="py-2 pr-4">Статус</th>
                    <th className="py-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/admin/companies/${p.company.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.company.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleString('ru-RU')}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {p.plan.name} ({p.months} мес.)
                      </td>
                      <td className="py-3 pr-4 font-semibold">
                        {p.amount} {p.currency}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        <div>{p.reference ?? '—'}</div>
                        {p.comment && <div>{p.comment}</div>}
                        {p.rejectReason && (
                          <div className="text-destructive">Причина: {p.rejectReason}</div>
                        )}
                        {(p.proofs ?? []).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(p.proofs ?? []).map((proof) => (
                              <Button
                                key={proof.id}
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => void handleOpenProof(p.id, proof.id)}
                              >
                                <FileText className="mr-1 h-3 w-3" aria-hidden="true" />
                                {proof.fileName}
                              </Button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={
                            p.status === 'CONFIRMED'
                              ? 'secondary'
                              : p.status === 'REJECTED'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        {p.status === 'PENDING' ? (
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => setConfirmTarget(p)}
                              disabled={isSubmitting}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Подтвердить
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectTarget(p);
                                setRejectReason('');
                              }}
                              disabled={isSubmitting}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Отклонить
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      <Dialog
        open={Boolean(confirmTarget)}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтвердить платёж?</DialogTitle>
            <DialogDescription>
              Компания: {confirmTarget?.company.name} • {confirmTarget?.amount}{' '}
              {confirmTarget?.currency} ({confirmTarget?.months} мес.). Подписка будет автоматически
              продлена.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              Отмена
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить платёж</DialogTitle>
            <DialogDescription>
              Укажите причину отклонения для владельца компании.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Причина</Label>
            <Input
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Чек не найден / неверная сумма"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || isSubmitting}
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
