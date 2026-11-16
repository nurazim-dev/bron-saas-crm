'use client';

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
  { href: '/admin/outbox', label: 'Outbox', icon: Mail },
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
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-slate-50 sm:px-6">
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
                      ? 'bg-slate-900 text-white dark:bg-slate-800'
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

        {/* Mobile/Tablet Drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true">
            <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <div className="relative z-50 flex w-64 flex-col bg-background p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between border-b pb-3">
                <span className="font-bold">Zapis.kg Admin</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" />
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
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium',
                        isActive(item.href)
                          ? 'bg-slate-900 text-white'
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
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
