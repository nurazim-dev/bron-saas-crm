import request from 'supertest';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Role } from '../../src/generated/prisma/client.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';
const app = createApp();
async function fixture() {
  const company = await createCompanyFactory();
  const plan = await prisma.plan.upsert({
    where: { code: 'media-test' },
    update: { isPublic: false },
    create: {
      code: 'media-test',
      name: 'Media test',
      isPublic: false,
      priceMonthly: 1000,
      maxStaff: 10,
    },
  });
  await prisma.subscription.create({
    data: {
      companyId: company.id,
      planId: plan.id,
      status: 'TRIAL',
      isTrial: true,
      periodStartsAt: new Date(),
      periodEndsAt: new Date(Date.now() + 86400000),
    },
  });
  const owner = await createUserFactory(company.id, { role: Role.OWNER });
  const master = await createUserFactory(company.id);
  const token = (user: typeof owner) =>
    signAccessToken({
      sub: user.id,
      companyId: company.id,
      role: user.role,
      tv: user.tokenVersion,
    });
  const base = `/api/v1/staff/${master.id}`;
  const photo = await sharp({
    create: { width: 80, height: 80, channels: 3, background: '#12634b' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const upload = (kind = 'PHOTO', data = photo, mime = 'image/jpeg') =>
    request(app)
      .post(`${base}/media/upload/${kind}`)
      .auth(token(owner), { type: 'bearer' })
      .set('Content-Type', mime)
      .send(data);
  return { company, owner, master, token, base, photo, upload };
}
describe('owner portfolio: validation and tenant isolation', () => {
  beforeEach(truncateAllTables);
  afterEach(async () => {
    await truncateAllTables();
    await prisma.plan.deleteMany({ where: { code: 'media-test' } });
  });
  it('requires a valid owner and conceals foreign profiles', async () => {
    const f = await fixture();
    expect((await request(app).get(`${f.base}/profile`)).status).toBe(401);
    expect(
      (await request(app).get(`${f.base}/profile`).auth(f.token(f.master), { type: 'bearer' }))
        .status,
    ).toBe(403);
    const other = await createCompanyFactory();
    const stranger = await createUserFactory(other.id);
    expect(
      (
        await request(app)
          .get(`/api/v1/staff/${stranger.id}/profile`)
          .auth(f.token(f.owner), { type: 'bearer' })
      ).status,
    ).toBe(404);
  });
  it('decodes and sanitizes images, replaces photos and revokes deleted public URLs', async () => {
    const f = await fixture();
    const result = await f.upload();
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const id =
      (result.body as { data: { portfolio: { id: string }[] } }).data.portfolio[0]?.id ?? '';
    const item = await prisma.staffMedia.findUniqueOrThrow({ where: { id } });
    const meta = await sharp(Buffer.from(item.data ?? [])).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    const url = `/api/v1/public/companies/${f.company.slug}/masters/${f.master.id}/media/${id}`;
    expect((await request(app).get(url)).status).toBe(200);
    const replacement = await f.upload();
    expect(replacement.status).toBe(201);
    expect((await request(app).get(url)).status).toBe(404);
    expect(await prisma.staffMedia.count({ where: { companyId: f.company.id } })).toBe(1);
    const nextId =
      (replacement.body as { data: { portfolio: { id: string }[] } }).data.portfolio[0]?.id ?? '';
    expect(
      (
        await request(app)
          .delete(`${f.base}/media/${nextId}`)
          .auth(f.token(f.owner), { type: 'bearer' })
      ).status,
    ).toBe(204);
    expect(await prisma.staffMedia.count({ where: { companyId: f.company.id } })).toBe(0);
  });
  it('rejects spoofed, corrupt and oversized images without leaving reservations', async () => {
    const f = await fixture();
    for (const response of [
      await f.upload('WORK', Buffer.from('<svg onload="alert(1)"/>')),
      await f.upload('WORK', f.photo, 'image/png'),
      await f.upload('WORK', Buffer.alloc(8 * 1024 * 1024 + 1)),
    ]) {
      expect(response.status, JSON.stringify(response.body)).toBe(422);
    }
    expect(await prisma.staffMedia.count({ where: { companyId: f.company.id } })).toBe(0);
  });
  it('enforces quota before processing and isolates mutation and binary reads', async () => {
    const f = await fixture();
    await prisma.staffMedia.createMany({
      data: Array.from({ length: 12 }, (_, position) => ({
        companyId: f.company.id,
        userId: f.master.id,
        kind: 'WORK',
        status: 'READY',
        position,
      })),
    });
    expect((await f.upload('WORK')).status).toBe(409);
    const other = await createCompanyFactory();
    const user = await createUserFactory(other.id);
    const item = await prisma.staffMedia.create({
      data: { companyId: other.id, userId: user.id, kind: 'WORK', status: 'READY', data: f.photo },
    });
    expect(
      (
        await request(app)
          .patch(`${f.base}/media/${item.id}`)
          .auth(f.token(f.owner), { type: 'bearer' })
          .send({ isCover: true })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${f.base}/media/${item.id}`)
          .auth(f.token(f.owner), { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app).get(
          `/api/v1/public/companies/${f.company.slug}/masters/${user.id}/media/${item.id}`,
        )
      ).status,
    ).toBe(404);
  });
  it('publishes only ready media and whitelisted profile fields, with one cover', async () => {
    const f = await fixture();
    const service = await createServiceFactory(f.company.id);
    await prisma.masterService.create({ data: { userId: f.master.id, serviceId: service.id } });
    await prisma.workingHours.create({
      data: { userId: f.master.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    });
    await request(app)
      .patch(`${f.base}/profile`)
      .auth(f.token(f.owner), { type: 'bearer' })
      .send({ biography: 'О мастере', specialties: 'Стрижки', experienceYears: 7 })
      .expect(200);
    const first = await f.upload('WORK');
    const second = await f.upload('WORK');
    const firstId =
      (first.body as { data: { portfolio: { id: string }[] } }).data.portfolio[0]?.id ?? '';
    const secondId =
      (second.body as { data: { portfolio: { id: string }[] } }).data.portfolio[1]?.id ?? '';
    for (const id of [firstId, secondId])
      await request(app)
        .patch(`${f.base}/media/${id}`)
        .auth(f.token(f.owner), { type: 'bearer' })
        .send({ isCover: true })
        .expect(200);
    expect(
      await prisma.staffMedia.count({
        where: { companyId: f.company.id, userId: f.master.id, isCover: true },
      }),
    ).toBe(1);
    const pending = await prisma.staffMedia.create({
      data: { companyId: f.company.id, userId: f.master.id, kind: 'WORK' },
    });
    await request(app)
      .get(`/api/v1/public/companies/${f.company.slug}/masters/${f.master.id}/media/${pending.id}`)
      .expect(404);
    const response = await request(app)
      .get(`/api/v1/public/companies/${f.company.slug}`)
      .expect(200);
    const body = response.body as { data: { masters: Record<string, unknown>[] } };
    const master = body.data.masters[0];
    expect(master).toMatchObject({ biography: 'О мастере', experienceYears: 7 });
    for (const key of [
      'email',
      'phone',
      'passwordHash',
      'tokenVersion',
      'telegramChatId',
      'companyId',
    ])
      expect(master).not.toHaveProperty(key);
    expect(JSON.stringify(master)).not.toContain(pending.id);
    await prisma.user.update({
      where: { id: f.master.id, companyId: f.company.id },
      data: { isActive: false },
    });
    await request(app)
      .get(`/api/v1/public/companies/${f.company.slug}/masters/${f.master.id}/media/${firstId}`)
      .expect(404);
  });
});
