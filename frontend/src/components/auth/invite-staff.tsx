'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient, getApiErrorMessage } from '@/lib/api/client';
import type { ApiSuccessEnvelope } from '@/types/api';

export function InviteStaff({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MASTER' | 'MANAGER'>('MASTER');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.post<ApiSuccessEnvelope<{ url: string }>>('/staff/invite', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
      });
      setUrl(result.data.data.url);
      onInvited();
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Пригласить сотрудника</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Сотрудник получит письмо и установит собственный пароль. Приглашённый сотрудник
          учитывается в лимите тарифа.
        </p>
        {!open && (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              setUrl('');
            }}
          >
            Пригласить по email
          </Button>
        )}
        {open && !url && (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="invite-name">Имя сотрудника</Label>
              <Input
                id="invite-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-email">Email сотрудника</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="invite-role">Роль сотрудника</Label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value === 'MANAGER' ? 'MANAGER' : 'MASTER')
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-xs"
              >
                <option value="MASTER">Мастер</option>
                <option value="MANAGER">Менеджер</option>
              </select>
              {role === 'MANAGER' && (
                <p className="text-sm text-muted-foreground">
                  Ведёт расписание и записи всех мастеров, просматривает карточки клиентов.
                </p>
              )}
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Создаём…' : 'Отправить приглашение'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {url && (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              Приглашение создано, письмо поставлено в очередь. Ссылка действует 60 минут;
              передавайте её только этому сотруднику.
            </p>
            <Input
              aria-label="Ссылка приглашения"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setUrl('');
                setName('');
                setEmail('');
                setRole('MASTER');
              }}
            >
              Готово
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
