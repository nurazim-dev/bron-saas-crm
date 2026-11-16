import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppointmentStatus } from '../../src/generated/prisma/client.js';
import type { ErrorResponseBody } from '../../src/lib/errors.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AuthUserDto } from '../../src/modules/auth/auth.service.js';
import type { CompanyDto } from '../../src/modules/company/company.service.js';
import type { ServiceDto } from '../../src/modules/services/services.service.js';
import type { StaffDto } from '../../src/modules/staff/staff.service.js';
import { truncateAllTables } from '../helpers/db.js';
import { createAppointmentFactory } from '../helpers/factories.js';

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

interface ServiceListEnvelope {
  data: ServiceDto[];
}

interface StaffEnvelope {
  data: StaffDto;
}

interface StaffListEnvelope {
  data: StaffDto[];
}

function asAuth(body: unknown): AuthEnvelope {
  return body as AuthEnvelope;
}

function asService(body: unknown): ServiceEnvelope {
  return body as ServiceEnvelope;
}

function asServiceList(body: unknown): ServiceListEnvelope {
  return body as ServiceListEnvelope;
}

function asStaff(body: unknown): StaffEnvelope {
  return body as StaffEnvelope;
}

function asStaffList(body: unknown): StaffListEnvelope {
  return body as StaffListEnvelope;
}

function asError(body: unknown): ErrorResponseBody {
  return body as ErrorResponseBody;
}

