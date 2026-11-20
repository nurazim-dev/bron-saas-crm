import { prisma } from '../../lib/prisma.js';
import { now } from '../../lib/clock.js';
import { addDurationMsUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import type { ProfileInput, MediaEdit } from './media.schemas.js';
import { processMedia } from './media-process.js';
const notFound = () => new AppError('NOT_FOUND', 404, 'Материал или мастер не найден');
const mediaSelect = {
  id: true,
  kind: true,
  status: true,
  position: true,
  isCover: true,
  caption: true,
  mime: true,
  size: true,
} as const;
let processors = 0;
export async function assertMediaOwner(companyId: string, userId: string) {
  if (!(await prisma.user.findFirst({ where: { id: userId, companyId } }))) throw notFound();
}
export async function getProfile(companyId: string, userId: string) {
  await assertMediaOwner(companyId, userId);
  return prisma.user.findFirstOrThrow({
    where: { id: userId, companyId },
    select: {
      id: true,
      name: true,
      biography: true,
      specialties: true,
      experienceYears: true,
      portfolio: {
        where: { companyId, status: 'READY' },
        select: mediaSelect,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
}
export async function saveProfile(companyId: string, userId: string, input: ProfileInput) {
  await assertMediaOwner(companyId, userId);
  await prisma.user.update({ where: { id: userId, companyId }, data: input });
  return getProfile(companyId, userId);
}
export async function uploadMedia(
  companyId: string,
  userId: string,
  kind: string,
  input: Buffer,
  mime: string,
) {
  await assertMediaOwner(companyId, userId);
  if (processors >= 2)
    throw new AppError('RATE_LIMITED', 429, 'Обработка занята. Повторите позже.');
  processors++;
  let id: string | undefined;
  try {
    const reserved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId}::uuid FOR UPDATE`;
      // Recover crashed requests; no unvalidated source bytes are persisted.
      await tx.staffMedia.deleteMany({
        where: {
          companyId,
          status: { in: ['REJECTED', 'PENDING'] },
          createdAt: { lt: addDurationMsUtc(now(), -5 * 60_000) },
        },
      });
      const pending = await tx.staffMedia.count({ where: { companyId, status: 'PENDING' } });
      const count = await tx.staffMedia.count({
        where: {
          companyId,
          userId,
          status: 'READY',
          ...(kind === 'PHOTO' ? { kind: { not: 'PHOTO' } } : {}),
        },
      });
      const total = await tx.staffMedia.aggregate({
        where: { companyId, status: 'READY' },
        _sum: { size: true },
        _count: true,
      });
      if (
        pending ||
        count >= 12 ||
        total._count >= 200 ||
        (total._sum.size ?? 0) + 25 * 1024 * 1024 > 100 * 1024 * 1024
      )
        throw new AppError(
          'PLAN_LIMIT_REACHED',
          409,
          'Лимит: 12 материалов на мастера, 100 МБ на компанию. Удалите лишние материалы или дождитесь обработки.',
        );
      return tx.staffMedia.create({
        data: { companyId, userId, kind, position: count },
        select: { id: true },
      });
    });
    id = reserved.id;
    const processed = await processMedia(input, kind, mime);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId}::uuid FOR UPDATE`;
      if (!(await tx.user.findFirst({ where: { id: userId, companyId, deletedAt: null } })))
        throw notFound();
      if (kind === 'PHOTO')
        await tx.staffMedia.deleteMany({
          where: { companyId, userId, kind: 'PHOTO', status: 'READY' },
        });
      await tx.staffMedia.update({
        where: { id: reserved.id, companyId, userId },
        data: {
          ...processed,
          size: processed.data.length + processed.poster.length,
          status: 'READY',
        },
      });
    });
    return getProfile(companyId, userId);
  } catch (e) {
    if (id)
      await prisma.staffMedia.deleteMany({ where: { id, companyId, userId, status: 'PENDING' } });
    throw e;
  } finally {
    processors--;
  }
}
export async function editMedia(companyId: string, userId: string, id: string, input: MediaEdit) {
  await assertMediaOwner(companyId, userId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    if (!(await tx.staffMedia.findFirst({ where: { id, companyId, userId, status: 'READY' } })))
      throw notFound();
    if (input.isCover)
      await tx.staffMedia.updateMany({ where: { companyId, userId }, data: { isCover: false } });
    await tx.staffMedia.update({ where: { id, companyId, userId }, data: input });
  });
  return getProfile(companyId, userId);
}
export async function deleteMedia(companyId: string, userId: string, id: string) {
  await assertMediaOwner(companyId, userId);
  const result = await prisma.staffMedia.deleteMany({ where: { id, companyId, userId } });
  if (!result.count) throw notFound();
}
export async function readMedia(companyId: string, userId: string, id: string, poster: boolean) {
  const item = await prisma.staffMedia.findFirst({
    where: { id, companyId, userId, status: 'READY' },
    select: { poster: true, data: true, mime: true },
  });
  const bytes = item && (poster ? item.poster : item.data);
  if (!bytes) throw notFound();
  return { data: Buffer.from(bytes), mime: poster ? 'image/webp' : item.mime };
}
export async function readPublicMedia(slug: string, userId: string, id: string, poster: boolean) {
  const company = await prisma.company.findFirst({
    where: { slug, publicBookingEnabled: true, suspendedAt: null },
    select: { id: true },
  });
  if (
    !company ||
    !(await prisma.user.findFirst({
      where: { id: userId, companyId: company.id, isActive: true, isBookable: true },
    }))
  )
    throw notFound();
  return readMedia(company.id, userId, id, poster);
}
