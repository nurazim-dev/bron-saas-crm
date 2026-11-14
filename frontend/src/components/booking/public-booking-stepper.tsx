'use client';

import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
  formatDateInCompanyTz,
  formatTimeInCompanyTz,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay, getWhatsAppUrl, normalizePhoneE164OrNull } from '@/lib/phone';
import type {
  PublicBookedAppointmentDto,
  PublicCompanyProfileDto,
  PublicMasterDto,
  PublicServiceDto,
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

function buildDateStrip(timezone: string, maxAdvanceDays: number): DateStripItem[] {
  const today = getTodayLocalDateInTz(timezone);
  const count = Math.min(Math.max(1, maxAdvanceDays), 30);
  const items: DateStripItem[] = [];

  for (let i = 0; i <= count; i++) {
    const dateStr = addDaysToLocalDateInTz(today, i, timezone);
    const dt = DateTime.fromISO(dateStr, { zone: timezone }).setLocale('ru');
    items.push({
      date: dateStr,
      weekdayShort: dt.toFormat('ccc'),
      dayNum: dt.toFormat('d'),
      monthShort: dt.toFormat('LLL'),
    });
  }

  return items;
}

export function PublicBookingStepper({ profile }: { profile: PublicCompanyProfileDto }) {
  const { company, services, masters } = profile;
  const timezone = company.timezone;

  const dateStrip = useMemo(
    () => buildDateStrip(timezone, company.maxAdvanceDays),
    [company.maxAdvanceDays, timezone],
  );

  const [step, setStep] = useState<StepNumber>(1);
  const [selectedService, setSelectedService] = useState<PublicServiceDto | null>(null);
  const [selectedMasterChoice, setSelectedMasterChoice] = useState<'ANY' | string>('ANY');
  const [selectedDate, setSelectedDate] = useState<string>(
    () => dateStrip[0]?.date ?? getTodayLocalDateInTz(timezone),
  );
  const [selectedSlot, setSelectedSlot] = useState<ResolvedSlotItem | null>(null);

  const [slots, setSlots] = useState<ResolvedSlotItem[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);

  // Step 4 Client form state
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [websiteHoneypot, setWebsiteHoneypot] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 5 Confirmation state
  const [bookedAppointment, setBookedAppointment] = useState<PublicBookedAppointmentDto | null>(
    null,
  );

  // Masters that perform the selected service
  const eligibleMasters = useMemo<PublicMasterDto[]>(() => {
    if (!selectedService) return [];
    return masters.filter((m) => m.serviceIds.includes(selectedService.id));
  }, [masters, selectedService]);

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
        const avail = await getPublicAvailability(company.slug, {
          masterId: specificMaster ? specificMaster.id : 'ANY',
          serviceId,
          date: selectedDate,
        });

        if (cancelled) return;

        const resolvedMasterId = specificMaster ? specificMaster.id : 'ANY';
        const resolvedMasterName = specificMaster
          ? specificMaster.name
          : ru.publicBooking.anyMasterTitle;

        setSlots(
          avail.slots.map((sl) => ({
            startAt: sl.startAt,
            label: sl.label,
            masterId: resolvedMasterId,
            masterName: resolvedMasterName,
          })),
        );
      } catch {
        if (!cancelled) {
          setSlots([]);
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
    selectedDate,
    selectedMasterChoice,
    selectedService,
    slotsRefreshKey,
    step,
  ]);

  function handleSelectService(service: PublicServiceDto) {
    setSelectedService(service);
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
      setSubmitError(ru.validation.nameMin);
      return;
    }

    const normalizedPhone = normalizePhoneE164OrNull(clientPhone);
    if (!normalizedPhone) {
      setSubmitError(ru.validation.phoneInvalid);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createPublicAppointment(company.slug, {
        serviceId: selectedService.id,
        masterId: selectedSlot.masterId,
        startAt: selectedSlot.startAt,
        clientName: trimmedName,
        clientPhone: normalizedPhone,
        clientNote: clientNote.trim().length > 0 ? clientNote.trim() : null,
        website: websiteHoneypot,
      });

      setBookedAppointment(result.appointment);
      setStep(5);
    } catch (err) {
      const code = getPublicErrorCode(err);
      if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_NOT_AVAILABLE') {
        const msg = ru.publicBooking.slotTakenConflict;
        toast.error(msg);
        setSubmitError(msg);
        setSelectedSlot(null);
        setIsLoadingSlots(true);
        setSlotsRefreshKey((k) => k + 1);
        setStep(3);
        return;
      }
      setSubmitError(getPublicErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleResetFlow() {
    setBookedAppointment(null);
    setSelectedService(null);
    setSelectedMasterChoice('ANY');
    setSelectedSlot(null);
    setClientNote('');
    setSubmitError(null);
    setStep(1);
  }

  if (services.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="items-center text-center">
          <Sparkles className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">{ru.publicBooking.noServicesTitle}</CardTitle>
          <CardDescription>{ru.publicBooking.noServicesDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stepper Progress Pills (Steps 1–4) */}
      {step < 5 && (
        <nav aria-label="Шаги онлайн-записи" className="grid grid-cols-4 gap-1.5">
          {[
            { num: 1 as const, label: ru.publicBooking.step1Label },
            { num: 2 as const, label: ru.publicBooking.step2Label },
            { num: 3 as const, label: ru.publicBooking.step3Label },
            { num: 4 as const, label: ru.publicBooking.step4Label },
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

      {/* STEP 1: Select Service */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">{ru.publicBooking.step1Title}</h2>
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
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-primary">
                    {formatPriceKgs(service.price)}
                  </p>
                  <span className="mt-1 inline-block text-xs font-medium text-muted-foreground">
                    {ru.publicBooking.selectButton} →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2: Select Master */}
      {step === 2 && selectedService && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              className="gap-1.5 px-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {ru.publicBooking.backButton}
            </Button>
            <Badge variant="secondary">{selectedService.name}</Badge>
          </div>

          <h2 className="text-lg font-bold">{ru.publicBooking.step2Title}</h2>

          {eligibleMasters.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardDescription>{ru.appointmentDialog.noMastersForService}</CardDescription>
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
                    <p className="font-semibold text-foreground">
                      {ru.publicBooking.anyMasterTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ru.publicBooking.anyMasterDescription}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-primary">
                  {ru.publicBooking.selectButton} →
                </span>
              </button>

              {/* Specific masters */}
              {eligibleMasters.map((master) => (
                <button
                  key={master.id}
                  type="button"
                  onClick={() => handleSelectMaster(master.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left shadow-2xs transition-colors hover:border-primary/60 hover:bg-primary/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                      <User className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="font-semibold text-foreground">{master.name}</p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {ru.publicBooking.selectButton} →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Select Date & Time */}
      {step === 3 && selectedService && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(2)}
              className="gap-1.5 px-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {ru.publicBooking.backButton}
            </Button>
            <Badge variant="secondary">{selectedService.name}</Badge>
          </div>

          <h2 className="text-lg font-bold">{ru.publicBooking.step3Title}</h2>

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
          ) : slots.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader className="items-center text-center">
                <Calendar className="mb-1 h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-base">{ru.publicBooking.noSlotsForDate}</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Button type="button" variant="outline" onClick={handleSelectNextDay}>
                  {ru.publicBooking.nextDayButton}
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
      {step === 4 && selectedService && selectedSlot && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(3)}
              className="gap-1.5 px-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {ru.publicBooking.backButton}
            </Button>
          </div>

          <h2 className="text-lg font-bold">{ru.publicBooking.step4Title}</h2>

          {/* Booking Summary Card */}
          <Card className="border-primary/25 bg-primary/5 shadow-2xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-primary">
                {ru.publicBooking.summaryTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.serviceLabel}:</span>
                <span className="font-semibold">{selectedService.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.masterLabel}:</span>
                <span className="font-medium">{selectedSlot.masterName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.dateLabel}:</span>
                <span className="font-medium">
                  {formatDateInCompanyTz(selectedSlot.startAt, timezone)}, {selectedSlot.label}
                </span>
              </div>
              <div className="flex justify-between border-t pt-1.5">
                <span className="text-muted-foreground">{ru.appointmentDialog.priceLabel}:</span>
                <span className="text-base font-bold text-foreground">
                  {formatPriceKgs(selectedService.price)}
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
                  <Label htmlFor="public-client-name">{ru.publicBooking.clientNameLabel}</Label>
                  <Input
                    id="public-client-name"
                    autoComplete="name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder={ru.publicBooking.clientNamePlaceholder}
                    className="min-h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="public-client-phone">{ru.publicBooking.clientPhoneLabel}</Label>
                  <Input
                    id="public-client-phone"
                    type="tel"
                    autoComplete="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder={ru.publicBooking.clientPhonePlaceholder}
                    className="min-h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    {ru.publicBooking.clientPhoneHint}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="public-client-note">{ru.publicBooking.clientNoteLabel}</Label>
                  <Input
                    id="public-client-note"
                    value={clientNote}
                    onChange={(e) => setClientNote(e.target.value)}
                    placeholder={ru.publicBooking.clientNotePlaceholder}
                    className="min-h-11"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-12 w-full text-base font-semibold"
                >
                  {isSubmitting
                    ? ru.publicBooking.submittingBooking
                    : ru.publicBooking.submitBooking}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 5: Confirmation Screen */}
      {step === 5 && bookedAppointment && (
        <Card className="border-emerald-500/30 shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl font-bold">{ru.publicBooking.confirmTitle}</CardTitle>
            <CardDescription>{ru.publicBooking.confirmSubtitle}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-2.5 rounded-xl border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.dateLabel}:</span>
                <span className="font-semibold">
                  {formatDateInCompanyTz(bookedAppointment.startAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.timeLabel}:</span>
                <span className="font-bold">
                  {formatTimeInCompanyTz(bookedAppointment.startAt, timezone)} –{' '}
                  {formatTimeInCompanyTz(bookedAppointment.endAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">{ru.appointmentDialog.serviceLabel}:</span>
                <span className="font-medium">{bookedAppointment.service.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{ru.appointmentDialog.masterLabel}:</span>
                <span className="font-medium">{bookedAppointment.master.name}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">{ru.appointmentDialog.priceLabel}:</span>
                <span className="text-base font-bold text-primary">
                  {formatPriceKgs(bookedAppointment.service.price)}
                </span>
              </div>
              {bookedAppointment.company.address && (
                <div className="flex items-start justify-between border-t pt-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    Адрес:
                  </span>
                  <span className="text-right font-medium">
                    {bookedAppointment.company.address}
                  </span>
                </div>
              )}
            </div>

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
              {ru.publicBooking.bookAnotherButton}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
