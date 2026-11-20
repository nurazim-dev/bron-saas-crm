import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { PwaProvider } from '@/components/pwa/pwa-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Zapis.kg — Онлайн-запись и CRM для барбершопов и салонов красоты',
  description:
    'Система онлайн-записи и управления расписанием для барбершопов и салонов красоты в Кыргызстане.',
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>
          <PwaProvider />
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
