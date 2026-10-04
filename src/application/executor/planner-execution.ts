import type { EntityId, ISODateTime } from '../../domain/common/primitives';
import type { Reminder, ReminderTargetType } from '../../domain/reminder/reminder';
import type { ActionProposal } from '../proposals/action-proposal';
import type { PlannerRepositories, PlannerUnitOfWork } from '../repositories/planner-unit-of-work';
import type { ReversalValue, UndoRecord } from '../undo/undo-record';
import { relativeFireAt } from '../validator/validate-reminder';
import { isUtcDateTime } from '../validator/utc-date-time';
import type { ValidationResult } from '../validator/validation-result';
import type { ExecutionResult } from './execution-result';

export interface PlannerExecutionDependencies {
  unitOfWork: PlannerUnitOfWork;
  /** Must return the same IDs for the same action across retries/restarts.
   * entityId is used only by creation actions.
   */
  idsForAction(actionId: EntityId): { entityId: EntityId; undoId: EntityId };
  /** New UUID-style evidence ID per attempt: logs remain append-only. */
  nextLogId(): EntityId;
  now(): ISODateTime;
  /** Explicit product policy supplied by the caller; no default duration is chosen here. */
  undoWindowMilliseconds: number;
}

export interface PlannerExecutionOutcome {
  result: ExecutionResult;
  /** Null when nothing was committed by this attempt, including idempotent replays. */
  undoRecord: UndoRecord | null;
}

/** A business rejection inside the atomic operation; the transaction rolls back. */
export class PlannerActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface AppliedAction {
  affectedEntityId: EntityId;
  reversalData: { [key: string]: ReversalValue };
  affectedReminderIds: EntityId[];
}

export interface ApplyContext {
  repositories: PlannerRepositories;
  /** Stable ID for a created entity. */
  entityId: EntityId;
  /** Execution time used for creation, evidence and the Undo deadline. */
  timestamp: ISODateTime;
  /** Execution time, moved 1 ms past `previous` if needed so updatedAt always increases. */
  stampAfter(previous: ISODateTime): ISODateTime;
}

function failed(actionId: EntityId, errorCode: string, errorMessage: string): ExecutionResult {
  return { actionId, affectedEntityId: null, status: 'FAILED', errorCode, errorMessage };
}

function outcome(result: ExecutionResult, undoRecord: UndoRecord | null = null): PlannerExecutionOutcome {
  return { result, undoRecord };
}

/** Shared pipeline for event, task and reminder actions:
 * defensive revalidation → snapshot → one atomic unit (receipt check, writes, ActionLog) → UndoRecord after commit.
 * A repeated actionId with identical input returns the earlier success without writing again;
 * different input under the same actionId is rejected. Failures never report success.
 */
