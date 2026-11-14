import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envFileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
const envFilePath = fileURLToPath(new URL(`../../${envFileName}`, import.meta.url));

// Variables already present in the process environment take precedence over the file.
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const trustProxySchema = z
  .string()
  .trim()
  .default('false')
  .transform((value, ctx): boolean | number => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return Number(value);
    ctx.addIssue({ code: 'custom', message: 'must be "true", "false" or a hop count' });
    return z.NEVER;
  });

const corsOriginsSchema = z
  .string()
  .trim()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url()));

const booleanStringSchema = (defaultVal: boolean) =>
  z
    .string()
    .trim()
    .default(defaultVal ? 'true' : 'false')
    .transform((value, ctx): boolean => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      ctx.addIssue({ code: 'custom', message: 'must be "true" or "false"' });
      return z.NEVER;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(2).default('15m'),
  JWT_REFRESH_TTL: z.string().min(2).default('30d'),
  CORS_ORIGINS: corsOriginsSchema,
  TRUST_PROXY: trustProxySchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: z.url().default('http://localhost:3000'),
  SMTP_HOST: z.string().trim().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: booleanStringSchema(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().trim().min(3).default('Zapis.kg <noreply@zapis.kg>'),
  TELEGRAM_MODE: z.enum(['off', 'polling', 'webhook']).default('off'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  CLIENT_MESSAGE_PROVIDER: z.string().trim().min(1).default('off'),
  WORKER_ENABLED: booleanStringSchema(false),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(500).max(300_000).default(5000),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60 * 1000),
  RATE_LIMIT_PUBLIC_BOOKING_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_PUBLIC_BOOKING_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60 * 60 * 1000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    process.stderr.write(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
