'use client';

import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  MapPin,
  MessageCircle,
  Phone,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarButton } from '@/components/booking/calendar-button';
import { PublicLangSwitcher } from '@/components/booking/public-lang-switcher';
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
  getPublicErrorMessage,
  type ManageDisableReason,
  type PublicManageAppointmentDto,
  cancelPublicManageAppointment,
  getPublicManageAppointment,
  getPublicManageAvailability,
  reschedulePublicManageAppointment,
} from '@/lib/api/public.api';
import {
  addDaysToLocalDateInTz,
  formatTimeInCompanyTz,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import {
  formatPublicDate,
  getPublicLangFromCookie,
  PUBLIC_DICT,
  type PublicLang,
} from '@/lib/i18n/public-dict';
import { formatPriceKgs } from '@/lib/i18n/ru';
import type { AvailableSlotDto } from '@/types/api';

function buildDateStrip(timezone: string, lang: PublicLang, days = 14) {
  const today = getTodayLocalDateInTz(timezone);
  const items: { date: string; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysToLocalDateInTz(today, i, timezone);
    const dt = new Date(`${d}T12:00:00Z`);
    const label =
      lang === 'ky'
        ? `${dt.getUTCDate()}.${dt.getUTCMonth() + 1} ${['жк', 'дш', 'шш', 'шр', 'бш', 'жм', 'иш'][dt.getUTCDay()]}`
        : dt.toLocaleDateString('ru-RU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });
    items.push({ date: d, label });
  }
  return items;
}

function getReasonText(
  reason: ManageDisableReason | null,
  t: (typeof PUBLIC_DICT)[PublicLang],
): string {
  switch (reason) {
    case 'WINDOW_CLOSED':
      return t.windowClosedNotice;
    case 'RESCHEDULE_DISABLED':
      return t.rescheduleDisabled;
    case 'RESCHEDULE_LIMIT':
      return t.rescheduleLimit;
    case 'NOT_SCHEDULED':
      return t.notScheduled;
    default:
      return '';
  }
}

export default function ManageAppointmentPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [appt, setAppt] = useState<PublicManageAppointmentDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<AvailableSlotDto[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [lang, setLang] = useState<PublicLang>('ru');
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsRetry, setSlotsRetry] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const cookieLang = getPublicLangFromCookie();
      setLang(cookieLang);
      document.documentElement.lang = cookieLang;
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const t = PUBLIC_DICT[lang];
  const formatLocalDate = (value: string, tz: string) => formatPublicDate(value, tz, lang);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPublicManageAppointment(token)
      .then((data) => {
        if (cancelled) return;
        setAppt(data);
        setSelectedDate(getTodayLocalDateInTz(data.company.timezone));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getPublicErrorMessage(err, lang));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, lang]);

  const dateStrip = useMemo(
    () => (appt ? buildDateStrip(appt.company.timezone, lang) : []),
    [appt, lang],
  );

  useEffect(() => {
    if (!rescheduleOpen || !selectedDate) return;
    let cancelled = false;
    void getPublicManageAvailability(token, selectedDate)
      .then((res) => {
        if (!cancelled) {
          setSlots(res.slots);
          setSlotsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSlots([]);
          setSlotsError(getPublicErrorMessage(err, lang));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rescheduleOpen, selectedDate, token, lang, slotsRetry]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      const updated = await cancelPublicManageAppointment(
        token,
        cancelReason.trim() ? cancelReason.trim() : null,
      );
      setAppt(updated);
      setCancelOpen(false);
      toast.success(t.cancelledToast);
    } catch (err: unknown) {
      toast.error(getPublicErrorMessage(err, lang));
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleReschedule() {
    if (!selectedSlot) return;
    setIsRescheduling(true);
    try {
      const updated = await reschedulePublicManageAppointment(token, selectedSlot);
      setAppt(updated);
      setRescheduleOpen(false);
      setSelectedSlot(null);
      toast.success(t.rescheduledToast);
    } catch (err: unknown) {
      toast.error(getPublicErrorMessage(err, lang));
    } finally {
      setIsRescheduling(false);
    }
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <Skeleton className="h-72 w-full rounded-xl" />
      </main>
    );
  }

  if (error || !appt) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {lang === 'ky' ? 'Жазылуу табылган жок' : 'Запись не найдена'}
            </CardTitle>
            <CardDescription>
              {error ??
                (lang === 'ky'
                  ? 'Шилтеме жараксыз же жазылуу жок кылынган.'
                  : 'Ссылка недействительна или запись была удалена.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">{lang === 'ky' ? 'Башкы бетке' : 'На главную'}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const waPhone = appt.company.phone ? appt.company.phone.replace(/[^\d]/g, '') : '';

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="flex justify-end">
        <PublicLangSwitcher lang={lang} onChange={setLang} />
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xl">{appt.company.name}</CardTitle>
            <Badge
              variant={
                appt.status === 'CANCELLED'
                  ? 'destructive'
                  : appt.status === 'COMPLETED'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {lang === 'ky'
                ? {
                    SCHEDULED: 'Жазылган',
                    CONFIRMED: 'Ырасталган',
                    IN_PROGRESS: 'Аткарылууда',
                    COMPLETED: 'Аяктаган',
                    CANCELLED: 'Жокко чыгарылган',
                    NO_SHOW: 'Келген жок',
                  }[appt.status]
                : lang === 'en'
                  ? {
                      SCHEDULED: 'Scheduled',
                      CONFIRMED: 'Confirmed',
                      IN_PROGRESS: 'In progress',
                      COMPLETED: 'Completed',
                      CANCELLED: 'Cancelled',
                      NO_SHOW: 'No-show',
                    }[appt.status]
                  : {
                      SCHEDULED: 'Запланирована',
                      CONFIRMED: 'Подтверждена',
                      IN_PROGRESS: 'В процессе',
                      COMPLETED: 'Завершена',
                      CANCELLED: 'Отменена',
                      NO_SHOW: 'Неявка',
                    }[appt.status]}
            </Badge>
          </div>
          <CardDescription>{t.manageTitle}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.dateLabel}</span>
              <span className="font-semibold">
                {formatLocalDate(appt.startAt, appt.company.timezone)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.timeLabel}</span>
              <span className="font-bold">
                {formatTimeInCompanyTz(appt.startAt, appt.company.timezone)} –{' '}
                {formatTimeInCompanyTz(appt.endAt, appt.company.timezone)}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">{t.manageService}</span>
              <span className="font-medium">{appt.service.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.manageMaster}</span>
              <span className="font-medium">{appt.master.name}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">{t.managePrice}</span>
              <span className="font-bold text-primary">{formatPriceKgs(appt.service.price)}</span>
            </div>
            {appt.company.address && (
              <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {t.manageAddress}
                </span>
                <span>{appt.company.address}</span>
              </div>
            )}
          </div>

          {appt.prepayment && appt.prepayment.status !== 'NOT_REQUIRED' && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {appt.prepayment.status === 'PENDING'
                    ? t.prepaymentPending
                    : appt.prepayment.status === 'RECEIVED'
                      ? t.prepaymentReceived
                      : t.prepaymentRefunded}
                </span>
                {appt.prepayment.amount && (
                  <span className="font-bold text-foreground">
                    {formatPriceKgs(appt.prepayment.amount)}
                  </span>
                )}
              </div>
              {appt.prepayment.status === 'PENDING' && appt.prepayment.instructions && (
                <p className="whitespace-pre-line text-foreground">
                  {appt.prepayment.instructions}
                </p>
              )}
              {appt.prepayment.status === 'PENDING' && appt.prepayment.holdUntil && (
                <p className="text-muted-foreground">
                  {t.prepaymentDeadlinePrefix}{' '}
                  {formatLocalDate(appt.prepayment.holdUntil, appt.company.timezone)}{' '}
                  {formatTimeInCompanyTz(appt.prepayment.holdUntil, appt.company.timezone)}.
                </p>
              )}
              {appt.prepayment.status === 'PENDING' && appt.prepayment.whatsappProofUrl && (
                <Button asChild size="sm" className="w-full">
                  <a
                    href={appt.prepayment.whatsappProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.whatsappProofButton}
                  </a>
                </Button>
              )}
            </div>
          )}

          {appt.status === 'CANCELLED' && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {appt.cancelledBy === 'CLIENT'
                  ? t.cancelledByClient
                  : appt.cancelledBy === 'SYSTEM'
                    ? t.cancelledBySystem
                    : t.cancelledByStaff}
                {appt.cancelReason && (
                  <div className="text-xs">
                    {t.reason}: {appt.cancelReason}
                  </div>
                )}
              </div>
            </div>
          )}

          {(appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED') && (
            <div className="space-y-3">
              <CalendarButton
                startAt={appt.startAt}
                endAt={appt.endAt}
                title={`${appt.company.name}: ${appt.service.name}`}
                address={appt.company.address}
                lang={lang}
              />
              {appt.telegramBotUrl && (
                <Button asChild variant="secondary" className="min-h-11 w-full gap-2">
                  <a
                    href={appt.telegramBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="manage-telegram-bot-link"
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
              <div className="flex flex-wrap gap-2">
                {appt.actions.canReschedule && (
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setIsLoadingSlots(true);
                      setRescheduleOpen(true);
                    }}
                  >
                    <CalendarClock className="mr-1.5 h-4 w-4" />
                    {t.rescheduleButton}
                  </Button>
                )}
                {appt.actions.canCancel && (
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    {t.cancelButton}
                  </Button>
                )}
              </div>

              {(!appt.actions.canCancel || !appt.actions.canReschedule) && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  {getReasonText(
                    appt.actions.cancelDisabledReason ?? appt.actions.rescheduleDisabledReason,
                    t,
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            {appt.company.phone && (
              <a
                href={`tel:${appt.company.phone}`}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
              >
                <Phone className="h-3.5 w-3.5" />
                {t.call}
              </a>
            )}
            {waPhone && (
              <a
                href={`https://wa.me/${waPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </a>
            )}
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href={`/b/${appt.company.slug}`}>{t.bookAnother}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.confirmCancelTitle}</DialogTitle>
            <DialogDescription>
              {lang === 'ky'
                ? 'Бул убакыт башка кардарлар үчүн жеткиликтүү болот.'
                : 'Это время станет доступно другим клиентам.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">{t.cancelReasonLabel}</Label>
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t.cancelReasonLabel}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {t.back}
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={isCancelling}>
              {t.confirmCancelButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.chooseDateTimeTitle}</DialogTitle>
            <DialogDescription>
              {t.manageMaster} {appt.master.name} • {t.manageService} {appt.service.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {dateStrip.map((item) => (
                <button
                  key={item.date}
                  type="button"
                  onClick={() => {
                    if (item.date === selectedDate) return;
                    setIsLoadingSlots(true);
                    setSelectedDate(item.date);
                    setSelectedSlot(null);
                  }}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium ${
                    selectedDate === item.date
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {isLoadingSlots ? (
              <Skeleton className="h-24 w-full" />
            ) : slotsError ? (
              <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 p-4">
                <p className="text-sm text-destructive">{slotsError}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsLoadingSlots(true);
                    setSlotsRetry((key) => key + 1);
                  }}
                >
                  {t.retry}
                </Button>
              </div>
            ) : slots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t.noSlotsForDate}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    onClick={() => setSelectedSlot(slot.startAt)}
                    className={`rounded-lg border py-2 text-sm font-medium ${
                      selectedSlot === slot.startAt
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              {t.back}
            </Button>
            <Button onClick={handleReschedule} disabled={!selectedSlot || isRescheduling}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {t.confirmRescheduleButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
