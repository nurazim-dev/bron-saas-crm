import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export default function AppointmentsPlaceholderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{ru.nav.appointments}</CardTitle>
          <CardDescription>{ru.dashboard.goToAppointments}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
