# Отчёт по фазе 25: PWA (Manifest, Service Worker, Icons, Install Prompt, 360px Mobile Pass)

## Что сделано
- **Иконки PWA**: добавлен `sharp` (devDependency во `frontend`) и сгенерированы иконки `frontend/public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`.
- **Web App Manifest**: создан `frontend/src/app/manifest.ts` (`/manifest.webmanifest` с `display: "standalone"`, `start_url: "/dashboard/schedule"`, `theme_color`, `background_color`, `icons`).
- **Service Worker и офлайн-страница**:
  - Созданы `frontend/public/offline.html` и `frontend/public/sw.js` (precache `/offline.html`, cache-first для `/_next/static/*` и `/icons/*`, network-first для навигаций с fallback на `/offline.html`, без кэширования `/api/*` и HTML, поддержка `SKIP_WAITING`).
  - В `frontend/next.config.ts` настроен заголовок `Cache-Control: no-cache, no-store, must-revalidate` для `/sw.js`.
- **Install UX и 360px Mobile Pass**:
  - Создан `frontend/src/components/pwa/pwa-provider.tsx` (`PwaProvider` и `PwaInstallCard`), подключён в `frontend/src/app/layout.tsx`, `dashboard/profile/page.tsx` и `dashboard/settings/page.tsx`.
  - В `frontend/src/components/layout/dashboard-shell.tsx` устранён горизонтальный скролл на ширине 360px (`min-w-0`, `overflow-x-hidden`).
- **E2E**: добавлен сценарий `E2E 14` в `frontend/e2e/zapis.spec.ts` (проверка manifest, `sw.js` `no-cache`, 360px без горизонтального переполнения, активный SW, отсутствие `/api/*` в Cache Storage, офлайн-фолбэк).

## Проверки
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run guard` — PASS.
- `npm test -w backend` — 139 тестов PASS.
- `E2E 14` — 3/3 подряд PASS; полный `npm run test:e2e -w frontend` — 14/14 PASS.
- `prisma migrate status` и `Appointment_no_overlapping_active_slots` — проверены.

Автопилот: переход к фазе 26.
