'use client';

import { AlertCircle, Clock, Package, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  createServicePackage,
  deleteServicePackage,
  listServicePackages,
  updateServicePackage,
} from '@/lib/api/services.api';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import type { ServiceDto, ServicePackageDto } from '@/types/api';

interface PackagesSectionProps {
  services: ServiceDto[];
}

export function PackagesSection({ services }: PackagesSectionProps) {
  const [packages, setPackages] = useState<ServicePackageDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<ServicePackageDto | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deletingPackage, setDeletingPackage] = useState<ServicePackageDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listServicePackages()
      .then((data) => {
        if (!cancelled) {
          setPackages(data);
          setLoadError(null);
        }
      })
      .catch((err) => {
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

  const selectableServices = useMemo(
    () => services.filter((s) => s.isActive || selectedServiceIds.includes(s.id)),
    [services, selectedServiceIds],
  );

  const selectionSummary = useMemo(() => {
    const selected = selectedServiceIds
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is ServiceDto => Boolean(s));
    const totalDurationMin = selected.reduce((sum, s) => sum + s.durationMin, 0);
    const catalogMinor = selected.reduce((sum, s) => sum + Math.round(Number(s.price) * 100), 0);
    return {
      totalDurationMin,
      catalogTotalPrice: (catalogMinor / 100).toFixed(2),
    };
  }, [selectedServiceIds, services]);

  function openCreateDialog() {
    setEditingPackage(null);
    setName('');
    setDescription('');
    setPrice('');
    setIsActive(true);
    setSelectedServiceIds([]);
    setFormError(null);
    setIsFormOpen(true);
  }

  function openEditDialog(pkg: ServicePackageDto) {
    setEditingPackage(pkg);
    setName(pkg.name);
    setDescription(pkg.description ?? '');
    setPrice(pkg.price);
    setIsActive(pkg.isActive);
    setSelectedServiceIds([...pkg.serviceIds]);
    setFormError(null);
    setIsFormOpen(true);
  }

  function toggleServiceId(id: string) {
    setSelectedServiceIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 10) {
        return prev;
      }
      return [...prev, id];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setFormError(ru.validation.nameMin);
      return;
    }

    const trimmedPrice = price.trim();
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(trimmedPrice) ||
      Number(trimmedPrice) < 0 ||
      Number(trimmedPrice) > 1000000
    ) {
      setFormError(ru.validation.priceInvalid);
      return;
    }

    if (selectedServiceIds.length < 2 || selectedServiceIds.length > 10) {
      setFormError('Выберите от 2 до 10 услуг для пакета');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        description: description.trim().length > 0 ? description.trim() : null,
        price: trimmedPrice,
        serviceIds: selectedServiceIds,
        isActive,
      };
      if (editingPackage) {
        const updated = await updateServicePackage(editingPackage.id, payload);
        setPackages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success(ru.servicesPage.packageUpdateSuccess);
      } else {
        const created = await createServicePackage(payload);
        setPackages((prev) => [...prev, created]);
        toast.success(ru.servicesPage.packageCreateSuccess);
      }
      setIsFormOpen(false);
    } catch (err) {
      setFormError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingPackage) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteServicePackage(deletingPackage.id);
      setPackages((prev) => prev.filter((p) => p.id !== deletingPackage.id));
      toast.success(ru.servicesPage.packageDeleteSuccess);
      setDeletingPackage(null);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6" aria-labelledby="service-packages-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="service-packages-heading" className="text-xl font-bold tracking-tight">
            {ru.servicesPage.packagesSectionTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ru.servicesPage.packagesSectionSubtitle}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={openCreateDialog}
          disabled={services.filter((s) => s.isActive).length < 2}
          className="min-h-11 gap-2 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {ru.servicesPage.addPackage}
        </Button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      {!isLoading && !loadError && packages.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="flex-row items-center gap-3">
            <Package className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">{ru.servicesPage.packagesSectionTitle}</CardTitle>
              <CardDescription>{ru.servicesPage.packagesEmpty}</CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      {packages.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {packages.map((pkg) => {
            const hasDiscount = Number(pkg.catalogTotalPrice) > Number(pkg.price);
            return (
              <Card key={pkg.id} className={!pkg.isActive ? 'opacity-75' : undefined}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Package className="h-4 w-4 text-primary" aria-hidden="true" />
                        <span>{pkg.name}</span>
                      </CardTitle>
                      {pkg.description && <CardDescription>{pkg.description}</CardDescription>}
                    </div>
                    <Badge variant={pkg.isActive ? 'default' : 'secondary'}>
                      {pkg.isActive ? ru.servicesPage.statusActive : ru.servicesPage.statusInactive}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    {pkg.items.map((item) => item.name).join(' + ')}
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-4 w-4" aria-hidden="true" />
                        {formatDurationMin(pkg.totalDurationMin)}
                      </span>
                      <div className="flex items-baseline gap-2">
                        {hasDiscount && (
                          <span className="text-xs text-muted-foreground line-through">
                            {formatPriceKgs(pkg.catalogTotalPrice)}
                          </span>
                        )}
                        <span className="text-base font-bold text-foreground">
                          {formatPriceKgs(pkg.price)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(pkg)}
                        aria-label={`${ru.common.edit}: ${pkg.name}`}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {ru.common.edit}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setDeletingPackage(pkg);
                          setDeleteError(null);
                        }}
                        aria-label={`${ru.common.delete}: ${pkg.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="package-dialog-title"
        >
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle id="package-dialog-title" className="text-lg">
                {editingPackage
                  ? ru.servicesPage.packageEditTitle
                  : ru.servicesPage.packageCreateTitle}
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
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {formError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="package-name">{ru.servicesPage.packageNameLabel}</Label>
                  <Input
                    id="package-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={ru.servicesPage.packageNamePlaceholder}
                    className="min-h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="package-description">{ru.servicesPage.descriptionLabel}</Label>
                  <Input
                    id="package-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={ru.servicesPage.descriptionPlaceholder}
                    className="min-h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="package-price">{ru.servicesPage.packagePriceLabel}</Label>
                  <Input
                    id="package-price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="850"
                    className="min-h-11"
                  />
                </div>

                <fieldset className="space-y-2 rounded-lg border p-3">
                  <legend className="px-1 text-xs font-medium text-muted-foreground">
                    {ru.servicesPage.packageServicesLabel} ({selectedServiceIds.length}/10)
                  </legend>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {selectableServices.map((service) => {
                      const checked = selectedServiceIds.includes(service.id);
                      return (
                        <label
                          key={service.id}
                          className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/40"
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && selectedServiceIds.length >= 10}
                              onChange={() => toggleServiceId(service.id)}
                              className="h-4 w-4 accent-primary"
                            />
                            <span>{service.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDurationMin(service.durationMin)} ·{' '}
                            {formatPriceKgs(service.price)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedServiceIds.length > 0 && (
                    <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                      <span>
                        {ru.servicesPage.packageTotalDuration}:{' '}
                        {formatDurationMin(selectionSummary.totalDurationMin)}
                      </span>
                      <span>
                        {ru.servicesPage.packageTotalCatalogPrice}:{' '}
                        {formatPriceKgs(selectionSummary.catalogTotalPrice)}
                      </span>
                    </div>
                  )}
                </fieldset>

                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    id="package-active"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{ru.servicesPage.isActiveLabel}</span>
                </label>

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

      {deletingPackage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-package-title"
        >
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle id="delete-package-title" className="text-lg">
                {ru.servicesPage.packageDeleteConfirmTitle}
              </CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">«{deletingPackage.name}»</span> —{' '}
                {ru.servicesPage.packageDeleteConfirmText}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {deleteError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{deleteError}</span>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeletingPackage(null)}
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
    </section>
  );
}
