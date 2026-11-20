import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Locale } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { adjustSubscription } from '../../src/modules/billing/billing.service.js';
import { buildManualReminderWhatsappUrl } from '../../src/modules/notifications/reminders.service.js';
import { renderNotificationTemplate } from '../../src/modules/notifications/templates/index.js';
import { invalidatePublicPlatformCache } from '../../src/modules/platform/platform-settings.service.js';
import { truncateAllTables } from '../helpers/db.js';

describe('Phase 6 Business Features: EN locale, notifications, public profile, custom domains & payments CSV', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    invalidatePublicPlatformCache();
    await prisma.platformSetting.upsert({
      where: { key: 'registrationOpen' },
      update: { value: true },
      create: { key: 'registrationOpen', value: true },
    });
  });

  afterEach(() => {
    resetClock();
    invalidatePublicPlatformCache();
  });

  async function registerOwner(email: string, companyName: string) {
    const res = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Алия Владелец',
      email,
      password: 'Password123!',
      termsAccepted: true,
      companyName,
      businessType: 'BEAUTY_SALON',
    });
    expect(res.status).toBe(201);
    return (
      res.body as {
        data: {
          accessToken: string;
          user: { id: string; email: string };
          company: { id: string; slug: string };
        };
      }
    ).data;
  }

  it('supports EN locale in company settings, public booking, prepayment WhatsApp links, manual reminders, and templates', async () => {
    const clock = new FakeClock(new Date('2026-11-10T06:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner('en-owner@salon.kg', 'English Ready Salon');

    // Update company defaultLocale to EN + paymentInstructions + phone
    const patchRes = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        defaultLocale: 'EN',
        phone: '+996555800900',
        paymentInstructions: 'Transfer via MBank +996555800900',
      });
    expect(patchRes.status).toBe(200);
    expect((patchRes.body as { data: { defaultLocale: string } }).data.defaultLocale).toBe('EN');

    // Create service with prepayment + assign to owner + working hours
    const svcRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Haircut & Styling',
        durationMin: 60,
        price: '1200.00',
        requiresPrepayment: true,
        prepaymentMode: 'FIXED',
        prepaymentValue: '300.00',
      });
    expect(svcRes.status).toBe(201);
    const svcId = (svcRes.body as { data: { id: string } }).data.id;

    await request(app)
      .put(`/api/v1/staff/${owner.user.id}/services`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ serviceIds: [svcId] })
      .expect(200);

    await request(app)
      .put(`/api/v1/staff/${owner.user.id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '19:00',
          breakStart: null,
          breakEnd: null,
        })),
      })
      .expect(200);

    // Book public appointment with locale: 'EN'
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        masterId: owner.user.id,
        serviceId: svcId,
        startAt: '2026-11-12T06:00:00.000Z',
        clientName: 'John Carter',
        clientPhone: '+996555700800',
        consentAccepted: true,
        locale: 'EN',
        website: '',
      });
    expect(bookRes.status).toBe(201);
    const bookBody = bookRes.body as {
      data: {
        appointment: { id: string };
        prepayment: { whatsappProofUrl: string | null } | null;
      };
    };
    expect(decodeURIComponent(bookBody.data.prepayment?.whatsappProofUrl ?? '')).toContain(
      'Hello! I am John Carter, sending prepayment receipt',
    );

    const apptRow = await prisma.appointment.findUniqueOrThrow({
      where: { id: bookBody.data.appointment.id },
    });
    expect(apptRow.clientLocale).toBe(Locale.EN);

    // Verify EN manual reminder WhatsApp URL and notification templates
    const waReminder = buildManualReminderWhatsappUrl({
      phone: '+996555700800',
      locale: Locale.EN,
      companyName: 'English Ready Salon',
      serviceName: 'Haircut & Styling',
      localDateTime: '2026-11-12 12:00',
      address: 'Chui Ave 150',
      manageUrl: 'https://zapis.kg/manage/tok',
    });
    expect(decodeURIComponent(waReminder)).toContain('appointment reminder');
    expect(decodeURIComponent(waReminder)).toContain('Manage appointment:');

    const sysTpl = renderNotificationTemplate('SYSTEM_TEST', Locale.EN, {});
    expect(sysTpl.subject).toContain('Zapis.kg test notification');

    const pwdTpl = renderNotificationTemplate('PASSWORD_RESET', Locale.EN, {
      userName: 'John',
      companyName: 'English Ready Salon',
      resetUrl: 'https://zapis.kg/reset#123',
      expiresInMinutes: 60,
    });
    expect(pwdTpl.subject).toContain('Password reset');
    expect(pwdTpl.text).toContain('Hello, John!');

    const remTpl = renderNotificationTemplate('REMINDER_24H', Locale.EN, {
      companyName: 'English Ready Salon',
      serviceName: 'Haircut & Styling',
      localDateTime: '2026-11-12 12:00',
      address: 'Chui Ave 150',
      manageUrl: 'https://zapis.kg/manage/tok',
    });
    expect(remTpl.subject).toContain('Appointment reminder');

    const expTpl = renderNotificationTemplate('PREPAYMENT_EXPIRED_CLIENT', Locale.EN, {
      companyName: 'English Ready Salon',
      serviceName: 'Haircut & Styling',
      localDateTime: '2026-11-12 12:00',
    });
    expect(expTpl.subject).toContain('Appointment cancelled');
  });

  it('gates customDomain on customBranding feature, enforces uniqueness, and resolves public profile by custom domain', async () => {
    const ownerA = await registerOwner('domain-a@salon.kg', 'Domain Salon A');
    const ownerB = await registerOwner('domain-b@salon.kg', 'Domain Salon B');
    const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });

    // Owner A on BUSINESS trial can set description & instagramUrl, but customDomain requires customBranding (402)
    const descOk = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        description: 'Премиум студия в центре Бишкека',
        instagramUrl: 'https://instagram.com/domainsalona',
      });
    expect(descOk.status).toBe(200);
    expect((descOk.body as { data: { description: string } }).data.description).toBe(
      'Премиум студия в центре Бишкека',
    );

    const gatedDomain = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ customDomain: 'booking.salona.kg' });
    expect(gatedDomain.status).toBe(402);
    expect((gatedDomain.body as { error: { code: string } }).error.code).toBe(
      'FEATURE_NOT_IN_PLAN',
    );

    // Upgrade both A and B to PRO (featureCustomBranding = true)
    await adjustSubscription(ownerA.company.id, null, {
      planId: proPlan.id,
      isTrial: false,
      reason: 'Upgrade A to PRO for customDomain test',
    });
    await adjustSubscription(ownerB.company.id, null, {
      planId: proPlan.id,
      isTrial: false,
      reason: 'Upgrade B to PRO for customDomain collision test',
    });

    // Reserved domain rejected with 400
    const reservedRes = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ customDomain: 'zapis.kg' });
    expect(reservedRes.status).toBe(400);

    // Owner A sets customDomain & brandColor
    const setDomainA = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        customDomain: 'BOOKING.SalonA.kg',
        brandColor: '#7C3AED',
      });
    expect(setDomainA.status).toBe(200);
    expect(
      (setDomainA.body as { data: { customDomain: string; brandColor: string } }).data,
    ).toMatchObject({
      customDomain: 'booking.salona.kg',
      brandColor: '#7c3aed',
    });

    // Owner B cannot claim the same customDomain -> 409 CONFLICT
    const duplicateDomain = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ customDomain: 'booking.salona.kg' });
    expect(duplicateDomain.status).toBe(409);

    // Resolve public company profile by custom domain
    const resolveRes = await request(app).get('/api/v1/public/domains/booking.salona.kg');
    expect(resolveRes.status).toBe(200);
    const resolvedCompany = (
      resolveRes.body as {
        data: {
          company: {
            slug: string;
            description: string | null;
            brandColor: string | null;
            customDomain: string | null;
            instagramUrl: string | null;
          };
        };
      }
    ).data.company;
    expect(resolvedCompany).toMatchObject({
      slug: ownerA.company.slug,
      description: 'Премиум студия в центре Бишкека',
      brandColor: '#7c3aed',
      customDomain: 'booking.salona.kg',
      instagramUrl: 'https://instagram.com/domainsalona',
    });

    const unknownDomain = await request(app).get('/api/v1/public/domains/unknown.salona.kg');
    expect(unknownDomain.status).toBe(404);
  });

  it('exports business payments report as CSV with formula-injection protection', async () => {
    const clock = new FakeClock(new Date('2026-11-15T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner('csv-pay@salon.kg', 'CSV Payments Salon');

    await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        kind: 'PAYMENT',
        amount: '1500.00',
        method: 'MBANK',
        reference: '=CMD|calc',
        note: 'Оплата стрижки',
        confirmImmediately: true,
      })
      .expect(201);

    const csvRes = await request(app)
      .get('/api/v1/export/payments.csv?from=2026-11-01&to=2026-11-30')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('1500.00');
    expect(csvRes.text).toContain("'=CMD|calc");
  });
});
