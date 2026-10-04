import type { ActionProposal } from '../application/proposals/action-proposal';
import type { PlannerRepositories, PlannerUnitOfWork } from '../application/repositories/planner-unit-of-work';
import type { ApplicationDatabase } from './database';
import { createSqliteActionLogRepository } from './repositories/sqlite-action-log-repository';
import { createSqliteEventRepository } from './repositories/sqlite-event-repository';
import { createSqliteReminderRepository } from './repositories/sqlite-reminder-repository';
import { createSqliteTaskRepository } from './repositories/sqlite-task-repository';

/** Same isolation rule as transaction creation: all SQL uses the exclusive transaction handle.
 * No result is exposed until the commit has completed successfully.
 */
export function createSqlitePlannerUnitOfWork(database: ApplicationDatabase): PlannerUnitOfWork {
  return {
    async run<T>(work: (repositories: PlannerRepositories) => Promise<T>): Promise<T> {
      let result!: T;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const events = createSqliteEventRepository(transaction);
        const tasks = createSqliteTaskRepository(transaction);
        const reminders = createSqliteReminderRepository(transaction);
        const actionLogs = createSqliteActionLogRepository(transaction);
        result = await work({
          events: { findById: events.findById, create: events.create, update: events.update, softDelete: events.softDelete, restore: events.restore },
          tasks: { findById: tasks.findById, create: tasks.create, update: tasks.update, softDelete: tasks.softDelete, restore: tasks.restore },
          reminders: { findById: reminders.findById, findByTarget: reminders.findByTarget, create: reminders.create, update: reminders.update },
          actionLogs: { append: actionLogs.append },
          async receipt(actionId) {
            const row = await transaction.getFirstAsync<{ proposal_json: string; affected_entity_id: string | null }>(
              "SELECT proposal_json, json_extract(execution_result_json, '$.affectedEntityId') AS affected_entity_id FROM action_logs WHERE json_valid(proposal_json) AND json_extract(proposal_json, '$.actionId') = ? AND json_valid(execution_result_json) AND json_extract(execution_result_json, '$.status') = 'SUCCESS' ORDER BY created_at ASC, id ASC LIMIT 1",
              actionId,
            );
            if (!row) return null;
            return { proposal: JSON.parse(row.proposal_json) as ActionProposal, affectedEntityId: row.affected_entity_id };
          },
        });
      });
      return result;
    },
  };
}
