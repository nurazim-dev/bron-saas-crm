import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { LEGAL_VERSION } from '../../src/config/legal.js';
import { Locale, ReminderMode, Role } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { renderNotificationTemplate } from '../../src/modules/notifications/templates/index.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

interface DataEnvelope<T> {
  data: T;
}

function asBody<T>(body: unknown): T {
  return body as T;
}

describe('Phase 24: Kyrgyz i18n, Legal Consent & Templates', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterEach(() => {
    resetClock();
  });

  it('rejects registration without termsAccepted and stores termsAcceptedAt/termsVersion when accepted', async () => {
    setClock(new FakeClock('2026-11-20T08:00:00.000Z'));

    const failRes = await request(app).post('/api/v1/auth/register').send({
      companyName: 'No Terms Salon',
      ownerName: 'Азамат',
      email: 'noterms@zapis.kg',
      password: 'Password123!',
    });
    expect(failRes.status).toBe(400);

    const okRes = await request(app).post('/api/v1/auth/register').send({
      companyName: 'With Terms Salon',
      ownerName: 'Азамат',
      email: 'withterms@zapis.kg',
      password: 'Password123!',
      termsAccepted: true,
    });
    expect(okRes.status).toBe(201);

    const user = await prisma.user.findFirst({ where: { email: 'withterms@zapis.kg' } });
    expect(user?.termsAcceptedAt?.toISOString()).toBe('2026-11-20T08:00:00.000Z');
    expect(user?.termsVersion).toBe(LEGAL_VERSION);
  });

  it('stores clientLocale KY on booking and renders reminder/prepayment templates in RU and KY', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'ky-salon',
      reminderMode: ReminderMode.AUTO,
      defaultLocale: Locale.RU,
    });
    const master = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    await prisma.workingHours.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        userId: master.id,
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      })),
    });
    const service = await createServiceFactory(company.id, { durationMin: 60 });
    await prisma.masterService.create({ data: { userId: master.id, serviceId: service.id } });

    const res = await request(app).post('/api/v1/public/companies/ky-salon/appointments').send({
      serviceId: service.id,
      masterId: master.id,
      startAt: '2026-11-21T08:00:00.000Z',
      clientName: 'Айзада',
      clientPhone: '+996555444333',
      consentAccepted: true,
      locale: 'KY',
    });
    expect(res.status).toBe(201);
    const apptId = asBody<DataEnvelope<{ appointment: { id: string } }>>(res.body).data.appointment
      .id;

    const appt = await prisma.appointment.findUnique({
      where: { id: apptId },
      include: { client: true },
    });
    expect(appt?.clientLocale).toBe(Locale.KY);
    expect(appt?.client.locale).toBe(Locale.KY);

    // Render client templates in both RU and KY
    for (const kind of ['REMINDER_24H', 'REMINDER_2H', 'PREPAYMENT_EXPIRED_CLIENT'] as const) {
      const ruMsg = renderNotificationTemplate(kind, Locale.RU, {
        companyName: 'Test Salon',
        serviceName: 'Стрижка',
        localDateTime: '2026-11-21 14:00',
        manageUrl: 'https://zapis.kg/manage/abc',
      });
      const kyMsg = renderNotificationTemplate(kind, Locale.KY, {
        companyName: 'Test Salon',
        serviceName: 'Чач кыркуу',
        localDateTime: '2026-11-21 14:00',
        manageUrl: 'https://zapis.kg/manage/abc',
      });
      expect(ruMsg.text.length).toBeGreaterThan(10);
      expect(kyMsg.text.length).toBeGreaterThan(10);
      expect(kyMsg.text).not.toBe(ruMsg.text);
    }
  });
});
