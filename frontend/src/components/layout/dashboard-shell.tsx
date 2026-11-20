'use client';
import { NavigationDrawer } from '@/components/ui/navigation-drawer';

import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardList,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Scissors,
  Settings,
  Sun,
  User,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompanySwitcher } from '@/components/layout/company-switcher';
import { GlobalSearch } from '@/components/layout/global-search';
import { NotificationBell } from '@/components/layout/notification-bell';
import { exitImpersonation, logoutSession } from '@/lib/api/auth.api';
import { getBillingOverview, getPublicPlatform } from '@/lib/api/billing.api';
import {
  DASHBOARD_NAV_BY_HREF,
  DASHBOARD_ROLE_LABELS,
  DASHBOARD_SHELL_TEXT,
  type DashboardLang,
  useDashboardLangStore,
} from '@/lib/i18n/dashboard-lang';
import { ru } from '@/lib/i18n/ru';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import type { BillingOverviewDto, PublicPlatformDto, Role } from '@/types/api';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: ru.nav.overview,
    icon: LayoutDashboard,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/schedule',
    label: ru.nav.schedule,
    icon: CalendarDays,
    roles: ['OWNER', 'MANAGER', 'MASTER'],
  },
  {
    href: '/dashboard/appointments',
    label: ru.nav.appointments,
    icon: ClipboardList,
    roles: ['OWNER', 'MANAGER', 'MASTER'],
  },
  {
    href: '/dashboard/clients',
    label: 'Клиенты',
    icon: Users,
    roles: ['OWNER', 'MANAGER', 'MASTER'],
  },
  {
    href: '/dashboard/analytics',
    label: 'Аналитика',
    icon: BarChart3,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/payments',
    label: 'Платежи',
    icon: Wallet,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/services',
    label: ru.nav.services,
    icon: Briefcase,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/staff',
    label: ru.nav.staff,
    icon: Users,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/billing',
    label: ru.nav.billing,
    icon: CreditCard,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/settings',
    label: ru.nav.settings,
    icon: Settings,
    roles: ['OWNER'],
  },
  {
    href: '/dashboard/profile',
    label: 'Профиль',
    icon: User,
    roles: ['OWNER', 'MANAGER', 'MASTER'],
  },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const dashLang = useDashboardLangStore((s) => s.lang);
  const setDashLang = useDashboardLangStore((s) => s.setLang);
  const shellText = DASHBOARD_SHELL_TEXT[dashLang];
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [scopedBilling, setScopedBilling] = useState<{
    companyId: string;
    data: BillingOverviewDto;
  } | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PublicPlatformDto | null>(null);

  const billingOverview =
    company?.id && scopedBilling?.companyId === company.id ? scopedBilling.data : null;

  useEffect(() => {
    let cancelled = false;
    void getPublicPlatform()
      .then((data) => {
        if (!cancelled) setPlatformInfo(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const activeCompanyId = company?.id;
    if (user?.role !== 'OWNER' || !activeCompanyId) {
      return;
    }
    let cancelled = false;
    const loadBilling = () => {
      void getBillingOverview()
        .then((data) => {
          if (!cancelled) setScopedBilling({ companyId: activeCompanyId, data });
        })
        .catch(() => undefined);
    };
    loadBilling();

    const handle402 = () => {
      toast.error(ru.errors.SUBSCRIPTION_REQUIRED);
      loadBilling();
    };
    window.addEventListener('zapis:billing-402', handle402);

    return () => {
      cancelled = true;
      window.removeEventListener('zapis:billing-402', handle402);
    };
  }, [company?.id, user?.role, pathname]);

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    user ? item.roles.includes(user.role) : false,
  );

  function isActivePath(href: string): boolean {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logoutSession();
      toast.success(ru.auth.logoutSuccess);
      router.replace('/login');
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleExitImpersonation() {
    setIsLoggingOut(true);
    try {
      await exitImpersonation();
      router.replace('/admin');
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="workspace-shell flex min-h-screen bg-muted/20">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <Link
            href={user?.role === 'OWNER' ? '/dashboard' : '/dashboard/schedule'}
            className="flex items-center gap-2.5 font-semibold"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scissors className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">{ru.brand.name}</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Основная навигация">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{DASHBOARD_NAV_BY_HREF[item.href]?.[dashLang] ?? item.label}</span>
              </Link>
            );
          })}
        </nav>

        {company && (
          <div className="border-t p-3">
            <Link
              href={`/b/${company.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="truncate">{shellText.publicPageLink}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        )}
      </aside>

      <NavigationDrawer
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        title="Меню кабинета"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
          <span className="text-lg font-bold">{ru.brand.name}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(false)}
            aria-label={ru.nav.closeMenu}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Мобильная навигация">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{DASHBOARD_NAV_BY_HREF[item.href]?.[dashLang] ?? item.label}</span>
              </Link>
            );
          })}
        </nav>
        {company && (
          <div className="border-t p-3">
            <Link
              href={`/b/${company.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs font-medium"
            >
              <span>{shellText.publicPageLink}</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </NavigationDrawer>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={ru.nav.openMenu}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            {company && (
              <div className="flex min-w-0 items-center gap-2">
                <CompanySwitcher />
                <Badge variant="outline" className="hidden sm:inline-flex">
                  {company.timezone}
                </Badge>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <GlobalSearch key={`search-${company?.id ?? 'none'}`} />
            <select
              data-testid="dashboard-lang-select"
              aria-label={shellText.langLabel}
              value={dashLang}
              onChange={(e) => setDashLang(e.target.value as DashboardLang)}
              className="h-9 rounded-md border border-input bg-background px-1.5 text-xs font-medium"
            >
              <option value="ru">RU</option>
              <option value="ky">KY</option>
              <option value="en">EN</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              data-testid="theme-toggle"
              aria-label={shellText.themeToggle}
              onClick={() => {
                const isCurrentlyDark =
                  resolvedTheme === 'dark' ||
                  (typeof document !== 'undefined' &&
                    document.documentElement.classList.contains('dark'));
                const next = isCurrentlyDark ? 'light' : 'dark';
                setTheme(next);
                if (typeof document !== 'undefined') {
                  document.documentElement.classList.toggle('dark', next === 'dark');
                }
              }}
              className="h-9 w-9 shrink-0"
            >
              <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
              <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
            </Button>
            <NotificationBell key={company?.id ?? 'none'} />
            {user && (
              <div className="flex items-center gap-2 text-right">
                <div className="hidden sm:block">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {DASHBOARD_ROLE_LABELS[user.role]?.[dashLang] ?? ru.roles[user.role]}
                  </p>
                </div>
                <Badge variant="secondary" className="sm:hidden">
                  {DASHBOARD_ROLE_LABELS[user.role]?.[dashLang] ?? ru.roles[user.role]}
                </Badge>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="min-h-11 gap-2 px-3"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{shellText.logout}</span>
            </Button>
          </div>
        </header>

        {isImpersonating && company && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-400/40 bg-indigo-950 px-4 py-2 text-xs font-medium text-indigo-50 sm:px-6 sm:text-sm"
          >
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0 text-indigo-300" aria-hidden="true" />
              <span>
                Сессия поддержки (только чтение): <strong>{company.name}</strong> — изменения
                отключены.
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isLoggingOut}
              onClick={() => void handleExitImpersonation()}
            >
              Выйти из режима поддержки
            </Button>
          </div>
        )}

        {platformInfo?.announcement.enabled && platformInfo.announcement.text && (
          <div className="border-b bg-primary/10 px-4 py-2 text-xs font-medium text-foreground sm:px-6">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{platformInfo.announcement.text}</span>
            </div>
          </div>
        )}

        {user?.role === 'OWNER' && billingOverview?.subscription.state === 'LOCKED' && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive sm:px-6"
          >
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Подписка истекла — кабинет в режиме только чтения, онлайн-запись отключена. Ваши
                данные сохранены.
              </span>
            </div>
            <Button asChild size="sm" variant="destructive">
              <Link href="/dashboard/billing">Продлить тариф</Link>
            </Button>
          </div>
        )}

        {user?.role === 'OWNER' && billingOverview?.subscription.state === 'PAST_DUE' && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Оплаченный период завершился (льготный период до{' '}
                {billingOverview.subscription.graceEndsAt.slice(0, 10)}). Оформите продление, чтобы
                избежать блокировки.
              </span>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/billing">Оплатить</Link>
            </Button>
          </div>
        )}

        {user?.role === 'OWNER' &&
          billingOverview?.subscription.state === 'TRIAL' &&
          billingOverview.subscription.daysLeft <= 3 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 sm:px-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Пробный период заканчивается через {billingOverview.subscription.daysLeft} дн.
                </span>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/billing">Выбрать тариф</Link>
              </Button>
            </div>
          )}

        <main
          key={`${company?.id ?? 'none'}:${user?.id ?? 'none'}`}
          className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
