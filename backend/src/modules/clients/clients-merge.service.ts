import { Prisma } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { MergeClientsExecuteInput, MergeClientsPreviewInput } from './clients.schemas.js';
import type { ClientTagDto } from './clients-tags.service.js';

interface LockedClientRow {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  notes: string | null;
  isBlocked: boolean;
  blockedAt: Date | null;
  anonymizedAt: Date | null;
  mergedAt: Date | null;
}

export interface ClientMergePreviewDto {
  source: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    isBlocked: boolean;
    totalAppointments: number;
    tags: ClientTagDto[];
  };
  target: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    isBlocked: boolean;
    totalAppointments: number;
    tags: ClientTagDto[];
  };
  appointmentsToMove: number;
  resultingNotes: string | null;
  resultingIsBlocked: boolean;
  resultingTags: ClientTagDto[];
  warnings: string[];
}

export function mergeClientNotes(
  sourceNotes: string | null,
  targetNotes: string | null,
  strategy: 'CONCAT' | 'KEEP_TARGET' | 'KEEP_SOURCE',
): string | null {
  const s = sourceNotes?.trim() || null;
  const t = targetNotes?.trim() || null;
  if (strategy === 'KEEP_TARGET') return t;
  if (strategy === 'KEEP_SOURCE') return s;
  if (t && s) {
    return t === s ? t : `${t}\n\n${s}`;
  }
  return t ?? s;
}

function assertPairMergeable(
  source: LockedClientRow | undefined,
  target: LockedClientRow | undefined,
): asserts source is LockedClientRow {
  if (!source || !target) {
    throw new AppError('NOT_FOUND', 404, 'Client not found');
  }
  if (source.mergedAt || target.mergedAt) {
    throw new AppError('CONFLICT', 409, 'Already merged client cannot be merged again');
  }
  if (source.anonymizedAt || target.anonymizedAt) {
    throw new AppError('CONFLICT', 409, 'Anonymized client cannot be merged');
  }
}

function unionTags(a: ClientTagDto[], b: ClientTagDto[]): ClientTagDto[] {
  const map = new Map<string, ClientTagDto>();
  for (const tag of [...a, ...b]) {
    if (!map.has(tag.id)) map.set(tag.id, tag);
  }
  return Array.from(map.values()).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
}

export async function previewClientMerge(
  actor: AuthenticatedActor,
  input: MergeClientsPreviewInput,
): Promise<ClientMergePreviewDto> {
  const [clients, assignmentRows, appointmentCounts] = await Promise.all([
    prisma.client.findMany({
      where: {
        companyId: actor.companyId,
        id: { in: [input.sourceClientId, input.targetClientId] },
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        phone: true,
        notes: true,
        isBlocked: true,
        blockedAt: true,
        anonymizedAt: true,
        mergedAt: true,
      },
    }),
    prisma.clientTagAssignment.findMany({
      where: {
        companyId: actor.companyId,
        clientId: { in: [input.sourceClientId, input.targetClientId] },
      },
      include: { tag: { select: { id: true, name: true, color: true } } },
    }),
    prisma.$queryRaw<
      Array<{ client_id: string; total_cnt: bigint; upcoming_cnt: bigint }>
    >(Prisma.sql`
      SELECT
        a."clientId" AS client_id,
        COUNT(*)::bigint AS total_cnt,
        COUNT(*) FILTER (
          WHERE a."deletedAt" IS NULL
            AND a."status" IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS')
            AND a."startAt" >= ${now()}
        )::bigint AS upcoming_cnt
      FROM "Appointment" a
      WHERE a."companyId" = ${actor.companyId}::uuid
        AND a."clientId" IN (${input.sourceClientId}::uuid, ${input.targetClientId}::uuid)
      GROUP BY a."clientId"
    `),
  ]);

  const source = clients.find((c) => c.id === input.sourceClientId);
  const target = clients.find((c) => c.id === input.targetClientId);
  assertPairMergeable(source, target);
  if (!target) {
    throw new AppError('NOT_FOUND', 404, 'Client not found');
  }

  const countByClient = new Map(
    appointmentCounts.map((r) => [
      r.client_id,
      { total: Number(r.total_cnt), upcoming: Number(r.upcoming_cnt) },
    ]),
  );

  const sourceTags = assignmentRows
    .filter((r) => r.clientId === source.id)
    .map((r) => ({ id: r.tag.id, name: r.tag.name, color: r.tag.color }));
  const targetTags = assignmentRows
    .filter((r) => r.clientId === target.id)
    .map((r) => ({ id: r.tag.id, name: r.tag.name, color: r.tag.color }));

  const sourceCounts = countByClient.get(source.id) ?? { total: 0, upcoming: 0 };
  const targetCounts = countByClient.get(target.id) ?? { total: 0, upcoming: 0 };

  const warnings: string[] = [];
  if (source.isBlocked && !target.isBlocked) {
    warnings.push('SOURCE_BLOCKED');
  }
  if (sourceCounts.upcoming > 0) {
    warnings.push('HAS_UPCOMING_APPOINTMENTS');
  }

  return {
    source: {
      id: source.id,
      name: source.name,
      phone: source.phone,
      notes: source.notes,
      isBlocked: source.isBlocked,
      totalAppointments: sourceCounts.total,
      tags: sourceTags,
    },
    target: {
      id: target.id,
      name: target.name,
      phone: target.phone,
      notes: target.notes,
      isBlocked: target.isBlocked,
      totalAppointments: targetCounts.total,
      tags: targetTags,
    },
    appointmentsToMove: sourceCounts.total,
    resultingNotes: mergeClientNotes(source.notes, target.notes, input.notesStrategy),
    resultingIsBlocked: target.isBlocked || source.isBlocked,
    resultingTags: unionTags(targetTags, sourceTags),
    warnings,
  };
}

