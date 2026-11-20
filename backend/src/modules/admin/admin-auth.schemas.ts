import { z } from 'zod';
import { sanitizeText } from '../../lib/phone.js';

const adminEmailSchema = z
  .string()
  .transform((val) => sanitizeText(val).toLowerCase())
  .pipe(z.email({ message: 'Must be a valid email address' }));

export const adminLoginBodySchema = z
  .object({
    email: adminEmailSchema,
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export type AdminLoginBody = z.infer<typeof adminLoginBodySchema>;

export const adminMfaBodySchema = z
  .object({
    mfaToken: z.string().min(1),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'TOTP code must be 6 digits')
      .optional(),
    recoveryCode: z.string().trim().min(6).max(32).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.code) !== Boolean(data.recoveryCode), {
    message: 'Provide either a 6-digit TOTP code or a recoveryCode',
  });

export type AdminMfaBody = z.infer<typeof adminMfaBodySchema>;

export const adminVerifyEnrollBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
  })
  .strict();

export type AdminVerifyEnrollBody = z.infer<typeof adminVerifyEnrollBodySchema>;

export const adminChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z
      .string()
      .min(12, 'Admin password must be at least 12 characters')
      .max(128, 'Admin password must be at most 128 characters'),
  })
  .strict();

export type AdminChangePasswordBody = z.infer<typeof adminChangePasswordBodySchema>;
