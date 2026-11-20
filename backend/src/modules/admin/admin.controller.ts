import type { RequestHandler } from 'express';
import { DateTime } from 'luxon';
import { extractAuditContext } from '../../lib/audit.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import {
  adjustSubscription,
  confirmPayment,
  recordOfflinePayment,
  rejectPayment,
} from '../billing/billing.service.js';
import {
  readSubscriptionProofForAdmin,
  sendProofDownloadResponse,
} from '../payments/payment-proof.service.js';
import { getAdminActor } from './admin-auth.middleware.js';
import type {
  AdminAdjustSubscriptionBody,
  AdminAuditQuery,
  AdminCompaniesQuery,
  AdminCreatePlanBody,
  AdminDeleteCompanyBody,
  AdminOutboxQuery,
  AdminPaymentProofParams,
  AdminPaymentsQuery,
  AdminReasonBody,
  AdminRecordOfflinePaymentBody,
  AdminSignupsQuery,
  AdminUpdateCompanyBody,
  AdminUpdatePlanBody,
  AdminUpdateSettingsBody,
  AdminUpdateUserBody,
  AdminUserPasswordResetBody,
  AdminUsersQuery,
  UuidParams,
} from './admin.schemas.js';
import {
  cancelAdminOutboxMessage,
  createAdminPlan,
  generateAdminUserPasswordResetLink,
  getAdminCompanyDetail,
  getAdminOverviewMetrics,
  getAdminSettings,
  getAdminSignupsSeries,
  listAdminAuditLogs,
  listAdminCompanies,
  listAdminOutbox,
  listAdminPayments,
  listAdminPlans,
  listAdminUsers,
  restoreAdminCompany,
  retryAdminOutboxMessage,
  revokeAdminUserSessions,
  setAdminUserActive,
  softDeleteAdminCompany,
  suspendCompany,
  unsuspendCompany,
  updateAdminCompany,
  updateAdminPlan,
  updateAdminSettings,
  updateAdminUser,
} from './admin.service.js';
import { startCompanyImpersonation } from './impersonation.service.js';

export const getAdminOverviewController: RequestHandler = async (_req, res) => {
  const data = await getAdminOverviewMetrics();
  res.status(200).json({ data });
};

export const getAdminSignupsController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminSignupsQuery>(req);
  const data = await getAdminSignupsSeries(query.days);
  res.status(200).json({ data });
};

export const listAdminCompaniesController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminCompaniesQuery>(req);
  const result = await listAdminCompanies(query);
  res.status(200).json({
    data: result.items,
    meta: { page: query.page, limit: query.limit, total: result.total },
  });
};

export const getAdminCompanyController: RequestHandler = async (req, res) => {
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await getAdminCompanyDetail(id);
  res.status(200).json({ data });
};

export const updateAdminCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminUpdateCompanyBody>(req);
  const data = await updateAdminCompany(actor.adminId, id, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const suspendCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminReasonBody>(req);
  const data = await suspendCompany(actor.adminId, id, body.reason, extractAuditContext(req));
  res.status(200).json({ data });
};

export const unsuspendCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await unsuspendCompany(actor.adminId, id, extractAuditContext(req));
  res.status(200).json({ data });
};

export const deleteAdminCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminDeleteCompanyBody>(req);
  await softDeleteAdminCompany(actor.adminId, id, body.confirmSlug, extractAuditContext(req));
  res.status(204).send();
};

export const restoreAdminCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await restoreAdminCompany(actor.adminId, id, extractAuditContext(req));
  res.status(200).json({ data });
};

export const impersonateCompanyController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminReasonBody>(req);
  const data = await startCompanyImpersonation(
    actor.adminId,
    id,
    body.reason,
    extractAuditContext(req),
  );
  res.status(200).json({ data });
};

export const adjustCompanySubscriptionController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminAdjustSubscriptionBody>(req);
  const data = await adjustSubscription(
    id,
    actor.adminId,
    {
      ...(body.planId !== undefined ? { planId: body.planId } : {}),
      ...(body.periodEndsAt !== undefined
        ? { periodEndsAt: DateTime.fromISO(body.periodEndsAt, { zone: 'utc' }).toJSDate() }
        : {}),
      ...(body.isTrial !== undefined ? { isTrial: body.isTrial } : {}),
      reason: body.reason,
    },
    extractAuditContext(req),
  );
  res.status(200).json({ data });
};

