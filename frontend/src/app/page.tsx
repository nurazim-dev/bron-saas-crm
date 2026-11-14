import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">Zapis.kg</CardTitle>
          <CardDescription>
            Онлайн-запись и CRM для салонов красоты, барбершопов и автосервисов Кыргызстана
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Единое расписание мастеров без накладок, круглосуточная онлайн-запись для клиентов по
            ссылке без регистрации.
          </p>
          <div className="flex items-center gap-3">
            <Button type="button">Начать работу</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
