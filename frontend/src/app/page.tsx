import { ArrowDown, ArrowUpRight, CalendarDays, Check, Scissors, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Brand } from '@/components/layout/auth-shell';
import {
  LandingAnnouncementBanner,
  LandingPricingSection,
} from '@/components/landing/platform-section';
import { Reveal } from '@/components/landing/reveal';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="editorial-site">
      <a href="#content" className="skip-link">
        К содержанию
      </a>
      <LandingAnnouncementBanner />
      <header className="editorial-header">
        <Brand />
        <nav aria-label="Основная навигация">
          <Link className="hidden md:inline-flex" href="#possibilities">
            Возможности
          </Link>
          <Link href="/login">Войти</Link>
          <Button asChild>
            <Link href="/register">
              Начать <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </nav>
      </header>
      <main id="content">
        <section className="cinema-hero">
          <div className="cinema-copy">
            <span className="eyebrow">ZAPIS.KG / ДЛЯ БИЗНЕСА В КЫРГЫЗСТАНЕ</span>
            <h1>
              Вы создаёте
              <br />
              красоту.
              <br />
              <em>Мы — порядок.</em>
            </h1>
            <p>
              Онлайн-запись и CRM для барбершопов и салонов. Чтобы в вашем дне оставалось больше
              места для любимого дела.
            </p>
            <Button asChild className="min-h-12 px-6">
              <Link href="/register">
                Открыть свой кабинет <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
            <a href="#possibilities" className="hero-explore">
              Знакомство с сервисом <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>
          <figure className="cinema-photo">
            <Image
              src="/images/salon-1600.webp"
              alt="Светлый интерьер салона с зеркалами и креслами"
              fill
              priority
              sizes="(max-width: 767px) 100vw, 55vw"
              className="object-cover"
            />
            <figcaption>
              <span>ВНИМАНИЕ К ДЕТАЛЯМ</span>
              <p>
                В салоне.
                <br />И за его пределами.
              </p>
            </figcaption>
          </figure>
        </section>
        <div className="editorial-strip">
          <span>
            <Scissors size={18} aria-hidden="true" /> Барбершопы и салоны
          </span>
          <span>Одна команда. Одно пространство.</span>
          <span>Телефон · Планшет · Компьютер</span>
        </div>
        <section id="possibilities" className="editorial-section">
          <Reveal className="section-intro">
            <span className="eyebrow text-primary">01 / ВАШ РАБОЧИЙ ДЕНЬ</span>
            <h2>
              Всё на своих местах.
              <br />
              <span className="text-muted-foreground">Даже в самый занятый день.</span>
            </h2>
          </Reveal>
          <div className="feature-editorial">
            {[
              {
                icon: CalendarDays,
                title: 'Расписание без путаницы',
                text: 'Записи, перерывы и отпуска мастеров — рядом. Доступное время для онлайн-записи учитывает расписание команды.',
                label: 'РАСПИСАНИЕ',
              },
              {
                icon: Users,
                title: 'Клиенты, которых помнят',
                text: 'История визитов и заметки в карточке клиента помогают продолжать знакомство с каждой новой встречей.',
                label: 'КЛИЕНТСКАЯ БАЗА',
              },
              {
                icon: Scissors,
                title: 'Команда в одном ритме',
                text: 'Владелец управляет услугами и командой. Мастер видит свои записи и планирует рабочий день.',
                label: 'ЛИЧНЫЕ КАБИНЕТЫ',
              },
            ].map((item, index) => (
              <Reveal key={item.label}>
                <article className="feature-story">
                  <div className="flex items-center justify-between text-primary">
                    <item.icon size={26} aria-hidden="true" />
                    <span className="eyebrow">0{index + 1}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <span className="eyebrow mt-8 block text-primary">{item.label}</span>
                </article>
              </Reveal>
            ))}
          </div>
        </section>
        <section className="booking-story">
          <Reveal>
            <span className="eyebrow">02 / ОНЛАЙН-ЗАПИСЬ</span>
            <h2>
              От «хочу записаться»
              <br />
              до «до встречи».
            </h2>
            <p>
              Поделитесь ссылкой на ваш салон. Клиент сам выберет услугу, мастера и удобное время.
            </p>
            <Button asChild variant="secondary" className="mt-8 min-h-12">
              <Link href="/register">
                Подключить свой салон <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </Reveal>
          <ol>
            {[
              ['Услуга и мастер', 'Цена, длительность и выбор любого свободного мастера.'],
              ['Дата и время', 'Только доступные слоты. Условия предоплаты — до подтверждения.'],
              [
                'Всё готово к встрече',
                'Детали визита и защищённая ссылка для переноса или отмены.',
              ],
            ].map(([title, text], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
                <Check size={20} aria-hidden="true" />
              </li>
            ))}
          </ol>
        </section>
        <LandingPricingSection />
        <Reveal className="editorial-section closing-note">
          <span className="eyebrow text-primary">СЛЕДУЮЩАЯ ГЛАВА ВАШЕГО САЛОНА</span>
          <h2>
            Больше внимания людям.
            <br />
            Меньше — рутине.
          </h2>
          <Button asChild className="min-h-12 px-6">
            <Link href="/register">
              Создать аккаунт <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </Reveal>
      </main>
      <footer className="editorial-footer">
        <Brand />
        <p>
          Онлайн-запись и CRM.
          <br />С заботой о вашем рабочем дне.
        </p>
        <div>
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия использования</Link>
          <a
            href="https://www.pexels.com/photo/interior-of-hairdresser-saloon-9146943/"
            target="_blank"
            rel="noreferrer"
          >
            Фото интерьера: Лена Gromakova / Pexels
          </a>
        </div>
      </footer>
    </div>
  );
}
