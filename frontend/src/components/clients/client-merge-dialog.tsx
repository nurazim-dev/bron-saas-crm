'use client';

import { AlertCircle, AlertTriangle, ArrowRight, GitMerge, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  type ClientListItemDto,
  type ClientMergePreviewDto,
  executeClientMerge,
  listClients,
  previewClientMerge,
} from '@/lib/api/clients.api';
import { ru } from '@/lib/i18n/ru';

interface ClientMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSourceClientId?: string;
  onMerged: (targetClientId: string) => void;
}

export function ClientMergeDialog({
  open,
  onOpenChange,
  initialSourceClientId,
  onMerged,
}: ClientMergeDialogProps) {
  const [candidates, setCandidates] = useState<ClientListItemDto[]>([]);
  const [sourceClientId, setSourceClientId] = useState(initialSourceClientId ?? '');
  const [targetClientId, setTargetClientId] = useState('');
  const [notesStrategy, setNotesStrategy] = useState<'CONCAT' | 'KEEP_TARGET' | 'KEEP_SOURCE'>(
    'CONCAT',
  );
  const [preview, setPreview] = useState<ClientMergePreviewDto | null>(null);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listClients({ limit: 100, sort: 'name' })
      .then((res) => {
        if (cancelled) return;
        const active = res.items.filter((c) => !c.anonymizedAt);
        setCandidates(active);
        const firstSource = initialSourceClientId || active[0]?.id || '';
        const firstTarget = active.find((c) => c.id !== firstSource)?.id || '';
        setSourceClientId(firstSource);
        setTargetClientId(firstTarget);
        setPreview(null);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialSourceClientId]);

  async function handlePreview() {
    setError(null);
    if (!sourceClientId || !targetClientId) {
      setError('Выберите обоих клиентов для объединения');
      return;
    }
    if (sourceClientId === targetClientId) {
      setError('Нельзя объединить клиента с самим собой');
      return;
    }
    setIsLoadingPreview(true);
    try {
      const result = await previewClientMerge({ sourceClientId, targetClientId, notesStrategy });
      setPreview(result);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleExecute() {
    if (!preview) return;
    setError(null);
    setIsExecuting(true);
    try {
      const res = await executeClientMerge({
        sourceClientId: preview.source.id,
        targetClientId: preview.target.id,
        notesStrategy,
      });
      toast.success(`Клиенты объединены (перенесено записей: ${res.movedAppointmentsCount})`);
      onOpenChange(false);
      onMerged(res.targetClientId);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="flex flex-row items-start justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-primary" aria-hidden="true" />
              Объединение дубликатов клиентов
            </DialogTitle>
            <DialogDescription>
              Все визиты, заметки и теги дубликата будут перенесены на основную карточку без потери
              истории.
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={ru.common.close}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {!preview ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="merge-source-select">Дубликат (источник)</Label>
                <select
                  id="merge-source-select"
                  value={sourceClientId}
                  disabled={isLoadingCandidates}
                  onChange={(e) => setSourceClientId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Выберите клиента-источника</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="merge-target-select">Основной клиент (цель)</Label>
                <select
                  id="merge-target-select"
                  value={targetClientId}
                  disabled={isLoadingCandidates}
                  onChange={(e) => setTargetClientId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Выберите основного клиента</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="merge-notes-strategy">Стратегия заметок</Label>
                <select
                  id="merge-notes-strategy"
                  value={notesStrategy}
                  onChange={(e) =>
                    setNotesStrategy(e.target.value as 'CONCAT' | 'KEEP_TARGET' | 'KEEP_SOURCE')
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="CONCAT">Объединить заметки обеих карточек</option>
                  <option value="KEEP_TARGET">Оставить заметку основного клиента</option>
                  <option value="KEEP_SOURCE">Взять заметку из дубликата</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  disabled={isLoadingPreview || candidates.length < 2}
                  onClick={() => void handlePreview()}
                >
                  {isLoadingPreview ? 'Проверка...' : 'Предпросмотр слияния'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid items-center gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_auto_1fr]">
                <div>
                  <p className="text-xs text-muted-foreground">Будет объединён</p>
                  <p className="font-semibold">{preview.source.name}</p>
                  <p className="text-xs text-muted-foreground">{preview.source.phone}</p>
                  <p className="mt-1 text-xs">Записей: {preview.source.totalAppointments}</p>
                </div>
                <ArrowRight className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Основной клиент</p>
                  <p className="font-semibold">{preview.target.name}</p>
                  <p className="text-xs text-muted-foreground">{preview.target.phone}</p>
                  <p className="mt-1 text-xs">Записей сейчас: {preview.target.totalAppointments}</p>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Перенесётся записей:</span>
                  <span className="font-semibold">{preview.appointmentsToMove}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Итоговая блокировка:</span>
                  <span className="font-semibold">
                    {preview.resultingIsBlocked ? 'Заблокирован' : 'Активен'}
                  </span>
                </div>
                {preview.resultingTags.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Итоговые теги:</span>
                    <div className="flex flex-wrap gap-1">
                      {preview.resultingTags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="outline"
                          style={{ borderColor: tag.color, color: tag.color }}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {preview.resultingNotes && (
                  <div className="space-y-1 border-t pt-2">
                    <span className="text-xs text-muted-foreground">Итоговые заметки:</span>
                    <p className="whitespace-pre-line text-xs">{preview.resultingNotes}</p>
                  </div>
                )}
              </div>

              {preview.warnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    {preview.warnings.includes('SOURCE_BLOCKED') && (
                      <p>Дубликат был заблокирован — блокировка сохранится на основной карточке.</p>
                    )}
                    {preview.warnings.includes('HAS_UPCOMING_APPOINTMENTS') && (
                      <p>У дубликата есть предстоящие записи; они также будут перенесены.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPreview(null)}
                  disabled={isExecuting}
                >
                  Назад
                </Button>
                <Button type="button" disabled={isExecuting} onClick={() => void handleExecute()}>
                  {isExecuting ? 'Объединяем...' : 'Подтвердить объединение'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
