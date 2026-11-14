import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function StaffPlaceholderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{ru.nav.staff}</CardTitle>
          <CardDescription>{ru.dashboard.goToStaff}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
