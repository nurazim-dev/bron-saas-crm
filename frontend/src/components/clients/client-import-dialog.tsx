'use client';

import { AlertCircle, FileSpreadsheet, Upload, X } from 'lucide-react';
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  type ClientImportPreviewDto,
  type DuplicateImportStrategy,
  executeClientImport,
  previewClientImport,
} from '@/lib/api/clients.api';
import { ru } from '@/lib/i18n/ru';

interface ClientImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ClientImportDialog({ open, onOpenChange, onImported }: ClientImportDialogProps) {
  const [csvText, setCsvText] = useState('');
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateImportStrategy>('MERGE_TAGS');
  const [preview, setPreview] = useState<ClientImportPreviewDto | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setPreview(null);
    setError(null);
  }

  async function handlePreview() {
    setError(null);
    if (!csvText.trim()) {
      setError('Вставьте CSV-таблицу или выберите файл');
      return;
    }
    setIsLoadingPreview(true);
    try {
      const result = await previewClientImport({ csvText, duplicateStrategy });
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
      const res = await executeClientImport({ csvText, duplicateStrategy });
      toast.success(`Импорт завершён: создано ${res.created}, обновлено ${res.updated}`);
      setPreview(null);
      setCsvText('');
      onOpenChange(false);
      onImported();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="flex flex-row items-start justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
              Импорт клиентов из CSV
            </DialogTitle>
            <DialogDescription>
              Поддерживаются колонки «Имя», «Телефон», необязательные «Теги» и «Заметки» (до 500
              строк). Сначала выполняется проверка без записи в базу.
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Загрузить файл .csv</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => void handleFileSelect(e)}
                    className="sr-only"
                  />
                </label>

                <select
                  aria-label="Обработка дубликатов"
                  value={duplicateStrategy}
                  onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateImportStrategy)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="SKIP">Пропускать существующие телефоны</option>
                  <option value="UPDATE_EMPTY">Заполнять пустые заметки дубликатов</option>
                  <option value="MERGE_TAGS">Добавлять теги и пустые заметки</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="import-csv-text">Содержимое CSV</Label>
                <Textarea
                  id="import-csv-text"
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={'Имя,Телефон,Теги,Заметки\nДинара,+996555111222,VIP,Удобно утром'}
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  disabled={isLoadingPreview}
                  onClick={() => void handlePreview()}
                >
                  {isLoadingPreview ? 'Проверяем...' : 'Предпросмотр импорта'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Создать: {preview.summary.create}</Badge>
                <Badge variant="secondary">Обновить: {preview.summary.update}</Badge>
                <Badge variant="outline">Пропустить: {preview.summary.skip}</Badge>
                <Badge variant={preview.summary.error > 0 ? 'destructive' : 'outline'}>
                  Ошибки: {preview.summary.error}
                </Badge>
              </div>

              {preview.newTagsToCreate.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Будут автоматически созданы теги: {preview.newTagsToCreate.join(', ')}
                </p>
              )}

              <div className="max-h-60 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-2">#</th>
                      <th className="p-2">Имя</th>
                      <th className="p-2">Телефон</th>
                      <th className="p-2">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 25).map((row) => (
                      <tr key={row.rowNumber} className="border-b last:border-0">
                        <td className="p-2 text-muted-foreground">{row.rowNumber}</td>
                        <td className="p-2">{row.name || '—'}</td>
                        <td className="p-2">{row.normalizedPhone ?? (row.phone || '—')}</td>
                        <td className="p-2">
                          <span
                            className={
                              row.action === 'ERROR'
                                ? 'font-medium text-destructive'
                                : row.action === 'CREATE'
                                  ? 'font-medium text-emerald-700 dark:text-emerald-300'
                                  : 'text-muted-foreground'
                            }
                          >
                            {row.action === 'CREATE'
                              ? 'Создать'
                              : row.action === 'UPDATE'
                                ? 'Обновить'
                                : row.action === 'SKIP'
                                  ? 'Пропустить'
                                  : `Ошибка: ${row.reason ?? ''}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPreview(null)}
                  disabled={isExecuting}
                >
                  Назад
                </Button>
                <Button
                  type="button"
                  disabled={isExecuting || preview.summary.create + preview.summary.update === 0}
                  onClick={() => void handleExecute()}
                >
                  {isExecuting ? 'Импортируем...' : 'Выполнить импорт'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
