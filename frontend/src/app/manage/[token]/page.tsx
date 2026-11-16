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
  type ManageDisableReason,
  type PublicManageAppointmentDto,
  cancelPublicManageAppointment,
  getPublicManageAppointment,
  getPublicManageAvailability,
  reschedulePublicManageAppointment,
} from '@/lib/api/public.api';
import {
  addDaysToLocalDateInTz,
  formatDateInCompanyTz,
  formatTimeInCompanyTz,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatPriceKgs, ru } from '@/lib/i18n/ru';
import type { AvailableSlotDto } from '@/types/api';

function buildDateStrip(timezone: string, days = 14) {
  const today = getTodayLocalDateInTz(timezone);
  const items: { date: string; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysToLocalDateInTz(today, i, timezone);
    const dt = new Date(`${d}T12:00:00Z`);
    const label = dt.toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    items.push({ date: d, label });
  }
  return items;
}

function getReasonText(reason: ManageDisableReason | null): string {
  switch (reason) {
    case 'WINDOW_CLOSED':
      return 'Окно самостоятельных изменений закрыто. Пожалуйста, позвоните или напишите в WhatsApp компании.';
    case 'RESCHEDULE_DISABLED':
      return 'Онлайн-перенос отключён компанией. Пожалуйста, свяжитесь с компанией напрямую.';
    case 'RESCHEDULE_LIMIT':
      return 'Достигнут лимит переносов записи (максимум 2). Для изменения времени свяжитесь с компанией.';
    case 'NOT_SCHEDULED':
      return 'Запись уже завершена или отменена.';
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
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const dateStrip = useMemo(() => (appt ? buildDateStrip(appt.company.timezone) : []), [appt]);

  useEffect(() => {
    if (!rescheduleOpen || !selectedDate) return;
    let cancelled = false;
    void getPublicManageAvailability(token, selectedDate)
      .then((res) => {
        if (!cancelled) setSlots(res.slots);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rescheduleOpen, selectedDate, token]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      const updated = await cancelPublicManageAppointment(
        token,
        cancelReason.trim() ? cancelReason.trim() : null,
      );
      setAppt(updated);
      setCancelOpen(false);
      toast.success('Запись отменена');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
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
      toast.success('Запись успешно перенесена');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
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
              Запись не найдена
            </CardTitle>
            <CardDescription>
              {error ?? 'Ссылка недействительна или запись была удалена.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">На главную</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const waPhone = appt.company.phone ? appt.company.phone.replace(/[^\d]/g, '') : '';

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-10">
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
              {ru.appointmentStatuses[appt.status]}
            </Badge>
          </div>
          <CardDescription>Управление вашей записью</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Дата:</span>
              <span className="font-semibold">
                {formatDateInCompanyTz(appt.startAt, appt.company.timezone)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Время:</span>
              <span className="font-bold">
                {formatTimeInCompanyTz(appt.startAt, appt.company.timezone)} –{' '}
                {formatTimeInCompanyTz(appt.endAt, appt.company.timezone)}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Услуга:</span>
              <span className="font-medium">{appt.service.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Мастер:</span>
              <span className="font-medium">{appt.master.name}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Стоимость:</span>
              <span className="font-bold text-primary">{formatPriceKgs(appt.service.price)}</span>
            </div>
            {appt.company.address && (
              <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  Адрес:
                </span>
                <span>{appt.company.address}</span>
              </div>
            )}
          </div>

          {appt.status === 'CANCELLED' && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Запись отменена ({appt.cancelledBy === 'CLIENT' ? 'вами' : 'администратором'}).
                {appt.cancelReason && <div className="text-xs">Причина: {appt.cancelReason}</div>}
              </div>
            </div>
          )}

          {appt.status === 'SCHEDULED' && (
            <div className="space-y-3">
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
                    Перенести время
                  </Button>
                )}
                {appt.actions.canCancel && (
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    Отменить запись
                  </Button>
                )}
              </div>

              {(!appt.actions.canCancel || !appt.actions.canReschedule) && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  {getReasonText(
                    appt.actions.cancelDisabledReason ?? appt.actions.rescheduleDisabledReason,
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
                Позвонить
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
              <Link href={`/b/${appt.company.slug}`}>Записаться на другой визит</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить запись?</DialogTitle>
            <DialogDescription>
              Слот станет доступен другим клиентам. При желании укажите причину.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Причина (необязательно)</Label>
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Изменились планы"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Назад
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={isCancelling}>
              Подтвердить отмену
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Выберите новую дату и время</DialogTitle>
            <DialogDescription>
              Мастер: {appt.master.name} • Услуга: {appt.service.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {dateStrip.map((item) => (
                <button
                  key={item.date}
                  type="button"
                  onClick={() => {
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
            ) : slots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                На выбранную дату нет свободных слотов.
              </p>
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
              Отмена
            </Button>
            <Button onClick={handleReschedule} disabled={!selectedSlot || isRescheduling}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Перенести
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
