'use client';

import { AlertCircle, Plus, Tag, Trash2, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/lib/api/client';
import { type ClientTagDto, createClientTag, deleteClientTag } from '@/lib/api/clients.api';
import { ru } from '@/lib/i18n/ru';

const COLOR_PRESETS = ['#0f766e', '#2563eb', '#7c3aed', '#b45309', '#dc2626', '#475569'];

interface ClientTagsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: ClientTagDto[];
  onTagsChanged: () => void;
}

export function ClientTagsManager({
  open,
  onOpenChange,
  tags,
  onTagsChanged,
}: ClientTagsManagerProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название тега');
      return;
    }

    setIsSubmitting(true);
    try {
      await createClientTag({ name: trimmed, color });
      setName('');
      toast.success('Тег создан');
      onTagsChanged();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(tag: ClientTagDto) {
    setDeletingId(tag.id);
    setError(null);
    try {
      await deleteClientTag(tag.id);
      toast.success(`Тег «${tag.name}» удалён`);
      onTagsChanged();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="flex flex-row items-start justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
              Теги клиентов
            </DialogTitle>
            <DialogDescription>
              Создавайте метки для быстрой сегментации и фильтрации базы клиентов.
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

          <form onSubmit={handleCreate} className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-tag-name">Новый тег</Label>
              <Input
                id="new-tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: VIP, Постоянный, Скидка"
                maxLength={40}
                className="min-h-10"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5" role="group" aria-label="Цвет тега">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setColor(preset)}
                    className={`h-6 w-6 rounded-full border-2 transition-transform ${
                      color === preset ? 'scale-110 border-foreground' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: preset }}
                    aria-label={`Цвет ${preset}`}
                  />
                ))}
              </div>
              <Button type="submit" size="sm" disabled={isSubmitting} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Создать тег
              </Button>
            </div>
          </form>

          <div className="max-h-60 space-y-2 overflow-y-auto">
            {tags.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Теги ещё не созданы.</p>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="font-medium">{tag.name}</span>
                    {tag.clientCount !== undefined && (
                      <Badge variant="secondary" className="text-[11px]">
                        {tag.clientCount}
                      </Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={deletingId === tag.id}
                    onClick={() => void handleDelete(tag)}
                    aria-label={`Удалить тег ${tag.name}`}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
