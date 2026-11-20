'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { getMe, refreshSession } from '@/lib/api/auth.api';
import { ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Restores the authenticated session from the httpOnly refresh cookie on initial load,
 * then verifies with GET /auth/me (Phase 6 Task 3).
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const clearSession = useAuthStore((s) => s.clearSession);

  useEffect(() => {
    if (isInitialized) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      try {
        if (!accessToken) {
          await refreshSession();
        }
        await getMe();
      } catch {
        if (!cancelled) {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setInitialized(true);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [accessToken, clearSession, isInitialized, setInitialized]);

  return <>{children}</>;
}

/**
 * Protects /dashboard* routes: redirects unauthenticated visitors to /login.
 */
export function DashboardGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (isInitialized && (!user || !accessToken)) {
      router.replace('/login');
    }
  }, [accessToken, isInitialized, router, user]);

  if (!isInitialized || !user || !accessToken) {
    return (
      <div
        className="flex min-h-screen flex-col gap-6 bg-background p-6"
        aria-busy="true"
        aria-label={ru.common.loading}
      >
        <div className="flex items-center justify-between border-b pb-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Protects /login and /register routes: redirects already authenticated users to /dashboard.
 */
export function GuestGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (isInitialized && user && accessToken) {
      router.replace(user.role === 'MANAGER' ? '/dashboard/schedule' : '/dashboard');
    }
  }, [accessToken, isInitialized, router, user]);

  if (user && accessToken) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Protects OWNER-only dashboard pages (/dashboard/services, /dashboard/staff, /dashboard/settings):
 * redirects employees to /dashboard/schedule.
 */
export function OwnerGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user && user.role !== 'OWNER') {
      router.replace('/dashboard/schedule');
    }
  }, [router, user]);

  if (!user || user.role !== 'OWNER') {
    return null;
  }

  return <>{children}</>;
}
