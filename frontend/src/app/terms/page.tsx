'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicLangSwitcher } from '@/components/booking/public-lang-switcher';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPublicLangFromCookie, PUBLIC_DICT, type PublicLang } from '@/lib/i18n/public-dict';

export default function TermsPage() {
  const [lang, setLang] = useState<PublicLang>('ru');

  useEffect(() => {
    const timer = setTimeout(() => {
      setLang(getPublicLangFromCookie());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const t = PUBLIC_DICT[lang];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-primary hover:underline">
          ← Zapis.kg
        </Link>
        <PublicLangSwitcher lang={lang} onChange={setLang} />
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <Badge variant="outline" className="w-fit border-amber-500/40 bg-amber-500/10 text-xs">
            {t.draftLegalBanner}
          </Badge>
          <CardTitle className="text-2xl">{t.termsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          {lang === 'ky' ? (
            <>
              <p>
                <strong>1. Кызмат көрсөтүү предмети:</strong> Zapis.kg барбершопторго жана сулуулук
                салондоруна онлайн-жазылуу жана CRM кызматын «болгонундай» (as-is) сунуштайт.
              </p>
              <p>
                <strong>2. Тарифтер жана төлөм:</strong> жазылуу шарттары тандалган тарифке жараша
                колдонулат. Мөөнөтү бүткөндө маалыматтар өчүрүлбөйт, бирок кабинет «окууга гана»
                режимине өтөт.
              </p>
              <p>
                <strong>3. Жоопкерчилик:</strong> кардарлардын маалыматтарын туура иштетүү жана
                кызматтардын сапаты үчүн бизнес ээси жооптуу.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>1. Предмет соглашения:</strong> Платформа Zapis.kg предоставляет барбершопам
                и салонам красоты доступ к системе онлайн-записи и CRM.
              </p>
              <p>
                <strong>2. Подписка и доступ:</strong> тарифы и лимиты указаны в личном кабинете. По
                истечении оплаченного периода данные не удаляются, но кабинет переходит в режим
                только чтения до продления.
              </p>
              <p>
                <strong>3. Ответственность:</strong> бизнес несёт ответственность за актуальность
                расписания, реквизитов предоплаты и соблюдение законодательства о персональных
                данных Кыргызской Республики.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <footer className="flex gap-4 text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">
          {t.privacyLinkLabel}
        </Link>
        <Link href="/terms" className="underline">
          {t.termsLinkLabel}
        </Link>
      </footer>
    </main>
  );
}
