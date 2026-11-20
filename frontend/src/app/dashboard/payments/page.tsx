'use client';

import { AlertCircle, Check, FileText, Plus, Upload, Wallet, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getApiErrorMessage } from '@/lib/api/client';
import {
  type BusinessPaymentDto,
  type BusinessPaymentKind,
  type BusinessPaymentStatus,
  type BusinessPaymentsSummaryDto,
  confirmBusinessPayment,
  createBusinessPayment,
  fetchBusinessPaymentProofBlob,
  getBusinessPaymentsSummary,
  listBusinessPayments,
  rejectBusinessPayment,
  uploadBusinessPaymentProof,
} from '@/lib/api/payments.api';
import { addDaysToLocalDateInTz, getTodayLocalDateInTz } from '@/lib/datetime';
import { formatPriceKgs } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { PaymentMethod } from '@/types/api';

type RangePreset = '7d' | '30d' | 'this_month';

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Наличные' },
  { value: 'MBANK', label: 'MBank' },
  { value: 'OPTIMA', label: 'Optima Bank' },
  { value: 'DEMIR', label: 'DemirBank' },
  { value: 'BAKAI', label: 'Bakai Bank' },
  { value: 'ELCART', label: 'Элкарт' },
  { value: 'BANK_TRANSFER', label: 'Банковский перевод' },
  { value: 'OTHER', label: 'Другое' },
];

const KIND_LABELS: Record<BusinessPaymentKind, string> = {
  PAYMENT: 'Оплата',
  PREPAYMENT: 'Предоплата',
  REFUND: 'Возврат',
};

const STATUS_LABELS: Record<BusinessPaymentStatus, string> = {
  PENDING: 'На проверке',
  CONFIRMED: 'Подтверждён',
  REJECTED: 'Отклонён',
  VOIDED: 'Аннулирован',
};

