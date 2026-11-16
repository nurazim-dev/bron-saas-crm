import { z } from 'zod';

export const clientIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listClientsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  sort: z.enum(['lastVisit', 'visits', 'noShows', 'name']).default('lastVisit'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const getClientDetailQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    isBlocked: z.boolean().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.notes !== undefined || data.isBlocked !== undefined,
    { message: 'At least one field must be provided' },
  );

export const anonymizeClientSchema = z.object({
  confirm: z.literal(true),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type GetClientDetailQuery = z.infer<typeof getClientDetailQuerySchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
