'use client';

import { Bell, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications.api';
import { formatDateInCompanyTz, formatTimeInCompanyTz } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import type { InAppNotificationDto } from '@/types/api';

export function NotificationBell() {
  const router = useRouter();
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listNotifications(false);
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silent background poll
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => {
      void load();
    }, 0);
    const id = setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  async function handleItemClick(item: InAppNotificationDto) {
    if (!item.readAt) {
      try {
        await markNotificationRead(item.id);
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // Ignore
      }
    }
    setOpen(false);
    if (item.kind === 'PLAN_REMINDER_CAP_REACHED') {
      router.push('/dashboard/billing');
    } else if (item.data && typeof item.data.appointmentId === 'string') {
      router.push('/dashboard/appointments');
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      const nowIso = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: nowIso })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Уведомления"
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
        className="relative min-h-11 min-w-11"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="unread-notifications-badge"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-sm font-semibold">Уведомления</span>
            {unreadCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleMarkAllRead()}
                className="h-7 gap-1 px-2 text-xs"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Прочитать все
              </Button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Новых уведомлений пока нет
              </div>
            ) : (
              items.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleItemClick(item)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/60',
                    !item.readAt && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('font-medium', !item.readAt && 'text-foreground')}>
                      {item.title}
                    </span>
                    {!item.readAt && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                  <p className="text-muted-foreground">{item.body}</p>
                  <span className="text-[11px] text-muted-foreground/80">
                    {formatDateInCompanyTz(item.createdAt, timezone)}{' '}
                    {formatTimeInCompanyTz(item.createdAt, timezone)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
