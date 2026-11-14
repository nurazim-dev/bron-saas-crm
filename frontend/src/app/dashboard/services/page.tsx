import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function ServicesPlaceholderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{ru.nav.services}</CardTitle>
          <CardDescription>{ru.dashboard.goToServices}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
