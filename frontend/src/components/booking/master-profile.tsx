'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PublicMasterDto, PublicServiceDto } from '@/types/api';
import type { PublicLang } from '@/lib/i18n/public-dict';
export function MasterProfile({
  master,
  services,
  lang,
  onSelect,
}: {
  master: PublicMasterDto;
  services: PublicServiceDto[];
  lang: PublicLang;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ky = lang === 'ky';
  const media = master.portfolio ?? [];
  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        {ky ? 'Чебер жана иштери' : 'О мастере и его работах'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="space-y-5">
          <DialogHeader>
            <DialogTitle>{master.name}</DialogTitle>
          </DialogHeader>
          {master.specialties && <p className="font-medium text-primary">{master.specialties}</p>}
          {master.experienceYears !== null && master.experienceYears !== undefined && (
            <p className="text-sm text-muted-foreground">
              {ky ? 'Иш тажрыйбасы (жыл)' : 'Опыт работы (лет)'}: {master.experienceYears}
            </p>
          )}
          {master.biography && (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {master.biography}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {services
              .filter((s) => master.serviceIds.includes(s.id))
              .map((s) => (
                <span key={s.id} className="rounded-full bg-muted px-3 py-2 text-xs">
                  {s.name} · {s.price} сом · {s.durationMin} {ky ? 'мүн' : 'мин'}
                </span>
              ))}
          </div>
          <details className="rounded-xl border p-4 text-sm">
            <summary className="min-h-7 cursor-pointer font-medium">
              {ky ? 'Кабыл алуу графиги' : 'График приёма'}
            </summary>
            <div className="mt-3 space-y-2">
              {[...(master.workingHours ?? [])]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                .map((day) => (
                  <p key={day.dayOfWeek} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {
                        (ky
                          ? ['Дш', 'Шш', 'Шр', 'Бш', 'Жм', 'Иш', 'Жк']
                          : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])[day.dayOfWeek - 1]
                      }
                    </span>
                    <span>
                      {day.startTime}–{day.endTime}
                      {day.breakStart && day.breakEnd
                        ? ` · ${ky ? 'тыныгуу' : 'перерыв'} ${day.breakStart}–${day.breakEnd}`
                        : ''}
                    </span>
                  </p>
                ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {ky
                ? 'Бош убакытты кийинки кадамда көрүңүз.'
                : 'Свободное время с учётом отпусков и записей — на следующем шаге.'}
            </p>
          </details>
          {!media.length && (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              {ky ? 'Портфолио азырынча кошула элек' : 'Мастер пока не добавил портфолио'}
            </p>
          )}
          <div className="space-y-4">
            {[...media]
              .sort((a, b) => Number(b.isCover) - Number(a.isCover))
              .map((item) => (
                <figure key={item.id}>
                  {item.kind === 'VIDEO' ? (
                    <video
                      controls
                      preload="none"
                      poster={item.posterUrl}
                      src={item.url}
                      className="max-h-80 w-full rounded-xl bg-muted"
                    />
                  ) : (
                    <Image
                      unoptimized
                      src={item.url}
                      alt={item.caption || master.name}
                      width={640}
                      height={480}
                      className="max-h-80 w-full rounded-xl bg-muted object-contain"
                      loading="lazy"
                    />
                  )}
                  {item.caption && (
                    <figcaption className="mt-2 break-words text-sm text-muted-foreground">
                      {item.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
          </div>
          <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-card pt-4">
            <Button
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
            >
              {ky ? 'Бул чеберди тандоо' : 'Выбрать этого мастера'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {ky ? 'Жабуу' : 'Закрыть'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
