import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Scissors } from 'lucide-react';
import type { ReactNode } from 'react';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Zapis.kg — главная">
      <span className="brand-mark">
        <Scissors size={21} aria-hidden="true" />
      </span>
      Zapis<span className="text-primary">.kg</span>
    </Link>
  );
}

export function AuthShell({
  children,
  registration = false,
}: {
  children: ReactNode;
  registration?: boolean;
}) {
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="auth-story-copy">
          <span className="eyebrow">ПРОСТРАНСТВО ДЛЯ ВАШЕГО БИЗНЕСА</span>
          <h1>
            {registration ? 'Хороший сервис начинается с порядка.' : 'Ваш день. В вашем ритме.'}
          </h1>
          <p>
            Записи, команда и клиенты — в одном месте. Больше внимания людям, меньше повседневной
            рутины.
          </p>
          <div className="auth-note">
            <CalendarDays aria-hidden="true" />
            <span>Для барбершопов и салонов красоты Кыргызстана</span>
          </div>
        </div>
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm">
          О сервисе Zapis.kg <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </aside>
      <div className="auth-form-area">
        <div className="mb-8 lg:hidden">
          <Brand />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Ваш бизнес. Внимание к каждой детали.
        </p>
      </div>
    </main>
  );
}
