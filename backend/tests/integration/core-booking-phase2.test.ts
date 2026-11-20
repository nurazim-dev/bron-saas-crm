import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppointmentStatus, BusinessType } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { localDateTimeToUtc } from '../../src/lib/datetime.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AppointmentDto } from '../../src/modules/appointments/appointments.service.js';
import type { AvailabilityResultDto } from '../../src/modules/availability/availability.service.js';
import type { ServicePackageDto } from '../../src/modules/services/packages.service.js';
import type { StaffDto } from '../../src/modules/staff/staff.service.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory, createUserFactory } from '../helpers/factories.js';

interface Envelope<T> {
  data: T;
}

const PASSWORD = 'Password123!';

describe('Core Booking Phase 2: Master Overrides, Packages & Extended Statuses', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
  });

  afterEach(() => {
    resetClock();
  });

  async function registerSalon(email = 'booking2@zapis.kg', companyName = 'Core Salon') {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        companyName,
        businessType: BusinessType.BEAUTY_SALON,
        ownerName: 'Владелец',
        email,
        password: PASSWORD,
        termsAccepted: true,
      })
      .expect(201);
    return (
      res.body as Envelope<{
        accessToken: string;
        user: { id: string; companyId: string };
        company: { id: string; slug: string; timezone: string };
      }>
    ).data;
  }

  it('supports master-specific price and duration overrides across staff, availability, public booking, and ANY-master', async () => {
    setClock(new FakeClock('2026-11-20T03:00:00.000Z')); // 09:00 Bishkek
    const owner = await registerSalon();
    const headers = { Authorization: `Bearer ${owner.accessToken}` };

    // Create catalog service: 500.00 KGS, 60 min
    const svcRes = await request(app)
      .post('/api/v1/services')
      .set(headers)
      .send({ name: 'Стрижка', durationMin: 60, price: '500.00' })
      .expect(201);
    const service = (svcRes.body as Envelope<{ id: string }>).data;

    // Second master keeps catalog defaults (60 min, 500.00)
    const masterBRes = await request(app)
      .post('/api/v1/staff')
      .set(headers)
      .send({ name: 'Мастер Бек', isBookable: true })
      .expect(201);
    const masterB = (masterBRes.body as Envelope<StaffDto>).data;

    // Owner (Master A) overrides to 800.00 KGS and 45 min
    const putOverride = await request(app)
      .put(`/api/v1/staff/${owner.user.id}/services`)
      .set(headers)
      .send({
        serviceIds: [service.id],
        serviceOverrides: [{ serviceId: service.id, customPrice: '800.00', customDurationMin: 45 }],
      })
      .expect(200);
    const updatedMasterA = (putOverride.body as Envelope<StaffDto>).data;
    expect(updatedMasterA.serviceOverrides).toEqual([
      { serviceId: service.id, customPrice: '800.00', customDurationMin: 45 },
    ]);

    // Assign default service to Master B without overrides
    await request(app)
      .put(`/api/v1/staff/${masterB.id}/services`)
      .set(headers)
      .send({ serviceIds: [service.id] })
      .expect(200);

    // Working hours 10:00 - 11:45 on Saturday 2026-11-21 (weekday 6):
    // Master A (45m) fits at 10:00, 10:30, 11:00 (ends 11:45).
    // Master B (60m) fits at 10:00, 10:30 (11:00 would end 12:00 > 11:45!).
    for (const mId of [owner.user.id, masterB.id]) {
      await request(app)
        .put(`/api/v1/staff/${mId}/working-hours`)
        .set(headers)
        .send({
          days: [{ dayOfWeek: 6, startTime: '10:00', endTime: '11:45' }],
        })
        .expect(200);
    }

    // Public profile exposes Master A overrides
    const profileRes = await request(app)
      .get(`/api/v1/public/companies/${owner.company.slug}`)
      .expect(200);
    const profile = (
      profileRes.body as Envelope<{
        masters: Array<{
          id: string;
          serviceOverrides: Array<{ serviceId: string; price: string; durationMin: number }>;
        }>;
      }>
    ).data;
    const pubMasterA = profile.masters.find((m) => m.id === owner.user.id);
    const pubMasterB = profile.masters.find((m) => m.id === masterB.id);
    expect(pubMasterA?.serviceOverrides).toEqual([
      { serviceId: service.id, price: '800.00', durationMin: 45 },
    ]);
    expect(pubMasterB?.serviceOverrides).toEqual([]);

    // Availability checks
    const availA = await request(app)
      .get(`/api/v1/public/companies/${owner.company.slug}/availability`)
      .query({ serviceId: service.id, masterId: owner.user.id, date: '2026-11-21' })
      .expect(200);
    expect((availA.body as Envelope<AvailabilityResultDto>).data.slots.map((s) => s.label)).toEqual(
      ['10:00', '10:30', '11:00'],
    );

    const availB = await request(app)
      .get(`/api/v1/public/companies/${owner.company.slug}/availability`)
      .query({ serviceId: service.id, masterId: masterB.id, date: '2026-11-21' })
      .expect(200);
    expect((availB.body as Envelope<AvailabilityResultDto>).data.slots.map((s) => s.label)).toEqual(
      ['10:00', '10:30'],
    );

    // ANY availability includes 11:00 because Master A fits in 45 min!
    const availAny = await request(app)
      .get(`/api/v1/public/companies/${owner.company.slug}/availability`)
      .query({ serviceId: service.id, masterId: 'ANY', date: '2026-11-21' })
      .expect(200);
    expect(
      (availAny.body as Envelope<AvailabilityResultDto>).data.slots.map((s) => s.label),
    ).toEqual(['10:00', '10:30', '11:00']);

    // Booking via ANY at 11:00 assigns Master A and snapshots 800.00 & 45 min
    const slot11 = localDateTimeToUtc('2026-11-21', '11:00', owner.company.timezone).toISOString();
    const bookAny = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: 'ANY',
        startAt: slot11,
        clientName: 'Алия',
        clientPhone: '+996555100101',
        consentAccepted: true,
      })
      .expect(201);
    const bookedAny = (
      bookAny.body as Envelope<{
        appointment: {
          id: string;
          startAt: string;
          endAt: string;
          service: { price: string; durationMin: number };
          master: { id: string };
        };
      }>
    ).data.appointment;
    expect(bookedAny.master.id).toBe(owner.user.id);
    expect(bookedAny.service.price).toBe('800.00');
    expect(bookedAny.service.durationMin).toBe(45);

    // Changing override later does NOT alter historical snapshot
    await request(app)
      .put(`/api/v1/staff/${owner.user.id}/services`)
      .set(headers)
      .send({
        serviceIds: [service.id],
        serviceOverrides: [
          { serviceId: service.id, customPrice: '1200.00', customDurationMin: 30 },
        ],
      })
      .expect(200);

    const fetched = await request(app)
      .get(`/api/v1/appointments/${bookedAny.id}`)
      .set(headers)
      .expect(200);
    const apptSnapshot = (fetched.body as Envelope<AppointmentDto>).data;
    expect(apptSnapshot.price).toBe('800.00');
    expect(apptSnapshot.service.durationMin).toBe(45);
  });

  it('supports ServicePackage CRUD, tenant isolation, booking via staff & public API, and proportional analytics', async () => {
    setClock(new FakeClock('2026-11-20T03:00:00.000Z'));
    const owner = await registerSalon('pkg-owner@zapis.kg', 'Pkg Salon');
    const other = await registerSalon('other-pkg@zapis.kg', 'Foreign Salon');
    const headers = { Authorization: `Bearer ${owner.accessToken}` };

    const s1 = await createServiceFactory(owner.company.id, {
      name: 'Стрижка',
      price: '600.00',
      durationMin: 30,
    });
    const s2 = await createServiceFactory(owner.company.id, {
      name: 'Борода',
      price: '400.00',
      durationMin: 30,
    });
    const foreignSvc = await createServiceFactory(other.company.id, { name: 'Чужая' });

    // Non-owner cannot manage packages -> 403
    const master = await createUserFactory(owner.company.id, {
      role: 'MASTER',
      email: 'pkg-master@zapis.kg',
    });
    await prisma.masterService.createMany({
      data: [
        { userId: master.id, serviceId: s1.id, customDurationMin: 45, customPrice: '700.00' },
        { userId: master.id, serviceId: s2.id },
      ],
    });
    await prisma.workingHours.create({
      data: { userId: master.id, dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
    });

    // Reject < 2 services and foreign serviceId
    await request(app)
      .post('/api/v1/services/packages')
      .set(headers)
      .send({ name: 'Плохой пакет', price: '500.00', serviceIds: [s1.id] })
      .expect(400);
    await request(app)
      .post('/api/v1/services/packages')
      .set(headers)
      .send({ name: 'Чужой пакет', price: '500.00', serviceIds: [s1.id, foreignSvc.id] })
      .expect(400);

    // Create valid package: catalog 600 + 400 = 1000, bundle price = 850.00
    const createPkg = await request(app)
      .post('/api/v1/services/packages')
      .set(headers)
      .send({
        name: 'Комбо: Стрижка + Борода',
        description: 'Скидка 15%',
        price: '850.00',
        serviceIds: [s1.id, s2.id],
      })
      .expect(201);
    const pkg = (createPkg.body as Envelope<ServicePackageDto>).data;
    expect(pkg.price).toBe('850.00');
    expect(pkg.catalogTotalPrice).toBe('1000.00');
    expect(pkg.totalDurationMin).toBe(60);

    // Public profile shows the package
    const pubProfile = await request(app)
      .get(`/api/v1/public/companies/${owner.company.slug}`)
      .expect(200);
    expect(
      (pubProfile.body as Envelope<{ packages: Array<{ id: string; price: string }> }>).data
        .packages,
    ).toMatchObject([{ id: pkg.id, price: '850.00' }]);

    // Foreign tenant packageId rejected with 404
    await request(app)
      .post('/api/v1/appointments')
      .set({ Authorization: `Bearer ${other.accessToken}` })
      .send({
        masterId: other.user.id,
        packageId: pkg.id,
        startAt: localDateTimeToUtc('2026-11-21', '10:00', other.company.timezone).toISOString(),
        clientName: 'Foreign',
        clientPhone: '+996555222333',
      })
      .expect(404);

    // Book package via public ANY at 10:00 on 2026-11-21 -> uses master's 45+30 = 75 min and bundle 850.00
    const slot10 = localDateTimeToUtc('2026-11-21', '10:00', owner.company.timezone).toISOString();
    const pubBook = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        packageId: pkg.id,
        masterId: 'ANY',
        startAt: slot10,
        clientName: 'Тимур',
        clientPhone: '+996555333111',
        consentAccepted: true,
      })
      .expect(201);
    const pubAppt = (
      pubBook.body as Envelope<{
        appointment: {
          id: string;
          endAt: string;
          service: { name: string; durationMin: number; price: string };
        };
      }>
    ).data.appointment;
    expect(pubAppt.service.name).toBe('Комбо: Стрижка + Борода');
    expect(pubAppt.service.durationMin).toBe(75);
    expect(pubAppt.service.price).toBe('850.00');

    // Overlapping staff booking inside 10:00..11:15 (e.g. at 11:00) is rejected with 409
    await request(app)
      .post('/api/v1/appointments')
      .set(headers)
      .send({
        masterId: master.id,
        packageId: pkg.id,
        startAt: localDateTimeToUtc('2026-11-21', '11:00', owner.company.timezone).toISOString(),
        clientName: 'Overlap',
        clientPhone: '+996555333222',
      })
      .expect(409);

    // Complete the appointment after its start time -> analytics services revenue sums to 850.00
    setClock(new FakeClock('2026-11-21T06:00:00.000Z')); // 12:00 Bishkek
    const reloginOwner = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'pkg-owner@zapis.kg', password: PASSWORD })
      .expect(200);
    const freshHeaders = {
      Authorization: `Bearer ${(reloginOwner.body as Envelope<{ accessToken: string }>).data.accessToken}`,
    };
    await request(app)
      .post(`/api/v1/appointments/${pubAppt.id}/status`)
      .set(freshHeaders)
      .send({ status: AppointmentStatus.COMPLETED })
      .expect(200);

    const svcAnalytics = await request(app)
      .get('/api/v1/analytics/services')
      .set(freshHeaders)
      .query({ from: '2026-11-21', to: '2026-11-21' })
      .expect(200);
    const items = (svcAnalytics.body as Envelope<Array<{ serviceId: string; revenue: string }>>)
      .data;
    const totalRevenue = items.reduce((sum, row) => sum + Number(row.revenue), 0);
    expect(totalRevenue.toFixed(2)).toBe('850.00');
  });

  it('enforces extended appointment status transitions, EXCLUDE slots on CONFIRMED/IN_PROGRESS, and client manage rules', async () => {
    setClock(new FakeClock('2026-11-20T03:00:00.000Z')); // 09:00 Bishkek
    const owner = await registerSalon('status-owner@zapis.kg', 'Status Salon');
    const headers = { Authorization: `Bearer ${owner.accessToken}` };

    const svc = await createServiceFactory(owner.company.id, {
      name: 'Услуга статуса',
      price: '500.00',
      durationMin: 60,
    });
    await prisma.masterService.create({ data: { userId: owner.user.id, serviceId: svc.id } });
    await prisma.workingHours.create({
      data: { userId: owner.user.id, dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
    });

    // Create a MANAGER and a MASTER for permission tests
    const inviteMgr = await request(app)
      .post('/api/v1/staff/invite')
      .set(headers)
      .send({ name: 'Менеджер', email: 'status-mgr@zapis.kg', role: 'MANAGER' })
      .expect(201);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: new URL((inviteMgr.body as Envelope<{ url: string }>).data.url).hash.slice(1),
        newPassword: PASSWORD,
      })
      .expect(204);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'status-mgr@zapis.kg', password: PASSWORD })
      .expect(200);

    const masterRes = await request(app)
      .post('/api/v1/staff')
      .set(headers)
      .send({
        name: 'Мастер Статуса',
        email: 'status-master@zapis.kg',
        password: PASSWORD,
        isBookable: true,
      })
      .expect(201);
    const masterId = (masterRes.body as Envelope<{ id: string }>).data.id;
    await prisma.masterService.create({ data: { userId: masterId, serviceId: svc.id } });
    await prisma.workingHours.create({
      data: { userId: masterId, dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
    });
    const masterLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'status-master@zapis.kg', password: PASSWORD })
      .expect(200);
    const masterHeaders = {
      Authorization: `Bearer ${(masterLogin.body as Envelope<{ accessToken: string }>).data.accessToken}`,
    };

    // Public booking on 2026-11-21 10:00 (tomorrow)
    const start10 = localDateTimeToUtc('2026-11-21', '10:00', owner.company.timezone).toISOString();
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId,
        startAt: start10,
        clientName: 'Самат',
        clientPhone: '+996555444111',
        consentAccepted: true,
      })
      .expect(201);
    const apptId = (bookRes.body as Envelope<{ appointment: { id: string } }>).data.appointment.id;
    const manageToken = (bookRes.body as Envelope<{ manageUrl: string }>).data.manageUrl
      .split('/')
      .pop();
    expect(manageToken).toBeTruthy();

    // Future COMPLETED / NO_SHOW rejected (409)
    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(headers)
      .send({ status: AppointmentStatus.COMPLETED })
      .expect(409);

    // SCHEDULED -> CONFIRMED
    const confirmed = await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(masterHeaders)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(200);
    expect((confirmed.body as Envelope<AppointmentDto>).data.status).toBe(
      AppointmentStatus.CONFIRMED,
    );

    // Overlapping booking against CONFIRMED fails (409) AND raw SQL EXCLUDE constraint blocks it too
    await request(app)
      .post('/api/v1/appointments')
      .set(headers)
      .send({
        masterId,
        serviceId: svc.id,
        startAt: start10,
        clientName: 'Дубль',
        clientPhone: '+996555444222',
      })
      .expect(409);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Appointment" ("id", "companyId", "masterId", "serviceId", "clientId", "clientName", "clientPhone", "startAt", "endAt", "price", "status", "source", "manageToken", "updatedAt")
        SELECT gen_random_uuid(), "companyId", "masterId", "serviceId", "clientId", 'Raw', '+996555000999', "startAt", "endAt", "price", 'CONFIRMED'::"AppointmentStatus", 'STAFF'::"AppointmentSource", ${randomBytes(16).toString('hex')}, NOW()
        FROM "Appointment" WHERE "id" = ${apptId}::uuid
      `,
    ).rejects.toThrow();

    // Client self-service manage is STILL allowed in CONFIRMED
    const manageInConfirmed = await request(app)
      .get(`/api/v1/public/manage/${manageToken}`)
      .expect(200);
    expect(
      (
        manageInConfirmed.body as Envelope<{
          actions: { canCancel: boolean; canReschedule: boolean };
        }>
      ).data.actions,
    ).toMatchObject({ canCancel: true, canReschedule: true });

    // CONFIRMED -> IN_PROGRESS
    const inProgress = await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(masterHeaders)
      .send({ status: AppointmentStatus.IN_PROGRESS })
      .expect(200);
    expect((inProgress.body as Envelope<AppointmentDto>).data.status).toBe(
      AppointmentStatus.IN_PROGRESS,
    );

    // Client self-service manage is blocked in IN_PROGRESS -> canCancel/canReschedule false & 422
    const manageInProgress = await request(app)
      .get(`/api/v1/public/manage/${manageToken}`)
      .expect(200);
    expect(
      (
        manageInProgress.body as Envelope<{
          actions: { canCancel: boolean; canReschedule: boolean };
        }>
      ).data.actions,
    ).toMatchObject({ canCancel: false, canReschedule: false });
    await request(app).post(`/api/v1/public/manage/${manageToken}/cancel`).send({}).expect(422);

    // MASTER cannot cancel IN_PROGRESS (403); MANAGER can cancel IN_PROGRESS (200)
    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(masterHeaders)
      .send({ status: AppointmentStatus.CANCELLED })
      .expect(403);

    // IN_PROGRESS -> CONFIRMED -> IN_PROGRESS -> COMPLETED (after start time)
    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(masterHeaders)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(200);
    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(masterHeaders)
      .send({ status: AppointmentStatus.IN_PROGRESS })
      .expect(200);

    setClock(new FakeClock('2026-11-21T05:00:00.000Z')); // 11:00 Bishkek
    const reloginMaster = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'status-master@zapis.kg', password: PASSWORD })
      .expect(200);
    const freshMasterHeaders = {
      Authorization: `Bearer ${(reloginMaster.body as Envelope<{ accessToken: string }>).data.accessToken}`,
    };
    const reloginOwner = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'status-owner@zapis.kg', password: PASSWORD })
      .expect(200);
    const freshOwnerHeaders = {
      Authorization: `Bearer ${(reloginOwner.body as Envelope<{ accessToken: string }>).data.accessToken}`,
    };
    const reloginMgr = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'status-mgr@zapis.kg', password: PASSWORD })
      .expect(200);
    const freshMgrHeaders = {
      Authorization: `Bearer ${(reloginMgr.body as Envelope<{ accessToken: string }>).data.accessToken}`,
    };

    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(freshMasterHeaders)
      .send({ status: AppointmentStatus.COMPLETED })
      .expect(200);

    // Terminal COMPLETED -> * is rejected (409)
    await request(app)
      .post(`/api/v1/appointments/${apptId}/status`)
      .set(freshOwnerHeaders)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(409);

    // Verify MANAGER can cancel an IN_PROGRESS appointment and OWNER can restore CANCELLED -> SCHEDULED
    const start12 = localDateTimeToUtc('2026-11-21', '12:00', owner.company.timezone).toISOString();
    const secondAppt = await request(app)
      .post('/api/v1/appointments')
      .set(freshOwnerHeaders)
      .send({
        masterId,
        serviceId: svc.id,
        startAt: start12,
        clientName: 'Айжан',
        clientPhone: '+996555444333',
      })
      .expect(201);
    const secondId = (secondAppt.body as Envelope<AppointmentDto>).data.id;
    await request(app)
      .post(`/api/v1/appointments/${secondId}/status`)
      .set(freshMgrHeaders)
      .send({ status: AppointmentStatus.IN_PROGRESS })
      .expect(200);
    await request(app)
      .post(`/api/v1/appointments/${secondId}/status`)
      .set(freshMgrHeaders)
      .send({ status: AppointmentStatus.CANCELLED })
      .expect(200);
    await request(app)
      .post(`/api/v1/appointments/${secondId}/status`)
      .set(freshMgrHeaders)
      .send({ status: AppointmentStatus.SCHEDULED })
      .expect(403);
    const restored = await request(app)
      .post(`/api/v1/appointments/${secondId}/status`)
      .set(freshOwnerHeaders)
      .send({ status: AppointmentStatus.SCHEDULED })
      .expect(200);
    expect((restored.body as Envelope<AppointmentDto>).data.status).toBe(
      AppointmentStatus.SCHEDULED,
    );
  });
});
