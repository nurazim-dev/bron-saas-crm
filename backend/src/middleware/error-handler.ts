import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
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
