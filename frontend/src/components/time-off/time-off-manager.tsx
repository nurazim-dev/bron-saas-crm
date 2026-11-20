'use client';

import { AlertTriangle, CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getApiErrorMessage } from '@/lib/api/client';
import {
  type TimeOffDto,
  type TimeOffKind,
  createTimeOff,
  deleteTimeOff,
  listTimeOff,
} from '@/lib/api/time-off.api';

const KIND_LABELS: Record<TimeOffKind, string> = {
  VACATION: 'Отпуск',
  SICK_LEAVE: 'Больничный',
  OTHER: 'Отсутствие',
};

interface TimeOffManagerProps {
  userId?: string;
  title?: string;
  description?: string;
  readOnly?: boolean;
}

export function TimeOffManager({
  userId,
  title = 'Отпуска и отсутствия',
  description = 'Периоды, когда онлайн-запись закрыта.',
  readOnly = false,
}: TimeOffManagerProps) {
  const [items, setItems] = useState<TimeOffDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<TimeOffKind>('VACATION');
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startAtLocal, setStartAtLocal] = useState('');
  const [endAtLocal, setEndAtLocal] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastConflictCount, setLastConflictCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listTimeOff(userId ? { userId } : undefined)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadTick]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await createTimeOff({
        ...(userId ? { userId } : {}),
        kind,
        allDay,
        ...(allDay
          ? { startDate, endDate }
          : {
              startAt: new Date(startAtLocal).toISOString(),
              endAt: new Date(endAtLocal).toISOString(),
            }),
        note: note.trim() ? note.trim() : null,
      });
      setLastConflictCount(res.conflicts.count);
      if (res.conflicts.count > 0) {
        toast.warning(
          `Отсутствие добавлено. Внимание: пересекается с существующими записями (${res.conflicts.count} шт.) — они не были отменены.`,
        );
      } else {
        toast.success('Период отсутствия добавлен');
      }
      setDialogOpen(false);
      setNote('');
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTimeOff(id);
      toast.success('Период отсутствия удалён');
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="h-4 w-4" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Добавить
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {lastConflictCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Обнаружено {lastConflictCount} пересекающихся записей в расписании. Они не отменены
            автоматически.
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Запланированных отсутствий нет.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
                    {item.userName && !userId && (
                      <span className="font-medium">{item.userName}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.startAt).toLocaleString('ru-RU')} —{' '}
                    {new Date(item.endAt).toLocaleString('ru-RU')}
                  </div>
                  {item.note && <div className="text-xs text-muted-foreground">{item.note}</div>}
                </div>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(item.id)}
                    aria-label="Удалить отсутствие"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить отсутствие</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="to-kind">Тип</Label>
              <select
                id="to-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as TimeOffKind)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="VACATION">Отпуск</option>
                <option value="SICK_LEAVE">Больничный</option>
                <option value="OTHER">Другое</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              Весь день (по датам)
            </label>

            {allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="to-start-date">Дата начала</Label>
                  <Input
                    id="to-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to-end-date">Дата окончания</Label>
                  <Input
                    id="to-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="to-start-dt">Начало</Label>
                  <Input
                    id="to-start-dt"
                    type="datetime-local"
                    value={startAtLocal}
                    onChange={(e) => setStartAtLocal(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to-end-dt">Окончание</Label>
                  <Input
                    id="to-end-dt"
                    type="datetime-local"
                    value={endAtLocal}
                    onChange={(e) => setEndAtLocal(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="to-note">Примечание (необязательно)</Label>
              <Input
                id="to-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Семейная поездка"
              />
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
    </Card>
  );
}
