'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicLangSwitcher } from '@/components/booking/public-lang-switcher';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPublicLangFromCookie, PUBLIC_DICT, type PublicLang } from '@/lib/i18n/public-dict';

export default function PrivacyPolicyPage() {
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
          <CardTitle className="text-2xl">{t.privacyTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          {lang === 'ky' ? (
            <>
              <p>
                <strong>1. Маалымат операторлору:</strong> Zapis.kg платформасы салондун же
                барбершоптун (бизнес) атынан онлайн-жазылууларды кабыл алуу үчүн техникалык кызмат
                көрсөтөт. Ар бир бизнес өз кардарларынын маалыматтары үчүн жооптуу контролер болуп
                саналат.
              </p>
              <p>
                <strong>2. Чогултулган маалыматтар:</strong> аты-жөнү, телефон номери, жазылууга
                комментарий, тандалган кызмат жана тил (RU/KY). Бизнес ээлери үчүн — email, телефон
                жана салондун дареги.
              </p>
              <p>
                <strong>3. Максаттары:</strong> онлайн жазылууну уюштуруу, кардарга башкаруу
                шилтемесин берүү, эскертүүлөрдү жөнөтүү жана кызмат көрсөтүүнү камсыз кылуу.
              </p>
              <p>
                <strong>4. Сактоо жана өчүрүү (анонимизация):</strong> маалыматтар кызмат көрсөтүү
                үчүн зарыл болгон мөөнөттө сакталат. Кардар маалыматтарын өчүрүүнү же
                анонимдештирүүнү салонго кайрылуу аркылуу талап кыла алат.
              </p>
              <p>
                <strong>5. Cookies жана байланыш:</strong> тилди сактоо (`zapis_lang`) жана коопсуз
                сессиялар үчүн зарыл cookie файлдары колдонулат. Суроолор боюнча: support@zapis.kg.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>1. Роли операторов данных:</strong> Платформа Zapis.kg выступает техническим
                обработчиком данных для барбершопов и салонов красоты. Каждый бизнес является
                самостоятельным контролером персональных данных своих клиентов.
              </p>
              <p>
                <strong>2. Собираемые данные:</strong> имя, номер телефона, комментарий к записи,
                выбранная услуга и язык уведомлений (RU/KY); для владельцев бизнеса — email, телефон
                и адрес заведения.
              </p>
              <p>
                <strong>3. Цели обработки:</strong> оформление и управление онлайн-записью, отправка
                напоминаний и обеспечение работы CRM для выбранного бизнеса.
              </p>
              <p>
                <strong>4. Хранение и права субъекта:</strong> данные хранятся на срок оказания
                услуг. Вы вправе запросить исправление или удаление/анонимизацию своих данных,
                обратившись в соответствующий салон или службу поддержки.
              </p>
              <p>
                <strong>5. Cookies и контакты:</strong> используются технические cookie для сессий
                (`HttpOnly`) и выбора языка (`zapis_lang`). Контакты: support@zapis.kg.
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
