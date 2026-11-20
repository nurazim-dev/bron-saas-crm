'use client';

import { AlertCircle, ArrowLeft, CheckCircle2, Eye, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import {
  type AdminAuditItem,
  type AdminCompanyDetailDto,
  type AdminPaymentItem,
  adjustAdminCompanySubscription,
  deleteAdminCompany,
  getAdminCompanyDetail,
  impersonateAdminCompany,
  listAdminAudit,
  listAdminPayments,
  listAdminPlans,
  recordAdminOfflinePayment,
  restoreAdminCompany,
  suspendAdminCompany,
  unsuspendAdminCompany,
  updateAdminCompany,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import type { BusinessType, PaymentMethod, PlanDto } from '@/types/api';

type TabKey = 'overview' | 'staff' | 'subscription' | 'payments' | 'audit';

export default function AdminCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [tab, setTab] = useState<TabKey>('overview');
  const [company, setCompany] = useState<AdminCompanyDetailDto | null>(null);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [payments, setPayments] = useState<AdminPaymentItem[]>([]);
  const [auditItems, setAuditItems] = useState<AdminAuditItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Overview edit form
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editType, setEditType] = useState<BusinessType>('BARBERSHOP');
  const [editPublicEnabled, setEditPublicEnabled] = useState(true);

  // Dialogs
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState('');
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');

  // Subscription adjustment form
  const [adjPlanId, setAdjPlanId] = useState('');
  const [adjPeriodEndsAt, setAdjPeriodEndsAt] = useState('');
  const [adjIsTrial, setAdjIsTrial] = useState(false);
  const [adjReason, setAdjReason] = useState('');

  // Offline payment form
  const [payPlanId, setPayPlanId] = useState('');
  const [payMonths, setPayMonths] = useState<1 | 3 | 6 | 12>(1);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('MBANK');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payReason, setPayReason] = useState('');

  const loadCompany = useCallback(async () => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getAdminCompanyDetail(id),
      listAdminPlans(),
      listAdminPayments({ companyId: id, limit: 50 }),
      listAdminAudit({ companyId: id, limit: 50 }),
    ])
      .then(([detail, planList, paymentList, auditList]) => {
        if (cancelled) return;
        setCompany(detail);
        setPlans(planList);
        setPayments(paymentList.items);
        setAuditItems(auditList.items);

        setEditName(detail.name);
        setEditSlug(detail.slug);
        setEditType(detail.businessType);
        setEditPublicEnabled(detail.publicBookingEnabled);

        if (detail.subscription) {
          setAdjPlanId(detail.subscription.plan.id);
          setAdjPeriodEndsAt(detail.subscription.periodEndsAt.slice(0, 10));
          setAdjIsTrial(detail.subscription.isTrial);
          setPayPlanId(detail.subscription.plan.id);
        } else if (planList[0]) {
          setAdjPlanId(planList[0].id);
          setPayPlanId(planList[0].id);
        }
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
  }, [id, reloadTick]);

  async function handleSaveOverview(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await updateAdminCompany(id, {
        name: editName.trim(),
        slug: editSlug.trim(),
        businessType: editType,
        publicBookingEnabled: editPublicEnabled,
      });
      toast.success('Данные компании обновлены');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSuspend() {
    if (!suspendReason.trim()) return;
    setIsSubmitting(true);
    try {
      await suspendAdminCompany(id, suspendReason.trim());
      toast.success('Компания заблокирована');
      setSuspendOpen(false);
      setSuspendReason('');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUnsuspend() {
    setIsSubmitting(true);
    try {
      await unsuspendAdminCompany(id);
      toast.success('Блокировка снята');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!company || deleteConfirmSlug.trim() !== company.slug) return;
    setIsSubmitting(true);
    try {
      await deleteAdminCompany(id, deleteConfirmSlug.trim());
      toast.success('Компания удалена');
      setDeleteOpen(false);
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRestore() {
    setIsSubmitting(true);
    try {
      await restoreAdminCompany(id);
      toast.success('Компания восстановлена');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImpersonate() {
    if (!impersonateReason.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await impersonateAdminCompany(id, impersonateReason.trim());
      setImpersonateOpen(false);
      setImpersonateReason('');
      router.push(`/impersonate?code=${encodeURIComponent(res.code)}`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdjustSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!adjReason.trim()) {
      toast.error('Укажите причину изменения подписки');
      return;
    }
    setIsSubmitting(true);
    try {
      await adjustAdminCompanySubscription(id, {
        ...(adjPlanId ? { planId: adjPlanId } : {}),
        ...(adjPeriodEndsAt ? { periodEndsAt: `${adjPeriodEndsAt}T23:59:59.000Z` } : {}),
        isTrial: adjIsTrial,
        reason: adjReason.trim(),
      });
      toast.success('Подписка обновлена');
      setAdjReason('');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordOfflinePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payPlanId || !payReason.trim()) {
      toast.error('Укажите тариф и причину');
      return;
    }
    setIsSubmitting(true);
    try {
      await recordAdminOfflinePayment(id, {
        planId: payPlanId,
        months: payMonths,
        method: payMethod,
        ...(payAmount.trim() ? { amount: payAmount.trim() } : {}),
        ...(payReference.trim() ? { reference: payReference.trim() } : {}),
        reason: payReason.trim(),
      });
      toast.success('Офлайн-платёж проведён, подписка продлена');
      setPayAmount('');
      setPayReference('');
      setPayReason('');
      await loadCompany();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="space-y-4">
        <Link href="/admin/companies" className="inline-flex items-center gap-2 text-sm underline">
          <ArrowLeft className="h-4 w-4" />К списку компаний
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error ?? 'Компания не найдена'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/companies"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Компании
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
            <Badge variant="outline">/{company.slug}</Badge>
            {company.subscription && (
              <Badge
                variant={company.subscription.state === 'LOCKED' ? 'destructive' : 'secondary'}
              >
                {company.subscription.state} ({company.subscription.plan.name})
              </Badge>
            )}
            {company.suspendedAt && <Badge variant="destructive">Заблокирована</Badge>}
            {company.deletedAt && <Badge variant="destructive">Удалена</Badge>}
          </div>
          {company.suspendedReason && (
            <p className="mt-1 text-sm text-destructive">
              Причина блокировки: {company.suspendedReason}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImpersonateOpen(true)}
            disabled={Boolean(company.deletedAt)}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            Имперсонация (read-only)
          </Button>
          {company.suspendedAt ? (
            <Button variant="outline" size="sm" onClick={handleUnsuspend} disabled={isSubmitting}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Разблокировать
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setSuspendOpen(true)}
              disabled={isSubmitting || Boolean(company.deletedAt)}
            >
              <ShieldAlert className="mr-1.5 h-4 w-4" />
              Заблокировать
            </Button>
          )}
          {company.deletedAt ? (
            <Button variant="outline" size="sm" onClick={handleRestore} disabled={isSubmitting}>
              Восстановить
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4 text-destructive" />
              Удалить
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {(
          [
            ['overview', 'Обзор'],
            ['staff', `Сотрудники (${company.staff.length})`],
            ['subscription', 'Подписка'],
            ['payments', `Платежи (${payments.length})`],
            ['audit', `Аудит (${auditItems.length})`],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? 'default' : 'ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Основные сведения</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Владелец</span>
                <span>
                  {company.owner?.name ?? '—'} ({company.owner?.email ?? '—'})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Телефон</span>
                <span>{company.phone ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Адрес</span>
                <span>{company.address ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Таймзона / Валюта</span>
                <span>
                  {company.timezone} / {company.currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Записи / Услуги / Персонал</span>
                <span>
                  {company.counts.appointments} / {company.counts.services} / {company.counts.staff}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Последняя активность</span>
                <span>
                  {company.lastActivityAt
                    ? new Date(company.lastActivityAt).toLocaleString('ru-RU')
                    : '—'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Редактировать компанию</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveOverview} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="comp-name">Название</Label>
                  <Input
                    id="comp-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="comp-slug">Slug</Label>
                  <Input
                    id="comp-slug"
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="comp-type">Тип бизнеса</Label>
                  <select
                    id="comp-type"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as BusinessType)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="BARBERSHOP">{ru.businessTypes.BARBERSHOP}</option>
                    <option value="BEAUTY_SALON">{ru.businessTypes.BEAUTY_SALON}</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editPublicEnabled}
                    onChange={(e) => setEditPublicEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Публичная онлайн-запись включена
                </label>
                <Button type="submit" disabled={isSubmitting}>
                  Сохранить изменения
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'staff' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Сотрудники компании</CardTitle>
          </CardHeader>
          <CardContent>
            {company.staff.length === 0 ? (
              <p className="text-sm text-muted-foreground">Сотрудников нет.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4">Имя</th>
                      <th className="py-2 pr-4">Роль</th>
                      <th className="py-2 pr-4">Контакты</th>
                      <th className="py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {company.staff.map((member) => (
                      <tr key={member.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 font-medium">{member.name}</td>
                        <td className="py-2.5 pr-4">{ru.roles[member.role]}</td>
                        <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                          {member.email ?? '—'} {member.phone ? `• ${member.phone}` : ''}
                        </td>
                        <td className="py-2.5">
                          <Badge variant={member.isActive ? 'secondary' : 'outline'}>
                            {member.isActive ? 'Активен' : 'Отключён'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'subscription' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Изменить тариф и срок</CardTitle>
              <CardDescription>
                Текущий статус: {company.subscription?.state ?? 'нет'} • Осталось дней:{' '}
                {company.subscription?.daysLeft ?? 0}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdjustSubscription} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="adj-plan">Тариф</Label>
                  <select
                    id="adj-plan"
                    value={adjPlanId}
                    onChange={(e) => setAdjPlanId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.priceMonthly} сом/мес)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adj-end">Дата окончания (UTC)</Label>
                  <Input
                    id="adj-end"
                    type="date"
                    value={adjPeriodEndsAt}
                    onChange={(e) => setAdjPeriodEndsAt(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={adjIsTrial}
                    onChange={(e) => setAdjIsTrial(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Пробный период (trial)
                </label>
                <div className="space-y-1">
                  <Label htmlFor="adj-reason">Причина (обязательно для аудита)</Label>
                  <Input
                    id="adj-reason"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="Например: Продление по договорённости"
                    required
                  />
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  Применить изменения
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Провести офлайн-платёж</CardTitle>
              <CardDescription>
                Создаёт подтверждённый платёж и продлевает подписку компании.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecordOfflinePayment} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="pay-plan">Тариф</Label>
                    <select
                      id="pay-plan"
                      value={payPlanId}
                      onChange={(e) => setPayPlanId(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pay-months">Срок (мес.)</Label>
                    <select
                      id="pay-months"
                      value={payMonths}
                      onChange={(e) => setPayMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value={1}>1 месяц</option>
                      <option value={3}>3 месяца</option>
                      <option value={6}>6 месяцев</option>
                      <option value={12}>12 месяцев</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="pay-method">Способ</Label>
                    <select
                      id="pay-method"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="MBANK">MBank</option>
                      <option value="OPTIMA">Optima</option>
                      <option value="DEMIR">Demir</option>
                      <option value="BAKAI">Bakai</option>
                      <option value="ELCART">Элкарт</option>
                      <option value="CASH">Наличные</option>
                      <option value="BANK_TRANSFER">Банковский перевод</option>
                      <option value="OTHER">Другое</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pay-amount">Сумма (опционально)</Label>
                    <Input
                      id="pay-amount"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="1500.00"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-ref">Референс / номер чека</Label>
                  <Input
                    id="pay-ref"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="TXN-12345"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-reason">Причина / комментарий</Label>
                  <Input
                    id="pay-reason"
                    value={payReason}
                    onChange={(e) => setPayReason(e.target.value)}
                    placeholder="Оплата получена в офисе"
                    required
                  />
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  Провести платёж
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'payments' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">История платежей</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Платежей пока нет.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4">Дата</th>
                      <th className="py-2 pr-4">Тариф</th>
                      <th className="py-2 pr-4">Сумма</th>
                      <th className="py-2 pr-4">Статус</th>
                      <th className="py-2">Референс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 text-xs">
                          {new Date(p.createdAt).toLocaleString('ru-RU')}
                        </td>
                        <td className="py-2 pr-4">
                          {p.plan.name} ({p.months} мес.)
                        </td>
                        <td className="py-2 pr-4 font-medium">
                          {p.amount} {p.currency}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={p.status === 'CONFIRMED' ? 'secondary' : 'outline'}>
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">{p.reference ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'audit' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Журнал аудита компании</CardTitle>
          </CardHeader>
          <CardContent>
            {auditItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Записей аудита нет.</p>
            ) : (
              <div className="space-y-2">
                {auditItems.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{item.action}</span>
                      <span className="text-muted-foreground">
                        {item.actorType} • {new Date(item.createdAt).toLocaleString('ru-RU')}
                      </span>
                    </div>
                    {item.metadata != null && (
                      <pre className="mt-1.5 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                        {JSON.stringify(item.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Suspend dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заблокировать компанию «{company.name}»?</DialogTitle>
            <DialogDescription>
              Сотрудники получат ошибку 403 при любых запросах, публичная страница записи будет
              отключена.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason">Причина блокировки</Label>
            <Input
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Нарушение правил / Неоплата"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleSuspend}
              disabled={!suspendReason.trim() || isSubmitting}
            >
              Заблокировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Soft-delete dialog with typed slug */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить компанию «{company.name}»?</DialogTitle>
            <DialogDescription>
              Введите точный slug компании (<code>{company.slug}</code>) для подтверждения мягкого
              удаления.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteConfirmSlug}
            onChange={(e) => setDeleteConfirmSlug(e.target.value)}
            placeholder={company.slug}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConfirmSlug.trim() !== company.slug || isSubmitting}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate dialog */}
      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Имперсонация (только чтение)</DialogTitle>
            <DialogDescription>
              Вы откроете кабинет владельца в режиме «только чтение». Действие будет записано в
              аудит.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="imp-reason">Причина входа</Label>
            <Input
              id="imp-reason"
              value={impersonateReason}
              onChange={(e) => setImpersonateReason(e.target.value)}
              placeholder="Диагностика расписания по обращению владельца"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleImpersonate}
              disabled={!impersonateReason.trim() || isSubmitting}
            >
              Открыть кабинет
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
