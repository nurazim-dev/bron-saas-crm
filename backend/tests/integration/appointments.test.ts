import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ErrorResponseBody } from '../../src/lib/errors.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type {
  AppointmentDto,
  PaginatedAppointmentsResult,
} from '../../src/modules/appointments/appointments.service.js';
import type { AuthUserDto } from '../../src/modules/auth/auth.service.js';
import type { CompanyDto } from '../../src/modules/company/company.service.js';
import type { ServiceDto } from '../../src/modules/services/services.service.js';
import type { StaffDto } from '../../src/modules/staff/staff.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();

interface AuthEnvelope {
  data: {
    accessToken: string;
    user: AuthUserDto;
    company: CompanyDto;
  };
}

interface ServiceEnvelope {
  data: ServiceDto;
}

interface StaffEnvelope {
  data: StaffDto;
}

interface AppointmentEnvelope {
  data: AppointmentDto;
}

function asAuth(body: unknown): AuthEnvelope {
  return body as AuthEnvelope;
}

function asService(body: unknown): ServiceEnvelope {
  return body as ServiceEnvelope;
}

function asStaff(body: unknown): StaffEnvelope {
  return body as StaffEnvelope;
}

function asAppointment(body: unknown): AppointmentEnvelope {
  return body as AppointmentEnvelope;
}

function asAppointmentList(body: unknown): PaginatedAppointmentsResult {
  return body as PaginatedAppointmentsResult;
}

function asError(body: unknown): ErrorResponseBody {
  return body as ErrorResponseBody;
}

interface SetupFixture {
  ownerToken: string;
  ownerId: string;
  companyId: string;
  master1Id: string;
  master1Token: string;
  master2Id: string;
  master2Token: string;
  service60Id: string;
  service30Id: string;
}

