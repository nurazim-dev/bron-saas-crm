import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  addDaysToLocalDate,
  getTodayLocalDate,
  localDateTimeToUtc,
} from '../../src/lib/datetime.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AppointmentDto } from '../../src/modules/appointments/appointments.service.js';
import { registerOwnerAndCompany, type AuthUserDto } from '../../src/modules/auth/auth.service.js';
import type { StaffDto } from '../../src/modules/staff/staff.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();
const password = 'Password123!';
const managerEmail = 'manager@example.test';
const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

function registerOwner(name: string) {
  return registerOwnerAndCompany({
    companyName: `${name} salon`,
    ownerName: name,
    email: `${name.toLowerCase()}@example.test`,
    password,
    termsAccepted: true,
    businessType: 'BEAUTY_SALON',
  });
}

async function inviteManager(owner: Awaited<ReturnType<typeof registerOwner>>) {
  const response = await request(app)
    .post('/api/v1/staff/invite')
    .set(auth(owner.accessToken))
    .send({ name: 'Менеджер Мария', email: managerEmail, role: 'MANAGER' })
    .expect(201);
  return (response.body as { data: { id: string; url: string } }).data;
}

describe('Staff manager permissions', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('lets a manager work with appointments in their tenant and protects owner operations', async () => {
    const owner = await registerOwner('Owner');
    const other = await registerOwner('Other');
    const invited = await inviteManager(owner);
    const browser = request.agent(app);
    await browser
      .post('/api/v1/auth/reset-password')
      .send({ token: new URL(invited.url).hash.slice(1), newPassword: password })
      .expect(204);
    const login = await browser
      .post('/api/v1/auth/login')
      .send({ email: managerEmail, password })
      .expect(200);
    expect((login.body as { data: { user: AuthUserDto } }).data.user).toMatchObject({
      id: invited.id,
      role: 'MANAGER',
      companyId: owner.company.id,
      isBookable: false,
    });
    const refreshed = await browser.post('/api/v1/auth/refresh').expect(200);
    const headers = auth((refreshed.body as { data: { accessToken: string } }).data.accessToken);

    const directory = await browser.get('/api/v1/staff').set(headers).expect(200);
    expect((directory.body as { data: StaffDto[] }).data).toMatchObject([
      { id: owner.user.id, email: null, phone: null, hasLogin: false },
    ]);
    await browser.get(`/api/v1/staff/${other.user.id}`).set(headers).expect(404);
    await browser.get('/api/v1/billing').set(headers).expect(403);
    await browser
      .post('/api/v1/staff/invite')
      .set(headers)
      .send({ name: 'Another manager', email: 'another@example.test', role: 'MANAGER' })
      .expect(403);

    const service = await prisma.service.create({
      data: { companyId: owner.company.id, name: 'Стрижка', durationMin: 30, price: '400.00' },
    });
    await prisma.masterService.create({ data: { userId: owner.user.id, serviceId: service.id } });
    const zone = owner.company.timezone;
    const date = addDaysToLocalDate(getTodayLocalDate(zone), 1, zone);
    const booking = {
      masterId: owner.user.id,
      serviceId: service.id,
      clientName: 'Test Client',
      clientPhone: '+996555123456',
      startAt: localDateTimeToUtc(date, '10:00', zone).toISOString(),
    };
    const created = await browser
      .post('/api/v1/appointments')
      .set(headers)
      .send(booking)
      .expect(201);
    const { id } = (created.body as { data: AppointmentDto }).data;
    const path = `/api/v1/appointments/${id}`;
    await browser.post('/api/v1/appointments').set(headers).send(booking).expect(409);
    await browser
      .patch(path)
      .set(headers)
      .send({ startAt: localDateTimeToUtc(date, '11:00', zone).toISOString() })
      .expect(200);
    await browser.delete(path).set(headers).expect(403);
    await request(app).get(path).set(auth(other.accessToken)).expect(404);
    const client = await prisma.client.findFirstOrThrow({ where: { companyId: owner.company.id } });
    await browser.get(`/api/v1/clients/${client.id}`).set(headers).expect(200);
    await browser.post(`/api/v1/clients/${client.id}/anonymize`).set(headers).expect(403);

    await request(app)
      .patch(`/api/v1/staff/${invited.id}`)
      .set(auth(owner.accessToken))
      .send({ isActive: false })
      .expect(200);
    await browser.get('/api/v1/auth/me').set(headers).expect(401);
    await browser.post('/api/v1/auth/refresh').expect(401);
  });

  it('never makes managers bookable and invalidates the invitation when owner credentials change', async () => {
    const owner = await registerOwner('Owner');
    const headers = auth(owner.accessToken);
    const invited = await inviteManager(owner);
    const path = `/api/v1/staff/${invited.id}`;
    await request(app).patch(path).set(headers).send({ isBookable: true }).expect(400);
    await expect(
      prisma.user.update({
        where: { id: invited.id, companyId: owner.company.id },
        data: { isBookable: true },
      }),
    ).rejects.toThrow(/User_bookable_role_check/);
    await request(app)
      .patch(path)
      .set(headers)
      .send({ email: 'updated-manager@example.test', password })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: new URL(invited.url).hash.slice(1), newPassword: password })
      .expect(400);
  });
});
