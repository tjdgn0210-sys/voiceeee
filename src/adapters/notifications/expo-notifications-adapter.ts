import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationAdapter, ScheduleOutcome } from '../../application/notifications/notification-adapter';
import type { NotificationPermission } from '../../application/notifications/resolve-silence';

const CHANNEL_ID = 'reminders';
const UNSUPPORTED = '이 환경에서는 알림을 예약할 수 없어요';

function toPermission(response: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (response.granted || response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'GRANTED';
  return response.status === Notifications.PermissionStatus.UNDETERMINED ? 'UNDETERMINED' : 'BLOCKED';
}

let channelReady: Promise<void> | null = null;

/** Android needs a channel before any notification (and before the permission prompt on Android 13+). */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '일정 · 할 일 알림',
    importance: Notifications.AndroidImportance.HIGH,
  }).then(() => undefined);
  channelReady.catch(() => { channelReady = null; });
  return channelReady;
}

/** Shows a reminder that rings while the app is open instead of dropping it silently. Call once at startup. */
export function installForegroundNotificationHandler(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** expo-notifications behind the application's NotificationAdapter. Not available on web: scheduling reports FAILED there. */
export function createExpoNotificationAdapter(): NotificationAdapter {
  return {
    async getPermissionState() {
      if (Platform.OS === 'web') return 'UNDETERMINED';
      await ensureChannel();
      return toPermission(await Notifications.getPermissionsAsync());
    },
    async requestPermission() {
      if (Platform.OS === 'web') return 'UNDETERMINED';
      await ensureChannel();
      const current = await Notifications.getPermissionsAsync();
      // After a refusal iOS never shows the prompt again: the user has to use the system settings.
      if (!current.granted && !current.canAskAgain) return toPermission(current);
      return toPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }));
    },
    async schedule(request): Promise<ScheduleOutcome> {
      if (Platform.OS === 'web') return { status: 'FAILED', reason: UNSUPPORTED };
      try {
        await ensureChannel();
        if (toPermission(await Notifications.getPermissionsAsync()) !== 'GRANTED') return { status: 'PERMISSION_BLOCKED' };
        await Notifications.scheduleNotificationAsync({
          identifier: request.reminderId,
          content: { title: request.title, sound: true },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(request.fireAt), channelId: CHANNEL_ID },
        });
        return { status: 'SCHEDULED' };
      } catch (error) {
        return { status: 'FAILED', reason: error instanceof Error && error.message ? error.message.slice(0, 200) : '알림을 예약하지 못했어요' };
      }
    },
    async cancel(reminderId) {
      if (Platform.OS === 'web') return;
      await Notifications.cancelScheduledNotificationAsync(reminderId);
    },
    async listScheduledIds() {
      if (Platform.OS === 'web') return [];
      return (await Notifications.getAllScheduledNotificationsAsync()).map(item => item.identifier);
    },
  };
}
