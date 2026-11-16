'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Clock, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getBillingOverview } from '@/lib/api/billing.api';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api/client';
import { createService, deleteService, listServices, updateService } from '@/lib/api/services.api';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { PrepaymentMode, ServiceDto } from '@/types/api';

type FilterMode = 'all' | 'active' | 'inactive';

const serviceFormSchema = z.object({
  name: z.string().trim().min(2, ru.validation.nameMin).max(100, ru.validation.nameMax),
  description: z.string().trim().max(500).optional(),
  durationMin: z
    .number({ message: ru.validation.durationRange })
    .int(ru.validation.durationRange)
    .min(5, ru.validation.durationRange)
    .max(480, ru.validation.durationRange)
    .refine((v) => v % 5 === 0, { message: ru.validation.durationRange }),
  price: z
    .string()
    .trim()
    .min(1, ru.validation.required)
    .refine(
      (val) => /^\d+(?:\.\d{1,2})?$/.test(val) && Number(val) >= 0 && Number(val) <= 1000000,
      {
        message: ru.validation.priceInvalid,
      },
    ),
  isActive: z.boolean(),
  requiresPrepayment: z.boolean(),
  prepaymentMode: z.enum(['FIXED', 'PERCENT']),
  prepaymentValue: z.string().trim().optional(),
});

type ServiceFormValues = z.infer<typeof serviceFormSchema>;

