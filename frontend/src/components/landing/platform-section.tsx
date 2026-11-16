'use client';

import { Check, Megaphone, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPublicPlatform } from '@/lib/api/billing.api';
import { formatPriceKgs } from '@/lib/i18n/ru';
import type { PublicPlatformDto } from '@/types/api';

export function LandingAnnouncementBanner() {
  const [platform, setPlatform] = useState<PublicPlatformDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPublicPlatform()
      .then((data) => {
        if (!cancelled) setPlatform(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!platform?.announcement.enabled || !platform.announcement.text) {
    return null;
  }

  return (
    <div className="border-b bg-primary/10 px-4 py-2 text-center text-xs font-medium text-foreground sm:text-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
        <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{platform.announcement.text}</span>
      </div>
    </div>
  );
}

export function LandingPricingSection() {
  const [platform, setPlatform] = useState<PublicPlatformDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPublicPlatform()
      .then((data) => {
        if (!cancelled) setPlatform(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!platform || platform.plans.length === 0) {
    return null;
  }

  return (
    <section id="pricing" className="border-t py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Прозрачные тарифы</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            14 дней бесплатного пробного периода на тарифе «Бизнес» для каждой новой компании.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {platform.plans.map((plan) => (
            <Card
              key={plan.id}
              className="flex flex-col justify-between border-border/80 shadow-xs"
            >
              <CardHeader>
                <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
                <p className="mt-2 text-3xl font-extrabold">
                  {formatPriceKgs(plan.priceMonthly)}
                  <span className="text-sm font-normal text-muted-foreground"> / мес</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between space-y-6">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    До {plan.maxStaff} сотрудников
                  </li>
                  <li className="flex items-center gap-2">
                    {plan.featureAnalytics ? (
                      <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                    )}
                    Аналитика и CSV-экспорт
                  </li>
                  <li className="flex items-center gap-2">
                    {plan.featureAutoReminders ? (
                      <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                    )}
                    Авто-напоминания клиентам
                  </li>
                  <li className="flex items-center gap-2">
                    {plan.featurePrepayment ? (
                      <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                    )}
                    Предоплата при записи
                  </li>
                </ul>

                <Button asChild className="min-h-11 w-full">
                  <Link href="/register">Попробовать бесплатно</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
