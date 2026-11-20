'use client';

import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Image from 'next/image';
import { CalendarButton } from '@/components/booking/calendar-button';
import { MasterProfile } from '@/components/booking/master-profile';
import { PublicLangSwitcher } from '@/components/booking/public-lang-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createPublicAppointment,
  getPublicAvailability,
  getPublicErrorCode,
  getPublicErrorMessage,
} from '@/lib/api/public.api';
import {
  addDaysToLocalDateInTz,
  formatTimeInCompanyTz,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatPriceKgs } from '@/lib/i18n/ru';
import {
  formatPublicDate,
  getPublicLangFromCookie,
  PUBLIC_DICT,
  type PublicLang,
} from '@/lib/i18n/public-dict';
import { formatPhoneDisplay, getWhatsAppUrl, normalizePhoneE164OrNull } from '@/lib/phone';
import type {
  PublicBookedAppointmentDto,
  PublicCompanyProfileDto,
  PublicMasterDto,
  PublicPrepaymentBlockDto,
  PublicServiceDto,
  PublicServicePackageDto,
} from '@/types/api';

type StepNumber = 1 | 2 | 3 | 4 | 5;

interface ResolvedSlotItem {
  startAt: string;
  label: string;
  masterId: string;
  masterName: string;
}

interface DateStripItem {
  date: string;
  weekdayShort: string;
  dayNum: string;
  monthShort: string;
}

function buildDateStrip(
  timezone: string,
  maxAdvanceDays: number,
  lang: PublicLang,
): DateStripItem[] {
  const today = getTodayLocalDateInTz(timezone);
  const count = Math.min(Math.max(1, maxAdvanceDays), 30);
  const items: DateStripItem[] = [];

  for (let i = 0; i <= count; i++) {
    const dateStr = addDaysToLocalDateInTz(today, i, timezone);
    const dt = DateTime.fromISO(dateStr, { zone: timezone }).setLocale(lang);
    items.push({
      date: dateStr,
      weekdayShort:
        lang === 'ky'
          ? (['дш', 'шш', 'шр', 'бш', 'жм', 'иш', 'жк'][dt.weekday - 1] ?? '')
          : dt.toFormat('ccc'),
      dayNum: dt.toFormat('d'),
      monthShort: dt.toFormat('LLL'),
    });
  }

  return items;
}

