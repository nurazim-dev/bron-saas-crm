import { Skeleton } from '@/components/ui/skeleton';
import { ru } from '@/lib/i18n/ru';

export default function GlobalLoading() {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center p-6"
      aria-busy="true"
      aria-label={ru.common.loading}
    >
      <div className="w-full max-w-lg space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </main>
  );
}
