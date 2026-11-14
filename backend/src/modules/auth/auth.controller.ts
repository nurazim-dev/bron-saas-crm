import type { CookieOptions, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { extractAuditContext } from '../../lib/audit.js';
import { parseDurationToMs, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../lib/jwt.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody } from '../../middleware/validate.js';
import type { ChangePasswordBody, LoginBody, RegisterBody } from './auth.schemas.js';
import {
  changeUserPassword,
  getAuthenticatedProfile,
  loginWithEmailPassword,
  refreshAuthSession,
  registerOwnerAndCompany,
} from './auth.service.js';

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
  const result = await registerOwnerAndCompany(body);
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
  const result = await loginWithEmailPassword(body);
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

export const logoutController: RequestHandler = (_req, res) => {
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