function ServicesManagerContent() {
  const company = useAuthStore((s) => s.company);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [planSupportsPrepayment, setPlanSupportsPrepayment] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceDto | null>(null);
  const [formServerError, setFormServerError] = useState<string | null>(null);

  const [deletingService, setDeletingService] = useState<ServiceDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [hasUpcomingConflict, setHasUpcomingConflict] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: '',
      description: '',
      durationMin: 45,
      price: '800',
      isActive: true,
      requiresPrepayment: false,
      prepaymentMode: 'PERCENT',
      prepaymentValue: '30',
    },
  });

  const watchedPrice = useWatch({ control, name: 'price' });
  const watchedRequiresPrepayment = useWatch({ control, name: 'requiresPrepayment' });
  const watchedPrepayMode = useWatch({ control, name: 'prepaymentMode' });
  const watchedPrepayValue = useWatch({ control, name: 'prepaymentValue' });

  const prepaymentPreview = useMemo(() => {
    if (!watchedRequiresPrepayment) return null;
    const p = Number(watchedPrice);
    const v = Number(watchedPrepayValue);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(v) || v <= 0) return null;
    if (watchedPrepayMode === 'FIXED') {
      return Math.min(p, Math.round(v * 100) / 100);
    }
    return Math.min(p, Math.round((p * v) / 100));
  }, [watchedPrepayMode, watchedPrepayValue, watchedPrice, watchedRequiresPrepayment]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [data, billing] = await Promise.all([
          listServices(),
          getBillingOverview().catch(() => null),
        ]);
        if (!cancelled) {
          setServices(data);
          if (billing) setPlanSupportsPrepayment(billing.subscription.plan.featurePrepayment);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(err));
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
  }, [reloadKey]);

  function handleRetryLoad() {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }

  const filteredServices = useMemo(() => {
    if (filter === 'active') return services.filter((s) => s.isActive);
    if (filter === 'inactive') return services.filter((s) => !s.isActive);
    return services;
  }, [filter, services]);

  const activeCount = useMemo(() => services.filter((s) => s.isActive).length, [services]);
  const inactiveCount = useMemo(() => services.filter((s) => !s.isActive).length, [services]);

  function openCreateDialog() {
    setEditingService(null);
    setFormServerError(null);
    reset({
      name: '',
      description: '',
      durationMin: 45,
      price: '800',
      isActive: true,
      requiresPrepayment: false,
      prepaymentMode: 'PERCENT',
      prepaymentValue: '30',
    });
    setIsFormOpen(true);
  }

  function openEditDialog(service: ServiceDto) {
    setEditingService(service);
    setFormServerError(null);
    const numericPrice = Number(service.price);
    const priceDisplay =
      Number.isFinite(numericPrice) && Math.round(numericPrice * 100) % 100 === 0
        ? String(Math.round(numericPrice))
        : service.price;
    reset({
      name: service.name,
      description: service.description ?? '',
      durationMin: service.durationMin,
      price: priceDisplay,
      isActive: service.isActive,
      requiresPrepayment: service.requiresPrepayment ?? false,
      prepaymentMode: (service.prepaymentMode ?? 'PERCENT') as PrepaymentMode,
      prepaymentValue: service.prepaymentValue ? String(Number(service.prepaymentValue)) : '30',
    });
    setIsFormOpen(true);
  }

  async function onSubmitForm(values: ServiceFormValues) {
    setFormServerError(null);
    try {
      const payload = {
        name: values.name.trim(),
        description:
          values.description && values.description.trim().length > 0
            ? values.description.trim()
            : null,
        durationMin: values.durationMin,
        price: values.price.trim(),
        isActive: values.isActive,
        requiresPrepayment: values.requiresPrepayment,
        prepaymentMode: values.requiresPrepayment ? values.prepaymentMode : null,
        prepaymentValue: values.requiresPrepayment
          ? (values.prepaymentValue?.trim() ?? null)
          : null,
      };

      if (editingService) {
        const updated = await updateService(editingService.id, payload);
        setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast.success(ru.servicesPage.updateSuccess);
      } else {
        const created = await createService(payload);
        setServices((prev) => [...prev, created]);
        toast.success(ru.servicesPage.createSuccess);
      }
      setIsFormOpen(false);
    } catch (err) {
      setFormServerError(getApiErrorMessage(err));
    }
  }

  function openDeleteDialog(service: ServiceDto) {
    setDeletingService(service);
    setDeleteError(null);
    setHasUpcomingConflict(false);
  }

  async function handleConfirmDelete() {
    if (!deletingService) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteService(deletingService.id);
      setServices((prev) => prev.filter((s) => s.id !== deletingService.id));
      toast.success(ru.servicesPage.deleteSuccess);
      setDeletingService(null);
    } catch (err) {
      if (getApiErrorCode(err) === 'HAS_UPCOMING_APPOINTMENTS') {
        setHasUpcomingConflict(true);
      }
      setDeleteError(getApiErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDeactivateInstead() {
    if (!deletingService) return;
    setIsDeleting(true);
    try {
      const updated = await updateService(deletingService.id, { isActive: false });
      setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      toast.success(ru.servicesPage.updateSuccess);
      setDeletingService(null);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ru.servicesPage.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ru.servicesPage.subtitle}</p>
        </div>
        <Button onClick={openCreateDialog} className="min-h-11 gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {ru.servicesPage.addService}
        </Button>
      </div>

      {/* Filter tabs */}
      {services.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            {ru.servicesPage.filterAll} ({services.length})
          </Button>
          <Button
            type="button"
            variant={filter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('active')}
          >
            {ru.servicesPage.filterActive} ({activeCount})
          </Button>
          <Button
            type="button"
            variant={filter === 'inactive' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('inactive')}
          >
            {ru.servicesPage.filterInactive} ({inactiveCount})
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && loadError && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              {ru.common.errorTitle}
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleRetryLoad}>
              {ru.common.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !loadError && services.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <CardTitle>{ru.servicesPage.emptyTitle}</CardTitle>
            <CardDescription className="max-w-md">
              {ru.servicesPage.emptyDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={openCreateDialog} className="min-h-11 gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {ru.servicesPage.addFirstService}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Services list */}
      {!isLoading && !loadError && filteredServices.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredServices.map((service) => (
            <Card key={service.id} className="flex flex-col justify-between shadow-2xs">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold">{service.name}</CardTitle>
                    {service.description && (
                      <CardDescription className="mt-1 line-clamp-2">
                        {service.description}
                      </CardDescription>
                    )}
                  </div>
                  <Badge variant={service.isActive ? 'default' : 'secondary'}>
                    {service.isActive
                      ? ru.servicesPage.statusActive
                      : ru.servicesPage.statusInactive}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    {formatDurationMin(service.durationMin)}
                  </span>
                  <span className="text-base font-bold text-foreground">
                    {formatPriceKgs(service.price)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(service)}
                    aria-label={`${ru.common.edit}: ${service.name}`}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {ru.common.edit}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => openDeleteDialog(service)}
                    aria-label={`${ru.common.delete}: ${service.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-dialog-title"
        >
          <Card className="w-full max-w-lg shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle id="service-dialog-title" className="text-lg">
                {editingService
                  ? ru.servicesPage.editDialogTitle
                  : ru.servicesPage.createDialogTitle}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsFormOpen(false)}
                aria-label={ru.common.close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={handleSubmit(onSubmitForm)} noValidate className="space-y-4">
                {formServerError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{formServerError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="service-name">{ru.servicesPage.nameLabel}</Label>
                  <Input
                    id="service-name"
                    placeholder={ru.servicesPage.namePlaceholder}
                    className="min-h-11"
                    {...register('name')}
                  />
                  {errors.name && (
                    <p className="text-xs font-medium text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="service-description">{ru.servicesPage.descriptionLabel}</Label>
                  <Input
                    id="service-description"
                    placeholder={ru.servicesPage.descriptionPlaceholder}
                    className="min-h-11"
                    {...register('description')}
                  />
                  {errors.description && (
                    <p className="text-xs font-medium text-destructive">
                      {errors.description.message}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="service-duration">{ru.servicesPage.durationLabel}</Label>
                    <Input
                      id="service-duration"
                      type="number"
                      step={5}
                      min={5}
                      max={480}
                      className="min-h-11"
                      {...register('durationMin', { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">{ru.servicesPage.durationHint}</p>
                    {errors.durationMin && (
                      <p className="text-xs font-medium text-destructive">
                        {errors.durationMin.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="service-price">{ru.servicesPage.priceLabel}</Label>
                    <Input
                      id="service-price"
                      type="number"
                      step="1"
                      min={0}
                      placeholder={ru.servicesPage.pricePlaceholder}
                      className="min-h-11"
                      {...register('price')}
                    />
                    {errors.price && (
                      <p className="text-xs font-medium text-destructive">{errors.price.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
                  <input
                    id="service-active"
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input accent-primary"
                    {...register('isActive')}
                  />
                  <div>
                    <Label htmlFor="service-active" className="cursor-pointer font-medium">
                      {ru.servicesPage.isActiveLabel}
                    </Label>
                    <p className="text-xs text-muted-foreground">{ru.servicesPage.isActiveHint}</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start gap-2.5">
                    <input
                      id="service-requires-prepayment"
                      type="checkbox"
                      disabled={!planSupportsPrepayment}
                      className="mt-1 h-4 w-4 rounded border-input accent-primary"
                      {...register('requiresPrepayment')}
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor="service-requires-prepayment"
                        className="cursor-pointer font-medium"
                      >
                        Требовать предоплату при онлайн-записи
                      </Label>
                      {!planSupportsPrepayment && (
                        <p className="text-xs text-muted-foreground">
                          Предоплата доступна на старшем тарифе.{' '}
                          <Link href="/dashboard/billing" className="underline text-primary">
                            Перейти к тарифам
                          </Link>
                        </p>
                      )}
                      {planSupportsPrepayment && !company?.paymentInstructions?.trim() && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Сначала укажите реквизиты для предоплаты в{' '}
                          <Link href="/dashboard/settings" className="underline">
                            Настройках компании
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                  </div>

                  {watchedRequiresPrepayment && planSupportsPrepayment && (
                    <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="service-prepay-mode" className="text-xs">
                          Тип расчёта
                        </Label>
                        <select
                          id="service-prepay-mode"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          {...register('prepaymentMode')}
                        >
                          <option value="PERCENT">Процент (%)</option>
                          <option value="FIXED">Фиксированная сумма (сом)</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="service-prepay-value" className="text-xs">
                          Значение
                        </Label>
                        <Input
                          id="service-prepay-value"
                          type="number"
                          min={1}
                          step="1"
                          className="h-10"
                          {...register('prepaymentValue')}
                        />
                      </div>
                      {prepaymentPreview !== null && (
                        <p className="text-xs font-medium text-primary sm:col-span-2">
                          Сумма предоплаты при записи: {formatPriceKgs(prepaymentPreview)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsFormOpen(false)}
                    disabled={isSubmitting}
                  >
                    {ru.common.cancel}
                  </Button>
                  <Button type="submit" disabled={isSubmitting} className="min-h-10">
                    {isSubmitting ? ru.common.saving : ru.common.save}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingService && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-service-title"
        >
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle id="delete-service-title" className="text-lg">
                {ru.servicesPage.deleteConfirmTitle}
              </CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">«{deletingService.name}»</span> —{' '}
                {ru.servicesPage.deleteConfirmText}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {deleteError && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{deleteError}</span>
                  </div>
                  {hasUpcomingConflict && deletingService.isActive && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDeactivateInstead()}
                      disabled={isDeleting}
                      className="mt-1 self-start"
                    >
                      {ru.servicesPage.deactivateInstead}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeletingService(null)}
                  disabled={isDeleting}
                >
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleConfirmDelete()}
                  disabled={isDeleting}
                >
                  {isDeleting ? ru.common.deleting : ru.common.delete}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ServicesPage() {
  return (
    <OwnerGuard>
      <ServicesManagerContent />
    </OwnerGuard>
  );
}
