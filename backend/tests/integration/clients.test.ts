import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { disconnectPrisma, prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { truncateAllTables } from '../helpers/db.js';
import { createAppointmentFactory, createServiceFactory } from '../helpers/factories.js';

const app = createApp();

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface DataEnvelope<T> {
  data: T;
}

function asBody<T>(body: unknown): T {
  return body as T;
}

async function registerOwnerFactory(
  _app: ReturnType<typeof createApp>,
  opts: { email: string; slug: string },
) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: `Company ${opts.slug}`,
      slug: opts.slug,
      businessType: 'BARBERSHOP',
      ownerName: 'Owner Test',
      email: opts.email,
      password: 'Password123',
      phone: '+996555000001',
    });
  expect(res.status).toBe(201);
  const parsed = asBody<
    DataEnvelope<{
      accessToken: string;
      company: { id: string; slug: string };
      user: { id: string };
    }>
  >(res.body);
  return {
    accessToken: parsed.data.accessToken,
    company: parsed.data.company,
    user: parsed.data.user,
  };
}

async function setupMasterWithService(
  companyId: string,
  opts: { name: string; serviceName: string; durationMin?: number; price?: string },
) {
  const master = await prisma.user.create({
    data: {
      companyId,
      role: 'MASTER',
      name: opts.name,
      isBookable: true,
      isActive: true,
    },
  });
  const service = await createServiceFactory(companyId, {
    name: opts.serviceName,
    durationMin: opts.durationMin ?? 30,
    price: opts.price ?? '500.00',
  });
  await prisma.masterService.create({
    data: { userId: master.id, serviceId: service.id },
  });
  return { master, service };
}

async function createWorkingHoursFactory(opts: { userId: string; dayOfWeek: number }) {
  return prisma.workingHours.create({
    data: {
      userId: opts.userId,
      dayOfWeek: opts.dayOfWeek,
      startTime: '09:00',
      endTime: '18:00',
    },
  });
}

