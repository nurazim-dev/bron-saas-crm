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
import { loginWithPassword } from '@/lib/api/auth.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';

const loginSchema = z.object({
  email: z.string().trim().min(1, ru.validation.required).email(ru.validation.emailInvalid),
  password: z.string().min(8, ru.validation.passwordMin).max(128, ru.validation.passwordMax),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginFormContent() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      await loginWithPassword({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      toast.success(ru.auth.welcomeBack);
      router.replace('/dashboard');
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

      <Card className="w-full max-w-md shadow-xs">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">{ru.auth.loginTitle}</CardTitle>
          <CardDescription>{ru.auth.loginSubtitle}</CardDescription>
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

            <div className="space-y-2">
              <Label htmlFor="login-email">{ru.auth.emailLabel}</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder={ru.auth.emailPlaceholder}
                className="min-h-11"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="login-email-error" className="text-xs font-medium text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="login-password">{ru.auth.passwordLabel}</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {ru.auth.forgotPasswordLink}
                </Link>
              </div>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder={ru.auth.passwordPlaceholder}
                className="min-h-11"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="login-password-error" className="text-xs font-medium text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full text-base">
              {isSubmitting ? ru.auth.loginSubmitting : ru.auth.loginSubmit}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
          <div>
            {ru.auth.noAccountPrompt}{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              {ru.auth.goToRegister}
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

export default function LoginPage() {
  return (
    <AuthBootstrap>
      <GuestGuard>
        <LoginFormContent />
      </GuestGuard>
    </AuthBootstrap>
  );
}