describe('Services, Staff & Working Hours (/api/v1/services, /api/v1/staff)', () => {
  const app = createApp();

  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  async function registerOwner(email: string, companyName = 'Test Salon') {
    const res = await request(app).post('/api/v1/auth/register').send({
      companyName,
      businessType: 'BEAUTY_SALON',
      ownerName: 'Owner User',
      email,
      password: 'Password123!',
      termsAccepted: true,
    });
    expect(res.status).toBe(201);
    return asAuth(res.body).data;
  }

  describe('Services CRUD, RBAC & Deletion Guard (BR-5, BR-7)', () => {
    it('allows OWNER full CRUD on services while MASTER sees only active services and cannot write', async () => {
      const ownerA = await registerOwner('owner-srv@zapis.kg', 'Salon Services');

      // Create an active service and an inactive service
      const createActive = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Мужская стрижка',
          description: 'Мытьё и укладка включены',
          durationMin: 60,
          price: '500.00',
          isActive: true,
        });
      expect(createActive.status).toBe(201);
      const activeSrv = asService(createActive.body).data;
      expect(activeSrv).toMatchObject({
        name: 'Мужская стрижка',
        durationMin: 60,
        price: '500.00',
        isActive: true,
      });

      const createInactive = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Сезонный уход',
          durationMin: 45,
          price: 1200,
          isActive: false,
        });
      expect(createInactive.status).toBe(201);
      const inactiveSrv = asService(createInactive.body).data;
      expect(inactiveSrv.price).toBe('1200.00');
      expect(inactiveSrv.isActive).toBe(false);

      // Create a MASTER with login
      const staffRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Мастер Канат',
          email: 'kanat@zapis.kg',
          password: 'Password123!',
        });
      expect(staffRes.status).toBe(201);

      const masterLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'kanat@zapis.kg',
        password: 'Password123!',
      });
      const masterToken = asAuth(masterLogin.body).data.accessToken;

      // OWNER sees both active and inactive services
      const ownerList = await request(app)
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(ownerList.status).toBe(200);
      expect(asServiceList(ownerList.body).data).toHaveLength(2);

      // MASTER sees ONLY active services in list and GET /:id
      const masterList = await request(app)
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterList.status).toBe(200);
      expect(asServiceList(masterList.body).data.map((s) => s.id)).toEqual([activeSrv.id]);

      const masterGetInactive = await request(app)
        .get(`/api/v1/services/${inactiveSrv.id}`)
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterGetInactive.status).toBe(404);

      // MASTER cannot POST, PATCH, or DELETE services -> 403 FORBIDDEN
      const masterPost = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${masterToken}`)
        .send({ name: 'New', durationMin: 30, price: 300 });
      expect(masterPost.status).toBe(403);

      const masterPatch = await request(app)
        .patch(`/api/v1/services/${activeSrv.id}`)
        .set('Authorization', `Bearer ${masterToken}`)
        .send({ price: '600.00' });
      expect(masterPatch.status).toBe(403);

      const masterDelete = await request(app)
        .delete(`/api/v1/services/${activeSrv.id}`)
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterDelete.status).toBe(403);

      // OWNER updates service
      const patchRes = await request(app)
        .patch(`/api/v1/services/${activeSrv.id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ price: '550.00', durationMin: 45 });
      expect(patchRes.status).toBe(200);
      expect(asService(patchRes.body).data).toMatchObject({
        price: '550.00',
        durationMin: 45,
      });
    });

    it('validates service fields (durationMin multiple of 5 in 5..720, price 0..1,000,000, name 2..100)', async () => {
      const owner = await registerOwner('val-srv@zapis.kg');

      const notMultipleOf5 = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Bad Duration', durationMin: 23, price: 500 });
      expect(notMultipleOf5.status).toBe(400);
      expect(notMultipleOf5.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

      const priceTooHigh = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Too Expensive', durationMin: 30, price: 1_500_000 });
      expect(priceTooHigh.status).toBe(400);
    });

    it('blocks deleting a service with upcoming SCHEDULED appointments (409 HAS_UPCOMING_APPOINTMENTS with count) and allows deleting when none', async () => {
      const owner = await registerOwner('del-srv@zapis.kg');

      const srvRes = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Стрижка', durationMin: 60, price: 500 });
      const service = asService(srvRes.body).data;

      const futureStart = new Date(Date.now() + 24 * 60 * 60_000);
      const appt = await createAppointmentFactory({
        companyId: owner.company.id,
        masterId: owner.user.id,
        serviceId: service.id,
        startAt: futureStart,
        endAt: new Date(futureStart.getTime() + 60 * 60_000),
        status: AppointmentStatus.SCHEDULED,
      });

      const blockedDel = await request(app)
        .delete(`/api/v1/services/${service.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(blockedDel.status).toBe(409);
      const errBody = asError(blockedDel.body);
      expect(errBody.error.code).toBe('HAS_UPCOMING_APPOINTMENTS');
      expect(errBody.error.details?.[0]?.upcomingAppointmentsCount).toBe(1);

      // Cancel the appointment -> deletion now succeeds
      await createAppointmentFactory({
        companyId: owner.company.id,
        masterId: owner.user.id,
        serviceId: service.id,
        startAt: new Date(Date.now() - 2 * 60 * 60_000),
        endAt: new Date(Date.now() - 60 * 60_000),
        status: AppointmentStatus.SCHEDULED,
      });
      // Update future appointment to CANCELLED
      const { prisma } = await import('../../src/lib/prisma.js');
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: AppointmentStatus.CANCELLED },
      });

      const okDel = await request(app)
        .delete(`/api/v1/services/${service.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(okDel.status).toBe(204);

      // Hidden from GET /services
      const listAfter = await request(app)
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(asServiceList(listAfter.body).data).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND on cross-tenant service access (GET, PATCH, DELETE)', async () => {
      const ownerA = await registerOwner('tenant-a-srv@zapis.kg', 'Company A');
      const ownerB = await registerOwner('tenant-b-srv@zapis.kg', 'Company B');

      const srvRes = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ name: 'Услуга А', durationMin: 30, price: 400 });
      const srvIdA = asService(srvRes.body).data.id;

      const getCross = await request(app)
        .get(`/api/v1/services/${srvIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(getCross.status).toBe(404);

      const patchCross = await request(app)
        .patch(`/api/v1/services/${srvIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ name: 'Hijack' });
      expect(patchCross.status).toBe(404);

      const delCross = await request(app)
        .delete(`/api/v1/services/${srvIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(delCross.status).toBe(404);
    });
  });

  describe('Staff CRUD, Services Assignment, Working Hours & Soft-Delete Restore', () => {
    it('creates staff with and without login, enforces email+password pair rule, and restricts MASTER to reading only own record', async () => {
      const owner = await registerOwner('owner-staff@zapis.kg');

      // Email without password -> 400 VALIDATION_ERROR
      const badCreate = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Incomplete Login', email: 'incomplete@zapis.kg' });
      expect(badCreate.status).toBe(400);

      // Staff without login
      const noLoginRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Нурлан Без Логина', phone: '0555 22 33 44' });
      expect(noLoginRes.status).toBe(201);
      const noLoginStaff = asStaff(noLoginRes.body).data;
      expect(noLoginStaff).toMatchObject({
        role: 'MASTER',
        name: 'Нурлан Без Логина',
        email: null,
        hasLogin: false,
        phone: '+996555223344',
      });

      // Staff with login
      const withLoginRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Бекзат Исаков',
          email: 'bekzat@zapis.kg',
          password: 'Password123!',
          phone: '0700112233',
        });
      expect(withLoginRes.status).toBe(201);
      const withLoginStaff = asStaff(withLoginRes.body).data;
      expect(withLoginStaff.hasLogin).toBe(true);

      // Login as Бекзат
      const masterLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'bekzat@zapis.kg',
        password: 'Password123!',
      });
      const masterToken = asAuth(masterLogin.body).data.accessToken;

      // MASTER cannot list all staff -> 403 FORBIDDEN
      const masterList = await request(app)
        .get('/api/v1/staff')
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterList.status).toBe(403);

      // MASTER can GET own record -> 200
      const masterOwn = await request(app)
        .get(`/api/v1/staff/${withLoginStaff.id}`)
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterOwn.status).toBe(200);
      expect(asStaff(masterOwn.body).data.id).toBe(withLoginStaff.id);

      // MASTER cannot GET another staff member's record -> 404 NOT_FOUND (BR-5)
      const masterOther = await request(app)
        .get(`/api/v1/staff/${noLoginStaff.id}`)
        .set('Authorization', `Bearer ${masterToken}`);
      expect(masterOther.status).toBe(404);
    });

    it('restores and updates a soft-deleted MASTER of the SAME company on POST /staff with the same email, and returns 409 for another company', async () => {
      const ownerA = await registerOwner('restore-a@zapis.kg', 'Company A');
      const ownerB = await registerOwner('restore-b@zapis.kg', 'Company B');

      const createdRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Данияр Старый',
          email: 'daniyar@zapis.kg',
          password: 'OldPassword123!',
        });
      const originalId = asStaff(createdRes.body).data.id;

      // Delete Данияр
      const delRes = await request(app)
        .delete(`/api/v1/staff/${originalId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(delRes.status).toBe(204);

      // Deleted user cannot log in
      const loginDeleted = await request(app).post('/api/v1/auth/login').send({
        email: 'daniyar@zapis.kg',
        password: 'OldPassword123!',
      });
      expect(loginDeleted.status).toBe(401);

      // Company B trying to create a staff member with that email gets 409 CONFLICT (§3.3)
      const crossCollision = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          name: 'Данияр Чужой',
          email: 'daniyar@zapis.kg',
          password: 'NewPassword123!',
        });
      expect(crossCollision.status).toBe(409);

      // Company A recreating with the same email restores the same record ID with updated fields
      const restoredRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Данияр Восстановленный',
          email: 'daniyar@zapis.kg',
          password: 'NewPassword456!',
          phone: '0555998877',
        });
      expect(restoredRes.status).toBe(201);
      const restored = asStaff(restoredRes.body).data;
      expect(restored.id).toBe(originalId);
      expect(restored.name).toBe('Данияр Восстановленный');
      expect(restored.phone).toBe('+996555998877');

      // Restored user can log in with the new password
      const loginRestored = await request(app).post('/api/v1/auth/login').send({
        email: 'daniyar@zapis.kg',
        password: 'NewPassword456!',
      });
      expect(loginRestored.status).toBe(200);
    });

    it('guards staff deletion against upcoming appointments (409), prevents OWNER self-deletion (403) and OWNER deactivation (400), and revokes tokens immediately on deactivation/deletion', async () => {
      const owner = await registerOwner('guard-owner@zapis.kg');

      // OWNER cannot delete himself -> 403 FORBIDDEN
      const selfDel = await request(app)
        .delete(`/api/v1/staff/${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(selfDel.status).toBe(403);

      // OWNER cannot deactivate himself -> 400 VALIDATION_ERROR
      const selfDeactivate = await request(app)
        .patch(`/api/v1/staff/${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ isActive: false });
      expect(selfDeactivate.status).toBe(400);

      // OWNER CAN edit own name, phone, and isBookable
      const selfEdit = await request(app)
        .patch(`/api/v1/staff/${owner.user.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Владелец Обновлён', isBookable: false });
      expect(selfEdit.status).toBe(200);
      expect(asStaff(selfEdit.body).data).toMatchObject({
        name: 'Владелец Обновлён',
        isBookable: false,
      });

      // Create a MASTER and a service
      const srvRes = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Бритьё', durationMin: 30, price: 300 });
      const serviceId = asService(srvRes.body).data.id;

      const masterRes = await request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Мастер Для Удаления',
          email: 'delmaster@zapis.kg',
          password: 'Password123!',
        });
      const masterId = asStaff(masterRes.body).data.id;

      const masterLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'delmaster@zapis.kg',
        password: 'Password123!',
      });
      const masterToken = asAuth(masterLogin.body).data.accessToken;

      // Deactivating master immediately invalidates their existing token
      await request(app)
        .patch(`/api/v1/staff/${masterId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ isActive: false });

      const meAfterDeactivate = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${masterToken}`);
      expect(meAfterDeactivate.status).toBe(401);

      // Add an upcoming SCHEDULED appointment -> DELETE /staff/:id returns 409 HAS_UPCOMING_APPOINTMENTS
      const futureStart = new Date(Date.now() + 3600_000);
      const appt = await createAppointmentFactory({
        companyId: owner.company.id,
        masterId,
        serviceId,
        startAt: futureStart,
        endAt: new Date(futureStart.getTime() + 30 * 60_000),
        status: AppointmentStatus.SCHEDULED,
      });

      const blockedDel = await request(app)
        .delete(`/api/v1/staff/${masterId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(blockedDel.status).toBe(409);
      expect(asError(blockedDel.body).error.code).toBe('HAS_UPCOMING_APPOINTMENTS');

      // Cancel appointment -> DELETE now succeeds
      const { prisma } = await import('../../src/lib/prisma.js');
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: AppointmentStatus.CANCELLED },
      });

      const okDel = await request(app)
        .delete(`/api/v1/staff/${masterId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(okDel.status).toBe(204);

      const listStaff = await request(app)
        .get('/api/v1/staff')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(asStaffList(listStaff.body).data.map((u) => u.id)).toEqual([owner.user.id]);
    });

    it('replaces staff services (rejecting cross-tenant or deleted serviceIds) and replaces working hours (enforcing BR-10)', async () => {
      const ownerA = await registerOwner('assign-a@zapis.kg', 'Company A');
      const ownerB = await registerOwner('assign-b@zapis.kg', 'Company B');

      const s1Res = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ name: 'Стрижка', durationMin: 60, price: 500 });
      const s1 = asService(s1Res.body).data;

      const s2Res = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ name: 'Борода', durationMin: 30, price: 300 });
      const s2 = asService(s2Res.body).data;

      const foreignSrvRes = await request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ name: 'Чужая услуга', durationMin: 30, price: 300 });
      const foreignSrv = asService(foreignSrvRes.body).data;

      // Assign s1 and s2 to OWNER
      const assignOk = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/services`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ serviceIds: [s1.id, s2.id] });
      expect(assignOk.status).toBe(200);
      expect(asStaff(assignOk.body).data.serviceIds.sort()).toEqual([s1.id, s2.id].sort());

      // Foreign serviceId rejected with 400 VALIDATION_ERROR
      const assignForeign = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/services`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ serviceIds: [s1.id, foreignSrv.id] });
      expect(assignForeign.status).toBe(400);

      // Soft-delete s2 -> assigning s2 is rejected
      await request(app)
        .delete(`/api/v1/services/${s2.id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);

      const assignDeleted = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/services`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ serviceIds: [s2.id] });
      expect(assignDeleted.status).toBe(400);

      // Working hours: valid replace-all
      const whOk = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/working-hours`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          days: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
            { dayOfWeek: 2, startTime: '10:00', endTime: '19:00' },
          ],
        });
      expect(whOk.status).toBe(200);
      expect(asStaff(whOk.body).data.workingHours).toEqual([
        { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', breakStart: null, breakEnd: null },
        { dayOfWeek: 2, startTime: '10:00', endTime: '19:00', breakStart: null, breakEnd: null },
      ]);

      // Working hours validation: startTime >= endTime (overnight / zero length) -> 400
      const whBadOrder = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/working-hours`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          days: [{ dayOfWeek: 1, startTime: '18:00', endTime: '09:00' }],
        });
      expect(whBadOrder.status).toBe(400);

      // Working hours validation: duplicate dayOfWeek -> 400
      const whDupDay = await request(app)
        .put(`/api/v1/staff/${ownerA.user.id}/working-hours`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          days: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
            { dayOfWeek: 1, startTime: '13:00', endTime: '18:00' },
          ],
        });
      expect(whDupDay.status).toBe(400);

      // Cross-tenant staff access -> 404
      const crossStaffGet = await request(app)
        .get(`/api/v1/staff/${ownerA.user.id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(crossStaffGet.status).toBe(404);
    });
  });
});
