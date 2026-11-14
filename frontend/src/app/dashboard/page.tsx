'use client';

import {
  Briefcase,
  CalendarDays,
  ClipboardList,
  Copy,
  ExternalLink,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';

export default function DashboardOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);

  const isOwner = user?.role === 'OWNER';
  const publicPath = company ? `/b/${company.slug}` : '/b/demo-barbershop';

  async function handleCopyPublicLink() {
    if (!company || typeof window === 'undefined') return;
    const url = `${window.location.origin}/b/${company.slug}`;
    await navigator.clipboard.writeText(url);
    toast.success(ru.dashboard.linkCopied);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {ru.dashboard.welcomeTitle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          {isOwner ? ru.dashboard.welcomeSubtitleOwner : ru.dashboard.welcomeSubtitleMaster}
        </p>
      </div>

      {company && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{ru.dashboard.publicLinkLabel}</CardTitle>
              <CardDescription>{ru.businessTypes[company.businessType]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2.5 font-mono text-sm">
                <span className="truncate">{publicPath}</span>
                <Badge variant={company.publicBookingEnabled ? 'default' : 'secondary'}>
                  {company.publicBookingEnabled
                    ? ru.dashboard.bookingEnabled
                    : ru.dashboard.bookingDisabled}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={handleCopyPublicLink}
                  className="min-h-11 gap-2 px-4"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  <span>{ru.dashboard.copyLink}</span>
                </Button>
                <Button asChild variant="outline" className="min-h-11 gap-2 px-4">
                  <Link href={publicPath} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    <span>{ru.dashboard.openPublicPage}</span>
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{ru.dashboard.companyInfoTitle}</CardTitle>
              <CardDescription>{company.name}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{ru.dashboard.timezoneLabel}</p>
                <p className="mt-1 font-medium">{company.timezone}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ru.dashboard.currencyLabel}</p>
                <p className="mt-1 font-medium">{company.currency}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{ru.dashboard.quickActionsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Button asChild variant="outline" className="min-h-12 justify-start gap-3 px-4">
            <Link href="/dashboard/schedule">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{ru.dashboard.goToSchedule}</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-12 justify-start gap-3 px-4">
            <Link href="/dashboard/appointments">
              <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{ru.dashboard.goToAppointments}</span>
            </Link>
          </Button>
          {isOwner && (
            <>
              <Button asChild variant="outline" className="min-h-12 justify-start gap-3 px-4">
                <Link href="/dashboard/services">
                  <Briefcase className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>{ru.dashboard.goToServices}</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-12 justify-start gap-3 px-4">
                <Link href="/dashboard/staff">
                  <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>{ru.dashboard.goToStaff}</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-12 justify-start gap-3 px-4">
                <Link href="/dashboard/settings">
                  <Settings className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>{ru.dashboard.goToSettings}</span>
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
