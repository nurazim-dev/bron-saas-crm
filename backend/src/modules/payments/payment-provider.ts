import type { BusinessPaymentStatus } from '../../generated/prisma/client.js';

export interface PaymentProvider {
  readonly code: string;
  readonly displayName: string;
  readonly supportsAutoConfirm: boolean;
  initialStatus(): BusinessPaymentStatus;
}

class ManualPaymentProvider implements PaymentProvider {
  readonly code = 'MANUAL';
  readonly displayName = 'Ручное подтверждение';
  readonly supportsAutoConfirm = false;

  initialStatus(): BusinessPaymentStatus {
    return 'PENDING';
  }
}

const manualProvider = new ManualPaymentProvider();

const PROVIDERS: Record<string, PaymentProvider> = {
  MANUAL: manualProvider,
};

export function getPaymentProvider(code = 'MANUAL'): PaymentProvider {
  return PROVIDERS[code] ?? manualProvider;
}
