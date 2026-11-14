import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function SchedulePlaceholderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{ru.nav.schedule}</CardTitle>
          <CardDescription>{ru.dashboard.goToSchedule}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