export function PublicBookingStepper({ profile }: { profile: PublicCompanyProfileDto }) {
  const { company, services, masters } = profile;
  const packages = useMemo(() => profile.packages ?? [], [profile.packages]);
  const timezone = company.timezone;
  const [lang, setLang] = useState<PublicLang>('ru');

  const dateStrip = useMemo(
    () => buildDateStrip(timezone, company.maxAdvanceDays, lang),
    [company.maxAdvanceDays, timezone, lang],
  );

  const [step, setStep] = useState<StepNumber>(1);
  const [selectedServices, setSelectedServices] = useState<PublicServiceDto[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<PublicServicePackageDto | null>(null);
  const selectedService = useMemo<PublicServiceDto | null>(() => {
    if (selectedPackage) {
      return {
        id: selectedPackage.serviceIds[0] ?? selectedPackage.id,
        name: selectedPackage.name,
        description: selectedPackage.description,
        durationMin: selectedPackage.totalDurationMin,
        price: selectedPackage.price,
        requiresPrepayment: selectedPackage.requiresPrepayment,
        prepaymentAmount: selectedPackage.prepaymentAmount ?? null,
      };
    }
    const first = selectedServices[0];
    if (!first) return null;
    const total = (values: string[]) =>
      (values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100).toFixed(2);
    return {
      ...first,
      name: selectedServices.map((service) => service.name).join(' + '),
      durationMin: selectedServices.reduce((sum, service) => sum + service.durationMin, 0),
      price: total(selectedServices.map((service) => service.price)),
      requiresPrepayment: selectedServices.some((service) => service.requiresPrepayment),
      prepaymentAmount: total(selectedServices.map((service) => service.prepaymentAmount ?? '0')),
    };
  }, [selectedPackage, selectedServices]);

  function getEffectiveSelection(master: PublicMasterDto | null): {
    price: string;
    durationMin: number;
  } {
    if (selectedPackage) {
      const durationMin = selectedPackage.items.reduce((sum, item) => {
        const override = master?.serviceOverrides?.find((o) => o.serviceId === item.serviceId);
        return sum + (override?.durationMin ?? item.durationMin);
      }, 0);
      return { price: selectedPackage.price, durationMin };
    }
    const totalMinor = selectedServices.reduce((sum, s) => {
      const override = master?.serviceOverrides?.find((o) => o.serviceId === s.id);
      return sum + Math.round(Number(override?.price ?? s.price) * 100);
    }, 0);
    const durationMin = selectedServices.reduce((sum, s) => {
      const override = master?.serviceOverrides?.find((o) => o.serviceId === s.id);
      return sum + (override?.durationMin ?? s.durationMin);
    }, 0);
    return { price: (totalMinor / 100).toFixed(2), durationMin };
  }
  const [selectedMasterChoice, setSelectedMasterChoice] = useState<'ANY' | string>('ANY');
  const [selectedDate, setSelectedDate] = useState<string>(
    () => dateStrip[0]?.date ?? getTodayLocalDateInTz(timezone),
  );
  const [selectedSlot, setSelectedSlot] = useState<ResolvedSlotItem | null>(null);

  const [slots, setSlots] = useState<ResolvedSlotItem[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Step 4 Client form state
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [websiteHoneypot, setWebsiteHoneypot] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 5 Confirmation state
  const [bookedAppointment, setBookedAppointment] = useState<PublicBookedAppointmentDto | null>(
    null,
  );
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [telegramBotUrl, setTelegramBotUrl] = useState<string | null>(null);
  const [prepaymentBlock, setPrepaymentBlock] = useState<PublicPrepaymentBlockDto | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const cookieLang = getPublicLangFromCookie();
      setLang(cookieLang);
      document.documentElement.lang = cookieLang;
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const formatDurationMin = (minutes: number) =>
    `${minutes} ${lang === 'ky' ? 'мүн' : lang === 'en' ? 'min' : 'мин'}`;
  const t = PUBLIC_DICT[lang];
  const formatLocalDate = (value: string, tz: string) => formatPublicDate(value, tz, lang);

  // Masters that perform the selected service or package
  const eligibleMasters = useMemo<PublicMasterDto[]>(() => {
    if (!selectedService) return [];
    const requiredIds = selectedPackage
      ? selectedPackage.serviceIds
      : selectedServices.map((service) => service.id);
    return masters.filter((m) => requiredIds.every((id) => m.serviceIds.includes(id)));
  }, [masters, selectedPackage, selectedService, selectedServices]);

  // Load slots when on Step 3
  useEffect(() => {
    if (step !== 3 || !selectedService || !selectedDate) {
      return;
    }

    if (eligibleMasters.length === 0) {
      return;
    }

    const specificMaster =
      selectedMasterChoice === 'ANY'
        ? null
        : (eligibleMasters.find((m) => m.id === selectedMasterChoice) ?? null);

    if (selectedMasterChoice !== 'ANY' && !specificMaster) {
      return;
    }

    let cancelled = false;
    const serviceId = selectedService.id;

    async function loadSlotsForDate() {
      try {
        const avail = selectedPackage
          ? await getPublicAvailability(company.slug, {
              masterId: specificMaster ? specificMaster.id : 'ANY',
              packageId: selectedPackage.id,
              date: selectedDate,
            })
          : await getPublicAvailability(company.slug, {
              masterId: specificMaster ? specificMaster.id : 'ANY',
              serviceId,
              serviceIds: selectedServices.map((service) => service.id),
              date: selectedDate,
            });

        if (cancelled) return;

        setSlotsError(null);
        const resolvedMasterId = specificMaster ? specificMaster.id : 'ANY';
        const resolvedMasterName = specificMaster ? specificMaster.name : t.anyAvailableMaster;

        setSlots(
          avail.slots.map((sl) => ({
            startAt: sl.startAt,
            label: sl.label,
            masterId: resolvedMasterId,
            masterName: resolvedMasterName,
          })),
        );
      } catch (err) {
        if (!cancelled) {
          setSlots([]);
          setSlotsError(getPublicErrorMessage(err, lang));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSlots(false);
        }
      }
    }

    void loadSlotsForDate();

    return () => {
      cancelled = true;
    };
  }, [
    company.slug,
    eligibleMasters,
    t.anyAvailableMaster,
    lang,
    selectedDate,
    selectedMasterChoice,
    selectedPackage,
    selectedService,
    selectedServices,
    slotsRefreshKey,
    step,
  ]);

  function handleSelectService(service: PublicServiceDto) {
    setSelectedPackage(null);
    setSelectedServices((items) => (items[0]?.id === service.id ? items : [service]));
    setSelectedMasterChoice('ANY');
    setSelectedSlot(null);
    setSubmitError(null);
    setStep(2);
  }

  function handleSelectPackage(pkg: PublicServicePackageDto) {
    setSelectedPackage(pkg);
    setSelectedServices([]);
    setSelectedMasterChoice('ANY');
    setSelectedSlot(null);
    setSubmitError(null);
    setStep(2);
  }

  function handleSelectMaster(choice: 'ANY' | string) {
    setSelectedMasterChoice(choice);
    setSelectedSlot(null);
    setSubmitError(null);
    setIsLoadingSlots(true);
    setStep(3);
  }

  function handleSelectDate(nextDate: string) {
    if (nextDate === selectedDate) return;
    setSelectedDate(nextDate);
    setSelectedSlot(null);
    setSubmitError(null);
    setIsLoadingSlots(true);
  }

  function handleSelectNextDay() {
    const idx = dateStrip.findIndex((d) => d.date === selectedDate);
    const nextItem = idx >= 0 ? dateStrip[idx + 1] : undefined;
    if (nextItem) {
      handleSelectDate(nextItem.date);
    }
  }

  function handleSelectSlot(slot: ResolvedSlotItem) {
    setSelectedSlot(slot);
    setSubmitError(null);
    setStep(4);
  }

  async function handleConfirmBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedService || !selectedSlot) return;
    setSubmitError(null);

    const trimmedName = clientName.trim();
    if (trimmedName.length < 2) {
      setSubmitError(t.nameInvalid);
      return;
    }

    const normalizedPhone = normalizePhoneE164OrNull(clientPhone);
    if (!normalizedPhone) {
      setSubmitError(t.phoneInvalid);
      return;
    }

    if (!consentAccepted) {
      setSubmitError(t.consentRequired);
      return;
    }

    setIsSubmitting(true);
    try {
      const commonPayload = {
        masterId: selectedSlot.masterId,
        startAt: selectedSlot.startAt,
        clientName: trimmedName,
        clientPhone: normalizedPhone,
        clientNote: clientNote.trim().length > 0 ? clientNote.trim() : null,
        consentAccepted: true,
        locale: lang === 'ky' ? ('KY' as const) : lang === 'en' ? ('EN' as const) : ('RU' as const),
        website: websiteHoneypot,
      };
      const result = await createPublicAppointment(
        company.slug,
        selectedPackage
          ? { ...commonPayload, packageId: selectedPackage.id }
          : {
              ...commonPayload,
              serviceId: selectedService.id,
              serviceIds: selectedServices.map((service) => service.id),
            },
      );

      setBookedAppointment(result.appointment);
      setManageUrl(result.manageUrl);
      setTelegramBotUrl(result.telegramBotUrl ?? null);
      setPrepaymentBlock(result.prepayment ?? null);
      setStep(5);
    } catch (err) {
      const code = getPublicErrorCode(err);
      if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_NOT_AVAILABLE') {
        const msg = t.slotTaken;
        toast.error(msg);
        setSubmitError(msg);
        setSelectedSlot(null);
        setIsLoadingSlots(true);
        setSlotsRefreshKey((k) => k + 1);
        setStep(3);
        return;
      }
      setSubmitError(getPublicErrorMessage(err, lang));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleResetFlow() {
    setBookedAppointment(null);
    setTelegramBotUrl(null);
    setSelectedPackage(null);
    setSelectedServices([]);
    setSelectedMasterChoice('ANY');
    setSelectedSlot(null);
    setClientNote('');
    setSubmitError(null);
    setStep(1);
  }

  if (services.length === 0 && packages.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="items-center text-center">
          <Sparkles className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">{t.noServices}</CardTitle>
          <CardDescription>{t.noServicesDesc}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <PublicLangSwitcher lang={lang} onChange={setLang} />
      </div>
      {/* Stepper Progress Pills (Steps 1–4) */}
      {step < 5 && (
        <nav aria-label={t.stepsLabel} className="grid grid-cols-4 gap-1.5">
          {[
            { num: 1 as const, label: t.stepService },
            { num: 2 as const, label: t.stepMaster },
            { num: 3 as const, label: t.stepDateTime },
            { num: 4 as const, label: t.stepContacts },
          ].map((item) => {
            const isActive = step === item.num;
            const isCompleted = step > item.num;
            return (
              <div
                key={item.num}
                className={`rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isCompleted
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'bg-muted/40 text-muted-foreground'
                }`}
              >
                {item.label}
              </div>
            );
          })}
        </nav>
      )}

      {/* STEP 1: Select Service or Package */}
      {step === 1 && (
        <div className="phase-enter space-y-5">
          <h2 className="text-lg font-bold">{t.chooseServiceTitle}</h2>

          {packages.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t.packagesTab}
              </p>
              <div className="grid gap-3">
                {packages.map((pkg) => {
                  const hasDiscount = Number(pkg.catalogTotalPrice) > Number(pkg.price);
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => handleSelectPackage(pkg)}
                      className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left shadow-2xs transition-colors hover:border-primary hover:bg-primary/10"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            <Package className="h-3 w-3" aria-hidden="true" />
                            {t.packageBadge}
                          </span>
                          <p className="font-semibold text-foreground break-words">{pkg.name}</p>
                        </div>
                        {pkg.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {pkg.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground break-words">
                          {t.packageIncludes}: {pkg.items.map((item) => item.name).join(' + ')}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            {formatDurationMin(pkg.totalDurationMin)}
                          </span>
                          {pkg.requiresPrepayment && pkg.prepaymentAmount && (
                            <span className="inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                              {t.prepaymentBadge}: {formatPriceKgs(pkg.prepaymentAmount)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {hasDiscount && (
                          <p className="text-xs text-muted-foreground line-through">
                            {formatPriceKgs(pkg.catalogTotalPrice)}
                          </p>
                        )}
                        <p className="text-base font-bold text-primary">
                          {formatPriceKgs(pkg.price)}
                        </p>
                        <span className="mt-1 inline-block text-xs font-medium text-muted-foreground">
                          {t.select} →
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {services.length > 0 && (
            <div className="space-y-2.5">
              {packages.length > 0 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.singleServicesTab}
                </p>
              )}
              <div className="grid gap-3">
                {services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleSelectService(service)}
                    className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border bg-card p-4 text-left shadow-2xs transition-colors hover:border-primary/60 hover:bg-primary/5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{service.name}</p>
                      {service.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {service.description}
                        </p>
                      )}
                      <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDurationMin(service.durationMin)}
                      </span>
                      {service.requiresPrepayment && service.prepaymentAmount && (
                        <span className="mt-1.5 ml-2 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          {t.prepaymentBadge}: {formatPriceKgs(service.prepaymentAmount)}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-primary">
                        {formatPriceKgs(service.price)}
                      </p>
                      <span className="mt-1 inline-block text-xs font-medium text-muted-foreground">
                        {t.select} →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && selectedService && !selectedPackage && (
        <fieldset className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
          <legend className="px-2 font-semibold">{t.additionalServices}</legend>
          {services
            .filter((service) => service.id !== selectedService.id)
            .map((service) => {
              const checked = selectedServices.some((item) => item.id === service.id);
              return (
                <label
                  key={service.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      !checked &&
                      (selectedServices.length >= 10 ||
                        selectedService.durationMin + service.durationMin > 720)
                    }
                    onChange={() => {
                      setSelectedServices((items) =>
                        checked
                          ? items.filter((item) => item.id !== service.id)
                          : [...items, service],
                      );
                      setSelectedMasterChoice('ANY');
                      setSelectedSlot(null);
                    }}
                    className="h-5 w-5 accent-primary"
                  />
                  <span>
                    {service.name} · {formatDurationMin(service.durationMin)} ·{' '}
                    {formatPriceKgs(service.price)}
                  </span>
                </label>
              );
            })}
          <p className="font-semibold" aria-live="polite">
            {t.selectionTotal}: {formatDurationMin(selectedService.durationMin)} ·{' '}
            {formatPriceKgs(selectedService.price)}
          </p>
          {selectedService.requiresPrepayment && (
            <p className="text-sm text-muted-foreground">
              {t.prepaymentBadge}: {formatPriceKgs(selectedService.prepaymentAmount ?? '0')}
            </p>
          )}
        </fieldset>
      )}

      {/* STEP 2: Select Master */}
      {step === 2 && selectedService && (
        <div className="phase-enter space-y-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              className="gap-1.5 px-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t.back}
            </Button>
            <Badge
              variant="secondary"
              className="min-w-0 whitespace-normal break-words text-right"
              style={{ flexShrink: 1 }}
            >
              {selectedService.name}
            </Badge>
          </div>

          <h2 className="text-lg font-bold">{t.chooseMasterTitle}</h2>

          {eligibleMasters.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardDescription>{t.noMasters}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3">
              {/* Any available master option */}
              <button
                type="button"
                onClick={() => handleSelectMaster('ANY')}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left shadow-2xs transition-colors hover:border-primary"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Users className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t.anyAvailableMaster}</p>
                    <p className="text-xs text-muted-foreground">{t.anyMasterDesc}</p>
                  </div>
                </div>
                <span className="text-xs font-medium text-primary">{t.select} →</span>
              </button>

              {/* Specific masters */}
              {eligibleMasters.map((master) => {
                const effective = getEffectiveSelection(master);
                return (
                  <div key={master.id} className="overflow-hidden rounded-2xl border bg-card">
                    <button
                      type="button"
                      onClick={() => handleSelectMaster(master.id)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left shadow-2xs transition-colors hover:border-primary/60 hover:bg-primary/5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                          {master.portfolio?.find((item) => item.kind === 'PHOTO') ? (
                            <Image
                              unoptimized
                              src={
                                master.portfolio.find((item) => item.kind === 'PHOTO')!.posterUrl
                              }
                              width={40}
                              height={40}
                              alt=""
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <User className="h-5 w-5" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{master.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDurationMin(effective.durationMin)} ·{' '}
                            {formatPriceKgs(effective.price)}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {t.select} →
                      </span>
                    </button>
                    <MasterProfile
                      master={master}
                      services={services}
                      lang={lang}
                      onSelect={() => handleSelectMaster(master.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Select Date & Time */}
      {step === 3 && selectedService && (
        <div className="phase-enter space-y-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(2)}
              className="gap-1.5 px-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t.back}
            </Button>
            <Badge
              variant="secondary"
              className="min-w-0 whitespace-normal break-words text-right"
              style={{ flexShrink: 1 }}
            >
              {selectedService.name}
            </Badge>
          </div>

          <h2 className="text-lg font-bold">{t.chooseDateTimeTitle}</h2>

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Horizontal Date Strip */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dateStrip.map((item) => {
              const isSelected = item.date === selectedDate;
              return (
                <button
                  key={item.date}
                  type="button"
                  onClick={() => handleSelectDate(item.date)}
                  className={`flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-xl border px-3 py-2 text-center transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                      : 'bg-card hover:bg-muted'
                  }`}
                >
                  <span className="text-[11px] uppercase opacity-80">{item.weekdayShort}</span>
                  <span className="text-base font-bold leading-tight">{item.dayNum}</span>
                  <span className="text-[11px] opacity-80">{item.monthShort}</span>
                </button>
              );
            })}
          </div>

          {/* Available Time Slots */}
          {isLoadingSlots ? (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ) : slotsError ? (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <p className="text-sm text-destructive">{slotsError}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setIsLoadingSlots(true);
                  setSlotsRefreshKey((key) => key + 1);
                }}
              >
                {t.retry}
              </Button>
            </div>
          ) : slots.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader className="items-center text-center">
                <Calendar className="mb-1 h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-base">{t.noSlotsForDate}</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Button type="button" variant="outline" onClick={handleSelectNextDay}>
                  {t.nextAvailableDate}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {slots.map((slot) => (
                <button
                  key={slot.startAt}
                  type="button"
                  onClick={() => handleSelectSlot(slot)}
                  className="flex min-h-11 items-center justify-center rounded-xl border bg-card px-3 py-2.5 text-sm font-semibold shadow-2xs transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                >
                  {slot.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Client Details & Confirmation Submit */}
      {step === 4 &&
        selectedService &&
        selectedSlot &&
        (() => {
          const chosenMaster =
            selectedSlot.masterId !== 'ANY'
              ? (eligibleMasters.find((m) => m.id === selectedSlot.masterId) ?? null)
              : null;
          const effectiveSummary = getEffectiveSelection(chosenMaster);
          return (
            <div className="phase-enter space-y-4">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(3)}
                  className="gap-1.5 px-2"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  {t.back}
                </Button>
              </div>

              <h2 className="text-lg font-bold">{t.enterDetailsTitle}</h2>

              {/* Booking Summary Card */}
              <Card className="border-primary/25 bg-primary/5 shadow-2xs">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-primary">{t.summary}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t.manageService}:</span>
                    <span className="min-w-0 break-words text-right font-semibold">
                      {selectedService.name} ({formatDurationMin(effectiveSummary.durationMin)})
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t.manageMaster}:</span>
                    <span className="font-medium">{selectedSlot.masterName}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t.dateLabel}:</span>
                    <span className="font-medium">
                      {formatLocalDate(selectedSlot.startAt, timezone)}, {selectedSlot.label}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-1.5">
                    <span className="text-muted-foreground">{t.managePrice}:</span>
                    <span className="text-base font-bold text-foreground">
                      {formatPriceKgs(effectiveSummary.price)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-2xs">
                <CardContent className="pt-5">
                  <form onSubmit={handleConfirmBooking} noValidate className="space-y-4">
                    {submitError && (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{submitError}</span>
                      </div>
                    )}

                    {/* Honeypot field — hidden from humans */}
                    <div className="sr-only" aria-hidden="true">
                      <Label htmlFor="booking-website">Website</Label>
                      <input
                        id="booking-website"
                        name="website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={websiteHoneypot}
                        onChange={(e) => setWebsiteHoneypot(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="public-client-name">{t.nameLabel}</Label>
                      <Input
                        id="public-client-name"
                        autoComplete="name"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder={t.namePlaceholder}
                        className="min-h-11"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="public-client-phone">{t.phoneLabel}</Label>
                      <Input
                        id="public-client-phone"
                        type="tel"
                        autoComplete="tel"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder={t.phoneHint}
                        className="min-h-11"
                      />
                      <p className="text-xs text-muted-foreground">{t.phoneHint}</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="public-client-note">{t.noteLabel}</Label>
                      <Input
                        id="public-client-note"
                        value={clientNote}
                        onChange={(e) => setClientNote(e.target.value)}
                        placeholder={t.notePlaceholder}
                        className="min-h-11"
                      />
                    </div>

                    <label className="flex items-start gap-2.5 text-sm leading-snug">
                      <input
                        id="public-consent"
                        type="checkbox"
                        checked={consentAccepted}
                        onChange={(e) => setConsentAccepted(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-input"
                      />
                      <span>
                        {t.consentPrefix}{' '}
                        <Link href="/privacy" target="_blank" className="text-primary underline">
                          {t.privacyLinkLabel}
                        </Link>
                      </span>
                    </label>

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="min-h-12 w-full text-base font-semibold"
                    >
                      {isSubmitting ? t.submitting : t.submitBooking}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          );
        })()}

      {/* STEP 5: Confirmation Screen */}
      {step === 5 && bookedAppointment && (
        <Card className="phase-enter border-emerald-500/30 shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl font-bold">{t.successTitle}</CardTitle>
            <CardDescription>{t.confirmedHint}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-2.5 rounded-xl border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t.dateLabel}:</span>
                <span className="font-semibold">
                  {formatLocalDate(bookedAppointment.startAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t.timeLabel}:</span>
                <span className="font-bold">
                  {formatTimeInCompanyTz(bookedAppointment.startAt, timezone)} –{' '}
                  {formatTimeInCompanyTz(bookedAppointment.endAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <span className="text-muted-foreground">{t.manageService}:</span>
                <span className="min-w-0 break-words text-right font-medium">
                  {bookedAppointment.service.name}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t.manageMaster}:</span>
                <span className="font-medium">{bookedAppointment.master.name}</span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <span className="text-muted-foreground">{t.managePrice}:</span>
                <span className="text-base font-bold text-primary">
                  {formatPriceKgs(bookedAppointment.service.price)}
                </span>
              </div>
              {bookedAppointment.company.address && (
                <div className="flex items-start justify-between border-t pt-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.manageAddress}:
                  </span>
                  <span className="text-right font-medium">
                    {bookedAppointment.company.address}
                  </span>
                </div>
              )}
            </div>

            {prepaymentBlock && prepaymentBlock.status === 'PENDING' && (
              <div className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{t.prepaymentRequiredTitle}</span>
                  {prepaymentBlock.amount && (
                    <span className="text-sm font-bold text-foreground">
                      {formatPriceKgs(prepaymentBlock.amount)}
                    </span>
                  )}
                </div>
                {prepaymentBlock.instructions && (
                  <p className="whitespace-pre-line text-foreground">
                    {prepaymentBlock.instructions}
                  </p>
                )}
                {prepaymentBlock.holdUntil && (
                  <p className="text-muted-foreground">
                    {t.prepaymentDeadlinePrefix}{' '}
                    {formatLocalDate(prepaymentBlock.holdUntil, bookedAppointment.company.timezone)}{' '}
                    {formatTimeInCompanyTz(
                      prepaymentBlock.holdUntil,
                      bookedAppointment.company.timezone,
                    )}
                    {t.prepaymentDeadlineSuffix}
                  </p>
                )}
                {prepaymentBlock.whatsappProofUrl && (
                  <Button asChild size="sm" variant="default" className="w-full gap-2">
                    <a
                      href={prepaymentBlock.whatsappProofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t.whatsappProofButton}
                    </a>
                  </Button>
                )}
              </div>
            )}

            {manageUrl && (
              <div className="space-y-2 rounded-xl border bg-muted/20 p-3.5 text-xs">
                <div className="font-medium text-foreground">{t.manageLinkTitle}</div>
                <div className="flex items-center gap-2">
                  <a
                    href={manageUrl}
                    className="min-w-0 flex-1 truncate font-mono text-primary underline"
                  >
                    {manageUrl}
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(manageUrl);
                      toast.success(t.copiedToast);
                    }}
                  >
                    {t.copyButton}
                  </Button>
                </div>
              </div>
            )}

            {telegramBotUrl && (
              <Button asChild variant="default" className="min-h-11 w-full gap-2">
                <a
                  href={telegramBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="client-telegram-bot-link"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {lang === 'ky'
                    ? 'Telegram аркылуу эскертүү алуу жана башкаруу'
                    : lang === 'en'
                      ? 'Get reminders & manage in Telegram'
                      : 'Получать напоминания и управлять в Telegram'}
                </a>
              </Button>
            )}

            <CalendarButton
              startAt={bookedAppointment.startAt}
              endAt={bookedAppointment.endAt}
              title={`${bookedAppointment.company.name}: ${bookedAppointment.service.name}`}
              address={bookedAppointment.company.address}
              lang={lang}
            />
            {bookedAppointment.company.phone && (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="min-h-11 flex-1 gap-2">
                  <a href={`tel:${bookedAppointment.company.phone}`}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {formatPhoneDisplay(bookedAppointment.company.phone)}
                  </a>
                </Button>
                {getWhatsAppUrl(bookedAppointment.company.phone) && (
                  <Button asChild variant="outline" className="min-h-11 flex-1 gap-2">
                    <a
                      href={getWhatsAppUrl(bookedAppointment.company.phone) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                      WhatsApp
                    </a>
                  </Button>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="secondary"
              onClick={handleResetFlow}
              className="min-h-11 w-full"
            >
              {t.bookAnother}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
