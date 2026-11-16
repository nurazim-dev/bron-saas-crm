'use client';

import { AlertCircle, Copy, Download, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  adminEnrollTotp,
  adminLogin,
  adminVerifyEnrollTotp,
  adminVerifyMfa,
} from '@/lib/api/admin.api';
import { getApiErrorMessage } from '@/lib/api/client';

type LoginStep = 'password' | 'mfa' | 'enroll' | 'recovery_codes';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [enrollData, setEnrollData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await adminLogin({ email: email.trim().toLowerCase(), password });
      if (res.status === 'authenticated') {
        toast.success('Вход выполнен');
        router.replace('/admin');
        return;
      }
      setMfaToken(res.mfaToken);
      if (res.status === 'mfa_required') {
        setStep('mfa');
      } else {
        const enroll = await adminEnrollTotp(res.mfaToken);
        setEnrollData(enroll);
        setStep('enroll');
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await adminVerifyMfa(
        useRecovery
          ? { mfaToken, recoveryCode: recoveryInput.trim() }
          : { mfaToken, code: totpCode.trim() },
      );
      toast.success('2FA подтверждена');
      router.replace('/admin');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEnrollVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await adminVerifyEnrollTotp(mfaToken, totpCode.trim());
      setRecoveryCodes(res.recoveryCodes);
      setStep('recovery_codes');
      toast.success('2FA успешно включена');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    toast.success('Коды восстановления скопированы');
  }

  function downloadRecoveryCodes() {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zapis-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mb-6 flex items-center gap-2.5 text-xl font-bold">
        <ShieldCheck className="h-6 w-6 text-emerald-400" aria-hidden="true" />
        <span>Zapis.kg Admin</span>
      </div>

      <Card className="w-full max-w-md border-slate-800 bg-slate-900 text-slate-50">
        <CardHeader>
          <CardTitle className="text-xl">
            {step === 'password' && 'Вход для оператора платформы'}
            {step === 'mfa' && 'Двухфакторная аутентификация'}
            {step === 'enroll' && 'Настройка 2FA (обязательно)'}
            {step === 'recovery_codes' && 'Коды восстановления'}
          </CardTitle>
          <CardDescription className="text-slate-400">
            {step === 'password' && 'Изолированный контур управления SaaS'}
            {step === 'mfa' && 'Введите 6-значный код из приложения-аутентификатора'}
            {step === 'enroll' && 'Отсканируйте QR-код в Google Authenticator / 1Password'}
            {step === 'recovery_codes' &&
              'Сохраните эти одноразовые коды. Они больше не будут показаны.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/60 p-3 text-sm text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-email" className="text-slate-200">
                  Email
                </Label>
                <Input
                  id="admin-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-11 border-slate-700 bg-slate-950 text-slate-50"
                  placeholder="admin@demo.zapis.kg"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-password" className="text-slate-200">
                  Пароль
                </Label>
                <Input
                  id="admin-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-11 border-slate-700 bg-slate-950 text-slate-50"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full gap-2">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Войти
              </Button>
            </form>
          )}

          {step === 'mfa' && (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              {useRecovery ? (
                <div className="space-y-1.5">
                  <Label htmlFor="admin-recovery" className="text-slate-200">
                    Код восстановления
                  </Label>
                  <Input
                    id="admin-recovery"
                    required
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                    placeholder="XXXXXX-XXXXXX"
                    className="min-h-11 border-slate-700 bg-slate-950 font-mono text-slate-50"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="admin-totp" className="text-slate-200">
                    6-значный код TOTP
                  </Label>
                  <Input
                    id="admin-totp"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    className="min-h-11 border-slate-700 bg-slate-950 font-mono text-lg tracking-widest text-slate-50"
                  />
                </div>
              )}

              <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full gap-2">
                <KeyRound className="h-4 w-4" />
                Подтвердить
              </Button>

              <button
                type="button"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setError(null);
                }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 hover:underline"
              >
                {useRecovery ? 'Использовать код из приложения' : 'Использовать код восстановления'}
              </button>
            </form>
          )}

          {step === 'enroll' && enrollData && (
            <form onSubmit={handleEnrollVerify} className="space-y-4">
              <div className="flex justify-center rounded-lg bg-white p-4">
                <QRCodeSVG value={enrollData.otpauthUrl} size={180} />
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950 p-2.5 text-xs">
                <p className="mb-1 text-slate-400">Секрет для ручного ввода:</p>
                <p className="break-all font-mono text-slate-200">{enrollData.secret}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="enroll-totp" className="text-slate-200">
                  Введите код из приложения
                </Label>
                <Input
                  id="enroll-totp"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  className="min-h-11 border-slate-700 bg-slate-950 font-mono text-lg tracking-widest text-slate-50"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="min-h-11 w-full">
                Активировать 2FA
              </Button>
            </form>
          )}

          {step === 'recovery_codes' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
                {recoveryCodes.map((c) => (
                  <div key={c} className="rounded bg-slate-900 px-2 py-1 text-center">
                    {c}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 gap-1.5"
                  onClick={() => void copyRecoveryCodes()}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Копировать
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 gap-1.5"
                  onClick={downloadRecoveryCodes}
                >
                  <Download className="h-3.5 w-3.5" />
                  Скачать .txt
                </Button>
              </div>
              <Button type="button" className="w-full" onClick={() => router.replace('/admin')}>
                Продолжить в панель
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
