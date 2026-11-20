'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient, getApiErrorMessage } from '@/lib/api/client';
import { formatDateTimeInCompanyTz } from '@/lib/datetime';
import { useAuthStore } from '@/stores/auth.store';
import type { ApiSuccessEnvelope } from '@/types/api';

interface Session {
  id: string;
  userAgent: string;
  companyName?: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export function SessionManager() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const timezone = useAuthStore((state) => state.company?.timezone ?? 'Asia/Bishkek');
  async function load() {
    setLoading(true);
    try {
      const response = await apiClient.get<ApiSuccessEnvelope<Session[]>>('/auth/sessions');
      setSessions(response.data.data);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    void apiClient
      .get<ApiSuccessEnvelope<Session[]>>('/auth/sessions')
      .then((response) => {
        if (!cancelled) setSessions(response.data.data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function revoke(session: Session) {
    setBusy(true);
    try {
      await apiClient.delete(`/auth/sessions/${session.id}`);
      if (session.current) {
        useAuthStore.getState().clearSession();
        router.replace('/login');
      } else {
        setSessions((rows) => rows.filter((row) => row.id !== session.id));
        setConfirmId(null);
      }
    } catch (cause) {
      setError(getApiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Устройства и сессии</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Завершите сессию устройства, которым больше не пользуетесь.
        </p>
        {loading && <p role="status">Загрузка сессий…</p>}
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
            <Button variant="outline" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-sm">Активных сессий нет.</p>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="space-y-2 rounded-lg border p-3">
            <p className="break-words text-sm font-medium">
              {session.current ? 'Это устройство' : 'Другое устройство'}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {session.userAgent || 'Браузер не указан'}
            </p>
            {session.companyName && (
              <p className="text-xs text-muted-foreground">Компания: {session.companyName}</p>
            )}
            <p className="text-xs">
              Последнее обновление: {formatDateTimeInCompanyTz(session.lastUsedAt, timezone)}
            </p>
            {confirmId === session.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm">Завершить сессию?</p>
                <Button disabled={busy} onClick={() => void revoke(session)}>
                  Завершить
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirmId(null)}>
                  Отмена
                </Button>
              </div>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => setConfirmId(session.id)}>
                Завершить сессию
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
