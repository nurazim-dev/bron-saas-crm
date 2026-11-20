import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { truncateAllTables } from '../helpers/db.js';
import { createAppointmentFactory, createServiceFactory } from '../helpers/factories.js';

const app = createApp();

async function registerCompanyOwner(opts: {
  companyName: string;
  email: string;
  ownerName?: string;
}) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: opts.companyName,
      businessType: 'BARBERSHOP',
      ownerName: opts.ownerName ?? 'Владелец',
      email: opts.email,
      password: 'Password123!',
      termsAccepted: true,
    });
  expect(res.status).toBe(201);
  const body = res.body as {
    data: {
      accessToken: string;
      user: { id: string };
      company: { id: string; slug: string };
    };
  };
  return body.data;
}

describe('Phase 3 CRM: tags, segments, merge, import, global search, CRM analytics', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'crm-p3-' } } });
  });

  afterEach(async () => {
    resetClock();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'crm-p3-' } } });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('supports tag CRUD, case-insensitive deduplication, cross-tenant 404 isolation, segments, and spend sorting', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const ownerA = await registerCompanyOwner({
      companyName: 'Salon Alpha',
      email: 'crm-a@example.test',
    });
    const ownerB = await registerCompanyOwner({
      companyName: 'Salon Beta',
      email: 'crm-b@example.test',
    });
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    const svcA = await createServiceFactory(ownerA.company.id, {
      name: 'Мужская стрижка',
      price: '1200.00',
      durationMin: 45,
    });

    // Tag CRUD + 409 case-insensitive duplicate
    const tagRes = await request(app)
      .post('/api/v1/clients/tags')
      .set(authA)
      .send({ name: 'VIP', color: '#0f766e' })
      .expect(201);
    const vipTag = (tagRes.body as { data: { id: string; name: string; color: string } }).data;

    await request(app)
      .post('/api/v1/clients/tags')
      .set(authA)
      .send({ name: 'vip', color: '#111111' })
      .expect(409);

    const updatedTag = await request(app)
      .patch(`/api/v1/clients/tags/${vipTag.id}`)
      .set(authA)
      .send({ name: 'VIP Гость', color: '#b45309' })
      .expect(200);
    expect((updatedTag.body as { data: { name: string } }).data.name).toBe('VIP Гость');

    // Cross-tenant tag edit/delete returns 404
    await request(app)
      .patch(`/api/v1/clients/tags/${vipTag.id}`)
      .set(authB)
      .send({ name: 'Hack' })
      .expect(404);
    await request(app).delete(`/api/v1/clients/tags/${vipTag.id}`).set(authB).expect(404);

    // Seed clients across segments using deterministic FakeClock dates (now = 2026-11-19)
    const createClient = async (name: string, phone: string, createdAt: Date, isBlocked = false) =>
      prisma.client.create({
        data: {
          companyId: ownerA.company.id,
          name,
          phone,
          isBlocked,
          blockedAt: isBlocked ? createdAt : null,
          createdAt,
          updatedAt: createdAt,
        },
      });

    // 1) NEW client: created 5 days ago, 1 completed visit
    const cNew = await createClient(
      'Айдана Новая',
      '+996555001001',
      DateTime.fromISO('2026-11-14T08:00:00Z').toJSDate(),
    );
    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svcA.id,
      clientName: cNew.name,
      clientPhone: cNew.phone,
      startAt: DateTime.fromISO('2026-11-15T09:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-15T09:45:00Z').toJSDate(),
      price: '1200.00',
      status: 'COMPLETED',
    });

    // 2) VIP client: 5 visits (total 6000) & tagged with VIP Гость
    const cVip = await createClient(
      'Бакыт VIP',
      '+996555001002',
      DateTime.fromISO('2026-06-01T08:00:00Z').toJSDate(),
    );
    for (let i = 0; i < 5; i += 1) {
      const start = DateTime.fromISO('2026-11-01T09:00:00Z').plus({ days: i * 2 });
      await createAppointmentFactory({
        companyId: ownerA.company.id,
        masterId: ownerA.user.id,
        serviceId: svcA.id,
        clientName: cVip.name,
        clientPhone: cVip.phone,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: 45 }).toJSDate(),
        price: '1200.00',
        status: 'COMPLETED',
      });
    }
    await request(app)
      .put(`/api/v1/clients/${cVip.id}/tags`)
      .set(authA)
      .send({ tagIds: [vipTag.id] })
      .expect(200);

    // Cross-tenant tag assignment returns 404
    const tagBRes = await request(app)
      .post('/api/v1/clients/tags')
      .set(authB)
      .send({ name: 'BetaTag' })
      .expect(201);
    const tagB = (tagBRes.body as { data: { id: string } }).data;
    await request(app)
      .put(`/api/v1/clients/${cVip.id}/tags`)
      .set(authA)
      .send({ tagIds: [tagB.id] })
      .expect(404);

    // 3) AT_RISK client: 2 completed visits, last visit 60 days ago (2026-09-20), no upcoming
    const cRisk = await createClient(
      'Самира Риск',
      '+996555001003',
      DateTime.fromISO('2026-08-01T08:00:00Z').toJSDate(),
    );
    for (const dayIso of ['2026-08-10T09:00:00Z', '2026-09-20T09:00:00Z']) {
      const start = DateTime.fromISO(dayIso);
      await createAppointmentFactory({
        companyId: ownerA.company.id,
        masterId: ownerA.user.id,
        serviceId: svcA.id,
        clientName: cRisk.name,
        clientPhone: cRisk.phone,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: 45 }).toJSDate(),
        price: '800.00',
        status: 'COMPLETED',
      });
    }

    // 4) LOST client: 1 completed visit 120 days ago (2026-07-20)
    const cLost = await createClient(
      'Марат Потерян',
      '+996555001004',
      DateTime.fromISO('2026-07-01T08:00:00Z').toJSDate(),
    );
    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svcA.id,
      clientName: cLost.name,
      clientPhone: cLost.phone,
      startAt: DateTime.fromISO('2026-07-20T09:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-07-20T09:45:00Z').toJSDate(),
      price: '500.00',
      status: 'COMPLETED',
    });

    // 5) NO_SHOW_RISK client: 2 no-shows
    const cNoShow = await createClient(
      'Тимур Неявка',
      '+996555001005',
      DateTime.fromISO('2026-09-01T08:00:00Z').toJSDate(),
    );
    for (const dayIso of ['2026-10-01T09:00:00Z', '2026-10-15T09:00:00Z']) {
      const start = DateTime.fromISO(dayIso);
      await createAppointmentFactory({
        companyId: ownerA.company.id,
        masterId: ownerA.user.id,
        serviceId: svcA.id,
        clientName: cNoShow.name,
        clientPhone: cNoShow.phone,
        startAt: start.toJSDate(),
        endAt: start.plus({ minutes: 45 }).toJSDate(),
        price: '500.00',
        status: 'NO_SHOW',
      });
    }

    // 6) BLOCKED client
    await createClient(
      'Заблокированный',
      '+996555001006',
      DateTime.fromISO('2026-11-10T08:00:00Z').toJSDate(),
      true,
    );

    const expectSegmentNames = async (segment: string) => {
      const r = await request(app).get('/api/v1/clients').set(authA).query({ segment }).expect(200);
      return (r.body as { data: Array<{ name: string }> }).data.map((c) => c.name);
    };

    expect(await expectSegmentNames('NEW')).toEqual(['Айдана Новая']);
    expect(await expectSegmentNames('VIP')).toEqual(['Бакыт VIP']);
    expect(await expectSegmentNames('REPEAT')).toEqual(
      expect.arrayContaining(['Бакыт VIP', 'Самира Риск']),
    );
    expect(await expectSegmentNames('AT_RISK')).toEqual(['Самира Риск']);
    expect(await expectSegmentNames('LOST')).toEqual(['Марат Потерян']);
    expect(await expectSegmentNames('NO_SHOW_RISK')).toEqual(['Тимур Неявка']);
    expect(await expectSegmentNames('BLOCKED')).toEqual(['Заблокированный']);

    // Filter by tag + sort by totalSpent
    const byTag = await request(app)
      .get('/api/v1/clients')
      .set(authA)
      .query({ tagId: vipTag.id })
      .expect(200);
    expect((byTag.body as { data: Array<{ id: string }> }).data.map((c) => c.id)).toEqual([
      cVip.id,
    ]);

    const sorted = await request(app)
      .get('/api/v1/clients')
      .set(authA)
      .query({ sort: 'totalSpent' })
      .expect(200);
    expect((sorted.body as { data: Array<{ id: string }> }).data[0]?.id).toBe(cVip.id);
  });

  it('previews and executes client merge preserving appointment history, tags, notes, and freeing source phone', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const ownerA = await registerCompanyOwner({
      companyName: 'Merge Salon',
      email: 'merge-a@example.test',
    });
    const ownerB = await registerCompanyOwner({
      companyName: 'Other Merge',
      email: 'merge-b@example.test',
    });
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    const svc = await createServiceFactory(ownerA.company.id, {
      name: 'Борода',
      price: '600.00',
      durationMin: 30,
    });

    const source = await prisma.client.create({
      data: {
        companyId: ownerA.company.id,
        name: 'Асан Дубль',
        phone: '+996555300001',
        notes: 'Любит кофе',
        isBlocked: true,
        blockedAt: DateTime.fromISO('2026-11-10T10:00:00Z').toJSDate(),
      },
    });
    const target = await prisma.client.create({
      data: {
        companyId: ownerA.company.id,
        name: 'Асан Основной',
        phone: '+996555300002',
        notes: 'Постоянный гость',
      },
    });

    const tagSourceRes = await request(app)
      .post('/api/v1/clients/tags')
      .set(authA)
      .send({ name: 'Из дубля' })
      .expect(201);
    const tagTargetRes = await request(app)
      .post('/api/v1/clients/tags')
      .set(authA)
      .send({ name: 'Основной тег' })
      .expect(201);
    const tagSourceId = (tagSourceRes.body as { data: { id: string } }).data.id;
    const tagTargetId = (tagTargetRes.body as { data: { id: string } }).data.id;

    await request(app)
      .put(`/api/v1/clients/${source.id}/tags`)
      .set(authA)
      .send({ tagIds: [tagSourceId] })
      .expect(200);
    await request(app)
      .put(`/api/v1/clients/${target.id}/tags`)
      .set(authA)
      .send({ tagIds: [tagTargetId] })
      .expect(200);

    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svc.id,
      clientName: source.name,
      clientPhone: source.phone,
      startAt: DateTime.fromISO('2026-11-12T10:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-12T10:30:00Z').toJSDate(),
      price: '600.00',
      status: 'COMPLETED',
    });
    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svc.id,
      clientName: target.name,
      clientPhone: target.phone,
      startAt: DateTime.fromISO('2026-11-22T10:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-22T10:30:00Z').toJSDate(),
      price: '600.00',
      status: 'CONFIRMED',
    });

    // Cross-tenant merge preview must 404
    await request(app)
      .post('/api/v1/clients/merge/preview')
      .set(authB)
      .send({ sourceClientId: source.id, targetClientId: target.id })
      .expect(404);

    // Preview does not mutate DB
    const previewRes = await request(app)
      .post('/api/v1/clients/merge/preview')
      .set(authA)
      .send({ sourceClientId: source.id, targetClientId: target.id, notesStrategy: 'CONCAT' })
      .expect(200);
    const preview = (
      previewRes.body as {
        data: {
          appointmentsToMove: number;
          resultingIsBlocked: boolean;
          resultingNotes: string;
          warnings: string[];
          resultingTags: Array<{ id: string }>;
        };
      }
    ).data;
    expect(preview.appointmentsToMove).toBe(1);
    expect(preview.resultingIsBlocked).toBe(true);
    expect(preview.resultingNotes).toBe('Постоянный гость\n\nЛюбит кофе');
    expect(preview.warnings).toContain('SOURCE_BLOCKED');
    expect(preview.resultingTags.map((t) => t.id).sort()).toEqual(
      [tagSourceId, tagTargetId].sort(),
    );

    // Source is still unmerged after preview
    await request(app).get(`/api/v1/clients/${source.id}`).set(authA).expect(200);

    // Execute merge
    const execRes = await request(app)
      .post('/api/v1/clients/merge')
      .set(authA)
      .send({
        sourceClientId: source.id,
        targetClientId: target.id,
        notesStrategy: 'CONCAT',
        confirm: true,
      })
      .expect(200);
    expect(
      (execRes.body as { data: { movedAppointmentsCount: number } }).data.movedAppointmentsCount,
    ).toBe(1);

    // Source is now 404 on detail/update & excluded from list
    await request(app).get(`/api/v1/clients/${source.id}`).set(authA).expect(404);
    await request(app)
      .patch(`/api/v1/clients/${source.id}`)
      .set(authA)
      .send({ name: 'Should fail' })
      .expect(404);

    const targetDetail = await request(app)
      .get(`/api/v1/clients/${target.id}`)
      .set(authA)
      .expect(200);
    const detailData = (
      targetDetail.body as {
        data: {
          client: {
            isBlocked: boolean;
            notes: string;
            tags: Array<{ id: string }>;
            stats: { visits: number; nextAppointmentAt: string | null };
          };
          appointments: Array<{ id: string }>;
        };
      }
    ).data;
    expect(detailData.client.isBlocked).toBe(true);
    expect(detailData.client.notes).toBe('Постоянный гость\n\nЛюбит кофе');
    expect(detailData.client.tags.map((t) => t.id).sort()).toEqual(
      [tagSourceId, tagTargetId].sort(),
    );
    expect(detailData.appointments).toHaveLength(2);
    expect(detailData.client.stats.visits).toBe(1);
    expect(detailData.client.stats.nextAppointmentAt).toBeTruthy();

    // Old phone was freed on source row and can be re-created cleanly if booked later
    const recreated = await request(app)
      .post('/api/v1/clients')
      .set(authA)
      .send({ name: 'Новый по освобождённому номеру', phone: '+996555300001' })
      .expect(201);
    expect((recreated.body as { data: { id: string } }).data.id).not.toBe(source.id);

    const mergeAudit = await prisma.auditLog.findFirst({
      where: { companyId: ownerA.company.id, action: 'client.merge', entityId: target.id },
    });
    expect(mergeAudit).toBeTruthy();
  });

  it('previews and executes CSV import with tenant isolation and duplicate strategies', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const ownerA = await registerCompanyOwner({
      companyName: 'Import A',
      email: 'imp-a@example.test',
    });
    const ownerB = await registerCompanyOwner({
      companyName: 'Import B',
      email: 'imp-b@example.test',
    });
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    // Pre-existing client in Company A (empty notes) and Company B (same phone as import row)
    await request(app)
      .post('/api/v1/clients')
      .set(authA)
      .send({ name: 'Существующий', phone: '+996555400001' })
      .expect(201);
    await request(app)
      .post('/api/v1/clients')
      .set(authB)
      .send({ name: 'Чужой в Бета', phone: '+996555400002', notes: 'Не должно мешать Альфе' })
      .expect(201);

    const csvText = [
      '\uFEFFИмя;Телефон;Теги;Заметки',
      'Существующий;0555 400 001;Постоянный;Пришла с акции',
      'Новая Клиентка;0555 400 002;VIP | Борода;"Любит кофе, утро"',
      'Неверный Номер;12345;;',
      'Дубликат В Файле;+996555400002;;',
    ].join('\n');

    // Preview does not write anything
    const previewRes = await request(app)
      .post('/api/v1/clients/import/preview')
      .set(authA)
      .send({ csvText, duplicateStrategy: 'MERGE_TAGS' })
      .expect(200);
    const preview = (
      previewRes.body as {
        data: {
          summary: { create: number; update: number; skip: number; error: number };
          newTagsToCreate: string[];
        };
      }
    ).data;
    expect(preview.summary).toEqual({ create: 1, update: 1, skip: 0, error: 2 });
    expect(preview.newTagsToCreate).toEqual(['Постоянный', 'VIP', 'Борода']);

    const countBeforeExec = await prisma.client.count({
      where: { companyId: ownerA.company.id },
    });
    expect(countBeforeExec).toBe(1);

    // Execute import
    const execRes = await request(app)
      .post('/api/v1/clients/import')
      .set(authA)
      .send({ csvText, duplicateStrategy: 'MERGE_TAGS', confirm: true })
      .expect(200);
    const execData = (
      execRes.body as {
        data: {
          totalRows: number;
          created: number;
          updated: number;
          skipped: number;
          errorCount: number;
        };
      }
    ).data;
    expect(execData).toMatchObject({
      totalRows: 4,
      created: 1,
      updated: 1,
      skipped: 0,
      errorCount: 2,
    });

    // Verify Company B client is untouched
    const listB = await request(app).get('/api/v1/clients').set(authB).expect(200);
    expect((listB.body as { data: Array<{ name: string }> }).data).toHaveLength(1);
    expect(
      (listB.body as { data: Array<{ name: string; tags: unknown[] }> }).data[0],
    ).toMatchObject({
      name: 'Чужой в Бета',
      tags: [],
    });
  });

  it('performs global search, computes CRM analytics, and exports escaped CSV', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const ownerA = await registerCompanyOwner({
      companyName: 'Analytics Co A',
      email: 'crm-ana-a@example.test',
    });
    const ownerB = await registerCompanyOwner({
      companyName: 'Analytics Co B',
      email: 'crm-ana-b@example.test',
    });

    // Enable analytics on ownerA's plan
    const plan = await prisma.plan.create({
      data: {
        code: `crm-p3-${Date.now()}`,
        name: 'CRM Business Plan',
        priceMonthly: 2000,
        maxStaff: 10,
        featureAnalytics: true,
        featureAutoReminders: true,
        featurePrepayment: true,
        isPublic: false,
        isActive: true,
      },
    });
    await prisma.subscription.update({
      where: { companyId: ownerA.company.id },
      data: { planId: plan.id },
    });

    // Invite a manager in Company A
    const inviteRes = await request(app)
      .post('/api/v1/staff/invite')
      .set({ Authorization: `Bearer ${ownerA.accessToken}` })
      .send({ name: 'Менеджер Салтанат', email: 'mgr-crm@example.test', role: 'MANAGER' })
      .expect(201);
    const inviteToken = new URL((inviteRes.body as { data: { url: string } }).data.url).hash.slice(
      1,
    );
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, newPassword: 'Password123!' })
      .expect(204);
    const mgrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'mgr-crm@example.test', password: 'Password123!' })
      .expect(200);
    const mgrToken = (mgrLogin.body as { data: { accessToken: string } }).data.accessToken;

    const svcA = await createServiceFactory(ownerA.company.id, {
      name: 'Премиум укладка',
      price: '1500.00',
      durationMin: 60,
    });
    const svcB = await createServiceFactory(ownerB.company.id, {
      name: 'Премиум чужой',
      price: '999.00',
      durationMin: 30,
    });

    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };

    const clientA = await prisma.client.create({
      data: {
        companyId: ownerA.company.id,
        name: '=SUM(1+1) Формула',
        phone: '+996555600001',
      },
    });
    const clientB = await prisma.client.create({
      data: {
        companyId: ownerB.company.id,
        name: 'Формула Бета',
        phone: '+996555600002',
      },
    });

    const vipTagRes = await request(app)
      .post('/api/v1/clients/tags')
      .set(authA)
      .send({ name: 'Золотая карта' })
      .expect(201);
    const goldTagId = (vipTagRes.body as { data: { id: string } }).data.id;
    await request(app)
      .put(`/api/v1/clients/${clientA.id}/tags`)
      .set(authA)
      .send({ tagIds: [goldTagId] })
      .expect(200);

    // 1 prior visit + 1 current period visit for retention rate = 100%
    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svcA.id,
      clientName: clientA.name,
      clientPhone: clientA.phone,
      startAt: DateTime.fromISO('2026-10-15T10:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-10-15T11:00:00Z').toJSDate(),
      price: '1500.00',
      status: 'COMPLETED',
    });
    await createAppointmentFactory({
      companyId: ownerA.company.id,
      masterId: ownerA.user.id,
      serviceId: svcA.id,
      clientName: clientA.name,
      clientPhone: clientA.phone,
      startAt: DateTime.fromISO('2026-11-18T10:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-18T11:00:00Z').toJSDate(),
      price: '1500.00',
      status: 'COMPLETED',
    });
    await createAppointmentFactory({
      companyId: ownerB.company.id,
      masterId: ownerB.user.id,
      serviceId: svcB.id,
      clientName: clientB.name,
      clientPhone: clientB.phone,
      startAt: DateTime.fromISO('2026-11-18T10:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-18T10:30:00Z').toJSDate(),
      price: '999.00',
      status: 'COMPLETED',
    });

    // Global search by client tag & tenant isolation
    const searchByTag = await request(app)
      .get('/api/v1/search')
      .set(authA)
      .query({ q: 'Золотая' })
      .expect(200);
    expect(
      (searchByTag.body as { data: { clients: Array<{ id: string }> } }).data.clients,
    ).toHaveLength(1);

    const searchCross = await request(app)
      .get('/api/v1/search')
      .set(authA)
      .query({ q: 'Премиум' })
      .expect(200);
    const serviceNames = (
      searchCross.body as { data: { services: Array<{ name: string }> } }
    ).data.services.map((s) => s.name);
    expect(serviceNames).toEqual(['Премиум укладка']);

    // MANAGER search sees bookable staff without PII email/phone
    const mgrSearch = await request(app)
      .get('/api/v1/search')
      .set({ Authorization: `Bearer ${mgrToken}` })
      .query({ q: 'Владелец' })
      .expect(200);
    expect(
      (mgrSearch.body as { data: { staff: Array<{ email: string | null; phone: string | null }> } })
        .data.staff[0],
    ).toMatchObject({ email: null, phone: null });

    // CRM analytics
    const crmRes = await request(app)
      .get('/api/v1/analytics/crm')
      .set(authA)
      .query({ from: '2026-11-01', to: '2026-11-19' })
      .expect(200);
    const crmData = (
      crmRes.body as {
        data: {
          revenueBasis: string;
          retentionRate: number;
          repeatRate: number;
          segments: { totalActive: number; repeatClients: number };
          topClients: Array<{ id: string; visits: number; completedValue: string }>;
          byTag: Array<{
            tagId: string;
            clientCount: number;
            visitsInPeriod: number;
            completedValueInPeriod: string;
          }>;
        };
      }
    ).data;
    expect(crmData).toMatchObject({
      revenueBasis: 'COMPLETED_VISITS_ESTIMATE',
      retentionRate: 100,
      repeatRate: 100,
      segments: {
        totalActive: 1,
        repeatClients: 1,
      },
    });
    expect(crmData.topClients[0]).toMatchObject({
      id: clientA.id,
      visits: 1,
      completedValue: '1500.00',
    });
    expect(crmData.byTag[0]).toMatchObject({
      tagId: goldTagId,
      clientCount: 1,
      visitsInPeriod: 1,
      completedValueInPeriod: '1500.00',
    });

    // CSV export escapes formula injection
    const csvRes = await request(app).get('/api/v1/export/clients.csv').set(authA).expect(200);
    expect(csvRes.text).toContain("'=SUM(1+1) Формула");
    expect(csvRes.text).toContain('Золотая карта');
  });
});
