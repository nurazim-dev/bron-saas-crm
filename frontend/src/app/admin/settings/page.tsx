'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  type AdminPlatformSettingsDto,
  getAdminSettings,
  updateAdminSettings,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';

export default function AdminSettingsPage() {
  const [form, setForm] = useState<AdminPlatformSettingsDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAdminSettings()
      .then((data) => {
        if (!cancelled) {
          setForm(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setIsSaving(true);
    try {
      const updated = await updateAdminSettings(form);
      setForm(updated);
      toast.success('Настройки платформы сохранены');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Не удалось загрузить настройки'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Настройки платформы</h1>
        <p className="text-sm text-muted-foreground">
          Глобальные параметры регистрации, триала, реквизитов и объявлений.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Биллинг и регистрация</CardTitle>
            <CardDescription>Параметры применяются для новых компаний и подписок.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="trial-days">Дней триала</Label>
              <Input
                id="trial-days"
                type="number"
                min={0}
                value={form.trialDays}
                onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grace-days">Льготный период (дней)</Label>
              <Input
                id="grace-days"
                type="number"
                min={0}
                value={form.graceDays}
                onChange={(e) => setForm({ ...form, graceDays: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trial-plan">Код тарифа триала</Label>
              <Input
                id="trial-plan"
                value={form.trialPlanCode}
                onChange={(e) => setForm({ ...form, trialPlanCode: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={form.registrationOpen}
                onChange={(e) => setForm({ ...form, registrationOpen: e.target.checked })}
              />
              Открытая регистрация новых компаний
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Реквизиты оплаты и поддержка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="pay-instr">Инструкция по оплате (видна владельцам в биллинге)</Label>
              <Textarea
                id="pay-instr"
                rows={4}
                value={form.billingPaymentInstructions}
                onChange={(e) => setForm({ ...form, billingPaymentInstructions: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="sup-phone">Телефон поддержки</Label>
                <Input
                  id="sup-phone"
                  value={form.supportPhone}
                  onChange={(e) => setForm({ ...form, supportPhone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sup-wa">WhatsApp поддержки</Label>
                <Input
                  id="sup-wa"
                  value={form.supportWhatsapp}
                  onChange={(e) => setForm({ ...form, supportWhatsapp: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sup-email">Email поддержки</Label>
                <Input
                  id="sup-email"
                  value={form.supportEmail}
                  onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Объявление в кабинетах</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.announcementEnabled}
                onChange={(e) => setForm({ ...form, announcementEnabled: e.target.checked })}
              />
              Показывать баннер объявления
            </label>
            <div className="space-y-1">
              <Label htmlFor="ann-text">Текст объявления</Label>
              <Textarea
                id="ann-text"
                rows={2}
                value={form.announcementText}
                onChange={(e) => setForm({ ...form, announcementText: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Сохранение…' : 'Сохранить настройки'}
        </Button>
      </form>
    </div>
  );
}
