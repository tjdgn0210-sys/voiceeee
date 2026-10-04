import type { EntityId } from '../../domain/common/primitives';
import type { EventRepository } from '../../domain/event/event-repository';
import type { ReminderRepository } from '../../domain/reminder/reminder-repository';
import type { TaskRepository } from '../../domain/task/task-repository';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ActionLogRepository } from './action-log-repository';

/** Evidence of an earlier successful execution of the same actionId. */
export interface ActionReceipt {
  proposal: ActionProposal;
  affectedEntityId: EntityId | null;
}

/** Events, tasks, their reminders and evidence, scoped to one atomic write. */
export interface PlannerRepositories {
  events: Pick<EventRepository, 'findById' | 'create' | 'update' | 'softDelete' | 'restore'>;
  tasks: Pick<TaskRepository, 'findById' | 'create' | 'update' | 'softDelete' | 'restore'>;
  reminders: Pick<ReminderRepository, 'findById' | 'findByTarget' | 'create' | 'update'>;
  actionLogs: Pick<ActionLogRepository, 'append'>;
  /** First SUCCESS log for this actionId, or null. Used for idempotent retries. */
  receipt(actionId: EntityId): Promise<ActionReceipt | null>;
}

export interface PlannerUnitOfWork {
  /** Resolves only after commit; rejects on callback/commit failure and rolls back.
   * Await every repository call. Do not retain scoped repositories outside this callback.
   * Never swallow a write failure inside work: rejection is the rollback signal.
   */
  run<T>(work: (repositories: PlannerRepositories) => Promise<T>): Promise<T>;
}
