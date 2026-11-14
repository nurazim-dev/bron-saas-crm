import 'express-serve-static-core';
import type { Role } from '../generated/prisma/client.js';

export interface AuthenticatedActor {
  userId: string;
  companyId: string;
  role: Role;
  tokenVersion: number;
}

export interface ValidatedInput<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body: TBody;
  query: TQuery;
  params: TParams;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    auth?: AuthenticatedActor;
    validated?: ValidatedInput;
  }
}
