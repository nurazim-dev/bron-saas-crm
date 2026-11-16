'use client';

import { User } from 'lucide-react';
import { TimeOffManager } from '@/components/time-off/time-off-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';

export default function DashboardProfilePage() {
  const user = useAuthStore((s) => s.user);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Мой профиль</h1>
        <p className="text-sm text-muted-foreground">
          Личные данные и управление собственным временем отсутствия.
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
