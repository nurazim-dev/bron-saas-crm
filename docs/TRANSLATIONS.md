# Переводы (RU / KY) — на вычитку носителю языка

Все кыргызские строки публичного интерфейса и клиентских уведомлений требуют профессиональной вычитки носителем языка перед запуском.

## Публичный интерфейс (`frontend/src/lib/i18n/public-dict.ts`)
- `onlineBookingSubtitle`: Онлайн жазылуу
- `stepService`: 1. Кызмат
- `stepMaster`: 2. Чебер
- `stepDateTime`: 3. Күн жана убакыт
- `stepContacts`: 4. Байланыш
- `chooseServiceTitle`: Кызматты тандаңыз
- `chooseMasterTitle`: Чеберди тандаңыз
- `anyAvailableMaster`: Каалаган бош чебер
- `anyMasterDesc`: Ыңгайлуу убакытка бош адисти автоматтык түрдө тандайбыз
- `chooseDateTimeTitle`: Күндү жана убакытты тандаңыз
- `noSlotsForDate`: Тандалган күнгө бош убакыт жок.
- `nextAvailableDate`: Кийинки күндү тандоо
- `enterDetailsTitle`: Сиздин маалыматтар
- `nameLabel`: Атыңыз
- `phoneLabel`: Телефон (WhatsApp)
- `noteLabel`: Комментарий (милдеттүү эмес)
- `consentPrefix`: Жеке маалыматтарды иштетүүгө макулмун:
- `privacyLinkLabel`: Купуялуулук саясаты
- `termsLinkLabel`: Колдонуучу макулдашуусу
- `submitBooking`: Жазылуу
- `successTitle`: Ийгиликтүү жазылдыңыз!
- `prepaymentRequiredTitle`: Алдын ала төлөм талап кылынат
- `whatsappProofButton`: Чекти WhatsApp аркылуу жөнөтүү
- `manageLinkTitle`: Жазылууну жылдыруу же жокко чыгаруу шилтемеси:
- `manageTitle`: Жазылууну башкаруу
- `rescheduleButton`: Убакытты жылдыруу
- `cancelButton`: Жазылууну жокко чыгаруу
- `windowClosedNotice`: Онлайн жокко чыгаруу жана жылдыруу жабык. Салон менен түз байланышыңыз.

## Клиентские шаблоны (`backend/src/modules/notifications/templates/index.ts`)
- `REMINDER_24H` / `REMINDER_2H` (KY)
- `PREPAYMENT_EXPIRED_CLIENT` (KY)
- Ручное WhatsApp-напоминание (`reminders.service.ts`, KY)
- Текст ссылки чека предоплаты (`prepayment.ts`, KY)
