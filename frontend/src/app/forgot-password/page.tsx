'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2, Mail, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { forgotPassword } from '@/lib/api/auth.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { ru } from '@/lib/i18n/ru';

const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, ru.validation.required).email(ru.validation.emailInvalid),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

function ForgotPasswordContent() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setServerError(null);
    try {
      await forgotPassword(values.email.trim().toLowerCase());
      setIsSubmitted(true);
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
          <CardTitle className="text-2xl font-bold">{ru.auth.forgotPasswordTitle}</CardTitle>
          <CardDescription>{ru.auth.forgotPasswordSubtitle}</CardDescription>
        </CardHeader>

        <CardContent>
          {isSubmitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-semibold">{ru.auth.forgotPasswordSentTitle}</p>
                  <p>{ru.auth.forgotPasswordSentDescription}</p>
                </div>
              </div>
              <Button asChild className="min-h-11 w-full">
                <Link href="/login">{ru.auth.goToLogin}</Link>
              </Button>
            </div>
          ) : (
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
                <Label htmlFor="forgot-email">{ru.auth.emailLabel}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder={ru.auth.emailPlaceholder}
                  className="min-h-11"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'forgot-email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="forgot-email-error" className="text-xs font-medium text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full gap-2">
                <Mail className="h-4 w-4" aria-hidden="true" />
                {isSubmitting ? ru.auth.forgotPasswordSubmitting : ru.auth.forgotPasswordSubmit}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="flex flex-col items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            {ru.auth.goToLogin}
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthBootstrap>
      <GuestGuard>
        <ForgotPasswordContent />
      </GuestGuard>
    </AuthBootstrap>
  );
}
