import { randomUUID } from 'expo-crypto';
import { createExpoExportSink } from '../adapters/export/expo-file-sharing';
import { createExpoNotificationAdapter } from '../adapters/notifications/expo-notifications-adapter';
import { createExportService, type ExportService } from '../application/export/export-service';
import type { NotificationAdapter } from '../application/notifications/notification-adapter';
import { createReminderSync, type ReminderSync } from '../application/notifications/reminder-sync';
import { createPlannerServices, type PlannerServices } from '../application/planner/planner-services';
import { deviceTimeZone } from '../application/planner/zoned-time';
import { createSettingsService } from '../application/settings/app-settings';
import type { UndoBar } from '../application/undo/undo-bar';
import { getDatabase } from '../database/database';
import { createSqliteEventRepository } from '../database/repositories/sqlite-event-repository';
import { createSqliteReminderRepository } from '../database/repositories/sqlite-reminder-repository';
import { createSqliteTransactionRepository } from '../database/repositories/sqlite-transaction-repository';
import { createSqliteSettingsRepository } from '../database/repositories/sqlite-settings-repository';
import { createSqliteTaskRepository } from '../database/repositories/sqlite-task-repository';
import { createSqlitePlannerUnitOfWork } from '../database/sqlite-planner-unit-of-work';

/** Reversal evidence stays valid for 60 seconds, like expenses; the bar itself shows for about 8 seconds. */
const UNDO_WINDOW_MILLISECONDS = 60_000;

export interface PlannerComposition {
  planner: PlannerServices;
  reminderSync: ReminderSync;
  notificationAdapter: NotificationAdapter;
  exportService: ExportService;
}

export async function initializePlannerServices(undoBar: UndoBar): Promise<PlannerComposition> {
  const database = await getDatabase();
  const events = createSqliteEventRepository(database);
  const tasks = createSqliteTaskRepository(database);
  const reminders = createSqliteReminderRepository(database);
  const settings = createSettingsService(createSqliteSettingsRepository(database));
  const notificationAdapter = createExpoNotificationAdapter();
  const now = () => new Date().toISOString();
  const reminderSync = createReminderSync({ reminders, events, tasks, adapter: notificationAdapter, loadSettings: settings.load, now });
  const planner = createPlannerServices({
    events, tasks, reminders,
    unitOfWork: createSqlitePlannerUnitOfWork(database),
    nextActionId: randomUUID,
    nextLogId: randomUUID,
    now,
    timezone: deviceTimeZone,
    undoWindowMilliseconds: UNDO_WINDOW_MILLISECONDS,
    undoBar,
    afterMutation: async () => (await reminderSync.sync()).warnings,
  });
  const exportService = createExportService({
    transactions: createSqliteTransactionRepository(database), events, reminders, sink: createExpoExportSink(), now, timezone: deviceTimeZone,
  });
  return { planner, reminderSync, notificationAdapter, exportService };
}
