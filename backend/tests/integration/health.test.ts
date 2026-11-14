import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getHealth } from '../../src/modules/health/health.service.js';

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('returns 200 with status ok and database up when PostgreSQL is reachable', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        database: 'up',
        uptimeSec: expect.any(Number) as number,
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
      },
    });
  });

  it('returns degraded status and database down when the DB probe fails', async () => {
    const health = await getHealth(() => Promise.reject(new Error('DB connection refused')));

    expect(health.status).toBe('degraded');
    expect(health.database).toBe('down');
  });

  it('generates an X-Request-Id when none is provided', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('echoes a safe incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-abc-123456');

    expect(res.headers['x-request-id']).toBe('trace-abc-123456');
  });

  it('replaces an unsafe incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id <script>');

    expect(res.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows CORS only for allowlisted origins', async () => {
    const allowed = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
