import { CalendarOff, MapPin, MessageCircle, Phone, Scissors, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicBookingStepper } from '@/components/booking/public-booking-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchPublicCompanyServer } from '@/lib/api/public.api';
import { ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay, getWhatsAppUrl } from '@/lib/phone';

interface PublicPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PublicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const profile = await fetchPublicCompanyServer(slug);

  if (!profile) {
    return {
      title: `${ru.publicBooking.notFoundTitle} | ${ru.brand.name}`,
    };
  }

  const businessLabel = ru.businessTypes[profile.company.businessType];
  return {
    title: `${profile.company.name} — ${ru.publicBooking.metaTitleSuffix}`,
    description: `${ru.publicBooking.metaDescriptionPrefix} ${profile.company.name} (${businessLabel}).${profile.company.address ? ` Адрес: ${profile.company.address}.` : ''}`,
  };
}

export default async function PublicBookingPage({ params }: PublicPageProps) {
  const { slug } = await params;
  const profile = await fetchPublicCompanyServer(slug);

  if (!profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
        <Card className="w-full max-w-md text-center shadow-xs">
          <CardHeader className="items-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SearchX className="h-6 w-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl">{ru.publicBooking.notFoundTitle}</CardTitle>
            <CardDescription>{ru.publicBooking.notFoundDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/">{ru.common.backToHome}</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { company } = profile;
  const whatsappUrl = getWhatsAppUrl(company.phone);

  return (
    <div className="flex min-h-screen flex-col bg-muted/25">
      {/* Mobile-first Header */}
      <header className="border-b bg-background">
        <div className="mx-auto max-w-xl px-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-1.5">
                {ru.businessTypes[company.businessType]}
              </Badge>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{company.name}</h1>
              {company.description && (
                <p className="mt-1 text-sm text-muted-foreground">{company.description}</p>
              )}
              {company.address && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{company.address}</span>
                </p>
              )}
            </div>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              style={
                company.brandColor
                  ? { backgroundColor: `${company.brandColor}22`, color: company.brandColor }
                  : undefined
              }
            >
              <Scissors className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>

          {(company.phone || company.instagramUrl) && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {company.phone && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`tel:${company.phone}`}>
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatPhoneDisplay(company.phone)}
                  </a>
                </Button>
              )}
              {whatsappUrl && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    WhatsApp
                  </a>
                </Button>
              )}
              {company.instagramUrl && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a
                    href={
                      company.instagramUrl.startsWith('http')
                        ? company.instagramUrl
                        : `https://instagram.com/${company.instagramUrl.replace(/^@/, '')}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Instagram
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {!company.bookingEnabled ? (
          <Card className="text-center shadow-2xs">
            <CardHeader className="items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                <CalendarOff className="h-6 w-6" aria-hidden="true" />
              </div>
              <CardTitle className="text-lg">{ru.publicBooking.bookingDisabledTitle}</CardTitle>
              <CardDescription>{ru.publicBooking.bookingDisabledDescription}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <PublicBookingStepper profile={profile} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-background py-4 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          {ru.publicBooking.poweredBy}
        </Link>
      </footer>
    </div>
  );
}