function PaymentsContent() {
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';
  const today = useMemo(() => getTodayLocalDateInTz(timezone), [timezone]);

  const [preset, setPreset] = useState<RangePreset>('30d');
  const [fromDate, setFromDate] = useState(() => addDaysToLocalDateInTz(today, -29, timezone));
  const [toDate, setToDate] = useState(() => today);
  const [statusFilter, setStatusFilter] = useState<BusinessPaymentStatus | 'ALL'>('ALL');
  const [reloadTick, setReloadTick] = useState(0);

  const [summary, setSummary] = useState<BusinessPaymentsSummaryDto | null>(null);
  const [items, setItems] = useState<BusinessPaymentDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Create payment dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<BusinessPaymentKind>('PAYMENT');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('MBANK');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirmImmediately, setConfirmImmediately] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<BusinessPaymentDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const triggerReload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  function applyPreset(next: RangePreset) {
    setPreset(next);
    if (next === '7d') {
      setFromDate(addDaysToLocalDateInTz(today, -6, timezone));
      setToDate(today);
    } else if (next === '30d') {
      setFromDate(addDaysToLocalDateInTz(today, -29, timezone));
      setToDate(today);
    } else {
      const dt = DateTime.fromISO(today, { zone: timezone });
      setFromDate(dt.startOf('month').toISODate() ?? today);
      setToDate(today);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getBusinessPaymentsSummary({ from: fromDate, to: toDate }),
      listBusinessPayments({
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
        from: fromDate,
        to: toDate,
        limit: 50,
      }),
    ])
      .then(([sumRes, listRes]) => {
        if (cancelled) return;
        setSummary(sumRes);
        setItems(listRes.items);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, statusFilter, reloadTick]);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const trimmed = amount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed) || Number(trimmed) <= 0) {
      setCreateError('Укажите положительную сумму в сомах');
      return;
    }

    setIsCreating(true);
    try {
      await createBusinessPayment({
        kind,
        amount: trimmed,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
        confirmImmediately,
      });
      toast.success(
        confirmImmediately ? 'Платёж проведён и подтверждён' : 'Запись о платеже создана',
      );
      setAmount('');
      setReference('');
      setNote('');
      setConfirmImmediately(false);
      setCreateOpen(false);
      triggerReload();
    } catch (err) {
      setCreateError(getApiErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleConfirm(id: string) {
    setActionBusyId(id);
    try {
      await confirmBusinessPayment(id);
      toast.success('Платёж подтверждён');
      triggerReload();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleRejectSubmit() {
    if (!rejectTarget || rejectReason.trim().length < 3) {
      toast.error('Укажите причину отклонения (от 3 символов)');
      return;
    }
    setActionBusyId(rejectTarget.id);
    try {
      await rejectBusinessPayment(rejectTarget.id, rejectReason.trim());
      toast.success('Платёж отклонён');
      setRejectTarget(null);
      setRejectReason('');
      triggerReload();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleUploadProof(paymentId: string, file: File) {
    setActionBusyId(paymentId);
    try {
      await uploadBusinessPaymentProof(paymentId, file);
      toast.success('Чек прикреплён (статус платежа ожидает ручного подтверждения)');
      triggerReload();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleOpenProof(paymentId: string, proofId: string) {
    try {
      const blob = await fetchBusinessPaymentProofBlob(paymentId, proofId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Wallet className="h-6 w-6 text-primary" aria-hidden="true" />
            Журнал платежей
          </h1>
          <p className="text-sm text-muted-foreground">
            Ручной учёт оплат, предоплат и возвратов с приватными чеками. Загрузка чека не
            подтверждает оплату автоматически.
          </p>
        </div>

        <Button
          onClick={() => setCreateOpen(true)}
          className="min-h-11 gap-2 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Добавить платёж
        </Button>
      </div>

      {/* Period presets & status filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['7d', '7 дней'],
              ['30d', '30 дней'],
              ['this_month', 'Этот месяц'],
            ] as Array<[RangePreset, string]>
          ).map(([val, label]) => (
            <Button
              key={val}
              type="button"
              size="sm"
              variant={preset === val ? 'default' : 'outline'}
              onClick={() => applyPreset(val)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['ALL', 'Все'],
              ['PENDING', 'На проверке'],
              ['CONFIRMED', 'Подтверждены'],
              ['REJECTED', 'Отклонены'],
            ] as const
          ).map(([val, label]) => (
            <Button
              key={val}
              type="button"
              size="sm"
              variant={statusFilter === val ? 'default' : 'outline'}
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Подтверждённые поступления (нетто)</CardDescription>
              <CardTitle data-testid="net-confirmed-revenue" className="text-2xl">
                {formatPriceKgs(summary.netConfirmedRevenue)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Поступления: {formatPriceKgs(summary.confirmedPayments)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Подтверждённые возвраты</CardDescription>
              <CardTitle className="text-2xl">{formatPriceKgs(summary.confirmedRefunds)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Учтено в нетто</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ожидают проверки</CardDescription>
              <CardTitle className="text-2xl">{formatPriceKgs(summary.pendingAmount)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Заявок: {summary.pendingCount} (не включены в выручку)
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Оценка по завершённым визитам</CardDescription>
              <CardTitle className="text-2xl">
                {formatPriceKgs(summary.completedAppointmentsEstimate)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Справочно по прайсу записей
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Операции ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Платежей за выбранный период нет.
            </p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Дата</th>
                    <th className="py-2 pr-4">Тип / Детали</th>
                    <th className="py-2 pr-4">Способ</th>
                    <th className="py-2 pr-4">Сумма</th>
                    <th className="py-2 pr-4">Статус</th>
                    <th className="py-2 pr-4">Чеки</th>
                    <th className="py-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const busy = actionBusyId === p.id;
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                          {p.createdAt.slice(0, 10)}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {KIND_LABELS[p.kind]}
                            </Badge>
                            {p.client && <span className="font-medium">{p.client.name}</span>}
                          </div>
                          {p.appointment && (
                            <div className="text-xs text-muted-foreground">
                              {p.appointment.serviceName}
                            </div>
                          )}
                          {p.reference && (
                            <div className="text-xs text-muted-foreground">Реф: {p.reference}</div>
                          )}
                          {p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}
                          {p.rejectReason && (
                            <div className="text-xs text-destructive">
                              Причина: {p.rejectReason}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs">{p.method}</td>
                        <td className="py-3 pr-4 font-semibold whitespace-nowrap">
                          {p.kind === 'REFUND' ? '−' : ''}
                          {formatPriceKgs(p.amount)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant={
                              p.status === 'CONFIRMED'
                                ? 'default'
                                : p.status === 'REJECTED'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {STATUS_LABELS[p.status]}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.proofs.map((proof) => (
                              <Button
                                key={proof.id}
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => void handleOpenProof(p.id, proof.id)}
                                className="gap-1"
                              >
                                <FileText className="h-3 w-3" aria-hidden="true" />
                                {proof.fileName.slice(0, 16)}
                              </Button>
                            ))}
                            {(p.status === 'PENDING' || p.status === 'CONFIRMED') && (
                              <label className="relative inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-muted">
                                <Upload className="h-3 w-3" aria-hidden="true" />
                                <span>Чек</span>
                                <input
                                  type="file"
                                  aria-label={`Загрузить чек для платежа ${p.amount}`}
                                  accept="image/jpeg,image/png,image/webp,application/pdf"
                                  disabled={busy}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (file) void handleUploadProof(p.id, file);
                                  }}
                                  className="sr-only left-0 top-0"
                                />
                              </label>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          {p.status === 'PENDING' ? (
                            <div className="inline-flex gap-1.5">
                              <Button
                                type="button"
                                size="xs"
                                disabled={busy}
                                onClick={() => void handleConfirm(p.id)}
                              >
                                <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                                Подтвердить
                              </Button>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  setRejectTarget(p);
                                  setRejectReason('');
                                }}
                              >
                                <X className="mr-1 h-3 w-3" aria-hidden="true" />
                                Отклонить
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create BusinessPayment Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Новый ручной платёж</DialogTitle>
            <DialogDescription>
              Оплаты учитываются в финансовом журнале после подтверждения.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {createError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{createError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="biz-pay-kind">Тип операции</Label>
                <select
                  id="biz-pay-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as BusinessPaymentKind)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="PAYMENT">Оплата услуг</option>
                  <option value="PREPAYMENT">Предоплата</option>
                  <option value="REFUND">Возврат</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="biz-pay-method">Способ</Label>
                <select
                  id="biz-pay-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="biz-pay-amount">Сумма (сом)</Label>
              <Input
                id="biz-pay-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
                className="min-h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="biz-pay-ref">Номер квитанции / референс (необязательно)</Label>
              <Input
                id="biz-pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="TX-12345"
                className="min-h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="biz-pay-note">Комментарий (необязательно)</Label>
              <Input
                id="biz-pay-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Частичная оплата наличными"
                className="min-h-10"
              />
            </div>

            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
              <input
                id="biz-pay-confirm"
                type="checkbox"
                checked={confirmImmediately}
                onChange={(e) => setConfirmImmediately(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>Подтвердить сразу при создании</span>
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? 'Сохраняем...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={Boolean(rejectTarget)} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Отклонить платёж</DialogTitle>
            <DialogDescription>
              Укажите причину отклонения (будет сохранена в аудите).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="biz-pay-reject-reason">Причина</Label>
            <Input
              id="biz-pay-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Чек не найден или не совпадает сумма"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleRejectSubmit()}
              disabled={actionBusyId === rejectTarget?.id}
            >
              Подтвердить отказ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DashboardPaymentsPage() {
  return (
    <OwnerGuard>
      <PaymentsContent />
    </OwnerGuard>
  );
}
