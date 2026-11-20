import { z } from 'zod';
import { sanitizeText } from '../../lib/phone.js';

export const CLIENT_SEGMENTS = [
  'ALL',
  'NEW',
  'REPEAT',
  'VIP',
  'AT_RISK',
  'LOST',
  'NO_SHOW_RISK',
  'BLOCKED',
] as const;

export type ClientSegment = (typeof CLIENT_SEGMENTS)[number];

export const clientIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const tagIdParamsSchema = z.object({
  tagId: z.string().uuid(),
});

const listFilterBaseSchema = z.object({
  search: z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(z.string().max(100))
    .optional(),
  blocked: z.enum(['true', 'false']).optional(),
  tagId: z.string().uuid().optional(),
  segment: z.enum(CLIENT_SEGMENTS).optional(),
  minVisits: z.coerce.number().int().min(0).max(10000).optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export const listClientsQuerySchema = listFilterBaseSchema.extend({
  sort: z.enum(['lastVisit', 'visits', 'noShows', 'name', 'totalSpent']).default('lastVisit'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportClientsQuerySchema = listFilterBaseSchema;

export const getClientDetailQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createClientSchema = z.object({
  name: z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(z.string().min(2).max(100)),
  phone: z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(z.string().min(5).max(30)),
  notes: z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(z.string().max(1000))
    .nullable()
    .optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
});

export const updateClientSchema = z
  .object({
    name: z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().min(2).max(100))
      .optional(),
    notes: z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().max(1000))
      .nullable()
      .optional(),
    isBlocked: z.boolean().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.notes !== undefined || data.isBlocked !== undefined,
    { message: 'At least one field must be provided' },
  );

export const anonymizeClientSchema = z.object({
  confirm: z.literal(true),
});

const tagColorRegex = /^#[0-9a-fA-F]{6}$/;

export const createClientTagSchema = z.object({
  name: z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(z.string().min(1).max(40)),
  color: z.string().trim().regex(tagColorRegex, 'Color must be hex #RRGGBB').default('#0f766e'),
});

export const updateClientTagSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: z.string().trim().regex(tagColorRegex, 'Color must be hex #RRGGBB').optional(),
  })
  .refine((data) => data.name !== undefined || data.color !== undefined, {
    message: 'At least one field must be provided',
  });

export const setClientTagsSchema = z.object({
  tagIds: z
    .array(z.string().uuid())
    .max(20)
    .transform((ids) => Array.from(new Set(ids))),
});

export const mergeClientsPreviewSchema = z
  .object({
    sourceClientId: z.string().uuid(),
    targetClientId: z.string().uuid(),
    notesStrategy: z.enum(['CONCAT', 'KEEP_TARGET', 'KEEP_SOURCE']).default('CONCAT'),
  })
  .refine((data) => data.sourceClientId !== data.targetClientId, {
    message: 'sourceClientId and targetClientId must differ',
  });

export const mergeClientsExecuteSchema = z
  .object({
    sourceClientId: z.string().uuid(),
    targetClientId: z.string().uuid(),
    notesStrategy: z.enum(['CONCAT', 'KEEP_TARGET', 'KEEP_SOURCE']).default('CONCAT'),
    confirm: z.literal(true),
  })
  .refine((data) => data.sourceClientId !== data.targetClientId, {
    message: 'sourceClientId and targetClientId must differ',
  });

export const importClientsPreviewSchema = z.object({
  csvText: z.string().trim().min(1).max(90000),
  duplicateStrategy: z.enum(['SKIP', 'UPDATE_EMPTY', 'MERGE_TAGS']).default('SKIP'),
});

export const importClientsExecuteSchema = importClientsPreviewSchema.extend({
  confirm: z.literal(true),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type ExportClientsQuery = z.infer<typeof exportClientsQuerySchema>;
export type GetClientDetailQuery = z.infer<typeof getClientDetailQuerySchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type CreateClientTagInput = z.infer<typeof createClientTagSchema>;
export type UpdateClientTagInput = z.infer<typeof updateClientTagSchema>;
export type SetClientTagsInput = z.infer<typeof setClientTagsSchema>;
export type MergeClientsPreviewInput = z.infer<typeof mergeClientsPreviewSchema>;
export type MergeClientsExecuteInput = z.infer<typeof mergeClientsExecuteSchema>;
export type ImportClientsPreviewInput = z.infer<typeof importClientsPreviewSchema>;
export type ImportClientsExecuteInput = z.infer<typeof importClientsExecuteSchema>;
