import { Prisma } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type {
  CreateClientInput,
  CreateClientTagInput,
  UpdateClientTagInput,
} from './clients.schemas.js';

export interface ClientTagDto {
  id: string;
  name: string;
  color: string;
  clientCount?: number;
}

export async function listClientTags(actor: AuthenticatedActor): Promise<ClientTagDto[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; color: string; client_count: bigint }>
  >(Prisma.sql`
    SELECT
      t."id",
      t."name",
      t."color",
      COUNT(c."id")::bigint AS client_count
    FROM "ClientTag" t
    LEFT JOIN "ClientTagAssignment" cta
      ON cta."tagId" = t."id" AND cta."companyId" = t."companyId"
    LEFT JOIN "Client" c
      ON c."id" = cta."clientId" AND c."companyId" = cta."companyId" AND c."mergedAt" IS NULL
    WHERE t."companyId" = ${actor.companyId}::uuid
    GROUP BY t."id", t."name", t."color"
    ORDER BY lower(t."name") ASC, t."createdAt" ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    clientCount: Number(r.client_count),
  }));
}

export async function createClientTag(
  actor: AuthenticatedActor,
  input: CreateClientTagInput,
  auditCtx?: AuditRequestContext,
): Promise<ClientTagDto> {
  const existing = await prisma.clientTag.findFirst({
    where: {
      companyId: actor.companyId,
      name: { equals: input.name, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError('CONFLICT', 409, 'Client tag with this name already exists');
  }

  const currentTime = now();
  const created = await prisma.clientTag.create({
    data: {
      companyId: actor.companyId,
      name: input.name,
      color: input.color,
      createdAt: currentTime,
      updatedAt: currentTime,
    },
  });

  await audit(prisma, {
    actorType: 'USER',
    actorId: actor.userId,
    companyId: actor.companyId,
    action: 'client_tag.create',
    entityType: 'ClientTag',
    entityId: created.id,
    metadata: { name: created.name, color: created.color },
    context: auditCtx,
  });

  return {
    id: created.id,
    name: created.name,
    color: created.color,
    clientCount: 0,
  };
}

export async function updateClientTag(
  actor: AuthenticatedActor,
  tagId: string,
  input: UpdateClientTagInput,
  auditCtx?: AuditRequestContext,
): Promise<ClientTagDto> {
  const existing = await prisma.clientTag.findFirst({
    where: { id: tagId, companyId: actor.companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Client tag not found');
  }

  if (input.name !== undefined) {
    const conflict = await prisma.clientTag.findFirst({
      where: {
        companyId: actor.companyId,
        id: { not: existing.id },
        name: { equals: input.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new AppError('CONFLICT', 409, 'Client tag with this name already exists');
    }
  }

  const currentTime = now();
  const updated = await prisma.clientTag.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      updatedAt: currentTime,
    },
  });

  await audit(prisma, {
    actorType: 'USER',
    actorId: actor.userId,
    companyId: actor.companyId,
    action: 'client_tag.update',
    entityType: 'ClientTag',
    entityId: updated.id,
    metadata: { name: updated.name, color: updated.color },
    context: auditCtx,
  });

  return {
    id: updated.id,
    name: updated.name,
    color: updated.color,
  };
}

export async function deleteClientTag(
  actor: AuthenticatedActor,
  tagId: string,
  auditCtx?: AuditRequestContext,
): Promise<void> {
  const existing = await prisma.clientTag.findFirst({
    where: { id: tagId, companyId: actor.companyId },
    select: { id: true, name: true },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Client tag not found');
  }

  await prisma.clientTag.delete({ where: { id: existing.id } });

  await audit(prisma, {
    actorType: 'USER',
    actorId: actor.userId,
    companyId: actor.companyId,
    action: 'client_tag.delete',
    entityType: 'ClientTag',
    entityId: existing.id,
    metadata: { name: existing.name },
    context: auditCtx,
  });
}

export async function setClientTags(
  actor: AuthenticatedActor,
  clientId: string,
  tagIds: string[],
  auditCtx?: AuditRequestContext,
): Promise<ClientTagDto[]> {
  const currentTime = now();
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: clientId, companyId: actor.companyId, mergedAt: null },
      select: { id: true, anonymizedAt: true },
    });
    if (!client) {
      throw new AppError('NOT_FOUND', 404, 'Client not found');
    }
    if (client.anonymizedAt) {
      throw new AppError('CONFLICT', 409, 'Anonymized client cannot be tagged');
    }

    const tags =
      tagIds.length > 0
        ? await tx.clientTag.findMany({
            where: { companyId: actor.companyId, id: { in: tagIds } },
            orderBy: { name: 'asc' },
          })
        : [];
    if (tags.length !== tagIds.length) {
      throw new AppError('NOT_FOUND', 404, 'Client tag not found');
    }

    await tx.clientTagAssignment.deleteMany({
      where: { companyId: actor.companyId, clientId: client.id },
    });

    if (tags.length > 0) {
      await tx.clientTagAssignment.createMany({
        data: tags.map((tag) => ({
          companyId: actor.companyId,
          clientId: client.id,
          tagId: tag.id,
          createdAt: currentTime,
        })),
      });
    }

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.tags.update',
      entityType: 'Client',
      entityId: client.id,
      metadata: { tagIds: tags.map((t) => t.id) },
      context: auditCtx,
    });

    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  });
}

export async function createClientManual(
  actor: AuthenticatedActor,
  input: CreateClientInput,
  auditCtx?: AuditRequestContext,
) {
  const normalizedPhone = normalizePhoneE164(input.phone, 'phone');
  const uniqueTagIds = Array.from(new Set(input.tagIds ?? []));
  const currentTime = now();

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.client.findFirst({
      where: { companyId: actor.companyId, phone: normalizedPhone, mergedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError('CONFLICT', 409, 'Client with this phone already exists');
    }

    const tags =
      uniqueTagIds.length > 0
        ? await tx.clientTag.findMany({
            where: { companyId: actor.companyId, id: { in: uniqueTagIds } },
            orderBy: { name: 'asc' },
          })
        : [];
    if (tags.length !== uniqueTagIds.length) {
      throw new AppError('NOT_FOUND', 404, 'Client tag not found');
    }

    const created = await tx.client.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        phone: normalizedPhone,
        notes: input.notes ?? null,
        createdAt: currentTime,
        updatedAt: currentTime,
      },
    });

    if (tags.length > 0) {
      await tx.clientTagAssignment.createMany({
        data: tags.map((t) => ({
          companyId: actor.companyId,
          clientId: created.id,
          tagId: t.id,
          createdAt: currentTime,
        })),
      });
    }

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.create',
      entityType: 'Client',
      entityId: created.id,
      metadata: { phone: created.phone, tagIds: tags.map((t) => t.id) },
      context: auditCtx,
    });

    return {
      id: created.id,
      name: created.name,
      phone: created.phone,
      notes: created.notes,
      isBlocked: created.isBlocked,
      blockedAt: created.blockedAt ? created.blockedAt.toISOString() : null,
      anonymizedAt: null,
      createdAt: created.createdAt.toISOString(),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      stats: {
        visits: 0,
        noShows: 0,
        cancellations: 0,
        totalSpent: '0.00',
        lastVisitAt: null,
        nextAppointmentAt: null,
        firstSeenAt: created.createdAt.toISOString(),
      },
    };
  });
}
