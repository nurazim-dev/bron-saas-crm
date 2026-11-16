'use client';

import {
  AlertCircle,
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  QrCode,
} from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { changePassword } from '@/lib/api/auth.api';
import { getBillingOverview } from '@/lib/api/billing.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { getCompany, getCompanyCapabilities, updateCompany } from '@/lib/api/company.api';
import { ru } from '@/lib/i18n/ru';
import { normalizePhoneE164OrNull } from '@/lib/phone';
import { useAuthStore } from '@/stores/auth.store';
import type {
  BusinessType,
  CompanyCapabilitiesDto,
  CompanyDto,
  LocaleCode,
  ReminderMode,
} from '@/types/api';

const BUSINESS_TYPES: BusinessType[] = ['BARBERSHOP', 'BEAUTY_SALON'];
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function SettingsManagerContent() {
  const storeCompany = useAuthStore((s) => s.company);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const [company, setCompany] = useState<CompanyDto | null>(storeCompany);
  const [isLoading, setIsLoading] = useState(!storeCompany);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Company settings form state
  const [name, setName] = useState(storeCompany?.name ?? '');
  const [businessType, setBusinessType] = useState<BusinessType>(
    storeCompany?.businessType ?? 'BARBERSHOP',
  );
  const [phone, setPhone] = useState(storeCompany?.phone ?? '');
  const [address, setAddress] = useState(storeCompany?.address ?? '');
  const [timezone, setTimezone] = useState(storeCompany?.timezone ?? 'Asia/Bishkek');
  const [slug, setSlug] = useState(storeCompany?.slug ?? '');
  const [slotIntervalMin, setSlotIntervalMin] = useState(storeCompany?.slotIntervalMin ?? 30);
  const [minLeadTimeMin, setMinLeadTimeMin] = useState(storeCompany?.minLeadTimeMin ?? 60);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(storeCompany?.maxAdvanceDays ?? 30);
  const [publicBookingEnabled, setPublicBookingEnabled] = useState(
    storeCompany?.publicBookingEnabled ?? true,
  );
  const [clientCancelMinHours, setClientCancelMinHours] = useState(
    storeCompany?.clientCancelMinHours ?? 2,
  );
  const [allowClientReschedule, setAllowClientReschedule] = useState(
    storeCompany?.allowClientReschedule ?? true,
  );
  const [defaultLocale, setDefaultLocale] = useState<LocaleCode>(
    storeCompany?.defaultLocale ?? 'RU',
  );
  const [reminderMode, setReminderMode] = useState<ReminderMode>(
    storeCompany?.reminderMode ?? 'MANUAL',
  );
  const [remind24h, setRemind24h] = useState(storeCompany?.remind24h ?? true);
  const [remind2h, setRemind2h] = useState(storeCompany?.remind2h ?? true);
  const [capabilities, setCapabilities] = useState<CompanyCapabilitiesDto | null>(null);
  const [planSupportsAutoReminders, setPlanSupportsAutoReminders] = useState(true);

  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Password change form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  const populateForm = useCallback((c: CompanyDto) => {
    setName(c.name);
    setBusinessType(c.businessType);
    setPhone(c.phone ?? '');
    setAddress(c.address ?? '');
    setTimezone(c.timezone);
    setSlug(c.slug);
    setSlotIntervalMin(c.slotIntervalMin);
    setMinLeadTimeMin(c.minLeadTimeMin);
    setMaxAdvanceDays(c.maxAdvanceDays);
    setPublicBookingEnabled(c.publicBookingEnabled);
    setClientCancelMinHours(c.clientCancelMinHours ?? 2);
    setAllowClientReschedule(c.allowClientReschedule ?? true);
    setDefaultLocale(c.defaultLocale ?? 'RU');
    setReminderMode(c.reminderMode ?? 'MANUAL');
    setRemind24h(c.remind24h ?? true);
    setRemind2h(c.remind2h ?? true);
  }, []);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [data, caps, billing] = await Promise.all([
          getCompany(),
          getCompanyCapabilities().catch(() => null),
          getBillingOverview().catch(() => null),
        ]);
        if (!cancelled) {
          setCompany(data);
          populateForm(data);
          if (caps) setCapabilities(caps);
          if (billing) setPlanSupportsAutoReminders(billing.subscription.plan.featureAutoReminders);
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
  }, [populateForm, reloadKey]);

  function handleRetryLoad() {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

  const publicUrl = `${origin}/b/${slug || company?.slug || ''}`;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(ru.dashboard.linkCopied);
    } catch {
      toast.info(publicUrl);
    }
  }

  function handleDownloadQrSvg() {
    const svgEl = qrContainerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zapis-qr-${company?.slug ?? 'company'}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setSettingsError(ru.validation.nameMin);
      return;
    }

    const trimmedPhone = phone.trim();
    const normalizedPhone = trimmedPhone.length > 0 ? normalizePhoneE164OrNull(trimmedPhone) : null;
    if (trimmedPhone.length > 0 && !normalizedPhone) {
      setSettingsError(ru.validation.phoneInvalid);
      return;
    }

    const normalizedSlug = slug.trim().toLowerCase();
    if (
      normalizedSlug.length < 3 ||
      normalizedSlug.length > 60 ||
      !SLUG_REGEX.test(normalizedSlug)
    ) {
      setSettingsError(ru.validation.slugInvalid);
      return;
    }

    setIsSavingSettings(true);
    try {
      const updated = await updateCompany({
        name: trimmedName,
        businessType,
        phone: normalizedPhone,
        address: address.trim().length > 0 ? address.trim() : null,
        timezone,
        slug: normalizedSlug,
        slotIntervalMin: Number(slotIntervalMin),
        minLeadTimeMin: Number(minLeadTimeMin),
        maxAdvanceDays: Number(maxAdvanceDays),
        publicBookingEnabled,
        clientCancelMinHours: Number(clientCancelMinHours),
        allowClientReschedule,
        defaultLocale,
        reminderMode,
        remind24h,
        remind2h,
      });
      setCompany(updated);
      populateForm(updated);
      toast.success(ru.settingsPage.settingsSaved);
    } catch (err) {
      setSettingsError(getApiErrorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (currentPassword.length < 8 || newPassword.length < 8) {
      setPasswordError(ru.validation.passwordMin);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(ru.settingsPage.passwordMismatch);
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(ru.settingsPage.passwordChanged);
    } catch (err) {
      setPasswordError(getApiErrorMessage(err));
    } finally {
      setIsChangingPassword(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError || !company) {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            {ru.common.errorTitle}
          </CardTitle>
          <CardDescription>{loadError ?? ru.common.errorDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleRetryLoad}>
            {ru.common.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isSlugModified = slug.trim().toLowerCase() !== company.slug;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{ru.settingsPage.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{ru.settingsPage.subtitle}</p>
      </div>

      {/* Public link & QR code card */}
      <Card className="border-primary/25 bg-primary/5 shadow-xs">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <QrCode className="h-5 w-5 text-primary" aria-hidden="true" />
                {ru.settingsPage.publicBookingCardTitle}
              </CardTitle>
              <CardDescription className="mt-1">
                {ru.settingsPage.publicBookingCardDescription}
              </CardDescription>
            </div>
            <Badge variant={publicBookingEnabled ? 'default' : 'secondary'}>
              {publicBookingEnabled ? ru.dashboard.bookingEnabled : ru.dashboard.bookingDisabled}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 truncate rounded-lg border bg-background px-3.5 py-2.5 font-mono text-sm">
                {publicUrl}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={() => void handleCopyLink()} className="gap-2">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {ru.dashboard.copyLink}
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link href={`/b/${company.slug}`} target="_blank">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {ru.dashboard.openPublicPage}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadQrSvg}
                className="gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {ru.settingsPage.downloadQrSvg}
              </Button>
            </div>
          </div>

          <div
            ref={qrContainerRef}
            className="flex flex-col items-center justify-center self-start rounded-xl border bg-white p-3.5 shadow-2xs"
          >
            <QRCodeSVG value={publicUrl} size={136} level="M" includeMargin={false} />
            <span className="mt-2 font-mono text-[11px] text-neutral-600">/b/{company.slug}</span>
          </div>
        </CardContent>
      </Card>

      {/* Main settings form */}
      <form onSubmit={handleSaveSettings} noValidate className="space-y-6">
        {settingsError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{settingsError}</span>
          </div>
        )}

        {/* Company Profile Card */}
        <Card className="shadow-2xs">
          <CardHeader>
            <CardTitle className="text-lg">{ru.settingsPage.profileCardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">{ru.settingsPage.companyNameLabel}</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-business-type">{ru.settingsPage.businessTypeLabel}</Label>
              <select
                id="company-business-type"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {ru.businessTypes[bt]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-phone">{ru.settingsPage.phoneLabel}</Label>
              <Input
                id="company-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={ru.auth.phonePlaceholder}
                className="min-h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-timezone">{ru.settingsPage.timezoneLabel}</Label>
              <select
                id="company-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {ru.settingsPage.timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="company-address">{ru.settingsPage.addressLabel}</Label>
              <Input
                id="company-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={ru.settingsPage.addressPlaceholder}
                className="min-h-11"
              />
            </div>
          </CardContent>
        </Card>

        {/* Slug & Booking Rules Card */}
        <Card className="shadow-2xs">
          <CardHeader>
            <CardTitle className="text-lg">{ru.settingsPage.bookingRulesCardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={publicBookingEnabled}
                onChange={(e) => setPublicBookingEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span>{ru.settingsPage.bookingEnabledToggle}</span>
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="company-slug">{ru.settingsPage.slugLabel}</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/b/</span>
                <Input
                  id="company-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  className="min-h-11 font-mono"
                />
              </div>
              {isSlugModified && (
                <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{ru.settingsPage.slugWarning}</span>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="company-slot-step">{ru.settingsPage.slotStepLabel}</Label>
                <select
                  id="company-slot-step"
                  value={slotIntervalMin}
                  onChange={(e) => setSlotIntervalMin(Number(e.target.value))}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value={15}>{ru.settingsPage.slotStep15}</option>
                  <option value={30}>{ru.settingsPage.slotStep30}</option>
                  <option value={60}>{ru.settingsPage.slotStep60}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-lead-time">{ru.settingsPage.minLeadTimeLabel}</Label>
                <Input
                  id="company-lead-time"
                  type="number"
                  min={0}
                  max={10080}
                  step={5}
                  value={minLeadTimeMin}
                  onChange={(e) => setMinLeadTimeMin(Number(e.target.value))}
                  className="min-h-11"
                />
                <p className="text-xs text-muted-foreground">{ru.settingsPage.minLeadTimeHint}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-advance-days">{ru.settingsPage.maxAdvanceDaysLabel}</Label>
                <Input
                  id="company-advance-days"
                  type="number"
                  min={1}
                  max={365}
                  value={maxAdvanceDays}
                  onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                  className="min-h-11"
                />
                <p className="text-xs text-muted-foreground">
                  {ru.settingsPage.maxAdvanceDaysHint}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company-cancel-hours">
                  Окно отмены и переноса клиентом (часов до визита)
                </Label>
                <Input
                  id="company-cancel-hours"
                  type="number"
                  min={0}
                  max={168}
                  value={clientCancelMinHours}
                  onChange={(e) => setClientCancelMinHours(Number(e.target.value))}
                  className="min-h-11"
                />
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowClientReschedule}
                    onChange={(e) => setAllowClientReschedule(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Разрешить клиентам самостоятельный перенос записи
                </label>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div>
                <h3 className="text-sm font-semibold">Напоминания клиентам</h3>
                <p className="text-xs text-muted-foreground">
                  Уведомляйте клиентов о предстоящих визитах вручную через WhatsApp или
                  автоматически.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="company-reminder-mode">Режим напоминаний</Label>
                  <select
                    id="company-reminder-mode"
                    value={reminderMode}
                    onChange={(e) => setReminderMode(e.target.value as ReminderMode)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <option value="OFF">Выключены</option>
                    <option value="MANUAL">Вручную (очередь WhatsApp)</option>
                    {(capabilities?.autoRemindersAvailable ?? false) && (
                      <option value="AUTO" disabled={!planSupportsAutoReminders}>
                        Автоматически (SMS/WhatsApp)
                        {!planSupportsAutoReminders ? ' — нужен тариф выше' : ''}
                      </option>
                    )}
                  </select>
                  {!planSupportsAutoReminders && (
                    <p className="text-xs text-muted-foreground">
                      Авто-напоминания доступны на старших тарифах.{' '}
                      <Link href="/dashboard/billing" className="underline text-primary">
                        Посмотреть тарифы
                      </Link>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="company-default-locale">Язык сообщений по умолчанию</Label>
                  <select
                    id="company-default-locale"
                    value={defaultLocale}
                    onChange={(e) => setDefaultLocale(e.target.value as LocaleCode)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <option value="RU">Русский (RU)</option>
                    <option value="KY">Кыргызча (KY)</option>
                  </select>
                </div>
              </div>

              {reminderMode !== 'OFF' && (
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={remind24h}
                      onChange={(e) => setRemind24h(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Напоминать за 24 часа
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={remind2h}
                      onChange={(e) => setRemind2h(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Напоминать за 2 часа
                  </label>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {isImpersonating && (
                <span className="text-xs text-muted-foreground">
                  Режим имперсонации: изменения отключены
                </span>
              )}
              <Button
                type="submit"
                disabled={isSavingSettings || isImpersonating}
                className="min-h-11"
              >
                {isSavingSettings ? ru.common.saving : ru.settingsPage.saveSettings}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Change Password Card */}
      <Card className="shadow-2xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
            {ru.settingsPage.passwordCardTitle}
          </CardTitle>
          <CardDescription>{ru.settingsPage.passwordCardDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
            {passwordError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{passwordError}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">{ru.settingsPage.currentPasswordLabel}</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-password">{ru.settingsPage.newPasswordLabel}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">{ru.settingsPage.confirmPasswordLabel}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="min-h-11"
                />
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button
                type="submit"
                variant="outline"
                disabled={isChangingPassword}
                className="min-h-11"
              >
                {isChangingPassword ? ru.common.saving : ru.settingsPage.changePasswordSubmit}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <OwnerGuard>
      <SettingsManagerContent />
    </OwnerGuard>
  );
}
