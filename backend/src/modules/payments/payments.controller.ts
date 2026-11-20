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
  BusinessPaymentsSummaryQuery,
  CreateBusinessPaymentInput,
  ListBusinessPaymentsQuery,
  RejectBusinessPaymentInput,
} from './payments.schemas.js';
import {
  confirmBusinessPayment,
  createBusinessPayment,
  getBusinessPaymentsSummary,
  listBusinessPayments,
  rejectBusinessPayment,
} from './payments.service.js';
import {
  decodeProofFileNameHeader,
  readPaymentProofForOwner,
  sendProofDownloadResponse,
  uploadPaymentProof,
} from './payment-proof.service.js';

export const listBusinessPaymentsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListBusinessPaymentsQuery>(req);
  const result = await listBusinessPayments(actor.companyId, query);
  res.status(200).json({ data: result.items, meta: result.meta });
};

export const getBusinessPaymentsSummaryController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<BusinessPaymentsSummaryQuery>(req);
  const data = await getBusinessPaymentsSummary(actor.companyId, query);
  res.status(200).json({ data });
};

export const createBusinessPaymentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateBusinessPaymentInput>(req);
  const data = await createBusinessPayment(actor, body, extractAuditContext(req));
  res.status(201).json({ data });
};

export const confirmBusinessPaymentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const data = await confirmBusinessPayment(actor, id, extractAuditContext(req));
  res.status(200).json({ data });
};

export const rejectBusinessPaymentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const body = getValidatedBody<RejectBusinessPaymentInput>(req);
  const data = await rejectBusinessPayment(actor, id, body.reason, extractAuditContext(req));
  res.status(200).json({ data });
};

export const uploadBusinessPaymentProofController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      'VALIDATION_ERROR',
      422,
      'Загрузите файл изображения (JPEG/PNG/WebP) или PDF до 5 МБ',
    );
  }
  const data = await uploadPaymentProof({
    companyId: actor.companyId,
    actorUserId: actor.userId,
    scope: PaymentProofScope.BUSINESS_PAYMENT,
    paymentId: id,
    buffer: req.body,
    mime: String(req.headers['content-type'] ?? ''),
    fileName: decodeProofFileNameHeader(req.headers['x-file-name']),
    auditContext: extractAuditContext(req),
  });
  res.status(201).json({ data });
};

export const readBusinessPaymentProofController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id, proofId } = getValidatedParams<{ id: string; proofId: string }>(req);
  const file = await readPaymentProofForOwner({
    companyId: actor.companyId,
    scope: PaymentProofScope.BUSINESS_PAYMENT,
    paymentId: id,
    proofId,
  });
  sendProofDownloadResponse(res, file);
};
