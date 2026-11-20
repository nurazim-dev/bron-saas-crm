import {
  requestEmailVerification,
  confirmEmailVerification,
} from './email-verification.service.js';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { extractAuditContext } from '../../lib/audit.js';
import { parseDurationToMs, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../lib/jwt.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedQuery,
  getValidatedParams,
} from '../../middleware/validate.js';
import {
  exchangeImpersonationCode,
  exitImpersonationSession,
} from '../admin/impersonation.service.js';
import type {
  ChangePasswordBody,
  CreateAdditionalCompanyBody,
  ForgotPasswordBody,
  ImpersonateExchangeBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  SwitchCompanyBody,
  ValidateResetTokenQuery,
} from './auth.schemas.js';
import {
  createAdditionalCompany,
  listUserMemberships,
  listUserSessions,
  revokeUserSession,
  logoutAuthSession,
  changeUserPassword,
  getAuthenticatedProfile,
  loginWithEmailPassword,
  refreshAuthSession,
  registerOwnerAndCompany,
  switchActiveCompany,
} from './auth.service.js';
import {
  requestPasswordResetByEmail,
  resetPasswordWithToken,
  validatePasswordResetToken,
} from './password-reset.service.js';

function buildRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDurationToMs(env.JWT_REFRESH_TTL),
  };
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, buildRefreshCookieOptions());
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: REFRESH_COOKIE_PATH,
  });
}

export const registerController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<RegisterBody>(req);
  const result = await registerOwnerAndCompany(body, req.get('user-agent'));
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const loginController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<LoginBody>(req);
  const result = await loginWithEmailPassword(body, req.get('user-agent'));
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const refreshController: RequestHandler = async (req, res) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const refreshToken = cookies?.[REFRESH_COOKIE_NAME];
  const result = await refreshAuthSession(refreshToken);
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const logoutController: RequestHandler = async (req, res) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  await logoutAuthSession(cookies?.[REFRESH_COOKIE_NAME]);
  clearRefreshCookie(res);
  res.status(204).send();
};

export const meController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const profile = await getAuthenticatedProfile(actor.userId, actor.companyId);
  res.status(200).json({ data: profile });
};

export const changePasswordController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<ChangePasswordBody>(req);
  const result = await changeUserPassword(
    actor.userId,
    actor.companyId,
    body,
    extractAuditContext(req),
    req.get('user-agent'),
  );
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const forgotPasswordController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<ForgotPasswordBody>(req);
  const result = await requestPasswordResetByEmail(body.email, extractAuditContext(req));
  res.status(202).json({ data: result });
};

export const validateResetPasswordTokenController: RequestHandler = async (req, res) => {
  const query = getValidatedQuery<ValidateResetTokenQuery>(req);
  const result = await validatePasswordResetToken(query.token);
  res.status(200).json({ data: result });
};

export const resetPasswordController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<ResetPasswordBody>(req);
  await resetPasswordWithToken(body.token, body.newPassword, extractAuditContext(req));
  res.status(204).send();
};

export const impersonateExchangeController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<ImpersonateExchangeBody>(req);
  const result = await exchangeImpersonationCode(body.code, extractAuditContext(req));
  res.status(200).json({ data: result });
};

export const impersonateExitController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  await exitImpersonationSession(actor, extractAuditContext(req));
  res.status(204).send();
};

export const sessionsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  res.json({
    data: await listUserSessions(
      actor.userId,
      actor.companyId,
      actor.sessionId,
      actor.imp !== undefined,
    ),
  });
};
export const revokeSessionController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  await revokeUserSession(actor.userId, actor.companyId, id);
  res.status(204).send();
};

export const listCompaniesController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const items = await listUserMemberships(actor.userId, actor.companyId, actor.imp !== undefined);
  res.status(200).json({ data: items });
};

export const switchCompanyController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<SwitchCompanyBody>(req);
  const result = await switchActiveCompany(
    actor.userId,
    actor.companyId,
    body.companyId,
    actor.sessionId,
    req.get('user-agent'),
    extractAuditContext(req),
  );
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const createAdditionalCompanyController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateAdditionalCompanyBody>(req);
  const result = await createAdditionalCompany(
    actor.userId,
    actor.companyId,
    body,
    actor.sessionId,
    req.get('user-agent'),
    extractAuditContext(req),
  );
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({
    data: {
      accessToken: result.accessToken,
      user: result.user,
      company: result.company,
    },
  });
};

export const requestEmailVerificationController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  await requestEmailVerification(actor.userId, actor.companyId);
  res.status(202).json({ data: { message: 'Письмо для подтверждения отправлено' } });
};
export const confirmEmailVerificationController: RequestHandler = async (req, res) => {
  const { token } = getValidatedBody<{ token: string }>(req);
  await confirmEmailVerification(token);
  res.status(204).send();
};
