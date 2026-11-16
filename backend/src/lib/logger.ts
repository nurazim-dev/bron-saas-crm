import { pino } from 'pino';
import { env } from '../config/env.js';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.manageToken',
  '*.mfaToken',
  '*.recoveryCode',
  '*.totp',
  '*.resetToken',
  'req.query.token',
  'req.headers.referer',
  'req.headers.referrer',
];

export function scrubSensitiveUrl(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  return url.replace(/([?&](?:token|resetToken|manageToken)=)[^&\s]+/gi, '$1[REDACTED]');
}

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'zapis-backend' },
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
    : {}),
});
