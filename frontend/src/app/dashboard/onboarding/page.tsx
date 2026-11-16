'use client';

import { CheckCircle2, Copy, ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api/client';
import {
  applyOnboarding,
  getOnboardingPresets,
  getOnboardingState,
  markOnboardingLinkShared,
  type OnboardingStateDto,
  type ServicePresetDto,
} from '@/lib/api/onboarding.api';
import { normalizePhoneE164OrNull } from '@/lib/phone';
import { useAuthStore } from '@/stores/auth.store';

interface EditablePreset extends ServicePresetDto {
  selected: boolean;
}

function OnboardingWizardContent() {
  const company = useAuthStore((s) => s.company);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [state, setState] = useState<OnboardingStateDto | null>(null);
  const [presets, setPresets] = useState<EditablePreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [phone, setPhone] = useState(company?.phone ?? '');
  const [address, setAddress] = useState(company?.address ?? '');
  const [ownerServesClients, setOwnerServesClients] = useState(true);
  const [applyDefaultHours, setApplyDefaultHours] = useState(true);
  const [firstMasterName, setFirstMasterName] = useState('');
  const [firstMasterPhone, setFirstMasterPhone] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [st, pr] = await Promise.all([getOnboardingState(), getOnboardingPresets()]);
        if (!cancelled) {
          setState(st);
          setPresets(
            pr.map((p, idx) => ({
              ...p,
              price: String(Math.round(Number(p.price))),
              selected: idx < 3,
            })),
          );
          if (st.isCompleted) {
            setStep(5);
          } else if (
            st.steps.profileComplete &&
            st.steps.hasServices &&
            st.steps.hasBookableMaster
          ) {
            setStep(4);
          } else if (st.steps.profileComplete && st.steps.hasServices) {
            setStep(3);
          } else if (st.steps.profileComplete) {
            setStep(2);
          }
        }
      } catch (err) {
        if (!cancelled) toast.error(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');
  const publicUrl = `${origin}/b/${state?.companySlug ?? company?.slug ?? ''}`;

  async function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    const normalized = phone.trim() ? normalizePhoneE164OrNull(phone.trim()) : null;
    if (!normalized) {
      toast.error('Укажите корректный номер телефона (+996...)');
      return;
    }
    if (address.trim().length < 2) {
      toast.error('Укажите адрес салона или барбершопа');
      return;
    }
    setIsSaving(true);
    try {
      const next = await applyOnboarding({
        phone: normalized,
        address: address.trim(),
        ownerServesClients: false,
        applyDefaultHours: false,
      });
      setState(next);
      setStep(2);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStep2Next() {
    const chosen = presets.filter((p) => p.selected);
    if (chosen.length === 0) {
      toast.error('Выберите хотя бы одну услугу');
      return;
    }
    setIsSaving(true);
    try {
      const next = await applyOnboarding({
        services: chosen.map((p) => ({
          presetId: p.id,
          name: p.name,
          durationMin: Number(p.durationMin),
          price: p.price,
        })),
        ownerServesClients: false,
        applyDefaultHours: false,
      });
      setState(next);
      setStep(3);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStep3Next() {
    if (!ownerServesClients && firstMasterName.trim().length < 2) {
      toast.error('Укажите имя первого мастера или отметьте, что сами принимаете клиентов');
      return;
    }
    setIsSaving(true);
    try {
      const normMasterPhone = firstMasterPhone.trim()
        ? normalizePhoneE164OrNull(firstMasterPhone.trim())
        : null;
      const next = await applyOnboarding({
        ownerServesClients,
        applyDefaultHours,
        ...(!ownerServesClients && firstMasterName.trim().length >= 2
          ? {
              firstMaster: {
                name: firstMasterName.trim(),
                ...(normMasterPhone ? { phone: normMasterPhone } : {}),
              },
            }
          : {}),
      });
      setState(next);
      setStep(4);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyAndComplete() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Ссылка скопирована');
    } catch {
      toast.info(publicUrl);
    }
    setIsSaving(true);
    try {
      const next = await markOnboardingLinkShared();
      setState(next);
      setStep(5);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
            Быстрый запуск Zapis.kg
          </h1>
          <p className="text-sm text-muted-foreground">Шаг {step} из 5</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Перейти в кабинет</Link>
        </Button>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. Контакты бизнеса</CardTitle>
            <CardDescription>
              Клиенты увидят телефон и адрес на странице онлайн-записи.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep1Next} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="onb-phone">Телефон (WhatsApp)</Label>
                <Input
                  id="onb-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 555 123 456"
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onb-address">Адрес</Label>
                <Input
                  id="onb-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="г. Бишкек, ул. Киевская 100"
                  className="min-h-11"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving} className="min-h-11">
                  {isSaving ? 'Сохранение...' : 'Далее'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Выберите услуги и цены</CardTitle>
            <CardDescription>
              Цены указаны ориентировочно — вы можете изменить их прямо сейчас или позже.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y">
              {presets.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={p.name}
                    checked={p.selected}
                    onChange={(e) =>
                      setPresets((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, selected: e.target.checked } : x)),
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="min-w-36 flex-1 text-sm font-medium">{p.name}</span>
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    value={p.durationMin}
                    onChange={(e) =>
                      setPresets((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, durationMin: Number(e.target.value) } : x,
                        ),
                      )
                    }
                    className="h-9 w-20 text-xs"
                    aria-label={`Длительность ${p.name}`}
                  />
                  <span className="text-xs text-muted-foreground">мин</span>
                  <Input
                    type="number"
                    min={0}
                    step={50}
                    value={p.price}
                    onChange={(e) =>
                      setPresets((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, price: e.target.value } : x)),
                      )
                    }
                    className="h-9 w-24 text-xs"
                    aria-label={`Цена ${p.name}`}
                  />
                  <span className="text-xs text-muted-foreground">сом</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Назад
              </Button>
              <Button type="button" disabled={isSaving} onClick={() => void handleStep2Next()}>
                {isSaving ? 'Сохранение...' : 'Далее'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Мастера и график работы</CardTitle>
            <CardDescription>
              Настройте первого мастера, чтобы публичная страница сразу показывала свободные слоты.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <input
                id="onb-owner-serves"
                type="checkbox"
                checked={ownerServesClients}
                onChange={(e) => setOwnerServesClients(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Я сам(а) принимаю клиентов как мастер
            </label>

            {!ownerServesClients && (
              <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="onb-master-name">Имя первого мастера</Label>
                  <Input
                    id="onb-master-name"
                    value={firstMasterName}
                    onChange={(e) => setFirstMasterName(e.target.value)}
                    placeholder="Например: Руслан"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="onb-master-phone">Телефон (необязательно)</Label>
                  <Input
                    id="onb-master-phone"
                    value={firstMasterPhone}
                    onChange={(e) => setFirstMasterPhone(e.target.value)}
                    placeholder="+996 555 000 111"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2.5 text-sm">
              <input
                id="onb-default-hours"
                type="checkbox"
                checked={applyDefaultHours}
                onChange={(e) => setApplyDefaultHours(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Установить график Пн–Сб с 10:00 до 20:00 (можно изменить позже)
            </label>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Назад
              </Button>
              <Button type="button" disabled={isSaving} onClick={() => void handleStep3Next()}>
                {isSaving ? 'Сохранение...' : 'Далее'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>4. Ваша публичная ссылка</CardTitle>
            <CardDescription>
              Отправьте её клиентам в WhatsApp, добавьте в шапку профиля Instagram и 2ГИС.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="rounded-lg border bg-white p-3">
                <QRCodeSVG value={publicUrl} size={120} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="truncate rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {publicUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleCopyAndComplete()}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Скопировать и завершить
                  </Button>
                  <Button asChild variant="outline" className="gap-2">
                    <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                      Предпросмотр страницы
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
              Готово! Онлайн-запись работает
            </CardTitle>
            <CardDescription>
              Вы можете принимать записи уже сейчас. Остальные настройки доступны в кабинете.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/dashboard">Перейти в кабинет</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                Открыть страницу записи
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <OwnerGuard>
      <OnboardingWizardContent />
    </OwnerGuard>
  );
}
