'use client';

import {
  Briefcase,
  CalendarDays,
  Loader2,
  Package,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage } from '@/lib/api/client';
import { formatDateInCompanyTz, formatTimeInCompanyTz } from '@/lib/datetime';
import { formatPriceKgs, ru } from '@/lib/i18n/ru';
import { globalSearch, type GlobalSearchResultDto } from '@/lib/api/search.api';
import { useAuthStore } from '@/stores/auth.store';

export function GlobalSearch() {
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResultDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (trimmed.length < 2) {
        if (!cancelled) {
          setResults(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
      void globalSearch(trimmed, 5)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch((err) => {
          if (!cancelled) {
            setResults(null);
            setError(getApiErrorMessage(err));
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const totalHits = results
    ? results.clients.length +
      results.appointments.length +
      results.services.length +
      results.packages.length +
      results.staff.length
    : 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="global-search-trigger"
        onClick={() => setOpen(true)}
        className="min-h-10 gap-2 px-3 text-muted-foreground"
        aria-label="Глобальный поиск"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Поиск</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="mb-0 flex flex-row items-center justify-between border-b px-4 py-3">
            <DialogTitle className="text-base">Глобальный поиск по кабинету</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label={ru.common.close}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DialogHeader>

          <div className="space-y-4 p-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="global-search-input"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Имя клиента, телефон, тег, услуга, запись или мастер..."
                className="min-h-11 pl-9"
              />
            </div>

            {query.trim().length < 2 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Введите минимум 2 символа для поиска по клиентам, записям, услугам и команде.
              </p>
            )}

            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Поиск...</span>
              </div>
            )}

            {error && <p className="py-2 text-center text-sm text-destructive">{error}</p>}

            {!isLoading && !error && results && totalHits === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ничего не найдено по запросу «{results.query}».
              </p>
            )}

            {!isLoading && results && totalHits > 0 && (
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm">
                {results.clients.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      Клиенты
                    </p>
                    <div className="space-y-1">
                      {results.clients.map((client) => (
                        <Link
                          key={client.id}
                          href={`/dashboard/clients/${client.id}`}
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{client.name}</p>
                            <p className="text-xs text-muted-foreground">{client.phone}</p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1">
                            {client.tags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="outline"
                                className="text-[10px]"
                                style={{ borderColor: tag.color, color: tag.color }}
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {results.appointments.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      Записи
                    </p>
                    <div className="space-y-1">
                      {results.appointments.map((appt) => (
                        <Link
                          key={appt.id}
                          href="/dashboard/appointments"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {appt.clientName} · {appt.serviceName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDateInCompanyTz(appt.startAt, timezone)}{' '}
                              {formatTimeInCompanyTz(appt.startAt, timezone)} · {appt.masterName}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {ru.appointmentStatuses[appt.status]}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {results.services.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                      Услуги
                    </p>
                    <div className="space-y-1">
                      {results.services.map((svc) => (
                        <Link
                          key={svc.id}
                          href="/dashboard/services"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
                        >
                          <span className="truncate font-medium">{svc.name}</span>
                          <span className="shrink-0 text-xs font-semibold">
                            {formatPriceKgs(svc.price)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {results.packages.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Package className="h-3.5 w-3.5" aria-hidden="true" />
                      Пакеты услуг
                    </p>
                    <div className="space-y-1">
                      {results.packages.map((pkg) => (
                        <Link
                          key={pkg.id}
                          href="/dashboard/services"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
                        >
                          <span className="truncate font-medium">{pkg.name}</span>
                          <span className="shrink-0 text-xs font-semibold">
                            {formatPriceKgs(pkg.price)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {results.staff.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Команда
                    </p>
                    <div className="space-y-1">
                      {results.staff.map((member) => (
                        <Link
                          key={member.id}
                          href="/dashboard/staff"
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
                        >
                          <span className="truncate font-medium">{member.name}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {ru.roles[member.role]}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
