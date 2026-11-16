'use client';

import { AlertCircle, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { createAdminPlan, listAdminPlans, updateAdminPlan } from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import type { PlanDto } from '@/types/api';

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlanDto | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [priceMonthly, setPriceMonthly] = useState('1500.00');
  const [maxStaff, setMaxStaff] = useState(5);
  const [maxRemindersPerMonth, setMaxRemindersPerMonth] = useState('');
  const [featureAnalytics, setFeatureAnalytics] = useState(true);
  const [featureAutoReminders, setFeatureAutoReminders] = useState(false);
  const [featurePrepayment, setFeaturePrepayment] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(10);

  const loadPlans = useCallback(async () => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAdminPlans()
      .then((data) => {
        if (cancelled) return;
        setPlans(data);
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
  }, [reloadTick]);

  function openCreate() {
    setEditing(null);
    setCode('');
    setName('');
    setPriceMonthly('1500.00');
    setMaxStaff(5);
    setMaxRemindersPerMonth('');
    setFeatureAnalytics(true);
    setFeatureAutoReminders(false);
    setFeaturePrepayment(false);
    setIsPublic(true);
    setIsActive(true);
    setSortOrder(10);
    setDialogOpen(true);
  }

  function openEdit(plan: PlanDto) {
    setEditing(plan);
    setCode(plan.code);
    setName(plan.name);
    setPriceMonthly(plan.priceMonthly);
    setMaxStaff(plan.maxStaff);
    setMaxRemindersPerMonth(
      plan.maxRemindersPerMonth != null ? String(plan.maxRemindersPerMonth) : '',
    );
    setFeatureAnalytics(plan.featureAnalytics);
    setFeatureAutoReminders(plan.featureAutoReminders);
    setFeaturePrepayment(plan.featurePrepayment);
    setIsPublic(plan.isPublic ?? true);
    setIsActive(plan.isActive ?? true);
    setSortOrder(plan.sortOrder);
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const remindersVal = maxRemindersPerMonth.trim() ? Number(maxRemindersPerMonth.trim()) : null;
      if (editing) {
        await updateAdminPlan(editing.id, {
          name: name.trim(),
          priceMonthly: priceMonthly.trim(),
          maxStaff,
          maxRemindersPerMonth: remindersVal,
          featureAnalytics,
          featureAutoReminders,
          featurePrepayment,
          isPublic,
          isActive,
          sortOrder,
        });
        toast.success('Тариф обновлён');
      } else {
        await createAdminPlan({
          code: code.trim(),
          name: name.trim(),
          priceMonthly: priceMonthly.trim(),
          maxStaff,
          maxRemindersPerMonth: remindersVal,
          featureAnalytics,
          featureAutoReminders,
          featurePrepayment,
          isPublic,
          sortOrder,
        });
        toast.success('Тариф создан');
      }
      setDialogOpen(false);
      await loadPlans();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Тарифные планы</h1>
          <p className="text-sm text-muted-foreground">
            Управление лимитами, функциями и стоимостью тарифов.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Новый тариф
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <div className="text-xs text-muted-foreground">{plan.code}</div>
                </div>
                <div className="flex gap-1">
                  <Badge variant={plan.isActive ? 'secondary' : 'outline'}>
                    {plan.isActive ? 'Активен' : 'Архив'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="text-2xl font-bold">{plan.priceMonthly} сом/мес</div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>Макс. мастеров: {plan.maxStaff}</div>
                  <div>Напоминаний/мес: {plan.maxRemindersPerMonth ?? 'без лимита'}</div>
                  <div>
                    Функции:{' '}
                    {[
                      plan.featureAnalytics && 'Аналитика',
                      plan.featureAutoReminders && 'Авто-напоминания',
                      plan.featurePrepayment && 'Предоплата',
                    ]
                      .filter(Boolean)
                      .join(', ') || 'Базовые'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openEdit(plan)}
                >
                  Редактировать
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Тариф «${editing.name}»` : 'Создать тариф'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            {!editing && (
              <div className="space-y-1">
                <Label htmlFor="plan-code">Код (латиница)</Label>
                <Input
                  id="plan-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="pro"
                  required
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="plan-name">Название</Label>
              <Input
                id="plan-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-price">Цена (сом/мес)</Label>
                <Input
                  id="plan-price"
                  value={priceMonthly}
                  onChange={(e) => setPriceMonthly(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-staff">Макс. мастеров</Label>
                <Input
                  id="plan-staff"
                  type="number"
                  min={1}
                  value={maxStaff}
                  onChange={(e) => setMaxStaff(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-rem">Лимит напоминаний</Label>
                <Input
                  id="plan-rem"
                  type="number"
                  min={0}
                  value={maxRemindersPerMonth}
                  onChange={(e) => setMaxRemindersPerMonth(e.target.value)}
                  placeholder="Пусто = без лимита"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-sort">Порядок сортировки</Label>
                <Input
                  id="plan-sort"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={featureAnalytics}
                  onChange={(e) => setFeatureAnalytics(e.target.checked)}
                />
                Аналитика
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={featureAutoReminders}
                  onChange={(e) => setFeatureAutoReminders(e.target.checked)}
                />
                Авто-напоминания
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={featurePrepayment}
                  onChange={(e) => setFeaturePrepayment(e.target.checked)}
                />
                Предоплата
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                Показывать на странице биллинга
              </label>
              {editing && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Тариф активен (не в архиве)
                </label>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
