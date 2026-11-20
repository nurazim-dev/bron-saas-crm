'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient, getApiErrorMessage } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth.store';

export function EmailVerification() {
  const user = useAuthStore((state) => state.user);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!user?.email) return null;
  async function request() {
    setBusy(true);
    try {
      await apiClient.post('/auth/email-verification/request');
      setMessage('Письмо отправлено. Проверьте входящие и папку «Спам».');
    } catch (cause) {
      setMessage(getApiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <p>{user.emailVerifiedAt ? 'Email подтверждён' : 'Email пока не подтверждён'}</p>
      {!user.emailVerifiedAt && (
        <Button variant="outline" disabled={busy} onClick={() => void request()}>
          {busy ? 'Отправляем…' : 'Подтвердить email'}
        </Button>
      )}
      <p role="status" className="text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
