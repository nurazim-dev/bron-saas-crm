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
  common: {
    loading: 'Загрузка...',
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
