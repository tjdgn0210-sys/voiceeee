import type { NotificationPermission } from '../../application/notifications/resolve-silence';
import { useNotifications } from './notification-context';

/** The device's notification permission as last read from the system. */
export function useNotificationPermission(): NotificationPermission {
  return useNotifications().permission;
}
