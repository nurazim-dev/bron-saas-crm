import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  addDaysToLocalDate,
  getIsoWeekdayOfLocalDate,
  getTodayLocalDate,
  localDateTimeToUtc,
} from '../../src/lib/datetime.js';
import type { ErrorResponseBody } from '../../src/lib/errors.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AuthUserDto } from '../../src/modules/auth/auth.service.js';
import type { AvailabilityResultDto } from '../../src/modules/availability/availability.service.js';
import type { CompanyDto } from '../../src/modules/company/company.service.js';
import type {
  PublicCompanyProfileDto,
  PublicCreateAppointmentResultDto,
} from '../../src/modules/public/public.service.js';
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

interface AvailabilityEnvelope {
  data: AvailabilityResultDto;
}

interface PublicProfileEnvelope {
  data: PublicCompanyProfileDto;
}

interface PublicCreateEnvelope {
  data: PublicCreateAppointmentResultDto;
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

function asAvailability(body: unknown): AvailabilityEnvelope {
  return body as AvailabilityEnvelope;
}

function asPublicProfile(body: unknown): PublicProfileEnvelope {
  return body as PublicProfileEnvelope;
}

function asPublicCreate(body: unknown): PublicCreateEnvelope {
  return body as PublicCreateEnvelope;
}

function asError(body: unknown): ErrorResponseBody {
  return body as ErrorResponseBody;
}

interface PublicTestFixture {
  ownerToken: string;
  ownerId: string;
  companyId: string;
  slug: string;
  master1Id: string;
  master1Token: string;
  master2Id: string;
  service60Id: string;
  service30Id: string;
  targetDate: string;
  targetDayOfWeek: number;
}

async function setupPublicBookingFixture(suffix = '1'): Promise<PublicTestFixture> {
  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: `Public Salon ${suffix}`,
      businessType: 'BARBERSHOP',
      ownerName: `Owner ${suffix}`,
      email: `owner-pub-${suffix}@zapis.kg`,
      phone: '0555100100',
      password: 'Password123!',
    })
    .expect(201);

  const auth = asAuth(regRes.body).data;
  const ownerToken = auth.accessToken;
  const ownerId = auth.user.id;
  const companyId = auth.company.id;
  const slug = auth.company.slug;

  const s60Res = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Haircut 60',
      description: 'Classic haircut',
      durationMin: 60,
      price: '600.00',
    })
    .expect(201);
  const service60Id = asService(s60Res.body).data.id;

  const s30Res = await request(app)
    .post('/api/v1/services')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Beard 30',
      durationMin: 30,
      price: '350.00',
    })
    .expect(201);
  const service30Id = asService(s30Res.body).data.id;

  const m1Res = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `Master Bookable ${suffix}`,
      email: `m1-pub-${suffix}@zapis.kg`,
      password: 'Password123!',
      phone: '0555100101',
    })
    .expect(201);
  const master1Id = asStaff(m1Res.body).data.id;

  const m2Res = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `Master Unconfigured ${suffix}`,
      phone: '0555100102',
    })
    .expect(201);
  const master2Id = asStaff(m2Res.body).data.id;

  // Assign both services to master1
  await request(app)
    .put(`/api/v1/staff/${master1Id}/services`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ serviceIds: [service60Id, service30Id] })
    .expect(200);

  // Pick a target local date 5 days ahead in Asia/Bishkek
  const todayLocal = getTodayLocalDate('Asia/Bishkek');
  const targetDate = addDaysToLocalDate(todayLocal, 5, 'Asia/Bishkek');
  const targetDayOfWeek = getIsoWeekdayOfLocalDate(targetDate, 'Asia/Bishkek');

  // Set working hours for master1 on targetDayOfWeek: 10:00 - 12:00
  await request(app)
    .put(`/api/v1/staff/${master1Id}/working-hours`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      days: [{ dayOfWeek: targetDayOfWeek, startTime: '10:00', endTime: '12:00' }],
    })
    .expect(200);

  const m1Login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `m1-pub-${suffix}@zapis.kg`, password: 'Password123!' })
    .expect(200);
  const master1Token = asAuth(m1Login.body).data.accessToken;

  return {
    ownerToken,
    ownerId,
    companyId,
    slug,
    master1Id,
    master1Token,
    master2Id,
    service60Id,
    service30Id,
    targetDate,
    targetDayOfWeek,
  };
}

