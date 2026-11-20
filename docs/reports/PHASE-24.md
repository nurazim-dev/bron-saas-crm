# Отчёт по фазе 24: Кыргызский язык (`RU`/`KY`), юридические страницы и согласие

## Что сделано
1. **Схема БД и миграция**: `20261116100000_terms_acceptance` — добавлены `termsAcceptedAt` и `termsVersion` в `User`; константа `LEGAL_VERSION = '2026-11-01'` в `backend/src/config/legal.ts`.
2. **Backend**:
   - `POST /api/v1/auth/register` требует `termsAccepted: true` и сохраняет `termsAcceptedAt` и `termsVersion`.
   - Публичная запись сохраняет `clientLocale` в `Appointment` и `locale` в `Client`; шаблоны `REMINDER_24H`, `REMINDER_2H`, `PREPAYMENT_EXPIRED_CLIENT` и ручные WhatsApp-напоминания рендерятся на `RU` и `KY`.
3. **Frontend**:
   - Словарь `PUBLIC_DICT` (`RU` и `KY`, 58 ключей) в `frontend/src/lib/i18n/public-dict.ts` + скрипт проверки паритета `frontend/scripts/check-i18n-parity.mjs`.
   - Переключатель языка `PublicLangSwitcher` (`zapis_lang` cookie + `<html lang>`) на `/b/[slug]`, `/manage/[token]`, `/privacy`, `/terms`.
   - Юридические страницы `/privacy` и `/terms` (RU/KY) с явной маркировкой **ЧЕРНОВИК / ДОЛБООР (DRAFT)**; чекбокс согласия на `/register` (ссылки на `/terms` и `/privacy`) и на `/b/[slug]` (ссылка на `/privacy`).
4. **Документация**: `docs/TRANSLATIONS.md` (список кыргызских строк на вычитку носителю языка) и `docs/LEGAL_NOTES.md` (предупреждение о необходимости проверки юристом).

## Проверки
- `check-i18n-parity.mjs`: 58 ключей в `ru` и `ky`, пустых строк нет.
- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm run build`, `npm run guard`: пройдены (`EXIT=0`).
- Backend тесты: `27` файлов, `139/139` тестов пройдены (включая `phase24-i18n-legal.test.ts`).
- Playwright E2E: `E2E 13` пройден 3/3 подряд, полный набор `13/13` пройден (`37.7s`).

> [!IMPORTANT]
> Требуется вычитка кыргызских переводов носителем языка (`docs/TRANSLATIONS.md`) и юридическая проверка черновиков `/privacy` и `/terms` (`docs/LEGAL_NOTES.md`) до запуска в production.

Автопилот: переход к фазе 25.
