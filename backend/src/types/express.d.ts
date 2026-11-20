import 'express-serve-static-core';
import type { Role } from '../generated/prisma/client.js';

export interface AuthenticatedActor {
  sessionId?: string;
  userId: string;
  companyId: string;
  role: Role;
  tokenVersion: number;
  imp?: string;
}

export interface AuthenticatedAdmin {
  adminId: string;
  email: string;
  name: string;
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
    adminAuth?: AuthenticatedAdmin;
    validated?: ValidatedInput;
  }
}
