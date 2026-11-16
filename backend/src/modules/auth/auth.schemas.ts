import { z } from 'zod';
import { BusinessType } from '../../generated/prisma/client.js';
import { sanitizeText } from '../../lib/phone.js';

const emailSchema = z
  .string()
  .transform((val) => sanitizeText(val).toLowerCase())
  .pipe(z.email({ message: 'Must be a valid email address' }));

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

const trimmedNameSchema = (fieldLabel: string) =>
  z
    .string()
    .transform((val) => sanitizeText(val))
    .pipe(
      z
        .string()
        .min(2, `${fieldLabel} must be at least 2 characters`)
        .max(100, `${fieldLabel} must be at most 100 characters`),
    );

export const registerBodySchema = z.object({
  companyName: trimmedNameSchema('Company name'),
  businessType: z.enum(BusinessType).optional().default(BusinessType.BARBERSHOP),
  ownerName: trimmedNameSchema('Owner name'),
  email: emailSchema,
  phone: z
    .string()
    .transform((val) => sanitizeText(val))
    .optional(),
  password: passwordSchema,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema,
});

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const validateResetTokenQuerySchema = z.object({
  token: z.string().max(256).optional(),
});

export type ValidateResetTokenQuery = z.infer<typeof validateResetTokenQuerySchema>;

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, 'Reset token is required').max(256),
  newPassword: passwordSchema,
});

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
