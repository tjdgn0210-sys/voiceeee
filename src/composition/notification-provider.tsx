import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState, Linking } from 'react-native';
import { installForegroundNotificationHandler } from '../adapters/notifications/expo-notifications-adapter';
import type { NotificationAdapter } from '../application/notifications/notification-adapter';
import type { ReminderSync } from '../application/notifications/reminder-sync';
import type { NotificationPermission } from '../application/notifications/resolve-silence';
import { NotificationContext, type NotificationState } from '../features/settings/notification-context';

/** Reads the permission, and reconciles notifications at start and whenever the app returns to the foreground
 * (this is also how the nearest 64 are refilled on iOS). It never opens the permission prompt on its own.
 */
export function NotificationProvider({ adapter, reminderSync, children }: PropsWithChildren<{ adapter: NotificationAdapter; reminderSync: ReminderSync }>) {
  const [permission, setPermission] = useState<NotificationPermission>('UNDETERMINED');

  const sync = useCallback(async () => {
    const report = await reminderSync.sync();
    setPermission(report.permission);
    return report;
  }, [reminderSync]);

  useEffect(() => {
    installForegroundNotificationHandler();
    const refresh = () => { sync().catch(() => console.error('Reminder sync failed.')); };
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => subscription.remove();
  }, [sync]);

  const value = useMemo<NotificationState>(() => ({
    permission,
    sync,
    async requestPermission() {
      const result = await adapter.requestPermission();
      setPermission(result);
      await sync();
      return result;
    },
    openSystemSettings() {
      Linking.openSettings().catch(() => console.error('The system settings could not be opened.'));
    },
  }), [permission, sync, adapter]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
