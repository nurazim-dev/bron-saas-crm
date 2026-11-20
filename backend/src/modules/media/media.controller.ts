import type { RequestHandler } from 'express';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody, getValidatedParams } from '../../middleware/validate.js';
import { AppError } from '../../lib/errors.js';
import * as service from './media.service.js';
import type { ProfileInput, MediaEdit } from './media.schemas.js';
type Params = { id: string; mediaId: string; kind: string; slug: string };
export const profile: RequestHandler = async (req, res) => {
  const a = getAuthActor(req);
  res.json({ data: await service.getProfile(a.companyId, getValidatedParams<Params>(req).id) });
};
export const save: RequestHandler = async (req, res) => {
  const a = getAuthActor(req);
  res.json({
    data: await service.saveProfile(
      a.companyId,
      getValidatedParams<Params>(req).id,
      getValidatedBody<ProfileInput>(req),
    ),
  });
};
export const upload: RequestHandler = async (req, res) => {
  const a = getAuthActor(req),
    p = getValidatedParams<Params>(req);
  if (!Buffer.isBuffer(req.body)) throw new AppError('VALIDATION_ERROR', 400, 'Ожидается файл');
  res.status(201).json({
    data: await service.uploadMedia(
      a.companyId,
      p.id,
      p.kind,
      req.body,
      req.get('content-type') ?? '',
    ),
  });
};
export const edit: RequestHandler = async (req, res) => {
  const a = getAuthActor(req),
    p = getValidatedParams<Params>(req);
  res.json({
    data: await service.editMedia(a.companyId, p.id, p.mediaId, getValidatedBody<MediaEdit>(req)),
  });
};
export const remove: RequestHandler = async (req, res) => {
  const a = getAuthActor(req),
    p = getValidatedParams<Params>(req);
  await service.deleteMedia(a.companyId, p.id, p.mediaId);
  res.status(204).send();
};
export const read: RequestHandler = async (req, res) => {
  const a = getAuthActor(req),
    p = getValidatedParams<Params>(req);
  await service.assertMediaOwner(a.companyId, p.id);
  const result = await service.readMedia(a.companyId, p.id, p.mediaId, req.query.poster === '1');
  res
    .set({
      'Content-Type': result.mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(result.data);
};
export const readPublic: RequestHandler = async (req, res) => {
  const p = getValidatedParams<Params>(req);
  const result = await service.readPublicMedia(p.slug, p.id, p.mediaId, req.query.poster === '1');
  res
    .set({
      'Content-Type': result.mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .send(result.data);
};
