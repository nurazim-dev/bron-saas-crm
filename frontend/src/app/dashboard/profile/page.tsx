'use client';

import { Bell, ExternalLink, Send, Unlink, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TimeOffManager } from '@/components/time-off/time-off-manager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  createTelegramLinkCode,
  getMyNotificationSettings,
  unlinkTelegram,
  updateMyNotificationSettings,
} from '@/lib/api/notifications.api';
import { ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { MyNotificationSettingsDto, TelegramLinkCodeDto } from '@/types/api';

export default function DashboardProfilePage() {
  const user = useAuthStore((s) => s.user);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);

  const [notifSettings, setNotifSettings] = useState<MyNotificationSettingsDto | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingNotif, setIsSavingNotif] = useState(false);
  const [linkData, setLinkData] = useState<TelegramLinkCodeDto | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getMyNotificationSettings();
        if (!cancelled) {
          setNotifSettings(data);
        }
      } catch {
        // Non-blocking
      } finally {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(field: 'notifyEmail' | 'notifyTelegram', nextVal: boolean) {
    if (!notifSettings || isImpersonating) return;
    setIsSavingNotif(true);
    try {
      const updated = await updateMyNotificationSettings({ [field]: nextVal });
      setNotifSettings(updated);
      toast.success('Настройки уведомлений сохранены');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSavingNotif(false);
    }
  }

  async function handleGenerateLinkCode() {
    if (isImpersonating) return;
    setIsGeneratingCode(true);
    try {
      const data = await createTelegramLinkCode();
      setLinkData(data);
      toast.success('Одноразовая ссылка для Telegram создана');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleUnlinkTelegram() {
    if (isImpersonating) return;
    setIsSavingNotif(true);
    try {
      await unlinkTelegram();
      setLinkData(null);
      setNotifSettings((prev) => (prev ? { ...prev, telegramConnected: false } : prev));
      toast.success('Telegram отключён');
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSavingNotif(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Мой профиль</h1>
        <p className="text-sm text-muted-foreground">
          Личные данные, каналы уведомлений и управление собственным временем отсутствия.
        </p>
      </div>

      {user && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              {user.name}
            </CardTitle>
            <CardDescription>{ru.roles[user.role]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Email: {user.email ?? '—'}</div>
            <div>Телефон: {user.phone ?? '—'}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Уведомления о записях
          </CardTitle>
          <CardDescription>
            Выберите, куда отправлять оповещения о новых записях, переносах и отменах.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? (
            <div className="text-sm text-muted-foreground">Загрузка настроек...</div>
          ) : notifSettings ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Уведомления по Email</p>
                  <p className="text-xs text-muted-foreground">
                    Письма на {user?.email ?? 'ваш email'}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Уведомления по Email"
                  checked={notifSettings.notifyEmail}
                  disabled={isSavingNotif || isImpersonating}
                  onChange={(e) => void handleToggle('notifyEmail', e.target.checked)}
                  className="h-5 w-5 accent-primary"
                />
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Уведомления в Telegram</p>
                    <Badge variant={notifSettings.telegramConnected ? 'default' : 'secondary'}>
                      {notifSettings.telegramConnected ? 'Подключён' : 'Не подключён'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Мгновенные сообщения через Telegram-бота
                    {notifSettings.telegramBotUsername
                      ? ` (@${notifSettings.telegramBotUsername})`
                      : ''}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Уведомления в Telegram"
                  checked={notifSettings.notifyTelegram}
                  disabled={isSavingNotif || isImpersonating}
                  onChange={(e) => void handleToggle('notifyTelegram', e.target.checked)}
                  className="h-5 w-5 accent-primary"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                {notifSettings.telegramConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSavingNotif || isImpersonating}
                    onClick={() => void handleUnlinkTelegram()}
                    className="gap-2"
                  >
                    <Unlink className="h-4 w-4" />
                    Отключить Telegram
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isGeneratingCode || isImpersonating}
                    onClick={() => void handleGenerateLinkCode()}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Подключить Telegram
                  </Button>
                )}

                {linkData && (
                  <div className="w-full rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                    <p className="font-medium">
                      Код привязки (действует 15 минут):{' '}
                      <code className="rounded bg-background px-1.5 py-0.5 font-mono">
                        /start {linkData.code}
                      </code>
                    </p>
                    {linkData.deepLink ? (
                      <Button asChild size="sm" variant="default" className="gap-1.5">
                        <a href={linkData.deepLink} target="_blank" rel="noreferrer">
                          Открыть бота в Telegram
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : (
                      <p className="text-muted-foreground">
                        Telegram-бот не настроен на сервере (`TELEGRAM_BOT_USERNAME` не задан).
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              Не удалось загрузить настройки уведомлений.
            </div>
          )}
        </CardContent>
      </Card>

      {user && (
        <TimeOffManager
          userId={user.id}
          title="Мои отпуска и больничные"
          description="Публичная онлайн-запись автоматически скрывает эти периоды."
          readOnly={isImpersonating}
        />
      )}
    </div>
  );
}
