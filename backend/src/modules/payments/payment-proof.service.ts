import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import sharp from 'sharp';
import {
  AuditActor,
  BusinessPaymentStatus,
  PaymentProofScope,
  PaymentStatus,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const MAX_PROOFS_PER_PAYMENT = 5;
export const MAX_COMPANY_PROOF_BYTES = 50 * 1024 * 1024;

export interface PaymentProofSummaryDto {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface SerializedPaymentProofDownload {
  fileName: string;
  mime: string;
  data: Buffer;
}

function sanitizeFileName(raw: string | undefined, ext: string): string {
  const cleaned = (raw ?? '')
    .replace(/[\p{Cc}\\/:*?"<>|]/gu, '_')
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `receipt.${ext}`;
  }
  return cleaned;
}

function assertSafePdfBuffer(input: Buffer): void {
  if (input.length < 16 || input.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new AppError('VALIDATION_ERROR', 422, 'Файл не является корректным PDF-документом');
  }
  const tailText = input.subarray(Math.max(0, input.length - 2048)).toString('latin1');
  if (!tailText.includes('%%EOF')) {
    throw new AppError('VALIDATION_ERROR', 422, 'Повреждённый PDF-документ (отсутствует %%EOF)');
  }
  const bodySample = input.toString('latin1');
  if (/\/(JavaScript|JS|Launch|RichMedia)\b/.test(bodySample)) {
    throw new AppError('VALIDATION_ERROR', 422, 'PDF-документы со встроенными скриптами запрещены');
  }
}

export async function validateAndProcessProof(
  input: Buffer,
  rawMime: string,
  rawFileName?: string,
): Promise<{
  data: Buffer;
  mime: string;
  size: number;
  sha256: string;
  fileName: string;
}> {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > MAX_PROOF_BYTES) {
    throw new AppError('VALIDATION_ERROR', 422, 'Размер чека должен быть от 1 байта до 5 МБ');
  }

  const normalizedMime = rawMime.split(';')[0]?.trim().toLowerCase() ?? '';
  let processedData: Buffer;
  let storedMime: string;
  let ext: string;

  if (
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/png' ||
    normalizedMime === 'image/webp'
  ) {
    try {
      const img = sharp(input, {
        limitInputPixels: 20_000_000,
        failOn: 'warning',
        animated: false,
      });
      const meta = await img.metadata();
      const accepted: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      if (!meta.format || accepted[meta.format] !== normalizedMime || (meta.pages ?? 1) !== 1) {
        throw new Error('MIME mismatch');
      }
      processedData = await img
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .timeout({ seconds: 10 })
        .toBuffer();
      storedMime = 'image/webp';
      ext = 'webp';
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        422,
        'Чек не прошёл проверку. Разрешены JPEG/PNG/WebP или PDF до 5 МБ.',
      );
    }
  } else if (normalizedMime === 'application/pdf') {
    assertSafePdfBuffer(input);
    processedData = input;
    storedMime = 'application/pdf';
    ext = 'pdf';
  } else {
    throw new AppError(
      'VALIDATION_ERROR',
      422,
      'Неподдерживаемый формат чека. Загрузите JPEG, PNG, WebP или PDF.',
    );
  }

  const sha256 = createHash('sha256').update(processedData).digest('hex');
  return {
    data: processedData,
    mime: storedMime,
    size: processedData.length,
    sha256,
    fileName: sanitizeFileName(rawFileName, ext),
  };
}

export async function uploadPaymentProof(params: {
  companyId: string;
  actorUserId: string;
  scope: PaymentProofScope;
  paymentId: string;
  buffer: Buffer;
  mime: string;
  fileName?: string;
  auditContext?: AuditRequestContext;
}): Promise<PaymentProofSummaryDto> {
  const processed = await validateAndProcessProof(params.buffer, params.mime, params.fileName);
  const currentTime = clockNow();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${params.companyId}::uuid FOR UPDATE`;

    if (params.scope === PaymentProofScope.SUBSCRIPTION_PAYMENT) {
      const target = await tx.subscriptionPayment.findFirst({
        where: { id: params.paymentId, companyId: params.companyId },
        select: { id: true, status: true },
      });
      if (!target) {
        throw new AppError('NOT_FOUND', 404, 'Subscription payment not found');
      }
      if (target.status !== PaymentStatus.PENDING) {
        throw new AppError('CONFLICT', 409, 'Чеки можно прикреплять только к заявкам на проверке');
      }

      const existingCount = await tx.paymentProof.count({
        where: {
          companyId: params.companyId,
          scope: PaymentProofScope.SUBSCRIPTION_PAYMENT,
          subscriptionPaymentId: target.id,
        },
      });
      if (existingCount >= MAX_PROOFS_PER_PAYMENT) {
        throw new AppError(
          'PLAN_LIMIT_REACHED',
          409,
          `К одному платежу можно прикрепить максимум ${MAX_PROOFS_PER_PAYMENT} файлов`,
        );
      }
    } else {
      const target = await tx.businessPayment.findFirst({
        where: { id: params.paymentId, companyId: params.companyId },
        select: { id: true, status: true },
      });
      if (!target) {
        throw new AppError('NOT_FOUND', 404, 'Payment not found');
      }
      if (
        target.status !== BusinessPaymentStatus.PENDING &&
        target.status !== BusinessPaymentStatus.CONFIRMED
      ) {
        throw new AppError(
          'CONFLICT',
          409,
          'Нельзя прикрепить чек к отклонённому или аннулированному платежу',
        );
      }

      const existingCount = await tx.paymentProof.count({
        where: {
          companyId: params.companyId,
          scope: PaymentProofScope.BUSINESS_PAYMENT,
          businessPaymentId: target.id,
        },
      });
      if (existingCount >= MAX_PROOFS_PER_PAYMENT) {
        throw new AppError(
          'PLAN_LIMIT_REACHED',
          409,
          `К одному платежу можно прикрепить максимум ${MAX_PROOFS_PER_PAYMENT} файлов`,
        );
      }
    }

    const totalStorage = await tx.paymentProof.aggregate({
      where: { companyId: params.companyId },
      _sum: { size: true },
    });
    if ((totalStorage._sum.size ?? 0) + processed.size > MAX_COMPANY_PROOF_BYTES) {
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        409,
        'Достигнут лимит хранилища чеков компании (50 МБ)',
      );
    }

    const created = await tx.paymentProof.create({
      data: {
        id: randomUUID(),
        companyId: params.companyId,
        scope: params.scope,
        subscriptionPaymentId:
          params.scope === PaymentProofScope.SUBSCRIPTION_PAYMENT ? params.paymentId : null,
        businessPaymentId:
          params.scope === PaymentProofScope.BUSINESS_PAYMENT ? params.paymentId : null,
        fileName: processed.fileName,
        mime: processed.mime,
        size: processed.size,
        sha256: processed.sha256,
        data: Uint8Array.from(processed.data),
        uploadedByUserId: params.actorUserId,
        createdAt: currentTime,
      },
      select: {
        id: true,
        fileName: true,
        mime: true,
        size: true,
        createdAt: true,
      },
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: params.actorUserId,
      companyId: params.companyId,
      action: 'payment_proof.upload',
      entityType: 'PaymentProof',
      entityId: created.id,
      metadata: {
        scope: params.scope,
        paymentId: params.paymentId,
        mime: created.mime,
        size: created.size,
        sha256: processed.sha256,
      },
      context: params.auditContext,
    });

    return {
      id: created.id,
      fileName: created.fileName,
      mime: created.mime,
      size: created.size,
      createdAt: created.createdAt.toISOString(),
    };
  });
}

export async function readPaymentProofForOwner(params: {
  companyId: string;
  scope: PaymentProofScope;
  paymentId: string;
  proofId: string;
}): Promise<SerializedPaymentProofDownload> {
  const proof = await prisma.paymentProof.findFirst({
    where: {
      id: params.proofId,
      companyId: params.companyId,
      scope: params.scope,
      ...(params.scope === PaymentProofScope.SUBSCRIPTION_PAYMENT
        ? { subscriptionPaymentId: params.paymentId }
        : { businessPaymentId: params.paymentId }),
    },
    select: {
      fileName: true,
      mime: true,
      data: true,
    },
  });

  if (!proof) {
    throw new AppError('NOT_FOUND', 404, 'Payment proof not found');
  }

  return {
    fileName: proof.fileName,
    mime: proof.mime,
    data: Buffer.from(proof.data),
  };
}

export async function readSubscriptionProofForAdmin(
  subscriptionPaymentId: string,
  proofId: string,
): Promise<SerializedPaymentProofDownload> {
  const proof = await prisma.paymentProof.findFirst({
    where: {
      id: proofId,
      scope: PaymentProofScope.SUBSCRIPTION_PAYMENT,
      subscriptionPaymentId,
    },
    select: {
      fileName: true,
      mime: true,
      data: true,
    },
  });

  if (!proof) {
    throw new AppError('NOT_FOUND', 404, 'Subscription payment proof not found');
  }

  return {
    fileName: proof.fileName,
    mime: proof.mime,
    data: Buffer.from(proof.data),
  };
}

export function decodeProofFileNameHeader(rawHeader: unknown): string | undefined {
  if (typeof rawHeader !== 'string' || !rawHeader.trim()) return undefined;
  try {
    return decodeURIComponent(rawHeader);
  } catch {
    return rawHeader;
  }
}

export function sendProofDownloadResponse(
  res: Response,
  file: SerializedPaymentProofDownload,
): void {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
  res.status(200).send(file.data);
}
