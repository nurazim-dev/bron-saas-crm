import { z } from 'zod';
export const profileParams = z.object({ id: z.uuid() });
export const mediaParams = profileParams.extend({ mediaId: z.uuid() });
export const uploadParams = profileParams.extend({ kind: z.enum(['PHOTO', 'WORK', 'VIDEO']) });
export const publicMediaParams = mediaParams.extend({ slug: z.string().min(1).max(100) });
export const profileSchema = z
  .object({
    biography: z.string().trim().max(1500),
    specialties: z.string().trim().max(300),
    experienceYears: z.number().int().min(0).max(80).nullable(),
  })
  .strict();
export const mediaEditSchema = z
  .object({
    caption: z.string().trim().max(200).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    isCover: z.boolean().optional(),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileSchema>;
export type MediaEdit = z.infer<typeof mediaEditSchema>;
