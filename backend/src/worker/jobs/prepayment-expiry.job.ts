import { env } from '../../config/env.js';
import {
  AppointmentStatus,
  CancelActor,
  NotificationChannel,
  PrepaymentStatus,
  ReminderMode,
  Role,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { utcToLocalParts } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getCompanyCapabilities } from '../../modules/company/company.service.js';
import { enqueue } from '../../modules/notifications/outbox.service.js';
import { cancelPendingReminders } from '../../modules/notifications/reminders.service.js';

export async function runPrepaymentExpiryOnce(
  db = prisma,
  currentNow: Date = clockNow(),
): Promise<{ expiredCount: number }> {
  const candidates = await db.appointment.findMany({
    where: {
      deletedAt: null,
      status: AppointmentStatus.SCHEDULED,
      prepaymentStatus: PrepaymentStatus.PENDING,
      prepaymentHoldUntil: { lt: currentNow },
    },
    include: {
      company: true,
      service: { select: { name: true } },
      master: { select: { id: true, email: true, notifyEmail: true } },
    },
    take: 50,
  });

  let expiredCount = 0;

  for (const appt of candidates) {
    const won = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: {
          id: appt.id,
          companyId: appt.companyId,
          deletedAt: null,
          status: AppointmentStatus.SCHEDULED,
          prepaymentStatus: PrepaymentStatus.PENDING,
          prepaymentHoldUntil: { lt: currentNow },
        },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: currentNow,
          cancelledBy: CancelActor.SYSTEM,
          cancelReason: 'PREPAYMENT_EXPIRED',
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await cancelPendingReminders(tx, appt.id);

      const local = utcToLocalParts(appt.startAt, appt.company.timezone);
      const localDateTime = `${local.date} ${local.time}`;

      const owner = await tx.user.findFirst({
        where: {
          companyId: appt.companyId,
          role: Role.OWNER,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, email: true, notifyEmail: true },
      });

      const staffRecipients = new Map<
        string,
        { id: string; email: string | null; notifyEmail: boolean }
      >();
      if (owner) staffRecipients.set(owner.id, owner);
      staffRecipients.set(appt.master.id, appt.master);

      for (const staff of staffRecipients.values()) {
        await tx.inAppNotification.create({
          data: {
            companyId: appt.companyId,
            userId: staff.id,
            kind: 'PREPAYMENT_EXPIRED_STAFF',
            title: `Бронь отменена (истекла предоплата): ${appt.clientName}`,
            body: `${appt.service.name} • ${localDateTime}`,
            data: { appointmentId: appt.id },
          },
        });
        if (staff.notifyEmail && staff.email) {
          await enqueue(tx, {
            companyId: appt.companyId,
            channel: NotificationChannel.EMAIL,
            kind: 'PREPAYMENT_EXPIRED_STAFF',
            recipient: staff.email,
            toUserId: staff.id,
            appointmentId: appt.id,
            payload: {
              clientName: appt.clientName,
              serviceName: appt.service.name,
              localDateTime,
            },
            dedupeKey: `prepay-exp-staff:${appt.id}:${staff.id}`,
          });
        }
      }

      if (
        appt.company.reminderMode === ReminderMode.AUTO &&
        getCompanyCapabilities().autoRemindersAvailable
      ) {
        const channel =
          env.CLIENT_MESSAGE_PROVIDER.toLowerCase() === 'sms'
            ? NotificationChannel.SMS
            : NotificationChannel.WHATSAPP;
        await enqueue(tx, {
          companyId: appt.companyId,
          channel,
          kind: 'PREPAYMENT_EXPIRED_CLIENT',
          recipient: appt.clientPhone,
          appointmentId: appt.id,
          locale: appt.clientLocale,
          payload: {
            companyName: appt.company.name,
            serviceName: appt.service.name,
            localDateTime,
          },
          dedupeKey: `prepay-exp-client:${appt.id}`,
        });
      }

      return true;
    });

    if (won) {
      expiredCount += 1;
    }
  }

  if (expiredCount > 0) {
    logger.info({ expiredCount }, 'Expired unpaid prepayment holds');
  }

  return { expiredCount };
}
