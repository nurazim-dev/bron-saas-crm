import {
  type Locale,
  PrepaymentMode,
  type PrepaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { utcToLocalParts } from '../../lib/datetime.js';

export interface PublicPrepaymentBlock {
  status: PrepaymentStatus;
  amount: string | null;
  holdUntil: string | null;
  receivedAt: string | null;
  instructions: string | null;
  whatsappProofUrl: string | null;
}

export function computePrepaymentAmount(
  priceInput: Prisma.Decimal | number | string,
  mode: PrepaymentMode,
  valueInput: Prisma.Decimal | number | string,
): Prisma.Decimal {
  const price = Number(priceInput);
  const value = Number(valueInput);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0) {
    return new Prisma.Decimal('0.00');
  }

  let amountNum: number;
  if (mode === PrepaymentMode.FIXED) {
    amountNum = Math.min(price, Math.round(value * 100) / 100);
  } else {
    amountNum = Math.min(price, Math.round((price * value) / 100));
  }

  return new Prisma.Decimal(amountNum.toFixed(2));
}

export function buildWhatsappProofUrl(
  companyPhone: string | null | undefined,
  params: {
    clientName: string;
    serviceName: string;
    localDateTime: string;
    amount: string;
    currency: string;
    locale: Locale;
  },
): string | null {
  if (!companyPhone) return null;
  const digits = companyPhone.replace(/\D/g, '');
  if (digits.length < 9) return null;

  const text =
    params.locale === 'KY'
      ? `Саламатсызбы! Мен ${params.clientName}, "${params.serviceName}" (${params.localDateTime}) жазылуусу үчүн ${params.amount} ${params.currency} алдын ала төлөм жөнөтүп жатам.`
      : params.locale === 'EN'
        ? `Hello! I am ${params.clientName}, sending prepayment receipt of ${params.amount} ${params.currency} for "${params.serviceName}" (${params.localDateTime}).`
        : `Здравствуйте! Я ${params.clientName}, отправляю чек предоплаты ${params.amount} ${params.currency} за запись «${params.serviceName}» (${params.localDateTime}).`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function buildPublicPrepaymentBlock(
  appointment: {
    prepaymentStatus: PrepaymentStatus;
    prepaymentAmount: Prisma.Decimal | null;
    prepaymentHoldUntil: Date | null;
    prepaymentReceivedAt: Date | null;
    clientName: string;
    clientLocale: Locale;
    startAt: Date;
  },
  company: {
    phone: string | null;
    timezone: string;
    currency: string;
    paymentInstructions: string | null;
  },
  serviceName: string,
): PublicPrepaymentBlock | null {
  if (appointment.prepaymentStatus === 'NOT_REQUIRED') {
    return null;
  }

  const local = utcToLocalParts(appointment.startAt, company.timezone);
  const amountStr = appointment.prepaymentAmount ? appointment.prepaymentAmount.toFixed(2) : null;

  return {
    status: appointment.prepaymentStatus,
    amount: amountStr,
    holdUntil: appointment.prepaymentHoldUntil?.toISOString() ?? null,
    receivedAt: appointment.prepaymentReceivedAt?.toISOString() ?? null,
    instructions: company.paymentInstructions ?? null,
    whatsappProofUrl: amountStr
      ? buildWhatsappProofUrl(company.phone, {
          clientName: appointment.clientName,
          serviceName,
          localDateTime: `${local.date} ${local.time}`,
          amount: amountStr,
          currency: company.currency,
          locale: appointment.clientLocale,
        })
      : null,
  };
}
