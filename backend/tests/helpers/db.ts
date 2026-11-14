import { prismaUnfiltered } from '../../src/lib/prisma.js';

export async function truncateAllTables(): Promise<void> {
  await prismaUnfiltered.$executeRawUnsafe(
    'TRUNCATE TABLE "OutboxMessage", "InAppNotification", "AuditLog", "WorkerHeartbeat", "Appointment", "WorkingHours", "MasterService", "Service", "User", "Company" RESTART IDENTITY CASCADE;',
  );
}
