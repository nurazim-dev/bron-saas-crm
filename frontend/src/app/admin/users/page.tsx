'use client';

import { AlertCircle, Copy, KeyRound, Search, ShieldOff, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AdminUserItem,
  activateAdminUser,
  createAdminUserPasswordResetLink,
  deactivateAdminUser,
  listAdminUsers,
  revokeAdminUserSessions,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import type { Role } from '@/types/api';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetExpiresAt, setResetExpiresAt] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAdminUsers({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(role ? { role } : {}),
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
  }, [search, role, page, reloadTick]);

  async function handleToggleActive(user: AdminUserItem) {
    setIsSubmitting(true);
    try {
      if (user.isActive) {
        await deactivateAdminUser(user.id);
        toast.success('Пользователь отключён');
      } else {
        await activateAdminUser(user.id);
        toast.success('Пользователь активирован');
      }
      await loadUsers();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeSessions(user: AdminUserItem) {
    setIsSubmitting(true);
    try {
      await revokeAdminUserSessions(user.id);
      toast.success('Все сессии пользователя отозваны');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetLink(user: AdminUserItem) {
    setIsSubmitting(true);
    try {
      const res = await createAdminUserPasswordResetLink(user.id, false);
      setResetUrl(res.url);
      setResetExpiresAt(res.expiresAt);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyResetUrl() {
    if (!resetUrl) return;
    await navigator.clipboard.writeText(resetUrl);
    toast.success('Ссылка скопирована');
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Пользователи</h1>
        <p className="text-sm text-muted-foreground">
          Поиск владельцев и мастеров, управление доступом и сессиями.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Имя, email или телефон"
              className="pl-9"
            />
          </div>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role | '');
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Все роли</option>
            <option value="OWNER">Владельцы</option>
            <option value="MASTER">Мастера</option>
            <option value="MANAGER">Менеджеры</option>
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
          <CardTitle className="text-base">Найдено: {total}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Пользователи не найдены.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">Пользователь</th>
                    <th className="py-2 pr-4">Компания</th>
                    <th className="py-2 pr-4">Роль</th>
                    <th className="py-2 pr-4">Статус</th>
                    <th className="py-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.email ?? '—'} {u.phone ? `• ${u.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Link href={`/admin/companies/${u.company.id}`} className="hover:underline">
                          {u.company.name}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">{ru.roles[u.role]}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={u.isActive ? 'secondary' : 'outline'}>
                          {u.isActive ? 'Активен' : 'Отключён'}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleActive(u)}
                            disabled={isSubmitting}
                          >
                            {u.isActive ? (
                              <>
                                <ShieldOff className="mr-1 h-3.5 w-3.5" />
                                Отключить
                              </>
                            ) : (
                              <>
                                <UserCheck className="mr-1 h-3.5 w-3.5" />
                                Включить
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRevokeSessions(u)}
                            disabled={isSubmitting}
                          >
                            Сбросить сессии
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResetLink(u)}
                            disabled={isSubmitting || !u.hasLogin}
                          >
                            <KeyRound className="mr-1 h-3.5 w-3.5" />
                            Ссылка сброса
                          </Button>
                        </div>
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

      <Dialog open={Boolean(resetUrl)} onOpenChange={(open) => !open && setResetUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Одноразовая ссылка сброса пароля</DialogTitle>
            <DialogDescription>
              Действует до {resetExpiresAt ? new Date(resetExpiresAt).toLocaleString('ru-RU') : '—'}
              . Передайте пользователю по безопасному каналу.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted p-3 font-mono text-xs break-all">
            {resetUrl}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUrl(null)}>
              Закрыть
            </Button>
            <Button onClick={copyResetUrl}>
              <Copy className="mr-1.5 h-4 w-4" />
              Копировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
