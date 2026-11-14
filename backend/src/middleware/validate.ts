import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';

export interface ValidationSchemas<
  TBody extends z.ZodType = z.ZodType,
  TQuery extends z.ZodType = z.ZodType,
  TParams extends z.ZodType = z.ZodType,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}

export function validate<
  TBody extends z.ZodType = z.ZodType,
  TQuery extends z.ZodType = z.ZodType,
  TParams extends z.ZodType = z.ZodType,
>(schemas: ValidationSchemas<TBody, TQuery, TParams>): RequestHandler {
  return (req, _res, next) => {
    const rawBody: unknown = req.body ?? {};
    const parsedBody: unknown = schemas.body ? schemas.body.parse(rawBody) : rawBody;
    const parsedQuery: unknown = schemas.query ? schemas.query.parse(req.query) : req.query;
    const parsedParams: unknown = schemas.params ? schemas.params.parse(req.params) : req.params;

    req.validated = {
      body: parsedBody,
      query: parsedQuery,
      params: parsedParams,
    };

    next();
  };
}

export function getValidatedBody<T>(req: Request): T {
  if (!req.validated) {
    throw new AppError('INTERNAL_ERROR', 500, 'Request input was not validated');
  }
  return req.validated.body as T;
}

export function getValidatedQuery<T>(req: Request): T {
  if (!req.validated) {
    throw new AppError('INTERNAL_ERROR', 500, 'Request query was not validated');
  }
  return req.validated.query as T;
}

export function getValidatedParams<T>(req: Request): T {
  if (!req.validated) {
    throw new AppError('INTERNAL_ERROR', 500, 'Request params were not validated');
  }
  return req.validated.params as T;
}
