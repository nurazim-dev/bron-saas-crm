'use client';

import {
  AlertCircle,
  Ban,
  Download,
  FileSpreadsheet,
  GitMerge,
  Search,
  Tag,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ClientImportDialog } from '@/components/clients/client-import-dialog';
import { ClientMergeDialog } from '@/components/clients/client-merge-dialog';
import { ClientTagsManager } from '@/components/clients/client-tags-manager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  type ClientListItemDto,
  type ClientSegment,
  type ClientSortOption,
  type ClientTagDto,
  downloadClientsCsv,
  listClientTags,
  listClients,
} from '@/lib/api/clients.api';
import { useAuthStore } from '@/stores/auth.store';

const SEGMENT_CHIPS: Array<{ value: ClientSegment; label: string }> = [
  { value: 'ALL', label: 'Все' },
  { value: 'NEW', label: 'Новые' },
  { value: 'REPEAT', label: 'Постоянные' },
  { value: 'VIP', label: 'VIP' },
  { value: 'AT_RISK', label: 'В зоне риска' },
  { value: 'LOST', label: 'Потерянные' },
  { value: 'NO_SHOW_RISK', label: 'Риск неявок' },
  { value: 'BLOCKED', label: 'Заблокированные' },
];

export default function DashboardClientsPage() {
  const user = useAuthStore((s) => s.user);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const isOwner = user?.role === 'OWNER' && !isImpersonating;

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ClientSortOption>('lastVisit');
  const [blocked, setBlocked] = useState<'' | 'true' | 'false'>('');
  const [segment, setSegment] = useState<ClientSegment>('ALL');
  const [tagId, setTagId] = useState('');
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  const [items, setItems] = useState<ClientListItemDto[]>([]);
  const [tags, setTags] = useState<ClientTagDto[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listClientTags()
      .then((res) => {
        if (!cancelled) setTags(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  useEffect(() => {
    let cancelled = false;
    void listClients({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(blocked ? { blocked } : {}),
      ...(tagId ? { tagId } : {}),
      ...(segment !== 'ALL' ? { segment } : {}),
      sort,
      page,
      limit: 20,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.meta.total);
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
  }, [search, sort, blocked, segment, tagId, page, reloadTick]);

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      await downloadClientsCsv({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(blocked ? { blocked } : {}),
        ...(tagId ? { tagId } : {}),
        ...(segment !== 'ALL' ? { segment } : {}),
      });
      toast.success('Экспорт клиентов CSV выполнен');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Клиенты</h1>
          <p className="text-sm text-muted-foreground">
            Сегменты, теги, история визитов, импорт и объединение дубликатов.
          </p>
        </div>

        {isOwner && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTagsDialogOpen(true)}
              className="gap-1.5"
            >
              <Tag className="h-3.5 w-3.5" aria-hidden="true" />
              Теги
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              className="gap-1.5"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              Импорт CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMergeDialogOpen(true)}
              className="gap-1.5"
            >
              <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
              Объединить
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isExporting}
              onClick={() => void handleExportCsv()}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Экспорт CSV
            </Button>
          </div>
        )}
      </div>

      {/* Segment chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Сегменты клиентов">
        {SEGMENT_CHIPS.map((chip) => (
          <Button
            key={chip.value}
            type="button"
            size="sm"
            variant={segment === chip.value ? 'default' : 'outline'}
            onClick={() => {
              setSegment(chip.value);
              setPage(1);
            }}
          >
            {chip.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск по имени или телефону"
              className="pl-9"
            />
          </div>

          <select
            aria-label="Фильтр по тегу"
            value={tagId}
            onChange={(e) => {
              setTagId(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все теги</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Сортировка клиентов"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ClientSortOption);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="lastVisit">Сначала недавние визиты</option>
            <option value="visits">По количеству визитов</option>
            <option value="totalSpent">По сумме визитов</option>
            <option value="noShows">По количеству неявок</option>
            <option value="name">По имени (А–Я)</option>
          </select>

          <select
            aria-label="Фильтр по статусу"
            value={blocked}
            onChange={(e) => {
              setBlocked(e.target.value as '' | 'true' | 'false');
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Любой статус</option>
            <option value="false">Активные</option>
            <option value="true">Заблокированные</option>
          </select>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Всего клиентов: {total}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Клиенты не найдены. Записи автоматически создают карточки клиентов.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Клиент</th>
                    <th className="py-2 pr-4">Теги</th>
                    <th className="py-2 pr-4">Визиты</th>
                    <th className="py-2 pr-4">Неявки</th>
                    <th className="py-2 pr-4">Выручка</th>
                    <th className="py-2 pr-4">Последний визит</th>
                    <th className="py-2 text-right">Карточка</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((client) => (
                    <tr key={client.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/dashboard/clients/${client.id}`}
                            className="font-medium hover:underline"
                          >
                            {client.name}
                          </Link>
                          {client.isBlocked && (
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                              <Ban className="h-3 w-3" />
                              Заблокирован
                            </Badge>
                          )}
                          {client.anonymizedAt && (
                            <Badge variant="outline" className="text-[10px]">
                              Удалён
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{client.phone}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {client.tags.map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="text-[10px]"
                              style={{ borderColor: tag.color, color: tag.color }}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-medium">{client.stats.visits}</td>
                      <td className="py-3 pr-4">{client.stats.noShows}</td>
                      <td className="py-3 pr-4">{client.stats.totalSpent} сом</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {client.stats.lastVisitAt
                          ? new Date(client.stats.lastVisitAt).toLocaleDateString('ru-RU')
                          : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/dashboard/clients/${client.id}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {isOwner && (
        <>
          <ClientTagsManager
            open={tagsDialogOpen}
            onOpenChange={setTagsDialogOpen}
            tags={tags}
            onTagsChanged={triggerReload}
          />
          <ClientMergeDialog
            open={mergeDialogOpen}
            onOpenChange={setMergeDialogOpen}
            onMerged={triggerReload}
          />
          <ClientImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            onImported={triggerReload}
          />
        </>
      )}
    </div>
  );
}
