import { prismaUnfiltered } from '../../src/lib/prisma.js';

export async function truncateAllTables(): Promise<void> {
  await prismaUnfiltered.$executeRawUnsafe(
    'TRUNCATE TABLE "ImpersonationCode", "PlatformAdmin", "SubscriptionPayment", "Subscription", "PasswordResetToken", "OutboxMessage", "InAppNotification", "AuditLog", "WorkerHeartbeat", "TimeOff", "Appointment", "Client", "WorkingHours", "MasterService", "Service", "User", "Company" RESTART IDENTITY CASCADE;',
  );
}
