import { createContext, useContext } from 'react';
import type { ReminderSyncReport } from '../../application/notifications/reminder-sync';
import type { NotificationPermission } from '../../application/notifications/resolve-silence';

export interface NotificationState {
  /** The device permission as last read. */
  permission: NotificationPermission;
  /** Reconciles the system's notifications with the saved reminders (also after a settings change). */
  sync(): Promise<ReminderSyncReport>;
  /** Shows the system prompt when it can still be shown, then syncs. */
  requestPermission(): Promise<NotificationPermission>;
  /** Opens the system settings page of the app. */
  openSystemSettings(): void;
}

export const NotificationContext = createContext<NotificationState | null>(null);

export function useNotifications(): NotificationState {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('NotificationProvider is required');
  return value;
}
