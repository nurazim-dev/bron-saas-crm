import { ArrowRight, CalendarCheck2, Scissors, Smartphone, Users } from 'lucide-react';
import Link from 'next/link';
import {
  LandingAnnouncementBanner,
  LandingPricingSection,
} from '@/components/landing/platform-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

const BENEFIT_ICONS = [CalendarCheck2, Smartphone, Users] as const;

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingAnnouncementBanner />
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scissors className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold">{ru.brand.name}</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Button asChild variant="ghost" className="min-h-11 px-4">
              <Link href="/login">{ru.landing.ctaLogin}</Link>
            </Button>
            <Button asChild className="min-h-11 px-4">
              <Link href="/register">{ru.landing.ctaStart}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="secondary" className="mb-4 px-3 py-1 text-xs sm:text-sm">
              {ru.landing.badge}
            </Badge>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              {ru.landing.heroTitle}
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-xl">
              {ru.landing.heroSubtitle}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Button asChild size="lg" className="min-h-12 w-full px-8 text-base sm:w-auto">
                <Link href="/register">
                  {ru.landing.ctaStart}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-12 w-full px-8 text-base sm:w-auto"
              >
                <Link href="/login">{ru.landing.ctaLogin}</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/40 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              {ru.landing.benefitsTitle}
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {ru.landing.benefits.map((benefit, idx) => {
                const Icon = BENEFIT_ICONS[idx] ?? CalendarCheck2;
                return (
                  <Card key={benefit.title} className="border-border/80 shadow-xs">
                    <CardHeader>
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <CardTitle className="text-lg font-semibold">{benefit.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {benefit.description}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <LandingPricingSection />
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6">
          {ru.landing.footerText}
        </div>
      </footer>
    </div>
  );
}
