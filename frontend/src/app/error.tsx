'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">{ru.common.errorTitle}</CardTitle>
          <CardDescription>{ru.common.errorDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button type="button" onClick={() => reset()} className="min-h-11 px-6">
            {ru.common.retry}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