describe('Client CRM (Phase 17 / BR-14)', () => {
  beforeAll(() => {
    setClock(new FakeClock(new Date('2026-11-18T03:00:00.000Z')));
  });

  afterAll(async () => {
    resetClock();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('handles parallel public bookings with the same new phone into one Client row and preserves existing name on repeat online booking', async () => {
    const owner = await registerOwnerFactory(app, {
      email: 'crm-owner@test.kg',
      slug: 'crm-barber',
    });
    const master1 = await setupMasterWithService(owner.company.id, {
      name: 'Master One',
      serviceName: 'Haircut',
      durationMin: 30,
      price: '600.00',
    });
    const master2 = await setupMasterWithService(owner.company.id, {
      name: 'Master Two',
      serviceName: 'Beard',
      durationMin: 30,
      price: '400.00',
    });

    await createWorkingHoursFactory({ userId: master1.master.id, dayOfWeek: 4 });
    await createWorkingHoursFactory({ userId: master2.master.id, dayOfWeek: 4 });

    // Missing consentAccepted fails 400 VALIDATION_ERROR
    const noConsentRes = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: master1.service.id,
        masterId: master1.master.id,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Азамат',
        clientPhone: '+996555112233',
      });
    expect(noConsentRes.status).toBe(400);
    expect(asBody<ErrorEnvelope>(noConsentRes.body).error.code).toBe('VALIDATION_ERROR');

    // Two parallel online bookings with the exact same new phone
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/v1/public/companies/${owner.company.slug}/appointments`).send({
        serviceId: master1.service.id,
        masterId: master1.master.id,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Азамат',
        clientPhone: '+996555112233',
        consentAccepted: true,
      }),
      request(app).post(`/api/v1/public/companies/${owner.company.slug}/appointments`).send({
        serviceId: master2.service.id,
        masterId: master2.master.id,
        startAt: '2026-11-19T05:00:00.000Z',
        clientName: 'Азамат',
        clientPhone: '+996555112233',
        consentAccepted: true,
      }),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const clients = await prisma.client.findMany({
      where: { companyId: owner.company.id, phone: '+996555112233' },
    });
    expect(clients).toHaveLength(1);
    const clientId = clients[0]?.id ?? '';
    expect(clients[0]?.name).toBe('Азамат');

    // Repeat online booking with a spoofed name must NOT overwrite Client.name (anti-vandalism)
    const repeatOnline = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: master1.service.id,
        masterId: master1.master.id,
        startAt: '2026-11-19T06:00:00.000Z',
        clientName: 'Fake Name',
        clientPhone: '+996555112233',
        consentAccepted: true,
      });
    expect(repeatOnline.status).toBe(201);

    const clientAfterOnline = await prisma.client.findUnique({ where: { id: clientId } });
    expect(clientAfterOnline?.name).toBe('Азамат');

    // Staff appointment creation DOES update Client.name
    const staffCreate = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: master1.master.id,
        serviceId: master1.service.id,
        startAt: '2026-11-19T07:00:00.000Z',
        clientName: 'Азамат Токтосунов',
        clientPhone: '+996555112233',
      });
    expect(staffCreate.status).toBe(201);
    expect(asBody<DataEnvelope<{ clientId: string }>>(staffCreate.body).data.clientId).toBe(
      clientId,
    );

    const clientAfterStaff = await prisma.client.findUnique({ where: { id: clientId } });
    expect(clientAfterStaff?.name).toBe('Азамат Токтосунов');
  });

  it('isolates clients by company and enforces generic 403 for blocked clients on public booking', async () => {
    const ownerA = await registerOwnerFactory(app, {
      email: 'owner-a@test.kg',
      slug: 'shop-a',
    });
    const ownerB = await registerOwnerFactory(app, {
      email: 'owner-b@test.kg',
      slug: 'shop-b',
    });

    const setupA = await setupMasterWithService(ownerA.company.id, {
      name: 'Master A',
      serviceName: 'Cut A',
    });
    const setupB = await setupMasterWithService(ownerB.company.id, {
      name: 'Master B',
      serviceName: 'Cut B',
    });
    await createWorkingHoursFactory({ userId: setupA.master.id, dayOfWeek: 4 });
    await createWorkingHoursFactory({ userId: setupB.master.id, dayOfWeek: 4 });

    const bookA = await request(app)
      .post(`/api/v1/public/companies/${ownerA.company.slug}/appointments`)
      .send({
        serviceId: setupA.service.id,
        masterId: setupA.master.id,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Shared Client',
        clientPhone: '+996700123456',
        consentAccepted: true,
      });
    expect(bookA.status).toBe(201);

    const bookB = await request(app)
      .post(`/api/v1/public/companies/${ownerB.company.slug}/appointments`)
      .send({
        serviceId: setupB.service.id,
        masterId: setupB.master.id,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Shared Client',
        clientPhone: '+996700123456',
        consentAccepted: true,
      });
    expect(bookB.status).toBe(201);

    const listA = await request(app)
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(listA.status).toBe(200);
    const listAData = asBody<DataEnvelope<Array<{ id: string }>>>(listA.body).data;
    expect(listAData).toHaveLength(1);
    const clientAId = listAData[0]?.id ?? '';

    const blockRes = await request(app)
      .patch(`/api/v1/clients/${clientAId}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ isBlocked: true, notes: 'Repeated no-shows' });
    expect(blockRes.status).toBe(200);
    expect(asBody<DataEnvelope<{ isBlocked: boolean }>>(blockRes.body).data.isBlocked).toBe(true);

    const crossTenant = await request(app)
      .get(`/api/v1/clients/${clientAId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(crossTenant.status).toBe(404);

    const blockedPublicA = await request(app)
      .post(`/api/v1/public/companies/${ownerA.company.slug}/appointments`)
      .send({
        serviceId: setupA.service.id,
        masterId: setupA.master.id,
        startAt: '2026-11-19T05:00:00.000Z',
        clientName: 'Shared Client',
        clientPhone: '+996700123456',
        consentAccepted: true,
      });
    expect(blockedPublicA.status).toBe(403);
    const blockedErr = asBody<ErrorEnvelope>(blockedPublicA.body).error;
    expect(blockedErr.code).toBe('BOOKING_NOT_ALLOWED');
    expect(blockedErr.message).not.toMatch(/block/i);

    const publicB2 = await request(app)
      .post(`/api/v1/public/companies/${ownerB.company.slug}/appointments`)
      .send({
        serviceId: setupB.service.id,
        masterId: setupB.master.id,
        startAt: '2026-11-19T05:00:00.000Z',
        clientName: 'Shared Client',
        clientPhone: '+996700123456',
        consentAccepted: true,
      });
    expect(publicB2.status).toBe(201);

    const staffBookA = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        masterId: setupA.master.id,
        serviceId: setupA.service.id,
        startAt: '2026-11-19T05:00:00.000Z',
        clientName: 'Shared Client',
        clientPhone: '+996700123456',
      });
    expect(staffBookA.status).toBe(201);
  });

  it('computes stats without N+1 queries, enforces MASTER scoping, and supports search & sort', async () => {
    const owner = await registerOwnerFactory(app, {
      email: 'stats-owner@test.kg',
      slug: 'stats-shop',
    });

    const master1Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master One',
        email: 'm1-crm@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    expect(master1Res.status).toBe(201);
    const master1Id = asBody<DataEnvelope<{ id: string }>>(master1Res.body).data.id;

    const master2Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master Two',
        email: 'm2-crm@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    expect(master2Res.status).toBe(201);
    const master2Id = asBody<DataEnvelope<{ id: string }>>(master2Res.body).data.id;

    const svc = await createServiceFactory(owner.company.id, {
      name: 'Full Cut',
      price: '1200.00',
    });

    await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: master1Id,
      serviceId: svc.id,
      clientName: 'Бектур Алиев',
      clientPhone: '+996555100001',
      status: 'COMPLETED',
      price: '1200.00',
      startAt: new Date('2026-11-10T04:00:00.000Z'),
      endAt: new Date('2026-11-10T05:00:00.000Z'),
    });
    await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: master1Id,
      serviceId: svc.id,
      clientName: 'Бектур Алиев',
      clientPhone: '+996555100001',
      status: 'COMPLETED',
      price: '1200.00',
      startAt: new Date('2026-11-12T04:00:00.000Z'),
      endAt: new Date('2026-11-12T05:00:00.000Z'),
    });
    await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: master2Id,
      serviceId: svc.id,
      clientName: 'Бектур Алиев',
      clientPhone: '+996555100001',
      status: 'NO_SHOW',
      price: '1200.00',
      startAt: new Date('2026-11-14T04:00:00.000Z'),
      endAt: new Date('2026-11-14T05:00:00.000Z'),
    });

    await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: master2Id,
      serviceId: svc.id,
      clientName: 'Тимур Сатыбалдиев',
      clientPhone: '+996555100002',
      status: 'COMPLETED',
      price: '800.00',
      startAt: new Date('2026-11-15T04:00:00.000Z'),
      endAt: new Date('2026-11-15T05:00:00.000Z'),
    });

    const querySpy = vi.spyOn(prisma, '$queryRaw');
    const listRes = await request(app)
      .get('/api/v1/clients?search=Бектур&sort=visits')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(querySpy.mock.calls.length).toBeLessThanOrEqual(2);
    querySpy.mockRestore();

    const listData = asBody<
      DataEnvelope<
        Array<{
          id: string;
          stats: { visits: number; noShows: number; cancellations: number; totalSpent: string };
        }>
      >
    >(listRes.body).data;
    expect(listData).toHaveLength(1);
    expect(listData[0]?.stats).toMatchObject({
      visits: 2,
      noShows: 1,
      cancellations: 0,
      totalSpent: '2400.00',
    });

    const m1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'm1-crm@test.kg', password: 'Password123' });
    const m1Token = asBody<DataEnvelope<{ accessToken: string }>>(m1Login.body).data.accessToken;

    const m1List = await request(app)
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${m1Token}`);
    expect(m1List.status).toBe(200);
    const m1Data = asBody<
      DataEnvelope<Array<{ id: string; stats: { visits: number; noShows: number } }>>
    >(m1List.body).data;
    expect(m1Data).toHaveLength(1);
    expect(m1Data[0]?.stats.noShows).toBe(0);
    expect(m1Data[0]?.stats.visits).toBe(2);

    const client2 = await prisma.client.findUniqueOrThrow({
      where: { companyId_phone: { companyId: owner.company.id, phone: '+996555100002' } },
    });
    const m1ForeignClient = await request(app)
      .get(`/api/v1/clients/${client2.id}`)
      .set('Authorization', `Bearer ${m1Token}`);
    expect(m1ForeignClient.status).toBe(404);

    const client1Id = listData[0]?.id ?? '';
    const m1Patch = await request(app)
      .patch(`/api/v1/clients/${client1Id}`)
      .set('Authorization', `Bearer ${m1Token}`)
      .send({ notes: 'Not allowed' });
    expect(m1Patch.status).toBe(403);

    const m1Anon = await request(app)
      .post(`/api/v1/clients/${client1Id}/anonymize`)
      .set('Authorization', `Bearer ${m1Token}`)
      .send({ confirm: true });
    expect(m1Anon.status).toBe(403);
  });

  it('anonymizes client PII while preserving appointment revenue, cancelling pending outbox, and freeing phone', async () => {
    const owner = await registerOwnerFactory(app, {
      email: 'anon-owner@test.kg',
      slug: 'anon-shop',
    });
    const setup = await setupMasterWithService(owner.company.id, {
      name: 'Master Anon',
      serviceName: 'Service Anon',
      price: '1500.00',
    });
    await createWorkingHoursFactory({ userId: setup.master.id, dayOfWeek: 4 });

    const appt = await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: setup.master.id,
      serviceId: setup.service.id,
      clientName: 'Эрлан Кадыров',
      clientPhone: '+996555778899',
      clientNote: 'Sensitive note',
      internalNote: 'VIP client',
      status: 'COMPLETED',
      price: '1500.00',
      startAt: new Date('2026-11-17T04:00:00.000Z'),
      endAt: new Date('2026-11-17T05:00:00.000Z'),
    });

    await prismaUnfiltered.outboxMessage.create({
      data: {
        companyId: owner.company.id,
        channel: 'EMAIL',
        kind: 'REMINDER_24H',
        recipient: 'client@test.kg',
        appointmentId: appt.id,
        locale: 'RU',
        payload: {},
        dedupeKey: `anon-outbox-${appt.id}`,
        status: 'PENDING',
        scheduledFor: new Date('2026-11-18T10:00:00.000Z'),
      },
    });

    const anonRes = await request(app)
      .post(`/api/v1/clients/${appt.clientId}/anonymize`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ confirm: true });
    expect(anonRes.status).toBe(200);
    const anonBody = asBody<DataEnvelope<{ name: string; phone: string }>>(anonRes.body).data;
    expect(anonBody.name).toBe('Deleted client');
    expect(anonBody.phone).toBe(`anon-${appt.clientId}`);

    const updatedAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(updatedAppt.clientName).toBe('Deleted client');
    expect(updatedAppt.clientPhone).toBe(`anon-${appt.clientId}`);
    expect(updatedAppt.clientNote).toBeNull();
    expect(updatedAppt.internalNote).toBeNull();
    expect(updatedAppt.price.toFixed(2)).toBe('1500.00');
    expect(updatedAppt.status).toBe('COMPLETED');

    const outbox = await prismaUnfiltered.outboxMessage.findUniqueOrThrow({
      where: { dedupeKey: `anon-outbox-${appt.id}` },
    });
    expect(outbox.status).toBe('CANCELLED');

    const rebook = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: setup.service.id,
        masterId: setup.master.id,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'New Person',
        clientPhone: '+996555778899',
        consentAccepted: true,
      });
    expect(rebook.status).toBe(201);

    const newClient = await prisma.client.findUnique({
      where: { companyId_phone: { companyId: owner.company.id, phone: '+996555778899' } },
    });
    expect(newClient).not.toBeNull();
    expect(newClient?.id).not.toBe(appt.clientId);
  });
});
