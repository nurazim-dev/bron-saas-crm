import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import type {
  CreatePaymentClaimBody,
  ListPaymentsQuery,
  PaymentIdParams,
} from './billing.schemas.js';
import {
  cancelPendingPaymentClaim,
  createPaymentClaim,
  getBillingOverview,
  listActivePlans,
  listCompanyPayments,
} from './billing.service.js';

export const getBillingController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const overview = await getBillingOverview(actor.companyId);
  res.status(200).json({ data: overview });
};

export const listBillingPlansController: RequestHandler = async (_req, res) => {
  const plans = await listActivePlans();
  res.status(200).json({ data: plans });
};

export const listBillingPaymentsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListPaymentsQuery>(req);
  const result = await listCompanyPayments(actor.companyId, query);
  res.status(200).json({
    data: result.items,
    meta: {
      page: query.page,
      limit: query.limit,
      total: result.total,
    },
  });
};

export const createPaymentClaimController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreatePaymentClaimBody>(req);
  const payment = await createPaymentClaim(
    actor.companyId,
    actor.userId,
    body,
    extractAuditContext(req),
  );
  res.status(201).json({ data: payment });
};

export const cancelPaymentClaimController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<PaymentIdParams>(req);
  const payment = await cancelPendingPaymentClaim(
    actor.companyId,
    actor.userId,
    id,
    extractAuditContext(req),
  );
  res.status(200).json({ data: payment });
};
