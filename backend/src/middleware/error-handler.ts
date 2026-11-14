import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import type { ErrorCode, ErrorDetail, ErrorResponseBody } from '../lib/errors.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    'status' in err &&
    typeof err.status === 'number'
  );
}

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function extractSqlState(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const record = err as Record<string, unknown>;
  if (typeof record.code === 'string' && record.code === '23P01') {
    return '23P01';
  }
  if (typeof record.meta === 'object' && record.meta !== null) {
    const meta = record.meta as Record<string, unknown>;
    if (typeof meta.code === 'string') return meta.code;
    if (typeof meta.driverAdapterError === 'object' && meta.driverAdapterError !== null) {
      const driverErr = meta.driverAdapterError as Record<string, unknown>;
      if (typeof driverErr.cause === 'object' && driverErr.cause !== null) {
        const cause = driverErr.cause as Record<string, unknown>;
        if (typeof cause.originalCode === 'string') return cause.originalCode;
        if (typeof cause.code === 'string') return cause.code;
      }
    }
  }
  if (
    typeof record.message === 'string' &&
    record.message.includes('Appointment_no_overlapping_active_slots')
  ) {
    return '23P01';
  }
  return undefined;
}

export function isExclusionConstraintError(err: unknown): boolean {
  return extractSqlState(err) === '23P01';
}

export function sendError(
  res: Response,
  requestId: string,
  httpStatus: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): void {
  const body: ErrorResponseBody = {
    error: {
      code,
      message,
      ...(details !== undefined && details.length > 0 ? { details } : {}),
      requestId,
    },
  };
  res.status(httpStatus).json(body);
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    sendError(res, req.requestId, err.httpStatus, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, req.requestId, 400, 'VALIDATION_ERROR', 'Invalid request', zodDetails(err));
    return;
  }

  if (isExclusionConstraintError(err)) {
    sendError(
      res,
      req.requestId,
      409,
      'SLOT_ALREADY_BOOKED',
      'Selected time slot is already booked',
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      sendError(res, req.requestId, 409, 'CONFLICT', 'Resource already exists');
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, req.requestId, 404, 'NOT_FOUND', 'Resource not found');
      return;
    }
  }

  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      sendError(res, req.requestId, 400, 'VALIDATION_ERROR', 'Malformed JSON body');
      return;
    }
    if (err.type === 'entity.too.large') {
      sendError(res, req.requestId, 413, 'VALIDATION_ERROR', 'Request body too large');
      return;
    }
  }

  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  sendError(res, req.requestId, 500, 'INTERNAL_ERROR', 'Internal server error');
};