async function setupCompanyWithStaffAndServices(suffix = '1'): Promise<SetupFixture> {
  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: `Salon Alpha ${suffix}`,
      businessType: 'BARBERSHOP',
      ownerName: `Owner ${suffix}`,
      email: `owner-${suffix}@alpha.kg`,
      phone: '0555100100',
      password: 'Password123!',
      termsAccepted: true,
    })
    .expect(201);

  const authData = asAuth(regRes.body).data;
  const ownerToken = authData.accessToken;
  const ownerId = authData.user.id;
  const companyId = authData.company.id;

  const s60Res = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Haircut 60',
      durationMin: 60,
      price: '700.00',
    })
    .expect(201);
  const service60Id = asService(s60Res.body).data.id;

  const s30Res = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Beard Trim 30',
      durationMin: 30,
      price: '400.00',
    })
    .expect(201);
  const service30Id = asService(s30Res.body).data.id;

  const m1Res = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `Master One ${suffix}`,
      email: `m1-${suffix}@alpha.kg`,
      password: 'Password123!',
      phone: '0555100101',
    })
    .expect(201);
  const master1Id = asStaff(m1Res.body).data.id;

  const m2Res = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `Master Two ${suffix}`,
      email: `m2-${suffix}@alpha.kg`,
      password: 'Password123!',
      phone: '0555100102',
    })
    .expect(201);
  const master2Id = asStaff(m2Res.body).data.id;

  // Link both services to owner, master1, and master2
  for (const staffId of [ownerId, master1Id, master2Id]) {
    await request(app)
      .put(`/api/v1/staff/${staffId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: [service60Id, service30Id] })
      .expect(200);
  }

  const m1Login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `m1-${suffix}@alpha.kg`, password: 'Password123!' })
    .expect(200);
  const master1Token = asAuth(m1Login.body).data.accessToken;

  const m2Login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `m2-${suffix}@alpha.kg`, password: 'Password123!' })
    .expect(200);
  const master2Token = asAuth(m2Login.body).data.accessToken;

  return {
    ownerToken,
    ownerId,
    companyId,
    master1Id,
    master1Token,
    master2Id,
    master2Token,
    service60Id,
    service30Id,
  };
}

describe('Phase 4: Appointments & Double-Booking Protection (BR-1, BR-2, BR-5, BR-6, BR-8)', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('stores Bishkek 10:00 (2026-11-20T10:00:00+06:00) as 2026-11-20T04:00:00.000Z, normalizes seconds/ms, normalizes phone, and snapshots price (BR-2, BR-8)', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    // Staff can book even when master has no WorkingHours rows (off-hours / walk-ins allowed for staff)
    const createRes = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T10:00:45.789+06:00',
        clientName: '  Бакыт Асанов  ',
        clientPhone: '0555 77 88 99',
        clientNote: 'Покороче по бокам',
        internalNote: 'Постоянный клиент',
      })
      .expect(201);

    expect(asAppointment(createRes.body).data).toMatchObject({
      companyId: ctx.companyId,
      masterId: ctx.master1Id,
      serviceId: ctx.service60Id,
      clientName: 'Бакыт Асанов',
      clientPhone: '+996555778899',
      clientNote: 'Покороче по бокам',
      internalNote: 'Постоянный клиент',
      startAt: '2026-11-20T04:00:00.000Z',
      endAt: '2026-11-20T05:00:00.000Z',
      price: '700.00',
      status: 'SCHEDULED',
      source: 'STAFF',
      service: {
        id: ctx.service60Id,
        name: 'Haircut 60',
        durationMin: 60,
      },
      master: {
        id: ctx.master1Id,
        name: 'Master One 1',
      },
    });
  });

  it('enforces BR-1 sequential conflicts, allows back-to-back adjacency, allows different masters at the same time, and frees slots on CANCELLED, NO_SHOW, or soft-delete', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    // 1. Create [04:00Z, 05:00Z) for master1
    const first = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client One',
        clientPhone: '0555111222',
      })
      .expect(201);
    const firstId = asAppointment(first.body).data.id;

    // 2. Identical slot for master1 -> 409 SLOT_ALREADY_BOOKED
    const exactConflict = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client Conflict',
        clientPhone: '0555111223',
      })
      .expect(409);
    expect(asError(exactConflict.body).error.code).toBe('SLOT_ALREADY_BOOKED');

    // 3. Partial overlap [04:30Z, 05:00Z) for master1 -> 409 SLOT_ALREADY_BOOKED
    const partialConflict = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service30Id,
        startAt: '2026-11-20T04:30:00.000Z',
        clientName: 'Client Partial',
        clientPhone: '0555111224',
      })
      .expect(409);
    expect(asError(partialConflict.body).error.code).toBe('SLOT_ALREADY_BOOKED');

    // 4. Back-to-back adjacency [05:00Z, 05:30Z) and [03:30Z, 04:00Z) for master1 -> 201
    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service30Id,
        startAt: '2026-11-20T05:00:00.000Z',
        clientName: 'Client After',
        clientPhone: '0555111225',
      })
      .expect(201);

    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service30Id,
        startAt: '2026-11-20T03:30:00.000Z',
        clientName: 'Client Before',
        clientPhone: '0555111226',
      })
      .expect(201);

    // 5. Same [04:00Z, 05:00Z) slot for master2 -> 201 (different masters are independent)
    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master2Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client Master2',
        clientPhone: '0555111227',
      })
      .expect(201);

    // 6. Cancel first appointment -> frees [04:00Z, 05:00Z) for master1
    await request(app)
      .post(`/api/v1/appointments/${firstId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    const replacement = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client Replacement',
        clientPhone: '0555111228',
      })
      .expect(201);
    const replacementId = asAppointment(replacement.body).data.id;

    // 7. Soft-delete replacement -> frees [04:00Z, 05:00Z) again
    await request(app)
      .delete(`/api/v1/appointments/${replacementId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .expect(204);

    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client After Delete',
        clientPhone: '0555111229',
      })
      .expect(201);
  });

  it('prevents double-booking under concurrency: 10 parallel identical POST requests produce exactly ONE 201 and NINE 409 SLOT_ALREADY_BOOKED (BR-1)', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    const requests = Array.from({ length: 10 }, (_, idx) =>
      request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${ctx.ownerToken}`)
        .send({
          masterId: ctx.master1Id,
          serviceId: ctx.service60Id,
          startAt: '2026-11-25T06:00:00.000Z',
          clientName: `Concurrent Client ${String(idx + 1)}`,
          clientPhone: `055599900${String(idx)}`,
        }),
    );

    const responses = await Promise.all(requests);
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    for (const conflict of conflicts) {
      expect(asError(conflict.body).error.code).toBe('SLOT_ALREADY_BOOKED');
    }
  });

  it('allows rescheduling an appointment onto a window overlapping its own old slot while rejecting overlaps with other appointments', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    // Appointment A: [04:00Z, 05:00Z)
    const apptA = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Client A',
        clientPhone: '0555200001',
      })
      .expect(201);
    const apptAId = asAppointment(apptA.body).data.id;

    // Appointment B: [06:00Z, 07:00Z)
    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T06:00:00.000Z',
        clientName: 'Client B',
        clientPhone: '0555200002',
      })
      .expect(201);

    // Reschedule A from [04:00Z, 05:00Z) to [04:30Z, 05:30Z) (overlaps its own old slot) -> 200
    const rescheduledA = await request(app)
      .patch(`/api/v1/appointments/${apptAId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ startAt: '2026-11-20T04:30:00.000Z' })
      .expect(200);
    expect(asAppointment(rescheduledA.body).data.startAt).toBe('2026-11-20T04:30:00.000Z');
    expect(asAppointment(rescheduledA.body).data.endAt).toBe('2026-11-20T05:30:00.000Z');

    // Attempt to reschedule A into [05:30Z, 06:30Z) (overlaps B) -> 409 SLOT_ALREADY_BOOKED
    const badReschedule = await request(app)
      .patch(`/api/v1/appointments/${apptAId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ startAt: '2026-11-20T05:30:00.000Z' })
      .expect(409);
    expect(asError(badReschedule.body).error.code).toBe('SLOT_ALREADY_BOOKED');
  });

  it('preserves duration and price snapshot when Service changes later, and recomputes endAt/price when serviceId changes on PATCH (BR-2)', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    // 1. Create with default service price (700.00, 60 min)
    const appt = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'Snapshot Client',
        clientPhone: '0555300001',
      })
      .expect(201);
    const apptData = asAppointment(appt.body).data;
    const apptId = apptData.id;
    expect(apptData.price).toBe('700.00');
    expect(apptData.endAt).toBe('2026-11-20T05:00:00.000Z');

    // 2. Owner updates service60 price to 950.00 and durationMin to 90
    await request(app)
      .patch(`/api/v1/services/${ctx.service60Id}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ price: '950.00', durationMin: 90 })
      .expect(200);

    // 3. Rescheduling appointment without changing serviceId keeps original 60 min duration and 700.00 price
    const moved = await request(app)
      .patch(`/api/v1/appointments/${apptId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ startAt: '2026-11-20T06:00:00.000Z' })
      .expect(200);
    expect(asAppointment(moved.body).data.endAt).toBe('2026-11-20T07:00:00.000Z');
    expect(asAppointment(moved.body).data.price).toBe('700.00');

    // 4. Changing serviceId to service30Id recomputes endAt (30 min) and updates price to 400.00
    const changedService = await request(app)
      .patch(`/api/v1/appointments/${apptId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ serviceId: ctx.service30Id })
      .expect(200);
    expect(asAppointment(changedService.body).data.endAt).toBe('2026-11-20T06:30:00.000Z');
    expect(asAppointment(changedService.body).data.price).toBe('400.00');

    // 5. Changing serviceId back to service60Id WITH explicit price override uses override price and new 90 min duration
    const overridden = await request(app)
      .patch(`/api/v1/appointments/${apptId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ serviceId: ctx.service60Id, price: '850.00' })
      .expect(200);
    expect(asAppointment(overridden.body).data.endAt).toBe('2026-11-20T07:30:00.000Z');
    expect(asAppointment(overridden.body).data.price).toBe('850.00');
  });

  it('enforces the BR-6 status lifecycle (COMPLETED/NO_SHOW require startAt <= now, CANCELLED -> SCHEDULED is OWNER-only and re-runs BR-1, no editing non-SCHEDULED)', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    const futureStart = new Date(Date.now() + 24 * 3_600_000);
    futureStart.setUTCSeconds(0, 0);

    const pastStart = new Date(Date.now() - 2 * 3_600_000);
    pastStart.setUTCSeconds(0, 0);

    // 1. Future appointment cannot be marked COMPLETED or NO_SHOW
    const futureAppt = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: futureStart.toISOString(),
        clientName: 'Future Client',
        clientPhone: '0555400001',
      })
      .expect(201);
    const futureId = asAppointment(futureAppt.body).data.id;

    const earlyComplete = await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'COMPLETED' })
      .expect(409);
    expect(asError(earlyComplete.body).error.code).toBe('INVALID_STATUS_TRANSITION');

    const earlyNoShow = await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'NO_SHOW' })
      .expect(409);
    expect(asError(earlyNoShow.body).error.code).toBe('INVALID_STATUS_TRANSITION');

    // 2. Past appointment CAN be marked COMPLETED or NO_SHOW, and NO_SHOW frees the slot
    const pastAppt = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service30Id,
        startAt: pastStart.toISOString(),
        clientName: 'Past Client',
        clientPhone: '0555400002',
      })
      .expect(201);
    const pastId = asAppointment(pastAppt.body).data.id;

    await request(app)
      .post(`/api/v1/appointments/${pastId}/status`)
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .send({ status: 'NO_SHOW' })
      .expect(200);

    // Editing a NO_SHOW appointment is rejected with 409 INVALID_STATUS_TRANSITION
    const editNoShow = await request(app)
      .patch(`/api/v1/appointments/${pastId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ clientName: 'Cannot Edit' })
      .expect(409);
    expect(asError(editNoShow.body).error.code).toBe('INVALID_STATUS_TRANSITION');

    // Transitioning NO_SHOW -> SCHEDULED is rejected with 409 INVALID_STATUS_TRANSITION
    const restoreNoShow = await request(app)
      .post(`/api/v1/appointments/${pastId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(409);
    expect(asError(restoreNoShow.body).error.code).toBe('INVALID_STATUS_TRANSITION');

    // 3. Cancel futureAppt by MASTER (own appointment) -> 200
    await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    // MASTER cannot restore CANCELLED -> SCHEDULED (403 FORBIDDEN)
    const masterRestore = await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .send({ status: 'SCHEDULED' })
      .expect(403);
    expect(asError(masterRestore.body).error.code).toBe('FORBIDDEN');

    // OWNER can restore CANCELLED -> SCHEDULED when slot is still free
    await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(200);

    // Cancel again, book another appointment into the same slot, then OWNER restore must fail with 409 SLOT_ALREADY_BOOKED
    await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master1Id,
        serviceId: ctx.service60Id,
        startAt: futureStart.toISOString(),
        clientName: 'Slot Taken Client',
        clientPhone: '0555400003',
      })
      .expect(201);

    const conflictingRestore = await request(app)
      .post(`/api/v1/appointments/${futureId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(409);
    expect(asError(conflictingRestore.body).error.code).toBe('SLOT_ALREADY_BOOKED');
  });

  it('enforces the BR-5 permission matrix (OWNER vs MASTER own/other, cross-tenant 404 isolation)', async () => {
    const companyA = await setupCompanyWithStaffAndServices('A');
    const companyB = await setupCompanyWithStaffAndServices('B');

    // Create 1 appointment for master1 and 1 for master2 in Company A
    const apptM1 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .send({
        masterId: companyA.master1Id,
        serviceId: companyA.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'M1 Client',
        clientPhone: '0555500001',
      })
      .expect(201);
    const apptM1Id = asAppointment(apptM1.body).data.id;

    const apptM2 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${companyA.master2Token}`)
      .send({
        masterId: companyA.master2Id,
        serviceId: companyA.service60Id,
        startAt: '2026-11-20T04:00:00.000Z',
        clientName: 'M2 Client',
        clientPhone: '0555500002',
      })
      .expect(201);
    const apptM2Id = asAppointment(apptM2.body).data.id;

    // 1. MASTER cannot create an appointment for another master (403 FORBIDDEN)
    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .send({
        masterId: companyA.master2Id,
        serviceId: companyA.service60Id,
        startAt: '2026-11-20T06:00:00.000Z',
        clientName: 'Not Allowed',
        clientPhone: '0555500003',
      })
      .expect(403);

    // 2. MASTER list query is forced to own masterId even if masterId=master2Id is passed in query
    const m1List = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .query({
        from: '2026-11-20T00:00:00.000Z',
        to: '2026-11-21T00:00:00.000Z',
        masterId: companyA.master2Id,
      })
      .expect(200);
    const m1ListData = asAppointmentList(m1List.body);
    expect(m1ListData.data).toHaveLength(1);
    expect(m1ListData.data[0]?.id).toBe(apptM1Id);

    // 3. MASTER accessing another master's appointment by ID gets 404 NOT_FOUND
    await request(app)
      .get(`/api/v1/appointments/${apptM2Id}`)
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .expect(404);

    await request(app)
      .patch(`/api/v1/appointments/${apptM2Id}`)
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .send({ clientName: 'Nope' })
      .expect(404);

    await request(app)
      .post(`/api/v1/appointments/${apptM2Id}/status`)
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .send({ status: 'CANCELLED' })
      .expect(404);

    // 4. MASTER cannot delete even own appointment (403 FORBIDDEN)
    await request(app)
      .delete(`/api/v1/appointments/${apptM1Id}`)
      .set('Authorization', `Bearer ${companyA.master1Token}`)
      .expect(403);

    // 5. Company B OWNER gets 404 NOT_FOUND on all Company A appointment endpoints, and can book same time slot independently
    await request(app)
      .get(`/api/v1/appointments/${apptM1Id}`)
      .set('Authorization', `Bearer ${companyB.ownerToken}`)
      .expect(404);

    await request(app)
      .patch(`/api/v1/appointments/${apptM1Id}`)
      .set('Authorization', `Bearer ${companyB.ownerToken}`)
      .send({ clientName: 'Cross Tenant' })
      .expect(404);

    await request(app)
      .post(`/api/v1/appointments/${apptM1Id}/status`)
      .set('Authorization', `Bearer ${companyB.ownerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/appointments/${apptM1Id}`)
      .set('Authorization', `Bearer ${companyB.ownerToken}`)
      .expect(404);
  });

  it('validates list range (<= 62 days), returns overlapping appointments sorted by startAt, and preserves soft-deleted service/master names on historical appointments', async () => {
    const ctx = await setupCompanyWithStaffAndServices();

    // Range > 62 days -> 400 VALIDATION_ERROR
    const tooWide = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .query({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-03-15T00:00:00.000Z',
      })
      .expect(400);
    expect(asError(tooWide.body).error.code).toBe('VALIDATION_ERROR');

    // Create an appointment in the past, mark it COMPLETED, then soft-delete the service and master
    const pastStart = new Date(Date.now() - 48 * 3_600_000);
    pastStart.setUTCSeconds(0, 0);

    const histRes = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        masterId: ctx.master2Id,
        serviceId: ctx.service30Id,
        startAt: pastStart.toISOString(),
        clientName: 'History Client',
        clientPhone: '0555600001',
      })
      .expect(201);
    const histId = asAppointment(histRes.body).data.id;

    await request(app)
      .post(`/api/v1/appointments/${histId}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    // Soft-delete service30 and master2 (allowed since no UPCOMING scheduled appointments)
    await request(app)
      .delete(`/api/v1/services/${ctx.service30Id}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .expect(204);

    await request(app)
      .delete(`/api/v1/staff/${ctx.master2Id}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .expect(204);

    // Historical appointment still returns the soft-deleted service and master names
    const getHist = await request(app)
      .get(`/api/v1/appointments/${histId}`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .expect(200);
    const getHistData = asAppointment(getHist.body).data;
    expect(getHistData.service).toEqual({
      id: ctx.service30Id,
      name: 'Beard Trim 30',
      durationMin: 30,
    });
    expect(getHistData.master).toEqual({
      id: ctx.master2Id,
      name: 'Master Two 1',
    });

    const listHist = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .query({
        from: new Date(pastStart.getTime() - 3_600_000).toISOString(),
        to: new Date(pastStart.getTime() + 3_600_000).toISOString(),
      })
      .expect(200);
    const listHistData = asAppointmentList(listHist.body);
    expect(listHistData.data).toHaveLength(1);
    expect(listHistData.data[0]?.service.name).toBe('Beard Trim 30');
    expect(listHistData.data[0]?.master.name).toBe('Master Two 1');
  });
});
