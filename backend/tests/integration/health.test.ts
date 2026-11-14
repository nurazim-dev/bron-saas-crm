import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { getHealth } from '../../src/modules/health/health.service.js';
import { WORKER_HEARTBEAT_NAME } from '../../src/worker/runner.js';

describe('GET /api/v1/health', () => {
  const app = createApp();

  afterEach(async () => {
    resetClock();
    await prisma.workerHeartbeat.deleteMany();
  });

  it('returns 200 with status ok and database up when PostgreSQL is reachable', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        database: 'up',
        worker: {
          status: 'disabled',
          lastBeatAt: null,
        },
        uptimeSec: expect.any(Number) as number,
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
      },
    });
  });

  it('returns 200 with status degraded when worker heartbeat is stale (> 2 min)', async () => {
    const clock = new FakeClock(new Date('2026-11-14T12:00:00.000Z'));
    setClock(clock);

    await prisma.workerHeartbeat.create({
      data: {
        name: WORKER_HEARTBEAT_NAME,
        beatAt: new Date('2026-11-14T11:57:00.000Z'), // 3 minutes old
      },
    });

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        status: 'degraded',
        database: 'up',
        worker: {
          status: 'stale',
          lastBeatAt: '2026-11-14T11:57:00.000Z',
        },
        uptimeSec: expect.any(Number) as number,
        timestamp: '2026-11-14T12:00:00.000Z',
      },
    });
  });

  it('returns 200 with worker up when worker heartbeat is fresh', async () => {
    const clock = new FakeClock(new Date('2026-11-14T12:00:00.000Z'));
    setClock(clock);

    await prisma.workerHeartbeat.create({
      data: {
        name: WORKER_HEARTBEAT_NAME,
        beatAt: new Date('2026-11-14T11:59:30.000Z'), // 30s old
      },
    });

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        database: 'up',
        worker: {
          status: 'up',
          lastBeatAt: '2026-11-14T11:59:30.000Z',
        },
        uptimeSec: expect.any(Number) as number,
        timestamp: '2026-11-14T12:00:00.000Z',
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
