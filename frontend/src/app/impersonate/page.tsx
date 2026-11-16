'use client';

import { AlertCircle, Loader2, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { exchangeImpersonationCode } from '@/lib/api/auth.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';

export default function ImpersonateExchangePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function exchange() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code')?.trim() ?? '';

      // Immediately strip one-time code from URL (BR-20)
      if (window.location.search) {
        window.history.replaceState(null, '', '/impersonate');
      }

      if (!code) {
        await Promise.resolve();
        if (!cancelled) {
          setError('Код входа в режим поддержки отсутствует или недействителен.');
        }
        return;
      }

      try {
        await exchangeImpersonationCode(code);
        if (!cancelled) {
          router.replace('/dashboard');
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err));
        }
      }
    }

    void exchange();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Scissors className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="text-xl font-bold">{ru.brand.name}</span>
      </div>

      <Card className="w-full max-w-md shadow-xs">
        <CardHeader>
          <CardTitle className="text-lg">Вход в режим поддержки</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
              <Button asChild className="w-full">
                <Link href="/admin">Вернуться в админ-панель</Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Выполняется вход в режиме только чтения...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
