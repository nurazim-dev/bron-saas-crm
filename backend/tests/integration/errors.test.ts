import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/lib/errors.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { notFound } from '../../src/middleware/not-found.js';
import { requestId } from '../../src/middleware/request-id.js';

const errorShape = {
  error: {
    code: expect.any(String) as string,
    message: expect.any(String) as string,
    requestId: expect.any(String) as string,
  },
};

function buildThrowingApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '1kb' }));
  app.get('/app-error', () => {
    throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Slot already booked', [{ message: 'overlap' }]);
  });
  app.get('/zod-error', () => {
    z.object({ name: z.string().min(2) }).parse({ name: 1 });
  });
  app.get('/unknown-error', () => {
    throw new Error('secret internal detail');
  });
  app.post('/echo', (req, res) => {
    res.json({ data: req.body as unknown });
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('error responses', () => {
  it('returns the 404 shape for unknown routes', async () => {
    const res = await request(createApp()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(errorShape);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('includes the request id in the error body and header', async () => {
    const res = await request(createApp())
      .get('/api/v1/nope')
      .set('X-Request-Id', 'req-id-for-test-1');

    expect(res.headers['x-request-id']).toBe('req-id-for-test-1');
    expect(res.body).toMatchObject({ error: { requestId: 'req-id-for-test-1' } });
  });

  it('maps AppError to its status, code and details', async () => {
    const res = await request(buildThrowingApp()).get('/app-error');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'SLOT_ALREADY_BOOKED',
        message: 'Slot already booked',
        details: [{ message: 'overlap' }],
        requestId: expect.any(String) as string,
      },
    });
  });

  it('maps ZodError to 400 VALIDATION_ERROR with field details', async () => {
    const res = await request(buildThrowingApp()).get('/zod-error');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(res.body).toMatchObject({ error: { details: [{ path: 'name' }] } });
  });

  it('maps malformed JSON to 400 VALIDATION_ERROR', async () => {
    const res = await request(buildThrowingApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' },
    });
  });

  it('maps an oversized body to 413 VALIDATION_ERROR', async () => {
    const res = await request(buildThrowingApp())
      .post('/echo')
      .send({ payload: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('hides unknown errors behind 500 INTERNAL_ERROR without leaking details', async () => {
    const res = await request(buildThrowingApp()).get('/unknown-error');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: expect.any(String) as string,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});
