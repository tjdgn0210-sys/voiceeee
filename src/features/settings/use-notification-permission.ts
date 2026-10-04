import type { NotificationPermission } from '../../application/notifications/resolve-silence';

/** The device's notification permission. The system adapter is connected in M1-08; until then the answer is unknown. */
export function useNotificationPermission(): NotificationPermission {
  return 'UNDETERMINED';
}
