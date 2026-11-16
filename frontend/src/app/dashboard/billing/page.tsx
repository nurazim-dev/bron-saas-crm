'use client';

import {
  AlertCircle,
  Check,
  Clock,
  CreditCard,
  Loader2,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cancelPaymentClaim,
  createPaymentClaim,
  getBillingOverview,
  listBillingPayments,
  listBillingPlans,
} from '@/lib/api/billing.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { formatPriceKgs } from '@/lib/i18n/ru';
import type {
  BillingOverviewDto,
  PaymentMethod,
  PaymentStatus,
  PlanDto,
  SubscriptionPaymentDto,
  SubscriptionStatus,
} from '@/types/api';

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIAL: 'Пробный период',
  ACTIVE: 'Активна',
  PAST_DUE: 'Льготный период',
  LOCKED: 'Только чтение',
};

const SUBSCRIPTION_STATUS_VARIANT: Record<
  SubscriptionStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  TRIAL: 'secondary',
  ACTIVE: 'default',
  PAST_DUE: 'outline',
  LOCKED: 'destructive',
};

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'На проверке',
  CONFIRMED: 'Подтверждён',
  REJECTED: 'Отклонён',
  CANCELLED: 'Отменён',
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'MBANK', label: 'MBank' },
  { value: 'OPTIMA', label: 'Optima Bank' },
  { value: 'DEMIR', label: 'DemirBank' },
  { value: 'BAKAI', label: 'Bakai Bank' },
  { value: 'ELCART', label: 'Элкарт' },
  { value: 'BANK_TRANSFER', label: 'Банковский перевод' },
  { value: 'CASH', label: 'Наличные' },
  { value: 'OTHER', label: 'Другое' },
];

const MONTHS_OPTIONS: Array<1 | 3 | 6 | 12> = [1, 3, 6, 12];

