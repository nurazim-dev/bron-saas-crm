import type { BusinessType, ErrorCode, ErrorDetail, Role } from '@/types/api';

export const ru = {
  brand: {
    name: 'Zapis.kg',
    tagline: 'Онлайн-запись и CRM для сферы услуг Кыргызстана',
  },
  landing: {
    badge: 'Для салонов красоты, барбершопов и СТО в Кыргызстане',
    heroTitle: 'Запись клиентов без хаоса',
    heroSubtitle:
      'Замените бумажные блокноты и бесконечные переписки в WhatsApp единым расписанием мастеров и круглосуточной онлайн-записью по ссылке.',
    ctaStart: 'Начать бесплатно',
    ctaLogin: 'Войти в кабинет',
    ctaDashboard: 'Перейти в панель',
    benefitsTitle: 'Почему бизнес выбирает Zapis.kg',
    benefits: [
      {
        title: 'Расписание без накладок',
        description:
          'Владелец видит загрузку всех мастеров на одном экране. Двойная запись на одно время технически исключена.',
      },
      {
        title: 'Онлайн-запись 24/7 без регистрации',
        description:
          'Разместите ссылку в Instagram, 2ГИС или на QR-визитке — клиент выбирает услугу, мастера и время с телефона меньше чем за минуту.',
      },
      {
        title: 'Личный кабинет для каждого мастера',
        description:
          'Мастер видит и ведёт только своё расписание, а владелец управляет услугами, графиком и настройками бизнеса.',
      },
    ],
    footerText: '© 2026 Zapis.kg. Сделано для малого бизнеса Кыргызстана.',
  },
  auth: {
    loginTitle: 'Вход в систему',
    loginSubtitle: 'Введите email и пароль для доступа к расписанию',
    registerTitle: 'Регистрация компании',
    registerSubtitle: 'Создайте аккаунт и получите ссылку для онлайн-записи клиентов за 1 минуту',
    emailLabel: 'Электронная почта',
    emailPlaceholder: 'owner@salon.kg',
    passwordLabel: 'Пароль',
    passwordPlaceholder: 'Не менее 8 символов',
    companyNameLabel: 'Название компании',
    companyNamePlaceholder: 'Например: Барбершоп Лорд',
    businessTypeLabel: 'Тип бизнеса',
    ownerNameLabel: 'Ваше имя',
    ownerNamePlaceholder: 'Например: Азамат Токтогулов',
    phoneLabel: 'Телефон (необязательно)',
    phonePlaceholder: '+996 555 123 456',
    phoneHint: 'Формат Кыргызстана: +996 или 0555...',
    loginSubmit: 'Войти',
    loginSubmitting: 'Входим...',
    registerSubmit: 'Создать аккаунт',
    registerSubmitting: 'Создаём компанию...',
    noAccountPrompt: 'Ещё нет аккаунта?',
    goToRegister: 'Зарегистрировать компанию',
    hasAccountPrompt: 'Уже есть аккаунт?',
    goToLogin: 'Войти',
    backToHome: 'На главную',
    logout: 'Выйти',
    logoutSuccess: 'Вы вышли из системы',
    welcomeBack: 'Добро пожаловать!',
    registrationSuccess: 'Компания успешно зарегистрирована!',
  },
  businessTypes: {
    BEAUTY_SALON: 'Салон красоты',
    BARBERSHOP: 'Барбершоп',
    AUTO_SERVICE: 'Автосервис (СТО)',
    OTHER: 'Другие услуги',
  } satisfies Record<BusinessType, string>,
  roles: {
    OWNER: 'Владелец',
    MASTER: 'Мастер',
  } satisfies Record<Role, string>,
  nav: {
    overview: 'Обзор',
    schedule: 'Расписание',
    appointments: 'Записи',
    services: 'Услуги',
    staff: 'Сотрудники',
    settings: 'Настройки',
    openMenu: 'Открыть меню навигации',
    closeMenu: 'Закрыть меню',
    publicPageLink: 'Публичная страница записи',
  },
  dashboard: {
    welcomeTitle: 'Панель управления',
    welcomeSubtitleOwner:
      'Управляйте расписанием мастеров, услугами и онлайн-записью вашей компании.',
    welcomeSubtitleMaster: 'Просматривайте своё расписание и управляйте записями клиентов.',
    publicLinkLabel: 'Ваша ссылка для онлайн-записи клиентов',
    copyLink: 'Скопировать ссылку',
    linkCopied: 'Ссылка скопирована в буфер обмена',
    openPublicPage: 'Открыть страницу',
    quickActionsTitle: 'Быстрые действия',
    goToSchedule: 'Открыть календарь расписания',
    goToAppointments: 'Перейти к списку записей',
    goToServices: 'Настроить услуги и цены',
    goToStaff: 'Настроить мастеров и график работы',
    goToSettings: 'Настройки компании и онлайн-записи',
    companyInfoTitle: 'Профиль компании',
    timezoneLabel: 'Часовой пояс',
    currencyLabel: 'Валюта',
    bookingStatusLabel: 'Онлайн-запись',
    bookingEnabled: 'Включена',
    bookingDisabled: 'Выключена',
  },
  servicesPage: {
    title: 'Услуги',
    subtitle: 'Управляйте прайс-листом, длительностью процедур и доступностью для онлайн-записи.',
    addService: 'Добавить услугу',
    addFirstService: 'Добавить первую услугу',
    emptyTitle: 'Услуг пока нет',
    emptyDescription:
      'Добавьте услуги с ценой и длительностью, чтобы привязать их к мастерам и открыть запись.',
    filterAll: 'Все',
    filterActive: 'Активные',
    filterInactive: 'Скрытые',
    statusActive: 'Активна',
    statusInactive: 'Скрыта',
    createDialogTitle: 'Новая услуга',
    editDialogTitle: 'Редактировать услугу',
    nameLabel: 'Название услуги',
    namePlaceholder: 'Например: Мужская стрижка',
    descriptionLabel: 'Описание (необязательно)',
    descriptionPlaceholder: 'Мытьё головы, стрижка и укладка',
    durationLabel: 'Длительность (мин)',
    durationHint: 'От 5 до 480 минут, кратно 5 минутам',
    priceLabel: 'Цена (сом)',
    pricePlaceholder: '800',
    isActiveLabel: 'Доступна для записи',
    isActiveHint: 'Скрытые услуги не отображаются на публичной странице онлайн-записи',
    deleteConfirmTitle: 'Удалить услугу?',
    deleteConfirmText:
      'Услуга будет удалена из прайс-листа и отвязана от мастеров. История прошлых записей сохранится.',
    deleteSuccess: 'Услуга удалена',
    createSuccess: 'Услуга добавлена',
    updateSuccess: 'Услуга обновлена',
    deactivateInstead: 'Скрыть услугу вместо удаления',
  },
  staffPage: {
    title: 'Сотрудники и график работы',
    subtitle: 'Управляйте мастерами, назначенными услугами и еженедельным расписанием смен.',
    addMaster: 'Добавить мастера',
    emptyTitle: 'Сотрудники не найдены',
    badgeHasLogin: 'Есть вход в кабинет',
    badgeNoLogin: 'Без входа в кабинет',
    badgeBookable: 'Запись открыта',
    badgeNotBookable: 'Не принимает запись',
    badgeActive: 'Активен',
    badgeInactive: 'Отключён',
    servicesCountLabel: 'Услуг назначено',
    workingDaysCountLabel: 'Рабочих дней в неделю',
    configureServices: 'Услуги мастера',
    configureHours: 'График работы',
    createDialogTitle: 'Новый мастер',
    editDialogTitle: 'Профиль сотрудника',
    nameLabel: 'Имя сотрудника',
    namePlaceholder: 'Например: Тимур Касымов',
    phoneLabel: 'Телефон (необязательно)',
    phonePlaceholder: '+996 555 200 300',
    enableLoginLabel: 'Предоставить доступ в личный кабинет по email и паролю',
    emailLabel: 'Email для входа',
    emailPlaceholder: 'master@salon.kg',
    passwordLabel: 'Пароль для входа',
    newPasswordLabel: 'Новый пароль (оставьте пустым, чтобы не менять)',
    passwordPlaceholder: 'Минимум 8 символов',
    isBookableLabel: 'Принимает записи клиентов (отображать в расписании и онлайн-записи)',
    isActiveLabel: 'Аккаунт активен',
    servicesModalTitle: 'Назначение услуг сотруднику',
    servicesModalSubtitle: 'Выберите услуги, которые выполняет этот специалист.',
    selectAllServices: 'Выбрать все',
    clearAllServices: 'Снять выбор',
    noServicesInCompany: 'Сначала создайте услуги в разделе «Услуги».',
    hoursModalTitle: 'Еженедельный график работы',
    hoursModalSubtitle:
      'Укажите рабочие дни и часы смен в часовом поясе компании. В выходные дни запись недоступна.',
    dayOff: 'Выходной',
    workingDay: 'Рабочий день',
    startTimeLabel: 'С',
    endTimeLabel: 'До',
    copyToWeekdays: 'Скопировать Пн на Пн–Пт',
    copyToAllDays: 'Скопировать Пн на все дни',
    deleteConfirmTitle: 'Удалить мастера?',
    deleteConfirmText:
      'Профиль мастера будет удалён, а доступ в кабинет закрыт. Прошлые записи сохранятся в истории.',
    createSuccess: 'Мастер добавлен',
    updateSuccess: 'Профиль сотрудника обновлён',
    deleteSuccess: 'Сотрудник удалён',
    servicesSaved: 'Список услуг сотрудника сохранён',
    hoursSaved: 'График работы сохранён',
    weekdays: {
      1: 'Понедельник',
      2: 'Вторник',
      3: 'Среда',
      4: 'Четверг',
      5: 'Пятница',
      6: 'Суббота',
      7: 'Воскресенье',
    } as Record<number, string>,
    weekdaysShort: {
      1: 'Пн',
      2: 'Вт',
      3: 'Ср',
      4: 'Чт',
      5: 'Пт',
      6: 'Сб',
      7: 'Вс',
    } as Record<number, string>,
  },
  settingsPage: {
    title: 'Настройки компании',
    subtitle:
      'Профиль бизнеса, параметры онлайн-записи, публичная ссылка с QR-кодом и безопасность.',
    publicBookingCardTitle: 'Публичная страница и QR-код для клиентов',
    publicBookingCardDescription:
      'Отправьте ссылку клиентам в WhatsApp, добавьте в профиль Instagram/2ГИС или распечатайте QR-код для ресепшена.',
    bookingEnabledToggle: 'Принимать онлайн-записи через публичную страницу',
    downloadQrSvg: 'Скачать QR-код (SVG)',
    profileCardTitle: 'Основная информация',
    companyNameLabel: 'Название компании',
    businessTypeLabel: 'Категория бизнеса',
    phoneLabel: 'Контактный телефон компании',
    addressLabel: 'Адрес (город, улица, ориентир)',
    addressPlaceholder: 'г. Бишкек, ул. Киевская 114',
    timezoneLabel: 'Часовой пояс',
    slugCardTitle: 'Адрес публичной страницы (slug)',
    slugLabel: 'Короткий адрес ссылки',
    slugWarning:
      'Внимание: при изменении короткого адреса старая ссылка и ранее распечатанные QR-коды перестанут работать.',
    bookingRulesCardTitle: 'Правила расчёта свободного времени',
    slotStepLabel: 'Шаг сетки времени для записи',
    slotStep15: '15 минут',
    slotStep30: '30 минут',
    slotStep60: '60 минут (1 час)',
    minLeadTimeLabel: 'Минимальный запас времени до визита (мин)',
    minLeadTimeHint:
      'Например, 60 мин — клиент не сможет записаться менее чем за час до начала приёма.',
    maxAdvanceDaysLabel: 'На сколько дней вперёд открыта запись',
    maxAdvanceDaysHint: 'От 1 до 365 дней (рекомендуется 30 дней).',
    saveSettings: 'Сохранить настройки',
    settingsSaved: 'Настройки компании сохранены',
    passwordCardTitle: 'Смена пароля',
    passwordCardDescription: 'При смене пароля все остальные устройства будут разлогинены.',
    currentPasswordLabel: 'Текущий пароль',
    newPasswordLabel: 'Новый пароль',
    confirmPasswordLabel: 'Повторите новый пароль',
    changePasswordSubmit: 'Обновить пароль',
    passwordChanged: 'Пароль успешно изменён',
    passwordMismatch: 'Новые пароли не совпадают',
    timezones: [
      { value: 'Asia/Bishkek', label: 'Бишкек (Asia/Bishkek, UTC+6)' },
      { value: 'Asia/Almaty', label: 'Алматы (Asia/Almaty, UTC+5)' },
      { value: 'Asia/Tashkent', label: 'Ташкент (Asia/Tashkent, UTC+5)' },
      { value: 'Asia/Dushanbe', label: 'Душанбе (Asia/Dushanbe, UTC+5)' },
      { value: 'Europe/Moscow', label: 'Москва (Europe/Moscow, UTC+3)' },
      { value: 'UTC', label: 'Всемирное координированное время (UTC)' },
    ],
  },
  common: {
    loading: 'Загрузка...',
    saving: 'Сохранение...',
    deleting: 'Удаление...',
    retry: 'Попробовать снова',
    errorTitle: 'Произошла ошибка',
    errorDescription: 'Не удалось загрузить данные. Проверьте подключение и попробуйте ещё раз.',
    notFoundTitle: 'Страница не найдена',
    notFoundDescription: 'Запрошенная страница не существует или была перемещена.',
    backToDashboard: 'Вернуться в панель',
    backToHome: 'На главную страницу',
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    edit: 'Редактировать',
    close: 'Закрыть',
    som: 'сом',
    minutesShort: 'мин',
  },
  validation: {
    required: 'Обязательное поле',
    emailInvalid: 'Введите корректный email адрес',
    passwordMin: 'Пароль должен содержать минимум 8 символов',
    passwordMax: 'Пароль не должен превышать 128 символов',
    nameMin: 'Минимум 2 символа',
    nameMax: 'Максимум 100 символов',
    phoneInvalid: 'Введите корректный номер телефона (например, +996 555 123 456)',
    durationRange: 'Длительность должна быть от 5 до 480 минут и кратна 5',
    priceInvalid: 'Введите корректную неотрицательную стоимость',
    slugInvalid:
      'Используйте только строчные латинские буквы, цифры и одиночные дефисы (3–60 символов)',
    timeRangeInvalid: 'Время начала должно быть раньше времени окончания смены',
  },
  errors: {
    VALIDATION_ERROR: 'Проверьте правильность заполнения полей формы.',
    UNAUTHENTICATED: 'Неверный email или пароль, либо сессия истекла.',
    FORBIDDEN: 'Недостаточно прав для выполнения этого действия.',
    BOOKING_DISABLED: 'Онлайн-запись для этой компании временно отключена.',
    NOT_FOUND: 'Запрошенная запись или страница не найдена.',
    CONFLICT: 'Такие данные уже используются (например, email или ссылка компании).',
    SLOT_ALREADY_BOOKED: 'Это время только что заняли. Пожалуйста, выберите другое время.',
    HAS_UPCOMING_APPOINTMENTS:
      'Невозможно удалить: есть предстоящие запланированные записи. Сначала отмените или перенесите их.',
    INVALID_STATUS_TRANSITION: 'Недопустимое изменение статуса для этой записи.',
    SLOT_NOT_AVAILABLE: 'Выбранное время недоступно для записи по графику работы.',
    RATE_LIMITED: 'Слишком много запросов. Пожалуйста, подождите немного и попробуйте снова.',
    INTERNAL_ERROR: 'Внутренняя ошибка сервера. Пожалуйста, попробуйте позже.',
    NETWORK_ERROR: 'Не удалось связаться с сервером. Проверьте подключение к интернету.',
  },
} as const;

