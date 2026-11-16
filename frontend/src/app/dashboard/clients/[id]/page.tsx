'use client';

import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  MessageCircle,
  Phone,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
import { Textarea } from '@/components/ui/textarea';
import {
  type ClientDetailDto,
  anonymizeClient,
  getClientDetail,
  updateClient,
} from '@/lib/api/clients.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';

export default function DashboardClientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const user = useAuthStore((s) => s.user);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const isOwner = user?.role === 'OWNER' && !isImpersonating;

  const [detail, setDetail] = useState<ClientDetailDto | null>(null);
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [anonymizeDialogOpen, setAnonymizeDialogOpen] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getClientDetail(id, { page, limit: 20 })
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setName(res.client.name);
        setNotes(res.client.notes ?? '');
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
  }, [id, page, reloadTick]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setIsSubmitting(true);
    try {
      await updateClient(detail.client.id, {
        name: name.trim(),
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success('Данные клиента сохранены');
      triggerReload();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleBlock() {
    if (!detail) return;
    setIsSubmitting(true);
    try {
      const nextBlocked = !detail.client.isBlocked;
      await updateClient(detail.client.id, { isBlocked: nextBlocked });
      toast.success(nextBlocked ? 'Клиент заблокирован для онлайн-записи' : 'Блокировка снята');
      setBlockDialogOpen(false);
      triggerReload();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAnonymize() {
    if (!detail) return;
    setIsSubmitting(true);
    try {
      await anonymizeClient(detail.client.id);
      toast.success('Персональные данные клиента обезличены');
      setAnonymizeDialogOpen(false);
      triggerReload();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-2 text-sm underline"
        >
          <ArrowLeft className="h-4 w-4" />К списку клиентов
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error ?? 'Клиент не найден'}
        </div>
      </div>
    );
  }

  const { client, appointments, meta } = detail;
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  const waPhone = client.phone.replace(/[^\d]/g, '');
  const isAnonymized = Boolean(client.anonymizedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/clients"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Клиенты
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            {client.isBlocked && (
              <Badge variant="destructive" className="gap-1">
                <Ban className="h-3.5 w-3.5" />
                Заблокирован
              </Badge>
            )}
            {isAnonymized && <Badge variant="outline">Обезличен</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{client.phone}</p>
        </div>

        {!isAnonymized && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`tel:${client.phone}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              <Phone className="h-4 w-4" />
              Позвонить
            </a>
            {waPhone && (
              <a
                href={`https://wa.me/${waPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            )}
            {isOwner && (
              <Button
                variant={client.isBlocked ? 'outline' : 'destructive'}
                size="sm"
                onClick={() => setBlockDialogOpen(true)}
                disabled={isSubmitting}
              >
                {client.isBlocked ? (
                  <>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Разблокировать
                  </>
                ) : (
                  <>
                    <ShieldAlert className="mr-1.5 h-4 w-4" />
                    Заблокировать
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Завершённые визиты</CardDescription>
            <CardTitle className="text-2xl">{client.stats.visits}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Неявки / Отмены</CardDescription>
            <CardTitle className="text-2xl">
              {client.stats.noShows} / {client.stats.cancellations}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Общая выручка</CardDescription>
            <CardTitle className="text-2xl">{client.stats.totalSpent} сом</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Следующий / последний визит</CardDescription>
            <CardTitle className="text-sm font-semibold">
              {client.stats.nextAppointmentAt
                ? `След.: ${new Date(client.stats.nextAppointmentAt).toLocaleDateString('ru-RU')}`
                : client.stats.lastVisitAt
                  ? `Посл.: ${new Date(client.stats.lastVisitAt).toLocaleDateString('ru-RU')}`
                  : 'Нет визитов'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile & Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Профиль и заметки</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="client-name">Имя</Label>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isOwner || isAnonymized}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-notes">Внутренние заметки</Label>
                <Textarea
                  id="client-notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Предпочтения клиента, особенности стрижки..."
                  disabled={!isOwner || isAnonymized}
                />
              </div>
              {isOwner && !isAnonymized && (
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  Сохранить
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Visit History */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">История записей ({meta.total})</CardTitle>
          </CardHeader>
          <CardContent>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Записей пока нет.</p>
            ) : (
              <div className="space-y-2">
                {appointments.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {a.service.name} — {a.master.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.startAt).toLocaleString('ru-RU')} • {a.price} сом
                      </div>
                      {a.clientNote && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Комментарий: {a.clientNote}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline">{ru.appointmentStatuses[a.status]}</Badge>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Страница {page} из {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Назад
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Вперёд
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isOwner && !isAnonymized && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Опасная зона</CardTitle>
            <CardDescription>
              Обезличивание удаляет имя, телефон и заметки клиента из базы и истории записей, но
              сохраняет суммы и статусы для финансовой аналитики. Действие необратимо.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setAnonymizeDialogOpen(true)}
              disabled={isSubmitting}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Обезличить данные клиента
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Block confirm dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {client.isBlocked ? 'Разблокировать клиента?' : 'Заблокировать клиента?'}
            </DialogTitle>
            <DialogDescription>
              {client.isBlocked
                ? 'Клиент снова сможет оформлять онлайн-записи по публичной ссылке.'
                : 'Онлайн-запись по этому номеру будет недоступна (с нейтральным сообщением). Администратор и мастера по-прежнему смогут записывать его вручную.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              variant={client.isBlocked ? 'default' : 'destructive'}
              onClick={handleToggleBlock}
              disabled={isSubmitting}
            >
              {client.isBlocked ? 'Разблокировать' : 'Заблокировать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anonymize confirm dialog */}
      <Dialog open={anonymizeDialogOpen} onOpenChange={setAnonymizeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Обезличить клиента «{client.name}»?</DialogTitle>
            <DialogDescription>
              Имя, телефон и заметки будут навсегда заменены на обезличенные значения, а ожидающие
              напоминания отменены. Выручка в отчётах сохранится.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnonymizeDialogOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleAnonymize} disabled={isSubmitting}>
              Подтвердить обезличивание
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
