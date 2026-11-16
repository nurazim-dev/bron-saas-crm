import type { CookieOptions, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { extractAuditContext } from '../../lib/audit.js';
import { getValidatedBody } from '../../middleware/validate.js';
import { getAdminActor } from './admin-auth.middleware.js';
import type {
  AdminChangePasswordBody,
  AdminLoginBody,
  AdminMfaBody,
  AdminVerifyEnrollBody,
} from './admin-auth.schemas.js';
import {
  changeAdminPassword,
  enrollAdminTotp,
  getAdminProfile,
  loginAdminWithPassword,
  refreshAdminSession,
  verifyAdminMfa,
  verifyAndEnableAdminTotp,
} from './admin-auth.service.js';
import { ADMIN_REFRESH_COOKIE_NAME, ADMIN_REFRESH_COOKIE_PATH } from './admin-crypto.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function buildAdminRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: ADMIN_REFRESH_COOKIE_PATH,
    maxAge: SEVEN_DAYS_MS,
  };
}

function setAdminRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(ADMIN_REFRESH_COOKIE_NAME, refreshToken, buildAdminRefreshCookieOptions());
}

function clearAdminRefreshCookie(res: Response): void {
  res.clearCookie(ADMIN_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: ADMIN_REFRESH_COOKIE_PATH,
  });
}

export const adminLoginController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<AdminLoginBody>(req);
  const result = await loginAdminWithPassword(body, extractAuditContext(req));

  if (result.status === 'authenticated') {
    setAdminRefreshCookie(res, result.refreshToken);
    res.status(200).json({
      data: {
        status: 'authenticated',
        accessToken: result.accessToken,
        admin: result.admin,
      },
    });
    return;
  }

  res.status(200).json({ data: result });
};

export const adminMfaController: RequestHandler = async (req, res) => {
  const body = getValidatedBody<AdminMfaBody>(req);
  const result = await verifyAdminMfa(body, extractAuditContext(req));
  setAdminRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      status: 'authenticated',
      accessToken: result.accessToken,
      admin: result.admin,
    },
  });
};

export const adminEnrollTotpController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const result = await enrollAdminTotp(actor.adminId, extractAuditContext(req));
  res.status(200).json({ data: result });
};

export const adminVerifyEnrollTotpController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const body = getValidatedBody<AdminVerifyEnrollBody>(req);
  const result = await verifyAndEnableAdminTotp(actor.adminId, body.code, extractAuditContext(req));
  setAdminRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      status: 'authenticated',
      accessToken: result.accessToken,
      admin: result.admin,
      recoveryCodes: result.recoveryCodes,
    },
  });
};

export const adminRefreshController: RequestHandler = async (req, res) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const refreshToken = cookies?.[ADMIN_REFRESH_COOKIE_NAME];
  const result = await refreshAdminSession(refreshToken);
  setAdminRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      admin: result.admin,
    },
  });
};

export const adminLogoutController: RequestHandler = (_req, res) => {
  clearAdminRefreshCookie(res);
  res.status(204).send();
};

export const adminMeController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const profile = await getAdminProfile(actor.adminId);
  res.status(200).json({ data: profile });
};

export const adminChangePasswordController: RequestHandler = async (req, res) => {
  const actor = getAdminActor(req);
  const body = getValidatedBody<AdminChangePasswordBody>(req);
  const result = await changeAdminPassword(actor.adminId, body, extractAuditContext(req));
  setAdminRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    data: {
      accessToken: result.accessToken,
      admin: result.admin,
    },
  });
};
