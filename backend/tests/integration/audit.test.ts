import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AuditActor } from '../../src/generated/prisma/client.js';
import { audit, redactAuditMetadata } from '../../src/lib/audit.js';
import { prisma } from '../../src/lib/prisma.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory } from '../helpers/factories.js';

describe('Audit log (Phase 12)', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
  });

  it('redacts secret keys and masks emails/phones in metadata', async () => {
    const redacted = redactAuditMetadata({
      password: 'plain-password',
      accessToken: 'jwt-secret',
      nested: {
        refreshToken: 'refresh-secret',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
      email: 'owner@example.com',
      phone: '+996700123456',
      safeField: 'kept',
    });

    expect(redacted).toEqual({
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
      nested: {
        refreshToken: '[REDACTED]',
        totpSecret: '[REDACTED]',
      },
      email: 'ow***@example.com',
      phone: '+996*****456',
      safeField: 'kept',
    });

    await audit(prisma, {
      actorType: AuditActor.SYSTEM,
      action: 'system.test',
      metadata: {
        token: 'never-stored',
        phone: '+996555987654',
      },
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'system.test' } });
    expect(row.metadata).toEqual({
      token: '[REDACTED]',
      phone: '+996*****654',
    });
  });

  it('records audit entries for critical staff, company, service, auth, and appointment events', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Audit Owner',
      email: 'audit-owner@example.com',
      password: 'Password123',
      termsAccepted: true,
      companyName: 'Audit Barbershop',
      businessType: 'BARBERSHOP',
    });
    expect(reg.status).toBe(201);
    const regBody = reg.body as {
      data: {
        accessToken: string;
        user: { id: string };
        company: { id: string };
      };
    };
    const { accessToken, user: owner, company } = regBody.data;

    const service = await createServiceFactory(company.id);
    await prisma.masterService.create({
      data: { userId: owner.id, serviceId: service.id },
    });

    // 1. company.update
    const companyRes = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Updated Barbershop' });
    expect(companyRes.status).toBe(200);

    // 2. staff.create
    const staffCreateRes = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Master Azat',
        email: 'azat@example.com',
        password: 'Password123',
        isActive: true,
        isBookable: true,
      });
    expect(staffCreateRes.status).toBe(201);
    const staffId = (staffCreateRes.body as { data: { id: string } }).data.id;

    // 3. staff.update (name)
    const staffUpdateRes = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Master Azat Updated' });
    expect(staffUpdateRes.status).toBe(200);

    // 4. staff.deactivate (isActive true -> false)
    const staffDeactivateRes = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false });
    expect(staffDeactivateRes.status).toBe(200);

    // 5. staff.delete
    const staffDeleteRes = await request(app)
      .delete(`/api/v1/staff/${staffId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(staffDeleteRes.status).toBe(204);

    // 6. appointment.delete
    const apptCreateRes = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        masterId: owner.id,
        serviceId: service.id,
        clientName: 'Client',
        clientPhone: '+996700111222',
        startAt: '2026-11-20T09:00:00.000Z',
      });
    expect(apptCreateRes.status).toBe(201);
    const apptId = (apptCreateRes.body as { data: { id: string } }).data.id;

    const apptDeleteRes = await request(app)
      .delete(`/api/v1/appointments/${apptId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(apptDeleteRes.status).toBe(204);

    // 7. service.delete
    const svcDeleteRes = await request(app)
      .delete(`/api/v1/services/${service.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(svcDeleteRes.status).toBe(204);

    // 8. auth.password_change
    const pwRes = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
      });
    expect(pwRes.status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'asc' },
    });

    const actions = logs.map((l) => l.action);
    expect(actions).toEqual([
      'company.update',
      'staff.create',
      'staff.update',
      'staff.deactivate',
      'staff.delete',
      'appointment.delete',
      'service.delete',
      'auth.password_change',
    ]);
    expect(logs.every((l) => l.actorType === AuditActor.USER && l.actorId === owner.id)).toBe(true);
  });
});
