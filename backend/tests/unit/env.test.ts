import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';

describe('runtime environment', () => {
  it('runs tests with the process time zone set to UTC', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(new Date('2026-11-20T04:00:00.000Z').getTimezoneOffset()).toBe(0);
  });

  it('loads the test configuration pointing at the zapis_test database', () => {
    expect(env.NODE_ENV).toBe('test');
    expect(new URL(env.DATABASE_URL).pathname).toBe('/zapis_test');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
