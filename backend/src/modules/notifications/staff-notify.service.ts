import { Locale, NotificationChannel, Role } from '../../generated/prisma/client.js';
import { utcToLocalParts } from '../../lib/datetime.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import { enqueue } from './outbox.service.js';

export type StaffNotificationKind =
  'NEW_ONLINE_BOOKING' | 'CLIENT_CANCELLED' | 'CLIENT_RESCHEDULED' | 'STAFF_BOOKING_FOR_MASTER';

export interface NotifyStaffParams {
  kind: StaffNotificationKind;
  companyId: string;
  companyName: string;
  timezone: string;
  appointmentId: string;
  masterId: string;
  masterName: string;
  serviceName: string;
  clientName: string;
  startAt: Date;
  dedupeSuffix: string;
  includeOwner?: boolean;
  excludeUserId?: string;
}

export async function notifyCompanyStaff(
  tx: TransactionClient,
  params: NotifyStaffParams,
): Promise<void> {
  const includeOwner = params.includeOwner ?? true;

  const [owner, master] = await Promise.all([
    includeOwner
      ? tx.user.findFirst({
          where: {
            companyId: params.companyId,
            role: Role.OWNER,
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            email: true,
            notifyEmail: true,
            notifyTelegram: true,
            telegramChatId: true,
          },
        })
      : Promise.resolve(null),
    tx.user.findFirst({
      where: {
        id: params.masterId,
        companyId: params.companyId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        notifyEmail: true,
        notifyTelegram: true,
        telegramChatId: true,
      },
    }),
  ]);

  const recipients = new Map<
    string,
    {
      id: string;
      email: string | null;
      notifyEmail: boolean;
      notifyTelegram: boolean;
      telegramChatId: string | null;
    }
  >();
  if (owner && owner.id !== params.excludeUserId) {
    recipients.set(owner.id, owner);
  }
  if (master && master.id !== params.excludeUserId) {
    recipients.set(master.id, master);
  }

  if (recipients.size === 0) return;

  const local = utcToLocalParts(params.startAt, params.timezone);
  const localDateTime = `${local.date} ${local.time}`;

  const titleByKind: Record<StaffNotificationKind, string> = {
    NEW_ONLINE_BOOKING: `Новая онлайн-запись: ${params.clientName}`,
    CLIENT_CANCELLED: `Клиент отменил запись: ${params.clientName}`,
    CLIENT_RESCHEDULED: `Клиент перенёс запись: ${params.clientName}`,
    STAFF_BOOKING_FOR_MASTER: `Новая запись для вас: ${params.clientName}`,
  };

  const title = titleByKind[params.kind];
  const body = `${params.serviceName} (${params.masterName}) • ${localDateTime}`;

  const payload = {
    companyName: params.companyName,
    serviceName: params.serviceName,
    masterName: params.masterName,
    clientName: params.clientName,
    localDateTime,
  };

  for (const recipient of recipients.values()) {
    await tx.inAppNotification.create({
      data: {
        companyId: params.companyId,
        userId: recipient.id,
        kind: params.kind,
        title,
        body,
        data: { appointmentId: params.appointmentId },
      },
    });

    if (recipient.notifyEmail && recipient.email) {
      await enqueue(tx, {
        companyId: params.companyId,
        channel: NotificationChannel.EMAIL,
        kind: params.kind,
        recipient: recipient.email,
        toUserId: recipient.id,
        appointmentId: params.appointmentId,
        locale: Locale.RU,
        payload,
        dedupeKey: `staff:${params.kind}:${params.appointmentId}:${recipient.id}:email:${params.dedupeSuffix}`,
      });
    }

    if (recipient.notifyTelegram && recipient.telegramChatId) {
      await enqueue(tx, {
        companyId: params.companyId,
        channel: NotificationChannel.TELEGRAM,
        kind: params.kind,
        recipient: recipient.telegramChatId,
        toUserId: recipient.id,
        appointmentId: params.appointmentId,
        locale: Locale.RU,
        payload,
        dedupeKey: `staff:${params.kind}:${params.appointmentId}:${recipient.id}:tg:${params.dedupeSuffix}`,
      });
    }
  }
}
