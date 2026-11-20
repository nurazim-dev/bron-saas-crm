'use client';

import { Download, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of listeners) fn();
}

export function PwaProvider() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      notifyListeners();
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          function promptUpdate(worker: ServiceWorker) {
            toast('Доступна новая версия', {
              action: {
                label: 'Обновить',
                onClick: () => {
                  worker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                },
              },
            });
          }

          if (registration.waiting) {
            promptUpdate(registration.waiting);
          }

          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                promptUpdate(installing);
              }
            });
          });
        })
        .catch(() => {
          // Ignore SW registration failure on unsupported origins
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  return null;
}

export function PwaInstallCard() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredPrompt));

  useEffect(() => {
    const update = () => setCanInstall(Boolean(deferredPrompt));
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    notifyListeners();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          Приложение на телефон
        </CardTitle>
        <CardDescription>
          Установите Zapis.kg на главный экран для быстрого входа в расписание.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        {canInstall && (
          <Button type="button" onClick={() => void handleInstall()} className="gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Установить приложение
          </Button>
        )}
        <p>
          <strong>Android / Chrome:</strong> откройте меню браузера (⋮) и выберите «Установить
          приложение».
        </p>
        <p>
          <strong>iPhone / Safari:</strong> нажмите «Поделиться» → «На экран „Домой“».
        </p>
      </CardContent>
    </Card>
  );
}
