import { getAnalyticsServices } from '../../src/modules/analytics/analytics.service.js';
import type { AppointmentDto } from '../../src/modules/appointments/appointments.service.js';
import type { PublicManageAppointmentDto } from '../../src/modules/public/public-manage.service.js';
import type { PublicCreateAppointmentResultDto } from '../../src/modules/public/public.service.js';
import type { AvailabilityResultDto } from '../../src/modules/availability/availability.service.js';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
  addDaysToLocalDate,
  getTodayLocalDate,
  localDateTimeToUtc,
} from '../../src/lib/datetime.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { registerOwnerAndCompany } from '../../src/modules/auth/auth.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();
const zone = 'Asia/Bishkek';
async function fixture() {
  const auth = await registerOwnerAndCompany({
    companyName: 'Multi Salon',
    ownerName: 'Owner',
    email: 'multi@example.test',
    password: 'Password123!',
    termsAccepted: true,
    businessType: 'BARBERSHOP',
  });
  const companyId = auth.company.id;
  const first = await prisma.service.create({
    data: { companyId, name: 'Стрижка', price: '1000.10', durationMin: 30 },
  });
  const second = await prisma.service.create({
    data: { companyId, name: 'Борода', price: '500.20', durationMin: 60 },
  });
  await prisma.masterService.createMany({
    data: [first, second].map((service) => ({ userId: auth.user.id, serviceId: service.id })),
  });
  await prisma.workingHours.createMany({
    data: Array.from({ length: 7 }, (_, index) => ({
      userId: auth.user.id,
      dayOfWeek: index + 1,
      startTime: '09:00',
      endTime: '18:00',
      breakStart: '12:00',
      breakEnd: '13:00',
    })),
  });
  const date = addDaysToLocalDate(getTodayLocalDate(zone), 2, zone);
  const path = `/api/v1/public/companies/${auth.company.slug}`;
  const body = {
    serviceId: first.id,
    serviceIds: [first.id, second.id],
    masterId: auth.user.id,
    startAt: localDateTimeToUtc(date, '10:00', zone).toISOString(),
    clientName: 'Multi Client',
    clientPhone: '+996555123456',
    consentAccepted: true,
  };
  return { auth, first, second, date, path, body };
}

