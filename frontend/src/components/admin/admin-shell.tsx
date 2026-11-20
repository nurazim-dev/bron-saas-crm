'use client';
import { NavigationDrawer } from '@/components/ui/navigation-drawer';

import {
  Activity,
  Building2,
  CreditCard,
  Layers,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { adminLogout, adminRefreshSession } from '@/lib/api/admin.api';
import { cn } from '@/lib/utils';
import { useAdminAuthStore } from '@/stores/admin-auth.store';

const ADMIN_NAV = [
  { href: '/admin', label: 'Обзор', icon: LayoutDashboard },
  { href: '/admin/companies', label: 'Компании', icon: Building2 },
  { href: '/admin/payments', label: 'Платежи', icon: CreditCard },
  { href: '/admin/plans', label: 'Тарифы', icon: Layers },
  { href: '/admin/users', label: 'Пользователи', icon: Users },
  { href: '/admin/outbox', label: 'Доставка сообщений', icon: Mail },
  { href: '/admin/audit', label: 'Аудит', icon: Activity },
  { href: '/admin/settings', label: 'Настройки', icon: Settings },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const admin = useAdminAuthStore((s) => s.admin);
  const accessToken = useAdminAuthStore((s) => s.accessToken);
  const isInitialized = useAdminAuthStore((s) => s.isInitialized);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isInitialized) {
      return;
    }
    let cancelled = false;
    void adminRefreshSession()
      .catch(() => {
        useAdminAuthStore.getState().clearSession();
      })
      .finally(() => {
        if (!cancelled) {
          useAdminAuthStore.getState().setInitialized(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isLoginPage && !accessToken) {
      router.replace('/admin/login');
    } else if (isLoginPage && accessToken) {
      router.replace('/admin');
    }
  }, [isInitialized, isLoginPage, accessToken, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!isInitialized || !accessToken || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <span className="text-sm">Проверка сессии администратора...</span>
      </div>
    );
  }

  async function handleLogout() {
    await adminLogout();
    toast.success('Вы вышли из админ-панели');
    router.replace('/admin/login');
  }

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      {/* Distinct Dark Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#34463a] bg-[#233b2e] px-4 text-slate-50 sm:px-6">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-slate-200 hover:bg-slate-800 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Открыть меню"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Link href="/admin" className="flex items-center gap-2 font-bold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            <span>Zapis.kg Admin</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-300 sm:inline">{admin.email}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleLogout()}
            className="gap-1.5"
          >
            <span className="sr-only">Выйти</span>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop & Tablet Sidebar */}
        <aside className="hidden w-56 shrink-0 border-r bg-background p-3 lg:block">
          <nav className="space-y-1">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-primary text-primary-foreground dark:bg-slate-800'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <NavigationDrawer
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title="Меню администратора"
        >
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between border-b pb-3">
              <span className="font-bold">Zapis.kg Admin</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Закрыть меню"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <nav className="space-y-1">
              {ADMIN_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium',
                      isActive(item.href)
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </NavigationDrawer>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
