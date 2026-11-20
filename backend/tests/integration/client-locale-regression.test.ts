import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Locale } from '../../src/generated/prisma/client.js';
import { FakeClock, now, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { upsertClientInTx } from '../../src/modules/clients/clients.service.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

const phone = '+996555444333';
const app = createApp();

async function bookableCompany(defaultLocale: Locale = Locale.RU) {
  const company = await createCompanyFactory({ defaultLocale });
  const master = await createUserFactory(company.id);
  const service = await createServiceFactory(company.id);
  await prisma.masterService.create({ data: { userId: master.id, serviceId: service.id } });
  await prisma.workingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      userId: master.id,
      dayOfWeek,
      startTime: '09:00',
      endTime: '18:00',
    })),
  });
  return {
    company,
    book(locale?: Locale, startAt = '2026-11-21T08:00:00.000Z') {
      return request(app)
        .post(`/api/v1/public/companies/${company.slug}/appointments`)
        .send({
          serviceId: service.id,
          masterId: master.id,
          startAt,
          clientName: 'Айзада',
          clientPhone: phone,
          consentAccepted: true,
          ...(locale ? { locale } : {}),
        });
    },
    client() {
      return prisma.client.findUniqueOrThrow({
        where: { companyId_phone: { companyId: company.id, phone } },
      });
    },
  };
}

describe('QA-001: client locale across public booking and CRM', () => {
  beforeEach(async () => {
    await truncateAllTables();
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));
  });
  afterEach(() => resetClock());

  it('updates an existing client locale without overwriting the CRM name or past appointment locale', async () => {
    const salon = await bookableCompany();
    expect((await salon.book(Locale.RU)).status).toBe(201);
    const initial = await salon.client();
    await prisma.client.update({
      where: { id: initial.id, companyId: salon.company.id },
      data: { name: 'Имя в CRM' },
    });
    expect((await salon.book(Locale.KY, '2026-11-21T09:00:00.000Z')).status).toBe(201);
    expect(await salon.client()).toMatchObject({
      id: initial.id,
      name: 'Имя в CRM',
      locale: Locale.KY,
    });
    const appointments = await prisma.appointment.findMany({
      where: { companyId: salon.company.id, clientId: initial.id },
      orderBy: { startAt: 'asc' },
    });
    expect(appointments.map((a) => a.clientLocale)).toEqual([Locale.RU, Locale.KY]);
    expect((await salon.book(Locale.RU, '2026-11-21T10:00:00.000Z')).status).toBe(201);
    expect((await salon.client()).locale).toBe(Locale.RU);
  });

  it('uses the company default when the public request omits locale', async () => {
    const salon = await bookableCompany(Locale.KY);
    expect((await salon.book()).status).toBe(201);
    expect((await salon.client()).locale).toBe(Locale.KY);
  });

  it('keeps identical phone numbers isolated between companies', async () => {
    const first = await bookableCompany();
    const second = await bookableCompany();
    expect((await first.book(Locale.RU)).status).toBe(201);
    expect((await second.book(Locale.KY)).status).toBe(201);
    expect((await first.client()).locale).toBe(Locale.RU);
    expect((await second.client()).locale).toBe(Locale.KY);
    expect((await first.client()).id).not.toBe((await second.client()).id);
  });

  it('preserves an existing KY preference when staff upsert without a language', async () => {
    const company = await createCompanyFactory();
    const client = await prisma.client.create({
      data: { companyId: company.id, name: 'Айзада', phone, locale: Locale.KY },
    });
    await prisma.$transaction((tx) =>
      upsertClientInTx(tx, {
        companyId: company.id,
        name: 'Обновлённое имя',
        phone,
        overwriteName: true,
        currentTime: now(),
      }),
    );
    expect(
      await prisma.client.findUniqueOrThrow({ where: { id: client.id, companyId: company.id } }),
    ).toMatchObject({ name: 'Обновлённое имя', locale: Locale.KY });
  });
});