describe('Multi-service booking', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('checks the full interval and snapshots exact totals; reschedule preserves them after catalog changes', async () => {
    const f = await fixture();
    const availability = await request(app)
      .get(`${f.path}/availability`)
      .query({
        serviceId: f.first.id,
        serviceIds: f.body.serviceIds.join(','),
        masterId: f.auth.user.id,
        date: f.date,
      });
    expect(availability.status).toBe(200);
    expect((availability.body as { data: AvailabilityResultDto }).data.slots).not.toContainEqual(
      expect.objectContaining({ label: '11:00' }),
    );
    expect((availability.body as { data: AvailabilityResultDto }).data.slots).not.toContainEqual(
      expect.objectContaining({ label: '17:00' }),
    );
    const booking = await request(app).post(`${f.path}/appointments`).send(f.body);
    expect(booking.status).toBe(201);
    expect(
      (booking.body as { data: PublicCreateAppointmentResultDto }).data.appointment.service,
    ).toMatchObject({
      name: 'Стрижка + Борода',
      durationMin: 90,
      price: '1500.30',
    });
    const stored = await prisma.appointment.findFirstOrThrow({
      where: { companyId: f.auth.company.id },
    });
    expect(
      await prisma.appointmentService.count({
        where: { companyId: f.auth.company.id, appointmentId: stored.id },
      }),
    ).toBe(2);
    await prisma.service.update({
      where: { id: f.second.id, companyId: f.auth.company.id },
      data: { name: 'Changed', durationMin: 5, price: '1.00' },
    });
    const managePath = `/api/v1/public/manage/${stored.manageToken}`;
    const details = await request(app).get(managePath);
    expect(details.status).toBe(200);
    expect((details.body as { data: PublicManageAppointmentDto }).data.service).toMatchObject({
      name: 'Стрижка + Борода',
      durationMin: 90,
      price: '1500.30',
    });
    const moved = await request(app)
      .post(`${managePath}/reschedule`)
      .send({ startAt: localDateTimeToUtc(f.date, '14:00', zone).toISOString() });
    expect(moved.status).toBe(200);
    expect((moved.body as { data: AppointmentDto }).data.service.durationMin).toBe(90);
    expect((moved.body as { data: PublicManageAppointmentDto }).data.service.price).toBe('1500.30');
  });

  it('rejects duplicate and foreign services and requires the master to provide the whole selection', async () => {
    const f = await fixture();
    await request(app)
      .post(`${f.path}/appointments`)
      .send({ ...f.body, serviceIds: [f.first.id, f.first.id] })
      .expect(400);
    const other = await prisma.company.create({
      data: { name: 'Other Salon', slug: 'other-salon' },
    });
    const foreign = await prisma.service.create({
      data: { companyId: other.id, name: 'Foreign', durationMin: 30, price: '100' },
    });
    await request(app)
      .post(`${f.path}/appointments`)
      .send({ ...f.body, serviceIds: [f.first.id, foreign.id] })
      .expect(404);
    await prisma.masterService.delete({
      where: { userId_serviceId: { userId: f.auth.user.id, serviceId: f.second.id } },
    });
    await request(app).post(`${f.path}/appointments`).send(f.body).expect(400);
    await request(app)
      .post(`${f.path}/appointments`)
      .send({ ...f.body, masterId: 'ANY' })
      .expect(422);
    expect(await prisma.appointment.count({ where: { companyId: f.auth.company.id } })).toBe(0);
  });

  it('serializes concurrent bookings and protects the tail of the combined interval', async () => {
    const f = await fixture();
    const responses = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post(`${f.path}/appointments`)
          .send({ ...f.body, masterId: 'ANY' }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await request(app)
      .post(`${f.path}/appointments`)
      .send({
        ...f.body,
        serviceIds: [f.first.id],
        startAt: localDateTimeToUtc(f.date, '11:00', zone).toISOString(),
      })
      .expect(409);
    await request(app)
      .post(`${f.path}/appointments`)
      .send({
        ...f.body,
        serviceIds: [f.first.id],
        startAt: localDateTimeToUtc(f.date, '11:30', zone).toISOString(),
      })
      .expect(201);
  });

  it('stores staff selections and preserves them when only the time changes', async () => {
    const f = await fixture();
    const { consentAccepted: _consent, ...body } = f.body;
    void _consent;
    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${f.auth.accessToken}`)
      .send(body);
    expect(created.status).toBe(201);
    expect((created.body as { data: AppointmentDto }).data.serviceIds).toEqual(f.body.serviceIds);
    const moved = await request(app)
      .patch(`/api/v1/appointments/${(created.body as { data: AppointmentDto }).data.id}`)
      .set('Authorization', `Bearer ${f.auth.accessToken}`)
      .send({ startAt: localDateTimeToUtc(f.date, '14:00', zone).toISOString() });
    expect(moved.status).toBe(200);
    expect((moved.body as { data: AppointmentDto }).data.service.durationMin).toBe(90);
    expect((moved.body as { data: AppointmentDto }).data.service.name).toBe('Стрижка + Борода');
    expect((moved.body as { data: AppointmentDto }).data.price).toBe('1500.30');
  });

  it('adds configured per-service prepayments using Decimal arithmetic', async () => {
    const f = await fixture();
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: f.auth.company.id },
    });
    await prisma.plan.update({ where: { id: sub.planId }, data: { featurePrepayment: true } });
    await prisma.service.updateMany({
      where: { companyId: f.auth.company.id },
      data: {
        requiresPrepayment: true,
        prepaymentMode: 'FIXED',
        prepaymentValue: new Prisma.Decimal('100.10'),
      },
    });
    const created = await request(app).post(`${f.path}/appointments`).send(f.body);
    expect(created.status).toBe(201);
    const stored = await prisma.appointment.findFirstOrThrow({
      where: { companyId: f.auth.company.id },
    });
    expect(stored.prepaymentAmount?.toFixed(2)).toBe('200.20');
  });
  it('allocates a manually adjusted visit price across all services without losing cents', async () => {
    const f = await fixture();
    const { consentAccepted: _consent, ...body } = f.body;
    void _consent;
    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${f.auth.accessToken}`)
      .send({ ...body, price: '100.01' });
    expect(created.status).toBe(201);
    const id = (created.body as { data: AppointmentDto }).data.id;
    await prisma.appointment.update({
      where: { id, companyId: f.auth.company.id },
      data: { status: 'COMPLETED' },
    });
    const rows = await getAnalyticsServices(f.auth.company.id, { from: f.date, to: f.date });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((total, row) => total + Math.round(Number(row.revenue) * 100), 0)).toBe(
      10001,
    );
    expect(rows.every((row) => row.completed === 1)).toBe(true);
  });

  it('rolls back changed composition on conflict and enforces composite tenant foreign keys', async () => {
    const f = await fixture();
    const { consentAccepted: _consent, ...body } = f.body;
    void _consent;
    const headers = { Authorization: `Bearer ${f.auth.accessToken}` };
    const first = await request(app)
      .post('/api/v1/appointments')
      .set(headers)
      .send({ ...body, serviceIds: [f.first.id] });
    expect(first.status).toBe(201);
    const id = (first.body as { data: AppointmentDto }).data.id;
    await request(app)
      .post('/api/v1/appointments')
      .set(headers)
      .send({
        ...body,
        serviceIds: [f.first.id],
        startAt: localDateTimeToUtc(f.date, '10:30', zone).toISOString(),
      })
      .expect(201);
    await request(app)
      .patch(`/api/v1/appointments/${id}`)
      .set(headers)
      .send({ serviceIds: f.body.serviceIds })
      .expect(409);
    const items = await prisma.appointmentService.findMany({
      where: { appointmentId: id, companyId: f.auth.company.id },
    });
    expect(items).toHaveLength(1);
    const foreign = await prisma.company.create({ data: { name: 'Foreign', slug: 'foreign' } });
    const foreignService = await prisma.service.create({
      data: { companyId: foreign.id, name: 'Foreign', price: '10', durationMin: 5 },
    });
    await expect(
      prisma.appointmentService.updateMany({
        where: { appointmentId: id, companyId: f.auth.company.id },
        data: { serviceId: foreignService.id },
      }),
    ).rejects.toThrow();
  });
});
