'use client';

import { Button } from '@/components/ui/button';
import { PUBLIC_DICT, type PublicLang, setPublicLangCookie } from '@/lib/i18n/public-dict';

export function PublicLangSwitcher({
  lang,
  onChange,
}: {
  lang: PublicLang;
  onChange: (next: PublicLang) => void;
}) {
  const t = PUBLIC_DICT[lang];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-background p-1">
      <Button
        type="button"
        size="sm"
        variant={lang === 'ru' ? 'default' : 'ghost'}
        onClick={() => {
          setPublicLangCookie('ru');
          onChange('ru');
        }}
        className="h-7 px-2.5 text-xs"
      >
        {t.langRu}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={lang === 'ky' ? 'default' : 'ghost'}
        onClick={() => {
          setPublicLangCookie('ky');
          onChange('ky');
        }}
        className="h-7 px-2.5 text-xs"
      >
        {t.langKy}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={lang === 'en' ? 'default' : 'ghost'}
        onClick={() => {
          setPublicLangCookie('en');
          onChange('en');
        }}
        className="h-7 px-2.5 text-xs"
      >
        {t.langEn}
      </Button>
    </div>
  );
}
