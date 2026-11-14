import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function GlobalNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileQuestion className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">{ru.common.notFoundTitle}</CardTitle>
          <CardDescription>{ru.common.notFoundDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild className="min-h-11 px-6">
            <Link href="/">{ru.common.backToHome}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
