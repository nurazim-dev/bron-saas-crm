import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function SettingsPlaceholderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{ru.nav.settings}</CardTitle>
          <CardDescription>{ru.dashboard.goToSettings}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
