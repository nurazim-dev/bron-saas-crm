'use client';

import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createAdditionalCompany, listMyCompanies, switchCompany } from '@/lib/api/auth.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import type { BusinessType } from '@/types/api';

const OWNER_ONLY_PREFIXES = [
  '/dashboard/services',
  '/dashboard/staff',
  '/dashboard/settings',
  '/dashboard/billing',
  '/dashboard/analytics',
  '/dashboard/onboarding',
];

function isOwnerOnlyPath(pathname: string): boolean {
  if (pathname === '/dashboard') return true;
  return OWNER_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function CompanySwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const companies = useAuthStore((s) => s.companies);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);

  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('BARBERSHOP');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user || !company || isImpersonating) {
      return;
    }
    let cancelled = false;
    void listMyCompanies().catch(() => {
      if (!cancelled) {
        // Ignore transient network errors; header keeps current company fallback.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [company, isImpersonating, user]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  if (!company) {
    return null;
  }

  const isOwner = user?.role === 'OWNER';
  const canSwitchOrCreate = !isImpersonating && (isOwner || companies.length > 1);

  if (!canSwitchOrCreate) {
    return <span className="truncate text-sm font-semibold sm:text-base">{company.name}</span>;
  }

  const items =
    companies.length > 0
      ? companies
      : user
        ? [
            {
              companyId: company.id,
              companyName: company.name,
              companySlug: company.slug,
              businessType: company.businessType,
              role: user.role,
              isCurrent: true,
              isSuspended: false,
            },
          ]
        : [];

  async function handleSwitch(targetCompanyId: string) {
    if (targetCompanyId === company?.id || switchingId !== null) {
      setMenuOpen(false);
      return;
    }
    setSwitchingId(targetCompanyId);
    try {
      const session = await switchCompany(targetCompanyId);
      setMenuOpen(false);
      if (session.user.role !== 'OWNER' && isOwnerOnlyPath(pathname)) {
        router.replace('/dashboard/schedule');
      } else if (/^\/dashboard\/staff\/.+/.test(pathname)) {
        router.replace('/dashboard/staff');
      }
      toast.success(`Переключено на «${session.company.name}»`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const trimmedPhone = phone.trim();
      const session = await createAdditionalCompany({
        companyName: companyName.trim(),
        businessType,
        ...(trimmedPhone.length > 0 ? { phone: trimmedPhone } : {}),
      });
      setCreateOpen(false);
      setCompanyName('');
      setBusinessType('BARBERSHOP');
      setPhone('');
      if (/^\/dashboard\/staff\/.+/.test(pathname)) {
        router.replace('/dashboard');
      }
      toast.success('Компания создана');
      if (session.user.role !== 'OWNER' && isOwnerOnlyPath(pathname)) {
        router.replace('/dashboard/schedule');
      }
    } catch (err) {
      setCreateError(getApiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 max-w-full">
      <Button
        type="button"
        variant="ghost"
        aria-label="Переключить компанию"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        data-testid="company-switcher-trigger"
        onClick={() => {
          const next = !menuOpen;
          setMenuOpen(next);
          if (next) {
            void listMyCompanies().catch(() => undefined);
          }
        }}
        className="h-auto min-h-11 max-w-full gap-1.5 px-2 py-1.5 text-left sm:max-w-[260px] sm:px-2.5"
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-semibold sm:text-base">{company.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Ваши компании"
          className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Ваши компании</div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {items.map((item) => {
              const isCurrent = item.companyId === company.id;
              const isBusy = switchingId === item.companyId;
              return (
                <button
                  key={item.companyId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  disabled={item.isSuspended || switchingId !== null}
                  onClick={() => void handleSwitch(item.companyId)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    isCurrent
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'hover:bg-muted/70',
                    item.isSuspended && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{item.companyName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{ru.roles[item.role]}</span>
                      {item.isSuspended && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          Приостановлена
                        </Badge>
                      )}
                    </div>
                  </div>
                  {isBusy ? (
                    <span className="text-xs text-muted-foreground">…</span>
                  ) : isCurrent ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {isOwner && !isImpersonating && (
            <div className="mt-1.5 border-t pt-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  setMenuOpen(false);
                  setCreateError(null);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Создать компанию
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать компанию</DialogTitle>
            <DialogDescription>
              Новая компания будет привязана к вашей текущей учётной записи владельца.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-company-name">Название компании</Label>
              <Input
                id="new-company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Например: Салон Бета"
                required
                minLength={2}
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-company-type">Тип бизнеса</Label>
              <select
                id="new-company-type"
                value={businessType}
                onChange={(e) =>
                  setBusinessType(e.target.value === 'BEAUTY_SALON' ? 'BEAUTY_SALON' : 'BARBERSHOP')
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="BARBERSHOP">{ru.businessTypes.BARBERSHOP}</option>
                <option value="BEAUTY_SALON">{ru.businessTypes.BEAUTY_SALON}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-company-phone">Телефон (необязательно)</Label>
              <Input
                id="new-company-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+996 555 123 456"
              />
            </div>

            {createError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {createError}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Создаём…' : 'Создать компанию'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
