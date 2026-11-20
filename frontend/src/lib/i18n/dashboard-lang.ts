import { create } from 'zustand';
import type { Role } from '@/types/api';

export type DashboardLang = 'ru' | 'ky' | 'en';

export const DASHBOARD_NAV_BY_HREF: Record<string, Record<DashboardLang, string>> = {
  '/dashboard': {
    ru: 'Обзор',
    ky: 'Сереп',
    en: 'Overview',
  },
  '/dashboard/schedule': {
    ru: 'Расписание',
    ky: 'Жүгүртмө',
    en: 'Schedule',
  },
  '/dashboard/appointments': {
    ru: 'Записи',
    ky: 'Жазылуулар',
    en: 'Appointments',
  },
  '/dashboard/clients': {
    ru: 'Клиенты',
    ky: 'Кардарлар',
    en: 'Clients',
  },
  '/dashboard/analytics': {
    ru: 'Аналитика',
    ky: 'Аналитика',
    en: 'Analytics',
  },
  '/dashboard/payments': {
    ru: 'Платежи',
    ky: 'Төлөмдөр',
    en: 'Payments',
  },
  '/dashboard/services': {
    ru: 'Услуги',
    ky: 'Кызматтар',
    en: 'Services',
  },
  '/dashboard/staff': {
    ru: 'Сотрудники',
    ky: 'Кызматкерлер',
    en: 'Staff',
  },
  '/dashboard/billing': {
    ru: 'Оплата и тариф',
    ky: 'Төлөм жана тариф',
    en: 'Billing & Plan',
  },
  '/dashboard/settings': {
    ru: 'Настройки',
    ky: 'Ырастоолор',
    en: 'Settings',
  },
  '/dashboard/profile': {
    ru: 'Профиль',
    ky: 'Профиль',
    en: 'Profile',
  },
};

export const DASHBOARD_ROLE_LABELS: Record<Role, Record<DashboardLang, string>> = {
  OWNER: {
    ru: 'Владелец',
    ky: 'Ээси',
    en: 'Owner',
  },
  MANAGER: {
    ru: 'Менеджер',
    ky: 'Менеджер',
    en: 'Manager',
  },
  MASTER: {
    ru: 'Мастер',
    ky: 'Чебер',
    en: 'Specialist',
  },
};

export const DASHBOARD_SHELL_TEXT: Record<
  DashboardLang,
  {
    publicPageLink: string;
    logout: string;
    themeToggle: string;
    langLabel: string;
  }
> = {
  ru: {
    publicPageLink: 'Публичная страница записи',
    logout: 'Выйти',
    themeToggle: 'Переключить тему',
    langLabel: 'Язык интерфейса',
  },
  ky: {
    publicPageLink: 'Онлайн жазылуу баракчасы',
    logout: 'Чыгуу',
    themeToggle: 'Теманы которуу',
    langLabel: 'Интерфейс тили',
  },
  en: {
    publicPageLink: 'Public booking page',
    logout: 'Log out',
    themeToggle: 'Toggle theme',
    langLabel: 'Interface language',
  },
};

interface DashboardLangState {
  lang: DashboardLang;
  setLang: (next: DashboardLang) => void;
}

export const useDashboardLangStore = create<DashboardLangState>((set) => ({
  lang: 'ru',
  setLang: (next) => {
    if (typeof document !== 'undefined') {
      document.cookie = `zapis_dash_lang=${next}; path=/; max-age=31536000; SameSite=Lax`;
    }
    set({ lang: next });
  },
}));
