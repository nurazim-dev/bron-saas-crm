'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthBootstrap, GuestGuard } from '@/components/layout/auth-bootstrap';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerOwner } from '@/lib/api/auth.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';
import { isValidPhoneInput, normalizePhoneE164OrNull } from '@/lib/phone';
import type { BusinessType } from '@/types/api';

const BUSINESS_TYPE_VALUES: [BusinessType, ...BusinessType[]] = ['BARBERSHOP', 'BEAUTY_SALON'];

const registerSchema = z.object({
  companyName: z.string().trim().min(2, ru.validation.nameMin).max(100, ru.validation.nameMax),
  businessType: z.enum(BUSINESS_TYPE_VALUES),
  ownerName: z.string().trim().min(2, ru.validation.nameMin).max(100, ru.validation.nameMax),
  email: z.string().trim().min(1, ru.validation.required).email(ru.validation.emailInvalid),
  phone: z
    .string()
    .trim()
    .refine((val) => val.length === 0 || isValidPhoneInput(val), {
      message: ru.validation.phoneInvalid,
    }),
  password: z.string().min(8, ru.validation.passwordMin).max(128, ru.validation.passwordMax),
  termsAccepted: z.literal(true, {
    message: 'Необходимо принять пользовательское соглашение',
  }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

function RegisterFormContent() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      companyName: '',
      businessType: 'BARBERSHOP',
      ownerName: '',
      email: '',
      phone: '+996 ',
      password: '',
    },
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    const trimmedPhone = values.phone.replace(/^\+996\s*$/, '').trim();
    const normalizedPhone = trimmedPhone ? normalizePhoneE164OrNull(values.phone) : null;

    try {
      await registerOwner({
        companyName: values.companyName.trim(),
        businessType: values.businessType,
        ownerName: values.ownerName.trim(),
        email: values.email.trim().toLowerCase(),
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        password: values.password,
        termsAccepted: true,
      });
      toast.success(ru.auth.registrationSuccess);
      router.replace('/dashboard/onboarding');
    } catch (err) {
      setServerError(getApiErrorMessage(err));
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold">{ru.brand.name}</span>
        </Link>
      </div>

      <Card className="w-full max-w-lg shadow-xs">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">{ru.auth.registerTitle}</CardTitle>
          <CardDescription>{ru.auth.registerSubtitle}</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {serverError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{serverError}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reg-company-name">{ru.auth.companyNameLabel}</Label>
                <Input
                  id="reg-company-name"
                  type="text"
                  placeholder={ru.auth.companyNamePlaceholder}
                  className="min-h-11"
                  aria-invalid={Boolean(errors.companyName)}
                  aria-describedby={errors.companyName ? 'reg-company-name-error' : undefined}
                  {...register('companyName')}
                />
                {errors.companyName && (
                  <p id="reg-company-name-error" className="text-xs font-medium text-destructive">
                    {errors.companyName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-business-type">{ru.auth.businessTypeLabel}</Label>
                <select
                  id="reg-business-type"
                  className="flex min-h-11 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-2xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  {...register('businessType')}
                >
                  {BUSINESS_TYPE_VALUES.map((type) => (
                    <option key={type} value={type}>
                      {ru.businessTypes[type]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-owner-name">{ru.auth.ownerNameLabel}</Label>
              <Input
                id="reg-owner-name"
                type="text"
                autoComplete="name"
                placeholder={ru.auth.ownerNamePlaceholder}
                className="min-h-11"
                aria-invalid={Boolean(errors.ownerName)}
                aria-describedby={errors.ownerName ? 'reg-owner-name-error' : undefined}
                {...register('ownerName')}
              />
              {errors.ownerName && (
                <p id="reg-owner-name-error" className="text-xs font-medium text-destructive">
                  {errors.ownerName.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reg-email">{ru.auth.emailLabel}</Label>
                <Input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  placeholder={ru.auth.emailPlaceholder}
                  className="min-h-11"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'reg-email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="reg-email-error" className="text-xs font-medium text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reg-phone">{ru.auth.phoneLabel}</Label>
                <Input
                  id="reg-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder={ru.auth.phonePlaceholder}
                  className="min-h-11"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? 'reg-phone-error' : 'reg-phone-hint'}
                  {...register('phone')}
                />
                {errors.phone ? (
                  <p id="reg-phone-error" className="text-xs font-medium text-destructive">
                    {errors.phone.message}
                  </p>
                ) : (
                  <p id="reg-phone-hint" className="text-xs text-muted-foreground">
                    {ru.auth.phoneHint}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-password">{ru.auth.passwordLabel}</Label>
              <Input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                placeholder={ru.auth.passwordPlaceholder}
                className="min-h-11"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'reg-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="reg-password-error" className="text-xs font-medium text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  id="reg-terms"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  {...register('termsAccepted')}
                />
                <span>
                  Я принимаю{' '}
                  <Link href="/terms" target="_blank" className="text-primary underline">
                    Пользовательское соглашение
                  </Link>{' '}
                  и{' '}
                  <Link href="/privacy" target="_blank" className="text-primary underline">
                    Политику конфиденциальности
                  </Link>
                </span>
              </label>
              {errors.termsAccepted && (
                <p className="text-xs font-medium text-destructive">
                  {errors.termsAccepted.message}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full text-base">
              {isSubmitting ? ru.auth.registerSubmitting : ru.auth.registerSubmit}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
          <div>
            {ru.auth.hasAccountPrompt}{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {ru.auth.goToLogin}
            </Link>
          </div>
          <Link href="/" className="text-xs hover:underline">
            {ru.auth.backToHome}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <AuthBootstrap>
      <GuestGuard>
        <RegisterFormContent />
      </GuestGuard>
    </AuthBootstrap>
  );
}
