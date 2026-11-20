'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient, getApiErrorMessage } from '@/lib/api/client';

export default function VerifyEmailPage() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState('');
  useEffect(() => {
    const value = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    queueMicrotask(() => setToken(value));
  }, []);
  async function confirm() {
    setState('busy');
    setError('');
    try {
      await apiClient.post('/auth/email-verification/confirm', { token });
      setToken('');
      setState('done');
    } catch (cause) {
      setError(getApiErrorMessage(cause));
      setState('ready');
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{state === 'done' ? 'Email подтверждён' : 'Подтверждение email'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {state === 'done'
              ? 'Адрес электронной почты подтверждён. Вернитесь в профиль.'
              : 'Нажмите кнопку, чтобы подтвердить адрес. Ссылка действует 60 минут.'}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {state !== 'done' && (
            <Button
              disabled={!/^[A-Za-z0-9_-]{43}$/.test(token) || state === 'busy'}
              onClick={() => void confirm()}
            >
              {state === 'busy' ? 'Подтверждаем…' : 'Подтвердить email'}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard/profile">В профиль</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