describe('Phase 5: Availability Engine & Public Booking API (BR-3, BR-4, BR-1)', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('returns public company profile with only bookable masters/services and no PII or internal fields, plus 404 on unknown slug and 403 on disabled booking', async () => {
    const ctx = await setupPublicBookingFixture();

    // Create an inactive service — must be hidden from public profile
    await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        name: 'Hidden Service',
        durationMin: 30,
        price: '999.00',
        isActive: false,
      })
      .expect(201);

    // master2 has no services and no working hours; owner has no services/working hours -> only master1 appears
    const profileRes = await request(app).get(`/api/v1/public/companies/${ctx.slug}`).expect(200);

    const profile = asPublicProfile(profileRes.body).data;
    expect(profile.company).toMatchObject({
      name: 'Public Salon 1',
      slug: ctx.slug,
      businessType: 'BARBERSHOP',
      timezone: 'Asia/Bishkek',
      currency: 'KGS',
      bookingEnabled: true,
    });
    expect(profile.services.map((s) => s.name)).toEqual(['Haircut 60', 'Beard 30']);
    expect(profile.masters).toHaveLength(1);
    expect(profile.masters[0]?.id).toBe(ctx.master1Id);
    expect(profile.masters[0]?.name).toBe('Master Bookable 1');
    expect([...(profile.masters[0]?.serviceIds ?? [])].sort()).toEqual(
      [ctx.service60Id, ctx.service30Id].sort(),
    );

    // Ensure no internal or PII fields leak in public profile
    const rawMaster = profile.masters[0] as unknown as Record<string, unknown>;
    expect(rawMaster.email).toBeUndefined();
    expect(rawMaster.phone).toBeUndefined();
    expect(rawMaster.passwordHash).toBeUndefined();
    expect(rawMaster.tokenVersion).toBeUndefined();

    // Unknown slug -> 404 NOT_FOUND
    const unknownRes = await request(app)
      .get('/api/v1/public/companies/non-existent-salon')
      .expect(404);
    expect(asError(unknownRes.body).error.code).toBe('NOT_FOUND');

    // Disable public booking -> 403 BOOKING_DISABLED across all 3 public endpoints
    await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ publicBookingEnabled: false })
      .expect(200);

    const disabledProfile = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}`)
      .expect(403);
    expect(asError(disabledProfile.body).error.code).toBe('BOOKING_DISABLED');

    const disabledAvail = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: ctx.targetDate,
      })
      .expect(403);
    expect(asError(disabledAvail.body).error.code).toBe('BOOKING_DISABLED');

    const disabledBook = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString(),
        clientName: 'Client Disabled',
        clientPhone: '0555123456',
        consentAccepted: true,
      })
      .expect(403);
    expect(asError(disabledBook.body).error.code).toBe('BOOKING_DISABLED');
  });

  it('computes BR-4 availability accurately (grid anchored at work start, duration fitting, day off, existing/cancelled appointments, lead time, max advance, timezones, and MASTER RBAC)', async () => {
    const ctx = await setupPublicBookingFixture();

    // 1. Master1 works 10:00 - 12:00 on targetDate, slotIntervalMin = 30.
    // For a 60-min service, valid candidate starts are 10:00, 10:30, 11:00 (11:30 + 60 = 12:30 > 12:00).
    const avail60 = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: ctx.targetDate,
      })
      .expect(200);

    expect(avail60.headers['cache-control']).toBe('no-store');
    expect(asAvailability(avail60.body).data).toEqual({
      date: ctx.targetDate,
      timezone: 'Asia/Bishkek',
      slots: [
        {
          startAt: localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString(),
          label: '10:00',
        },
        {
          startAt: localDateTimeToUtc(ctx.targetDate, '10:30', 'Asia/Bishkek').toISOString(),
          label: '10:30',
        },
        {
          startAt: localDateTimeToUtc(ctx.targetDate, '11:00', 'Asia/Bishkek').toISOString(),
          label: '11:00',
        },
      ],
    });

    // 2. Anchor grid at non-hour start time (09:15 - 11:15) -> slots anchored at 09:15, 09:45, 10:15
    await request(app)
      .put(`/api/v1/staff/${ctx.master1Id}/working-hours`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        days: [{ dayOfWeek: ctx.targetDayOfWeek, startTime: '09:15', endTime: '11:15' }],
      })
      .expect(200);

    const availAnchored = await request(app)
      .get('/api/v1/availability')
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: ctx.targetDate,
      })
      .expect(200);
    expect(asAvailability(availAnchored.body).data.slots.map((s) => s.label)).toEqual([
      '09:15',
      '09:45',
      '10:15',
    ]);

    // Restore 10:00 - 12:00 working hours
    await request(app)
      .put(`/api/v1/staff/${ctx.master1Id}/working-hours`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        days: [{ dayOfWeek: ctx.targetDayOfWeek, startTime: '10:00', endTime: '12:00' }],
      })
      .expect(200);

    // 3. Day off (next day has no working hours) -> empty slots
    const dayOffDate = addDaysToLocalDate(ctx.targetDate, 1, 'Asia/Bishkek');
    const availDayOff = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: dayOffDate,
      })
      .expect(200);
    expect(asAvailability(availDayOff.body).data.slots).toEqual([]);

    // 4. Past date and date beyond maxAdvanceDays (60) -> empty slots
    const pastDate = addDaysToLocalDate(getTodayLocalDate('Asia/Bishkek'), -1, 'Asia/Bishkek');
    const tooFarDate = addDaysToLocalDate(getTodayLocalDate('Asia/Bishkek'), 61, 'Asia/Bishkek');

    const availPast = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({ serviceId: ctx.service60Id, masterId: ctx.master1Id, date: pastDate })
      .expect(200);
    expect(asAvailability(availPast.body).data.slots).toEqual([]);

    const availTooFar = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({ serviceId: ctx.service60Id, masterId: ctx.master1Id, date: tooFarDate })
      .expect(200);
    expect(asAvailability(availTooFar.body).data.slots).toEqual([]);

    // 5. Staff endpoint RBAC: MASTER querying another master's availability gets 404 NOT_FOUND
    await request(app)
      .get('/api/v1/availability')
      .set('Authorization', `Bearer ${ctx.master1Token}`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.ownerId,
        date: ctx.targetDate,
      })
      .expect(404);
  });

  it('books a public appointment (removing the slot from availability), restores the slot when cancelled, and enforces 10-parallel-requests concurrency (exactly ONE 201 and NINE 409)', async () => {
    const ctx = await setupPublicBookingFixture();
    const slot1000Utc = localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString();

    // 1. 10 parallel public bookings racing for the 10:00 slot -> 1 x 201, 9 x 409 SLOT_ALREADY_BOOKED
    const parallelBookings = Array.from({ length: 10 }, (_, idx) =>
      request(app)
        .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
        .send({
          serviceId: ctx.service60Id,
          masterId: ctx.master1Id,
          startAt: slot1000Utc,
          clientName: `Public Racer ${String(idx + 1)}`,
          clientPhone: `055570000${String(idx)}`,
          consentAccepted: true,
        }),
    );

    const results = await Promise.all(parallelBookings);
    const winners = results.filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 409);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    for (const loser of losers) {
      expect(asError(loser.body).error.code).toBe('SLOT_ALREADY_BOOKED');
    }

    const booked = asPublicCreate(winners[0]?.body).data.appointment;
    expect(booked).toMatchObject({
      startAt: slot1000Utc,
      status: 'SCHEDULED',
      service: {
        name: 'Haircut 60',
        durationMin: 60,
        price: '600.00',
      },
      master: {
        name: 'Master Bookable 1',
      },
      company: {
        name: 'Public Salon 1',
        timezone: 'Asia/Bishkek',
      },
    });

    // 2. Availability for 60-min service now only has 11:00 (since [10:00, 11:00) blocks 10:00 and 10:30!)
    const availAfterBook = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: ctx.targetDate,
      })
      .expect(200);
    expect(asAvailability(availAfterBook.body).data.slots.map((s) => s.label)).toEqual(['11:00']);

    // 3. Cancel the booking via staff endpoint -> 10:00 and 10:30 become available again
    await request(app)
      .post(`/api/v1/appointments/${booked.id}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    const availAfterCancel = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        date: ctx.targetDate,
      })
      .expect(200);
    expect(asAvailability(availAfterCancel.body).data.slots.map((s) => s.label)).toEqual([
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('enforces every BR-3 rejection path (off-grid, outside hours, day off, lead time, max advance -> 422 SLOT_NOT_AVAILABLE; cross-company isolation -> 404)', async () => {
    const ctx = await setupPublicBookingFixture('A');
    const ctxB = await setupPublicBookingFixture('B');

    // 1. Off-grid start (10:15 when grid is 10:00 + k*30) -> 422 SLOT_NOT_AVAILABLE
    const offGrid = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '10:15', 'Asia/Bishkek').toISOString(),
        clientName: 'Off Grid',
        clientPhone: '0555800001',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(offGrid.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // 2. Outside working hours (09:30 before 10:00 start, and 11:30 for a 60-min service ending at 12:30 > 12:00) -> 422
    const beforeHours = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '09:30', 'Asia/Bishkek').toISOString(),
        clientName: 'Before Hours',
        clientPhone: '0555800002',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(beforeHours.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    const overflowsEnd = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service60Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '11:30', 'Asia/Bishkek').toISOString(),
        clientName: 'Overflows End',
        clientPhone: '0555800003',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(overflowsEnd.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // 3. Day off -> 422 SLOT_NOT_AVAILABLE
    const dayOffDate = addDaysToLocalDate(ctx.targetDate, 1, 'Asia/Bishkek');
    const onDayOff = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(dayOffDate, '10:00', 'Asia/Bishkek').toISOString(),
        clientName: 'Day Off',
        clientPhone: '0555800004',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(onDayOff.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // 4. Past time / violates minLeadTimeMin -> 422 SLOT_NOT_AVAILABLE
    const pastTime = new Date(Date.now() - 3_600_000).toISOString();
    const inPast = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: pastTime,
        clientName: 'Past Client',
        clientPhone: '0555800005',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(inPast.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // 5. Beyond maxAdvanceDays (65 days ahead) -> 422 SLOT_NOT_AVAILABLE
    const farDate = addDaysToLocalDate(getTodayLocalDate('Asia/Bishkek'), 65, 'Asia/Bishkek');
    const tooFar = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(farDate, '10:00', 'Asia/Bishkek').toISOString(),
        clientName: 'Too Far Client',
        clientPhone: '0555800006',
        consentAccepted: true,
      })
      .expect(422);
    expect(asError(tooFar.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // 6. Cross-company slug isolation: using Company B's masterId or serviceId under Company A's slug -> 404 NOT_FOUND
    await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctxB.service60Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString(),
        clientName: 'Cross Service',
        clientPhone: '0555800007',
        consentAccepted: true,
      })
      .expect(404);
  });

  it('enforces honeypot (fake 201 with zero DB writes), per-phone limit (max 3 upcoming SCHEDULED per phone per company), and IP rate limit (10/hour/IP)', async () => {
    const ctx = await setupPublicBookingFixture();

    // Give master1 working hours 10:00 - 18:00 so we have plenty of slots on targetDate
    await request(app)
      .put(`/api/v1/staff/${ctx.master1Id}/working-hours`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        days: [{ dayOfWeek: ctx.targetDayOfWeek, startTime: '10:00', endTime: '18:00' }],
      })
      .expect(200);

    // 1. Honeypot `website` filled -> returns 201 but writes nothing to DB
    const slot1000Utc = localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString();
    const honeypotRes = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: slot1000Utc,
        clientName: 'Bot Spammer',
        clientPhone: '0555911911',
        consentAccepted: true,
        website: 'https://spam.example.com',
      })
      .expect(201);

    expect(asPublicCreate(honeypotRes.body).data.appointment.status).toBe('SCHEDULED');
    expect(await prisma.appointment.count({ where: { companyId: ctx.companyId } })).toBe(0);

    // 2. Per-phone limit: same clientPhone can book 3 upcoming appointments (10:00, 10:30, 11:00), 4th (11:30) is rejected with 409 CONFLICT
    for (const time of ['10:00', '10:30', '11:00']) {
      await request(app)
        .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
        .send({
          serviceId: ctx.service30Id,
          masterId: ctx.master1Id,
          startAt: localDateTimeToUtc(ctx.targetDate, time, 'Asia/Bishkek').toISOString(),
          clientName: 'Loyal Client',
          clientPhone: '0555 33 44 55',
          consentAccepted: true,
        })
        .expect(201);
    }

    const fourthForSamePhone = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '11:30', 'Asia/Bishkek').toISOString(),
        clientName: 'Loyal Client',
        clientPhone: '+996555334455',
        consentAccepted: true,
      })
      .expect(409);
    expect(asError(fourthForSamePhone.body).error.code).toBe('CONFLICT');

    // 3. IP rate limit: we already made 5 POST requests to /public/companies/:slug/appointments in this test.
    // Make 5 more (reaching 10 total), then the 11th must return 429 RATE_LIMITED.
    const moreTimes = ['12:00', '12:30', '13:00', '13:30', '14:00'];
    for (let i = 0; i < moreTimes.length; i++) {
      const t = moreTimes[i] ?? '12:00';
      await request(app)
        .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
        .send({
          serviceId: ctx.service30Id,
          masterId: ctx.master1Id,
          startAt: localDateTimeToUtc(ctx.targetDate, t, 'Asia/Bishkek').toISOString(),
          clientName: `Other Client ${String(i)}`,
          clientPhone: `055566600${String(i)}`,
          consentAccepted: true,
        })
        .expect(201);
    }

    const eleventhReq = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service30Id,
        masterId: ctx.master1Id,
        startAt: localDateTimeToUtc(ctx.targetDate, '14:30', 'Asia/Bishkek').toISOString(),
        clientName: 'Rate Limited Client',
        clientPhone: '0555666099',
        consentAccepted: true,
      })
      .expect(429);
    expect(asError(eleventhReq.body).error.code).toBe('RATE_LIMITED');
  });

  it('enforces BR-12 any-available-master union availability, deterministic least-loaded ordering, and k-of-N parallel concurrency without deadlocks', async () => {
    const ctx = await setupPublicBookingFixture('BR12');

    // Configure master2 to also perform service60Id and work 10:00 - 13:00 on targetDayOfWeek
    // (master1 works 10:00 - 12:00, so 12:00 is available only on master2)
    await request(app)
      .put(`/api/v1/staff/${ctx.master2Id}/services`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ serviceIds: [ctx.service60Id] })
      .expect(200);

    await request(app)
      .put(`/api/v1/staff/${ctx.master2Id}/working-hours`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({
        days: [{ dayOfWeek: ctx.targetDayOfWeek, startTime: '10:00', endTime: '13:00' }],
      })
      .expect(200);

    // 1. Union availability when masterId is "ANY" or omitted includes 10:00, 10:30, 11:00, 11:30, 12:00
    const unionAvailRes = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        masterId: 'ANY',
        date: ctx.targetDate,
      })
      .expect(200);

    expect(asAvailability(unionAvailRes.body).data.slots.map((s) => s.label)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
    ]);

    const omittedMasterAvailRes = await request(app)
      .get(`/api/v1/public/companies/${ctx.slug}/availability`)
      .query({
        serviceId: ctx.service60Id,
        date: ctx.targetDate,
      })
      .expect(200);
    expect(asAvailability(omittedMasterAvailRes.body).data.slots.map((s) => s.label)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
    ]);

    // 2. Concurrent any-master booking at 10:00: k = 2 free masters, N = 6 parallel requests ->
    //    exactly 2 x 201 (assigned to master1 and master2) and 4 x 409 SLOT_ALREADY_BOOKED
    const slot1000Utc = localDateTimeToUtc(ctx.targetDate, '10:00', 'Asia/Bishkek').toISOString();
    const parallelAnyRequests = Array.from({ length: 6 }, (_, idx) =>
      request(app)
        .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
        .send({
          serviceId: ctx.service60Id,
          masterId: 'ANY',
          startAt: slot1000Utc,
          clientName: `Any Racer ${String(idx + 1)}`,
          clientPhone: `055540000${String(idx)}`,
          consentAccepted: true,
        }),
    );

    const raceResults = await Promise.all(parallelAnyRequests);
    const winners = raceResults.filter((r) => r.status === 201);
    const losers = raceResults.filter((r) => r.status === 409);

    expect(winners).toHaveLength(2);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(asError(loser.body).error.code).toBe('SLOT_ALREADY_BOOKED');
    }

    const assignedMasterIds = winners
      .map((w) => asPublicCreate(w.body).data.appointment.master.id)
      .sort();
    expect(assignedMasterIds).toEqual([ctx.master1Id, ctx.master2Id].sort());

    // 3. Deterministic least-loaded ordering: cancel master2's 10:00 booking so master1 has 1 appointment
    //    on targetDate and master2 has 0. Booking 11:00 with masterId omitted must pick master2 (0 < 1).
    const master2Booking = winners
      .map((w) => asPublicCreate(w.body).data.appointment)
      .find((a) => a.master.id === ctx.master2Id);
    expect(master2Booking).toBeDefined();

    await request(app)
      .post(`/api/v1/appointments/${master2Booking?.id ?? ''}/status`)
      .set('Authorization', `Bearer ${ctx.ownerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    const slot1100Utc = localDateTimeToUtc(ctx.targetDate, '11:00', 'Asia/Bishkek').toISOString();
    const leastLoadedRes = await request(app)
      .post(`/api/v1/public/companies/${ctx.slug}/appointments`)
      .send({
        serviceId: ctx.service60Id,
        startAt: slot1100Utc,
        clientName: 'Least Loaded Client',
        clientPhone: '0555400099',
        consentAccepted: true,
      })
      .expect(201);

    expect(asPublicCreate(leastLoadedRes.body).data.appointment.master.id).toBe(ctx.master2Id);
  });
});