function BillingContent() {
  const [overview, setOverview] = useState<BillingOverviewDto | null>(null);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [payments, setPayments] = useState<SubscriptionPaymentDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Claim modal state
  const [isClaimOpen, setIsClaimOpen] = useState(false);
  const [claimPlanId, setClaimPlanId] = useState('');
  const [claimMonths, setClaimMonths] = useState<1 | 3 | 6 | 12>(1);
  const [claimMethod, setClaimMethod] = useState<PaymentMethod>('MBANK');
  const [claimReference, setClaimReference] = useState('');
  const [claimComment, setClaimComment] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);
  const [isCancellingClaim, setIsCancellingClaim] = useState(false);

  async function loadAll() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [ov, pl, pay] = await Promise.all([
        getBillingOverview(),
        listBillingPlans(),
        listBillingPayments(1, 20),
      ]);
      setOverview(ov);
      setPlans(pl);
      setPayments(pay.items);
      if (!claimPlanId && pl.length > 0) {
        setClaimPlanId(ov.subscription.plan.id);
      }
    } catch (err) {
      setLoadError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getBillingOverview(), listBillingPlans(), listBillingPayments(1, 20)])
      .then(([ov, pl, pay]) => {
        if (cancelled) return;
        setOverview(ov);
        setPlans(pl);
        setPayments(pay.items);
        if (pl.length > 0) {
          setClaimPlanId((prev) => prev || ov.subscription.plan.id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function openClaimDialog(planId?: string) {
    setClaimPlanId(planId ?? overview?.subscription.plan.id ?? plans[0]?.id ?? '');
    setClaimMonths(1);
    setClaimMethod('MBANK');
    setClaimReference('');
    setClaimComment('');
    setClaimError(null);
    setIsClaimOpen(true);
  }

  async function handleSubmitClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!claimPlanId) return;
    setClaimError(null);
    setIsSubmittingClaim(true);
    try {
      await createPaymentClaim({
        planId: claimPlanId,
        months: claimMonths,
        method: claimMethod,
        ...(claimReference.trim() ? { reference: claimReference.trim() } : {}),
        ...(claimComment.trim() ? { comment: claimComment.trim() } : {}),
      });
      toast.success('Заявка на оплату отправлена на проверку');
      setIsClaimOpen(false);
      await loadAll();
    } catch (err) {
      setClaimError(getApiErrorMessage(err));
    } finally {
      setIsSubmittingClaim(false);
    }
  }

  async function handleCancelClaim(paymentId: string) {
    setIsCancellingClaim(true);
    try {
      await cancelPaymentClaim(paymentId);
      toast.success('Заявка на оплату отменена');
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsCancellingClaim(false);
    }
  }

  const selectedClaimPlan = plans.find((p) => p.id === claimPlanId) ?? overview?.subscription.plan;
  const calculatedClaimTotal = selectedClaimPlan
    ? Number(selectedClaimPlan.priceMonthly) * claimMonths
    : 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError || !overview) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{loadError ?? 'Не удалось загрузить данные'}</p>
          <Button variant="outline" onClick={() => void loadAll()}>
            Повторить
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { subscription, usage, pendingClaim, paymentInstructions } = overview;
  const usagePct = Math.min(100, Math.round((usage.activeStaffCount / usage.maxStaff) * 100));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Оплата и тариф</h1>
          <p className="text-sm text-muted-foreground">
            Управление подпиской компании, лимитами и историей платежей.
          </p>
        </div>
        {!pendingClaim && (
          <Button onClick={() => openClaimDialog()} className="min-h-11 gap-2">
            <CreditCard className="h-4 w-4" aria-hidden="true" />Я оплатил
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Текущий тариф: {subscription.plan.name}</CardTitle>
              <CardDescription>
                {formatPriceKgs(subscription.plan.priceMonthly)} / мес
              </CardDescription>
            </div>
            <Badge variant={SUBSCRIPTION_STATUS_VARIANT[subscription.state]}>
              {SUBSCRIPTION_STATUS_LABEL[subscription.state]}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Осталось дней</span>
              <span className="font-semibold">{subscription.daysLeft}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Окончание периода</span>
              <span className="font-medium">{subscription.periodEndsAt.slice(0, 10)}</span>
            </div>
            {subscription.state === 'PAST_DUE' && (
              <div className="flex items-center justify-between text-amber-700 dark:text-amber-300">
                <span>Льготный период до</span>
                <span className="font-semibold">{subscription.graceEndsAt.slice(0, 10)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Использование ресурсов</CardTitle>
            <CardDescription>Активные сотрудники (включая владельца)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Сотрудники
                </span>
                <span className="font-semibold">
                  {usage.activeStaffCount} / {usage.maxStaff}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${
                    usage.isOverStaffLimit ? 'bg-destructive' : 'bg-primary'
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              {usage.isOverStaffLimit && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Превышен лимит тарифа. Добавление новых сотрудников заблокировано.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant={subscription.plan.featureAnalytics ? 'default' : 'outline'}>
                Аналитика: {subscription.plan.featureAnalytics ? 'Включена' : 'Нет'}
              </Badge>
              <Badge variant={subscription.plan.featureAutoReminders ? 'default' : 'outline'}>
                Авто-напоминания: {subscription.plan.featureAutoReminders ? 'Да' : 'Нет'}
              </Badge>
              <Badge variant={subscription.plan.featurePrepayment ? 'default' : 'outline'}>
                Предоплата: {subscription.plan.featurePrepayment ? 'Да' : 'Нет'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {pendingClaim && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
              <div className="space-y-0.5 text-sm">
                <p className="font-semibold">
                  Заявка на оплату тарифа «{pendingClaim.planName}» ({pendingClaim.months} мес.,{' '}
                  {formatPriceKgs(pendingClaim.amount)}) находится на проверке
                </p>
                <p className="text-xs text-muted-foreground">
                  Способ: {pendingClaim.method}
                  {pendingClaim.reference ? ` • Номер перевода: ${pendingClaim.reference}` : ''}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isCancellingClaim}
              onClick={() => void handleCancelClaim(pendingClaim.id)}
            >
              {isCancellingClaim ? 'Отменяем...' : 'Отменить заявку'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Доступные тарифы</CardTitle>
          <CardDescription>Выберите подходящий тариф для вашего бизнеса</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.id === subscription.plan.id;
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col justify-between rounded-xl border p-4 ${
                    isCurrent ? 'border-primary bg-primary/5' : 'bg-card'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold">{plan.name}</h3>
                      {isCurrent && <Badge variant="secondary">Текущий</Badge>}
                    </div>
                    <p className="text-2xl font-extrabold">
                      {formatPriceKgs(plan.priceMonthly)}
                      <span className="text-xs font-normal text-muted-foreground"> / мес</span>
                    </p>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        До {plan.maxStaff} сотрудников
                      </li>
                      <li className="flex items-center gap-2">
                        {plan.featureAnalytics ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50" />
                        )}
                        Аналитика и CSV-экспорт
                      </li>
                      <li className="flex items-center gap-2">
                        {plan.featureAutoReminders ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50" />
                        )}
                        Авто-напоминания клиентам
                      </li>
                      <li className="flex items-center gap-2">
                        {plan.featurePrepayment ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50" />
                        )}
                        Предоплата при записи
                      </li>
                    </ul>
                  </div>

                  <Button
                    className="mt-5 w-full"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={Boolean(pendingClaim)}
                    onClick={() => openClaimDialog(plan.id)}
                  >
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                    {isCurrent ? 'Продлить' : 'Выбрать и оплатить'}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">История платежей</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Платежей пока нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Дата</th>
                    <th className="py-2 pr-4">Тариф</th>
                    <th className="py-2 pr-4">Срок</th>
                    <th className="py-2 pr-4">Сумма</th>
                    <th className="py-2 pr-4">Способ</th>
                    <th className="py-2 pr-4">Статус</th>
                    <th className="py-2">Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{p.createdAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-4 font-medium">{p.planName}</td>
                      <td className="py-2.5 pr-4">{p.months} мес.</td>
                      <td className="py-2.5 pr-4 font-medium">{formatPriceKgs(p.amount)}</td>
                      <td className="py-2.5 pr-4">{p.method}</td>
                      <td className="py-2.5 pr-4">
                        <Badge
                          variant={
                            p.status === 'CONFIRMED'
                              ? 'default'
                              : p.status === 'REJECTED'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {PAYMENT_STATUS_LABEL[p.status]}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">
                        {p.rejectReason ? `Причина: ${p.rejectReason}` : (p.comment ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Claim Modal */}
      {isClaimOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="billing-claim-title"
        >
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle id="billing-claim-title" className="text-lg">
                  Заявка на оплату подписки
                </CardTitle>
                <CardDescription>
                  Переведите сумму по реквизитам и отправьте заявку на подтверждение.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsClaimOpen(false)}
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {paymentInstructions && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Инструкция по оплате
                  </p>
                  <p className="whitespace-pre-line">{paymentInstructions}</p>
                </div>
              )}

              {claimError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{claimError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitClaim} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="claim-plan">Тариф</Label>
                  <select
                    id="claim-plan"
                    value={claimPlanId}
                    onChange={(e) => setClaimPlanId(e.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatPriceKgs(p.priceMonthly)} / мес
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="claim-months">Период</Label>
                    <select
                      id="claim-months"
                      value={claimMonths}
                      onChange={(e) => setClaimMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {MONTHS_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m} мес.
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="claim-method">Способ оплаты</Label>
                    <select
                      id="claim-method"
                      value={claimMethod}
                      onChange={(e) => setClaimMethod(e.target.value as PaymentMethod)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {PAYMENT_METHOD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Итого к оплате</span>
                    <span className="text-lg font-bold">
                      {formatPriceKgs(calculatedClaimTotal)}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="claim-reference">Номер чека / транзакции (необязательно)</Label>
                  <Input
                    id="claim-reference"
                    value={claimReference}
                    onChange={(e) => setClaimReference(e.target.value)}
                    placeholder="Например: TXN-123456"
                    className="min-h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="claim-comment">Комментарий (необязательно)</Label>
                  <Input
                    id="claim-comment"
                    value={claimComment}
                    onChange={(e) => setClaimComment(e.target.value)}
                    placeholder="Отправитель или заметка"
                    className="min-h-11"
                  />
                </div>

                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsClaimOpen(false)}
                    disabled={isSubmittingClaim}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" disabled={isSubmittingClaim} className="gap-2">
                    {isSubmittingClaim && <Loader2 className="h-4 w-4 animate-spin" />}
                    Отправить заявку
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <OwnerGuard>
      <BillingContent />
    </OwnerGuard>
  );
}