export const recordOfflinePaymentController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminRecordOfflinePaymentBody>(req);
  const data = await recordOfflinePayment(
    id,
    actor.adminId,
    {
      planId: body.planId,
      months: body.months,
      method: body.method,
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
      reason: body.reason,
    },
    extractAuditContext(req),
  );
  res.status(201).json({ data });
};

export const listAdminPaymentsController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminPaymentsQuery>(req);
  const result = await listAdminPayments(query);
  res.status(200).json({
    data: result.items,
    meta: { page: query.page, limit: query.limit, total: result.total },
  });
};

export const confirmAdminPaymentController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await confirmPayment(id, actor.adminId, extractAuditContext(req));
  res.status(200).json({ data });
};

export const rejectAdminPaymentController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminReasonBody>(req);
  const data = await rejectPayment(id, actor.adminId, body.reason, extractAuditContext(req));
  res.status(200).json({ data });
};

export const readAdminPaymentProofController: RequestHandler = async (req, res) => {
  const { id, proofId } = getValidatedParams<AdminPaymentProofParams>(req);
  const file = await readSubscriptionProofForAdmin(id, proofId);
  sendProofDownloadResponse(res, file);
};

export const listAdminPlansController: RequestHandler = async (_req, res) => {
  const data = await listAdminPlans();
  res.status(200).json({ data });
};

export const createAdminPlanController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const body = getValidatedBody<AdminCreatePlanBody>(req);
  const data = await createAdminPlan(actor.adminId, body, extractAuditContext(req));
  res.status(201).json({ data });
};

export const updateAdminPlanController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminUpdatePlanBody>(req);
  const data = await updateAdminPlan(actor.adminId, id, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const listAdminUsersController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminUsersQuery>(req);
  const result = await listAdminUsers(query);
  res.status(200).json({
    data: result.items,
    meta: { page: query.page, limit: query.limit, total: result.total },
  });
};

export const updateAdminUserController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminUpdateUserBody>(req);
  const data = await updateAdminUser(actor.adminId, id, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const deactivateAdminUserController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  await setAdminUserActive(actor.adminId, id, false, extractAuditContext(req));
  res.status(204).send();
};

export const activateAdminUserController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  await setAdminUserActive(actor.adminId, id, true, extractAuditContext(req));
  res.status(204).send();
};

export const revokeAdminUserSessionsController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  await revokeAdminUserSessions(actor.adminId, id, extractAuditContext(req));
  res.status(204).send();
};

export const adminUserPasswordResetLinkController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const body = getValidatedBody<AdminUserPasswordResetBody>(req);
  const data = await generateAdminUserPasswordResetLink(
    actor.adminId,
    id,
    body.sendEmail,
    extractAuditContext(req),
  );
  res.status(200).json({ data });
};

export const listAdminOutboxController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminOutboxQuery>(req);
  const result = await listAdminOutbox(query);
  res.status(200).json({
    data: result.items,
    meta: { page: query.page, limit: query.limit, total: result.total },
  });
};

export const retryAdminOutboxController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await retryAdminOutboxMessage(actor.adminId, id, extractAuditContext(req));
  res.status(200).json({ data });
};

export const cancelAdminOutboxController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const { id } = getValidatedParams<UuidParams>(req);
  const data = await cancelAdminOutboxMessage(actor.adminId, id, extractAuditContext(req));
  res.status(200).json({ data });
};

export const listAdminAuditController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<AdminAuditQuery>(req);
  const result = await listAdminAuditLogs(query);
  res.status(200).json({
    data: result.items,
    meta: { page: query.page, limit: query.limit, total: result.total },
  });
};

export const getAdminSettingsController: RequestHandler = async (_req, res) => {
  const data = await getAdminSettings();
  res.status(200).json({ data });
};

export const updateAdminSettingsController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const body = getValidatedBody<AdminUpdateSettingsBody>(req);
  const data = await updateAdminSettings(actor.adminId, body, extractAuditContext(req));
  res.status(200).json({ data });
};
