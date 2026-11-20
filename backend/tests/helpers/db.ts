import { prismaUnfiltered } from '../../src/lib/prisma.js';

export async function truncateAllTables(): Promise<void> {
  await prismaUnfiltered.$executeRawUnsafe(
    'TRUNCATE TABLE "AuthSession", "ImpersonationCode", "PlatformAdmin", "PaymentProof", "BusinessPayment", "SubscriptionPayment", "Subscription", "PasswordResetToken", "OutboxMessage", "InAppNotification", "AuditLog", "WorkerHeartbeat", "TimeOff", "AppointmentService", "Appointment", "ClientTagAssignment", "ClientTag", "Client", "WorkingHours", "MasterService", "ServicePackageItem", "ServicePackage", "Service", "User", "Identity", "Company" RESTART IDENTITY CASCADE;',
  );
}
