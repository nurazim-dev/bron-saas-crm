import { z } from 'zod';

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(15).default(5),
});

export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;
