import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { now as clockNow } from './clock.js';

export const SOFT_DELETE_MODELS = [
  'Company',
  'User',
  'Service',
  'ServicePackage',
  'Appointment',
] as const;
export type SoftDeleteModelName = (typeof SOFT_DELETE_MODELS)[number];

const SOFT_DELETE_MODEL_SET = new Set<string>(SOFT_DELETE_MODELS);

function isSoftDeleteModel(model: string | undefined): model is SoftDeleteModelName {
  return model !== undefined && SOFT_DELETE_MODEL_SET.has(model);
}

type WhereRecord = Record<string, unknown>;

function withNotDeletedWhere(where: unknown): WhereRecord {
  if (typeof where === 'object' && where !== null) {
    return { ...(where as WhereRecord), deletedAt: null };
  }
  return { deletedAt: null };
}

type QueryArgs = Record<string, unknown>;
type QueryFn = (args: QueryArgs) => Promise<unknown>;

function createNotFoundError(model: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `An operation failed because it depends on one or more records that were required but not found. No ${model} record was found.`,
    {
      code: 'P2025',
      clientVersion: Prisma.prismaVersion.client,
    },
  );
}

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const baseClient = new PrismaClient({ adapter });

function applySoftDeleteExtension(client: PrismaClient) {
  return client.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        async findUnique({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const result = await (query as QueryFn)(args);
          if (
            typeof result === 'object' &&
            result !== null &&
            'deletedAt' in result &&
            result.deletedAt !== null
          ) {
            return null;
          }
          return result;
        },

        async findUniqueOrThrow({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const result = await (query as QueryFn)(args);
          if (
            typeof result === 'object' &&
            result !== null &&
            'deletedAt' in result &&
            result.deletedAt !== null
          ) {
            throw createNotFoundError(model);
          }
          return result;
        },

        async findFirst({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async findFirstOrThrow({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async findMany({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async count({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async aggregate({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async groupBy({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async update({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async updateMany({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const nextArgs: QueryArgs = {
            ...(args as QueryArgs),
            where: withNotDeletedWhere((args as QueryArgs).where),
          };
          return (query as QueryFn)(nextArgs);
        },

        async delete({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const typedArgs = args as QueryArgs;
          const where = withNotDeletedWhere(typedArgs.where);
          const now = clockNow();
          const delegate = (baseClient as unknown as Record<string, Record<string, QueryFn>>)[
            model.charAt(0).toLowerCase() + model.slice(1)
          ];
          if (!delegate?.update) {
            return (query as QueryFn)(typedArgs);
          }
          const updateArgs: QueryArgs = {
            where,
            data: { deletedAt: now },
            ...(typedArgs.select !== undefined ? { select: typedArgs.select } : {}),
            ...(typedArgs.include !== undefined ? { include: typedArgs.include } : {}),
          };
          return delegate.update(updateArgs);
        },

        async deleteMany({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const typedArgs = args as QueryArgs;
          const where = withNotDeletedWhere(typedArgs.where);
          const now = clockNow();
          const delegate = (baseClient as unknown as Record<string, Record<string, QueryFn>>)[
            model.charAt(0).toLowerCase() + model.slice(1)
          ];
          if (!delegate?.updateMany) {
            return (query as QueryFn)(typedArgs);
          }
          return delegate.updateMany({
            where,
            data: { deletedAt: now },
          });
        },
      },
    },
  });
}

/**
 * Unfiltered Prisma client that sees soft-deleted rows.
 * Restricted strictly to:
 * 1. Restore flows and "email belongs to a soft-deleted user" checks
 * 2. Database seed (`prisma/seed.ts`)
 * 3. Test setup/cleanup (`tests/helpers/*`)
 */
export const prismaUnfiltered: PrismaClient = baseClient;

/**
 * Default soft-delete aware Prisma client for all application code.
 */
export const prisma = applySoftDeleteExtension(baseClient);

export async function withAdvisoryLock<T>(
  lockKey: number,
  fn: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockKey],
    );
    const acquired = res.rows[0]?.acquired === true;
    if (!acquired) {
      return { acquired: false };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export async function disconnectPrisma(): Promise<void> {
  await baseClient.$disconnect();
  await pool.end();
}
