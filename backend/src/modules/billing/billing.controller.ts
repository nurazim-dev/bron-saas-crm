import type { RequestHandler } from 'express';
import { PaymentProofScope } from '../../generated/prisma/client.js';
import { extractAuditContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
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
  PaymentProofParams,
} from './billing.schemas.js';
import {
  cancelPendingPaymentClaim,
  createPaymentClaim,
  getBillingOverview,
  listActivePlans,
  listCompanyPayments,
  switchToFreePlan,
} from './billing.service.js';
import {
  decodeProofFileNameHeader,
  readPaymentProofForOwner,
  sendProofDownloadResponse,
  uploadPaymentProof,
} from '../payments/payment-proof.service.js';

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

export const switchToFreePlanController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const overview = await switchToFreePlan(actor.companyId, actor.userId, extractAuditContext(req));
  res.status(200).json({ data: overview });
};

export const uploadBillingPaymentProofController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<PaymentIdParams>(req);
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      'VALIDATION_ERROR',
      422,
      'Загрузите файл изображения (JPEG/PNG/WebP) или PDF до 5 МБ',
    );
  }
  const proof = await uploadPaymentProof({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    scope: PaymentProofScope.SUBSCRIPTION_PAYMENT,
    paymentId: id,
    buffer: req.body,
    mime: String(req.headers['content-type'] ?? ''),
    fileName: decodeProofFileNameHeader(req.headers['x-file-name']),
    auditContext: extractAuditContext(req),
  });
  res.status(201).json({ data: proof });
};

export const readBillingPaymentProofController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id, proofId } = getValidatedParams<PaymentProofParams>(req);
  const file = await readPaymentProofForOwner({
    companyId: actor.companyId,
    scope: PaymentProofScope.SUBSCRIPTION_PAYMENT,
    paymentId: id,
    proofId,
  });
  sendProofDownloadResponse(res, file);
};