export async function executeClientMerge(
  actor: AuthenticatedActor,
  input: MergeClientsExecuteInput,
  auditCtx?: AuditRequestContext,
) {
  const currentTime = now();
  const [firstId, secondId] =
    input.sourceClientId < input.targetClientId
      ? [input.sourceClientId, input.targetClientId]
      : [input.targetClientId, input.sourceClientId];

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<LockedClientRow[]>(Prisma.sql`
      SELECT "id", "companyId", "name", "phone", "notes", "isBlocked", "blockedAt", "anonymizedAt", "mergedAt"
      FROM "Client"
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "id" IN (${firstId}::uuid, ${secondId}::uuid)
      ORDER BY "id" ASC
      FOR UPDATE
    `);

    const source = locked.find((c) => c.id === input.sourceClientId);
    const target = locked.find((c) => c.id === input.targetClientId);
    assertPairMergeable(source, target);
    if (!target) {
      throw new AppError('NOT_FOUND', 404, 'Client not found');
    }

    const movedAppointmentsCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "Appointment"
      SET "clientId" = ${target.id}::uuid, "updatedAt" = ${currentTime}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "clientId" = ${source.id}::uuid
    `);

    const mergedTagsCount = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ClientTagAssignment" ("clientId", "tagId", "companyId", "createdAt")
      SELECT ${target.id}::uuid, cta."tagId", ${actor.companyId}::uuid, ${currentTime}
      FROM "ClientTagAssignment" cta
      WHERE cta."companyId" = ${actor.companyId}::uuid
        AND cta."clientId" = ${source.id}::uuid
      ON CONFLICT ("clientId", "tagId") DO NOTHING
    `);

    await tx.clientTagAssignment.deleteMany({
      where: { companyId: actor.companyId, clientId: source.id },
    });

    const resultingNotes = mergeClientNotes(source.notes, target.notes, input.notesStrategy);
    const resultingIsBlocked = target.isBlocked || source.isBlocked;
    const resultingBlockedAt = target.isBlocked
      ? target.blockedAt
      : source.isBlocked
        ? (source.blockedAt ?? currentTime)
        : null;

    await tx.client.update({
      where: { id: target.id },
      data: {
        notes: resultingNotes,
        isBlocked: resultingIsBlocked,
        blockedAt: resultingBlockedAt,
        updatedAt: currentTime,
      },
    });

    await tx.client.update({
      where: { id: source.id },
      data: {
        mergedIntoClientId: target.id,
        mergedAt: currentTime,
        phone: `merged-${source.id}`,
        isBlocked: false,
        blockedAt: null,
        notes: null,
        updatedAt: currentTime,
      },
    });

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'client.merge',
      entityType: 'Client',
      entityId: target.id,
      metadata: {
        sourceClientId: source.id,
        targetClientId: target.id,
        movedAppointmentsCount,
        mergedTagsCount,
        notesStrategy: input.notesStrategy,
      },
      context: auditCtx,
    });

    return {
      targetClientId: target.id,
      sourceClientId: source.id,
      movedAppointmentsCount,
      mergedTagsCount,
    };
  });
}
