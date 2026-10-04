import { randomUUID } from 'expo-crypto';
import { createPlannerServices, type PlannerServices } from '../application/planner/planner-services';
import { deviceTimeZone } from '../application/planner/zoned-time';
import type { UndoBar } from '../application/undo/undo-bar';
import { getDatabase } from '../database/database';
import { createSqliteEventRepository } from '../database/repositories/sqlite-event-repository';
import { createSqliteReminderRepository } from '../database/repositories/sqlite-reminder-repository';
import { createSqliteTaskRepository } from '../database/repositories/sqlite-task-repository';
import { createSqlitePlannerUnitOfWork } from '../database/sqlite-planner-unit-of-work';

/** Reversal evidence stays valid for 60 seconds, like expenses; the bar itself shows for about 8 seconds. */
const UNDO_WINDOW_MILLISECONDS = 60_000;

export async function initializePlannerServices(undoBar: UndoBar): Promise<PlannerServices> {
  const database = await getDatabase();
  return createPlannerServices({
    events: createSqliteEventRepository(database),
    tasks: createSqliteTaskRepository(database),
    reminders: createSqliteReminderRepository(database),
    unitOfWork: createSqlitePlannerUnitOfWork(database),
    nextActionId: randomUUID,
    nextLogId: randomUUID,
    now: () => new Date().toISOString(),
    timezone: deviceTimeZone,
    undoWindowMilliseconds: UNDO_WINDOW_MILLISECONDS,
    undoBar,
  });
}
