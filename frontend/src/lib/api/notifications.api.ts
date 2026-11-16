import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  InAppNotificationDto,
  ManualRemindersQueueDto,
  MyNotificationSettingsDto,
  NotificationsListDto,
  TelegramLinkCodeDto,
} from '@/types/api';

export async function listNotifications(unreadOnly = false): Promise<NotificationsListDto> {
  const [listRes, countRes] = await Promise.all([
    apiClient.get<ApiSuccessEnvelope<InAppNotificationDto[]>>('/notifications', {
      params: unreadOnly ? { unreadOnly: 'true' } : undefined,
    }),
    apiClient.get<ApiSuccessEnvelope<{ unreadCount: number }>>('/notifications/unread-count'),
  ]);
  return {
    items: listRes.data.data,
    unreadCount: countRes.data.data.unreadCount,
  };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post('/notifications/read-all');
}

export async function getMyNotificationSettings(): Promise<MyNotificationSettingsDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<MyNotificationSettingsDto>>(
    '/me/notification-settings',
  );
  return res.data.data;
}

export async function updateMyNotificationSettings(payload: {
  notifyEmail?: boolean;
  notifyTelegram?: boolean;
}): Promise<MyNotificationSettingsDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<MyNotificationSettingsDto>>(
    '/me/notification-settings',
    payload,
  );
  return res.data.data;
}

export async function createTelegramLinkCode(): Promise<TelegramLinkCodeDto> {
  const res =
    await apiClient.post<ApiSuccessEnvelope<TelegramLinkCodeDto>>('/me/telegram/link-code');
  return res.data.data;
}

export async function unlinkTelegram(): Promise<void> {
  await apiClient.delete('/me/telegram');
}

export async function getManualRemindersQueue(): Promise<ManualRemindersQueueDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<ManualRemindersQueueDto>>('/reminders/queue');
  return res.data.data;
}

export async function markManualReminderSent(
  appointmentId: string,
): Promise<{ id: string; manualReminderSentAt: string | null }> {
  const res = await apiClient.post<
    ApiSuccessEnvelope<{ id: string; manualReminderSentAt: string | null }>
  >(`/appointments/${appointmentId}/reminder-sent`);
  return res.data.data;
}