export function mapErrorCodeToRussian(
  code: ErrorCode | undefined,
  details?: ErrorDetail[],
): string {
  if (!code) {
    return ru.errors.INTERNAL_ERROR;
  }

  if (code === 'HAS_UPCOMING_APPOINTMENTS') {
    const count = details?.[0]?.upcomingAppointmentsCount;
    if (typeof count === 'number' && count > 0) {
      return `Невозможно удалить: найдено предстоящих записей — ${String(count)}. Сначала отмените или перенесите их.`;
    }
    return ru.errors.HAS_UPCOMING_APPOINTMENTS;
  }

  return ru.errors[code] ?? ru.errors.INTERNAL_ERROR;
}

/**
 * Formats a decimal string price (e.g. "1200.00") as "1 200 сом" (or with kopecks if non-zero).
 */
export function formatPriceKgs(price: string | number): string {
  const num = typeof price === 'number' ? price : Number(price);
  if (!Number.isFinite(num)) {
    return `${String(price)} ${ru.common.som}`;
  }
  const hasFraction = Math.round(num * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} ${ru.common.som}`;
}

/**
 * Formats minutes as "45 мин".
 */
export function formatDurationMin(durationMin: number): string {
  return `${String(durationMin)} ${ru.common.minutesShort}`;
}
