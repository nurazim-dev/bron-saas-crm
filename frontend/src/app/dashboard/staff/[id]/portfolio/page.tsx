'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient, getApiErrorMessage } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiSuccessEnvelope } from '@/types/api';
type Media = { id: string; kind: string; caption: string; position: number; isCover: boolean };
type Profile = {
  name: string;
  biography: string;
  specialties: string;
  experienceYears: number | null;
  portfolio: Media[];
};
function Preview({ path, video }: { path: string; video: boolean }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void apiClient
      .get<Blob>(path, { responseType: 'blob' })
      .then((r) => {
        objectUrl = URL.createObjectURL(r.data);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  if (error) return <p className="p-4 text-sm text-destructive">Не удалось загрузить превью</p>;
  if (!url)
    return <div className="h-48 animate-pulse rounded-xl bg-muted" aria-label="Загрузка превью" />;
  return video ? (
    <video
      src={url}
      controls
      preload="metadata"
      className="h-56 w-full rounded-xl bg-muted object-contain"
    />
  ) : (
    <Image
      src={url}
      width={640}
      height={480}
      unoptimized
      alt="Материал портфолио"
      className="h-56 w-full rounded-xl bg-muted object-contain"
    />
  );
}
export default function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const base = `/staff/${id}`;
  useEffect(() => {
    let active = true;
    void apiClient
      .get<ApiSuccessEnvelope<Profile>>(`${base}/profile`)
      .then((r) => {
        if (active) setProfile(r.data.data);
      })
      .catch((e) => {
        if (active) setError(getApiErrorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [base]);
  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      toast.success('Сохранено');
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const r = await apiClient.get<ApiSuccessEnvelope<Profile>>(`${base}/profile`);
    setProfile(r.data.data);
  }
  async function upload(file: File, kind: string) {
    const video = kind === 'VIDEO';
    if (
      file.size > (video ? 20 : 8) * 1024 * 1024 ||
      !(video ? ['video/mp4'] : ['image/jpeg', 'image/png', 'image/webp']).includes(file.type)
    ) {
      setError('Фото: JPEG, PNG, WebP до 8 МБ. Видео: MP4 до 20 МБ.');
      return;
    }
    setProgress(0);
    await mutate(async () => {
      await apiClient.post(`${base}/media/upload/${kind}`, file, {
        headers: { 'Content-Type': file.type },
        onUploadProgress: (e) => setProgress(Math.round((e.loaded / (e.total || file.size)) * 100)),
      });
      await refresh();
    });
  }
  if (user?.role !== 'OWNER') return <p>Портфолио доступно владельцу.</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" asChild>
        <Link href="/dashboard/staff">← Сотрудники</Link>
      </Button>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Публичный профиль
        </p>
        <h1 className="mt-2 text-3xl font-bold">{profile?.name || 'Портфолио мастера'}</h1>
        <p className="mt-2 text-muted-foreground">
          Помогите клиенту выбрать своего мастера. Изменения появятся в онлайн-записи.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      )}
      {!profile && !error && <p role="status">Загрузка профиля…</p>}
      {profile && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Знакомство с мастером</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(async () => {
                    await apiClient.patch(`${base}/profile`, {
                      biography: profile.biography,
                      specialties: profile.specialties,
                      experienceYears: profile.experienceYears,
                    });
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="bio">О мастере</Label>
                  <textarea
                    id="bio"
                    className="min-h-32 w-full rounded-xl border bg-background p-3"
                    maxLength={1500}
                    value={profile.biography}
                    onChange={(e) => setProfile({ ...profile, biography: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Подход к работе, обучение и сильные стороны. До 1500 символов.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <div className="space-y-2">
                    <Label htmlFor="specialties">Специализации</Label>
                    <Input
                      id="specialties"
                      maxLength={300}
                      value={profile.specialties}
                      onChange={(e) => setProfile({ ...profile, specialties: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="experience">Опыт, лет</Label>
                    <Input
                      id="experience"
                      type="number"
                      min={0}
                      max={80}
                      value={profile.experienceYears ?? ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          experienceYears: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <Button disabled={busy} type="submit">
                  Сохранить профиль
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Фото и работы · {profile.portfolio.length}/12</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Фото JPEG/PNG/WebP до 8 МБ, не более 20 млн пикселей. Видео MP4 до 20 МБ, 30 секунд
                и 1920×1920. Видео публикуется без звука. Общий лимит компании — 100 МБ. Загружайте
                только свои материалы с согласия изображённых людей.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['PHOTO', 'Фото мастера'],
                  ['WORK', 'Фото работы'],
                  ['VIDEO', 'Видео работы'],
                ].map(([kind, label]) => (
                  <div key={kind} className="min-w-0 space-y-2">
                    <Label htmlFor={`upload-${kind}`}>{label}</Label>
                    <Input
                      id={`upload-${kind}`}
                      type="file"
                      disabled={busy}
                      accept={kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'}
                      className="h-auto min-h-11 max-w-full py-3 text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && kind) void upload(file, kind);
                        e.target.value = '';
                      }}
                    />
                  </div>
                ))}
              </div>
              {busy && (
                <p role="status" className="text-sm text-primary">
                  {progress > 0
                    ? `Загрузка ${progress}%. Проверяем и обрабатываем материал…`
                    : 'Сохраняем…'}
                </p>
              )}
              {!profile.portfolio.length && (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  Пока нет материалов. Начните с фотографии мастера.
                </div>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                {profile.portfolio.map((item, index) => (
                  <article key={item.id} className="min-w-0 space-y-3 rounded-2xl border p-3">
                    <Preview path={`${base}/media/${item.id}`} video={item.kind === 'VIDEO'} />
                    <p className="text-xs font-semibold text-primary">
                      {item.kind === 'PHOTO'
                        ? 'Фото мастера'
                        : item.kind === 'VIDEO'
                          ? 'Видео'
                          : 'Работа'}
                      {item.isCover ? ' · Обложка' : ''}
                    </p>
                    <Label htmlFor={`caption-${item.id}`}>Подпись</Label>
                    <Input
                      id={`caption-${item.id}`}
                      maxLength={200}
                      defaultValue={item.caption}
                      onBlur={(e) => {
                        if (e.target.value !== item.caption)
                          void mutate(async () => {
                            await apiClient.patch(`${base}/media/${item.id}`, {
                              caption: e.target.value,
                            });
                            await refresh();
                          });
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={busy || item.isCover}
                        onClick={() =>
                          void mutate(async () => {
                            await apiClient.patch(`${base}/media/${item.id}`, { isCover: true });
                            await refresh();
                          })
                        }
                      >
                        Обложка
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || index === 0}
                        onClick={() =>
                          void mutate(async () => {
                            const previous = profile.portfolio[index - 1];
                            if (!previous) return;
                            await apiClient.patch(`${base}/media/${item.id}`, {
                              position: Math.max(0, previous.position - 1),
                            });
                            await apiClient.patch(`${base}/media/${previous.id}`, {
                              position: item.position + 1,
                            });
                            await refresh();
                          })
                        }
                      >
                        ↑ Выше
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('Удалить материал? Восстановить его будет нельзя.'))
                            void mutate(async () => {
                              await apiClient.delete(`${base}/media/${item.id}`);
                              await refresh();
                            });
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