export async function runPlannerAction<P extends ActionProposal>(
  dependencies: PlannerExecutionDependencies,
  proposal: P,
  validation: ValidationResult,
  validate: (input: unknown) => ValidationResult,
  apply: (snapshot: P, context: ApplyContext) => Promise<AppliedAction>,
): Promise<PlannerExecutionOutcome> {
  const checked = validate(proposal);
  const actionId = checked.actionId;
  if (checked.status === 'INVALID') return outcome(failed(actionId, checked.errorCode, checked.errorMessage));
  if (checked.status === 'NEEDS_CLARIFICATION') return outcome({ actionId, affectedEntityId: null, status: 'PENDING_CLARIFICATION' });
  if (checked.status === 'REQUIRES_CONFIRMATION') return outcome({ actionId, affectedEntityId: null, status: 'PENDING_CONFIRMATION' });
  if (validation.actionId !== actionId || validation.status !== 'VALID') {
    return outcome(failed(actionId, 'VALIDATION_REQUIRED', 'A matching VALID validation result is required.'));
  }
  if (proposal.dependsOnActionIds.length) {
    const [first, ...rest] = proposal.dependsOnActionIds;
    return outcome({ actionId, affectedEntityId: null, status: 'SKIPPED_DEPENDENCY', blockedByActionIds: [first, ...rest] });
  }
  // Snapshot before any await; later caller mutations cannot alter the write or the evidence.
  const snapshot = JSON.parse(JSON.stringify(proposal)) as P;
  let ids: ReturnType<PlannerExecutionDependencies['idsForAction']>;
  let timestamp: ISODateTime;
  let logId: EntityId;
  let deadline: ISODateTime;
  try {
    ids = dependencies.idsForAction(actionId);
    timestamp = dependencies.now();
    logId = dependencies.nextLogId();
    if (!ids.entityId.trim() || !ids.undoId.trim() || !logId.trim() || !isUtcDateTime(timestamp)
      || !Number.isSafeInteger(dependencies.undoWindowMilliseconds) || dependencies.undoWindowMilliseconds <= 0) {
      throw new Error('Invalid execution dependencies.');
    }
    deadline = new Date(Date.parse(timestamp) + dependencies.undoWindowMilliseconds).toISOString();
  } catch {
    return outcome(failed(actionId, 'EXECUTION_SETUP_FAILED', 'ID, time, or Undo policy setup failed; no write was attempted.'));
  }
  const stampAfter = (previous: ISODateTime) => new Date(Math.max(Date.parse(timestamp), Date.parse(previous) + 1)).toISOString();
  try {
    const committed = await dependencies.unitOfWork.run(async (repositories) => {
      const receipt = await repositories.receipt(actionId);
      if (receipt) {
        if (JSON.stringify(receipt.proposal) !== JSON.stringify(snapshot)) {
          throw new PlannerActionError('ACTION_ID_CONFLICT', 'This action ID was already used for different input.');
        }
        return { replay: true as const, affectedEntityId: receipt.affectedEntityId };
      }
      const applied = await apply(snapshot, { repositories, entityId: ids.entityId, timestamp, stampAfter });
      const result: ExecutionResult = { actionId, affectedEntityId: applied.affectedEntityId, status: 'SUCCESS' };
      await repositories.actionLogs.append({
        id: logId, rawInput: snapshot.sourceInput, proposal: snapshot, validationResult: { actionId, status: 'VALID' },
        executionResult: result, createdAt: timestamp,
      });
      return { replay: false as const, applied, result };
    });
    if (committed.replay) {
      return outcome({ actionId, affectedEntityId: committed.affectedEntityId, status: 'SUCCESS' });
    }
    return outcome(committed.result, {
      undoId: ids.undoId, actionId, actionType: snapshot.type, affectedEntityId: committed.applied.affectedEntityId,
      reversibleUntil: deadline, reversalData: committed.applied.reversalData,
      affectedReminderIds: committed.applied.affectedReminderIds, createdAt: timestamp,
    });
  } catch (error) {
    if (error instanceof PlannerActionError) return outcome(failed(actionId, error.code, error.message));
    // No second durable mutation to log a failed atomic operation, and no Undo for an unconfirmed commit.
    return outcome(failed(actionId, 'ATOMIC_PERSISTENCE_FAILED', 'Atomic persistence failed; no successful commit was confirmed.'));
  }
}

/** Prior reminder values, enough to restore a reminder changed as a side effect. */
export type ReminderReversal = {
  id: EntityId;
  fireAt: ISODateTime;
  status: Reminder['status'];
  cancelledAt: ISODateTime | null;
  lastError: string | null;
  appliedUpdatedAt: ISODateTime;
};

/** Keeps a target's live reminders consistent with its new time.
 * newTargetTime null: relative reminders are cancelled (no time to count from).
 * cancelAbsolute: also cancel reminders with a fixed fireAt (target deleted or no longer EXACT).
 * Retimed reminders go back to REQUESTED: OS scheduling happens later (M1-08), never assumed here.
 */
export async function adjustTargetReminders(
  context: ApplyContext, targetType: ReminderTargetType, targetId: EntityId,
  newTargetTime: ISODateTime | null, cancelAbsolute: boolean,
): Promise<ReminderReversal[]> {
  const { reminders } = context.repositories;
  const changes: ReminderReversal[] = [];
  for (const reminder of await reminders.findByTarget(targetType, targetId)) {
    if (reminder.status === 'CANCELLED') continue;
    const relative = reminder.relativeOffsetMinutes;
    if (relative === null && !cancelAbsolute) continue;
    const stamp = context.stampAfter(reminder.updatedAt);
    let next: Reminder;
    if (relative === null || newTargetTime === null) {
      next = { ...reminder, status: 'CANCELLED', cancelledAt: stamp, updatedAt: stamp };
    } else {
      const fireAt = relativeFireAt(newTargetTime, relative);
      if (fireAt === reminder.fireAt) continue;
      next = { ...reminder, fireAt, status: 'REQUESTED', cancelledAt: null, lastError: null, updatedAt: stamp };
    }
    if (!await reminders.update(next)) throw new PlannerActionError('REMINDER_UPDATE_FAILED', 'A linked reminder changed during the operation.');
    changes.push({
      id: reminder.id, fireAt: reminder.fireAt, status: reminder.status, cancelledAt: reminder.cancelledAt,
      lastError: reminder.lastError, appliedUpdatedAt: stamp,
    });
  }
  return changes;
}

/** Loads a live target and checks optimistic concurrency evidence. */
export function requireCurrent<T extends { updatedAt: ISODateTime }>(entity: T | null, expectedUpdatedAt: ISODateTime | undefined): T {
  if (!entity) throw new PlannerActionError('TARGET_NOT_FOUND', 'The target does not exist or was deleted.');
  if (entity.updatedAt !== expectedUpdatedAt) throw new PlannerActionError('STALE_TARGET', 'The target changed; reopen it and try again.');
  return entity;
}
