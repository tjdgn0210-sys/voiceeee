import type { ActionType } from '../../domain/action/action-type';
import type { EntityId, ISODateTime } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import type { Reminder } from '../../domain/reminder/reminder';
import type { Task } from '../../domain/task/task';
import { eventFromCandidate, eventCandidateInput } from '../executor/event-executors';
import {
  adjustTargetReminders, type ApplyContext, type PlannerExecutionDependencies, type ReminderReversal,
} from '../executor/planner-execution';
import type { ActionProposal } from '../proposals/action-proposal';
import type { PlannerRepositories } from '../repositories/planner-unit-of-work';
import { isLocalDate } from '../validator/local-date';
import { isUtcDateTime } from '../validator/utc-date-time';
import type { EventCandidate } from '../validator/validate-event';
import type { UndoResult } from './undo-created-transaction';
import type { ReversalValue, UndoRecord } from './undo-record';

const SUPPORTED: readonly ActionType[] = [
  'CREATE_EVENT', 'UPDATE_EVENT', 'COMPLETE_EVENT', 'DELETE_EVENT',
  'CREATE_TASK', 'UPDATE_TASK', 'COMPLETE_TASK', 'DELETE_TASK',
  'CREATE_REMINDER', 'CANCEL_REMINDER',
];

/** Thrown inside the unit of work so any earlier write in the same Undo rolls back. */
class UndoRejection extends Error {
  constructor(readonly result: UndoResult) { super(result.status); }
}
const reject = (status: 'UNAVAILABLE' | 'INELIGIBLE', message: string): never => { throw new UndoRejection({ status, message }); };
const changedMessage = '기록이 변경되어 되돌릴 수 없습니다.';
const goneMessage = '기록이 없거나 이미 되돌렸습니다.';

type Data = { [key: string]: ReversalValue };
const isData = (value: ReversalValue | undefined): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNullableString = (value: ReversalValue | undefined): value is string | null => value === null || typeof value === 'string';

function utc(data: Data, key: string): ISODateTime {
  const value = data[key];
  return isUtcDateTime(value) ? value : reject('INELIGIBLE', '되돌리기 정보가 올바르지 않습니다.');
}

function reminderEntries(data: Data): ReminderReversal[] {
  const list = data.reminders;
  if (!Array.isArray(list)) return reject('INELIGIBLE', '되돌리기 정보가 올바르지 않습니다.');
  return list.map(item => {
    if (!isData(item) || typeof item.id !== 'string' || !isUtcDateTime(item.fireAt) || !isUtcDateTime(item.appliedUpdatedAt)
      || !['REQUESTED', 'PERMISSION_BLOCKED', 'SCHEDULED', 'CANCELLED'].includes(String(item.status))
      || !isNullableString(item.cancelledAt) || !isNullableString(item.lastError)) {
      return reject('INELIGIBLE', '되돌리기 정보가 올바르지 않습니다.');
    }
    return {
      id: item.id, fireAt: item.fireAt, status: item.status as Reminder['status'], cancelledAt: item.cancelledAt,
      lastError: item.lastError, appliedUpdatedAt: item.appliedUpdatedAt,
    };
  });
}

/** Restores reminders changed as a side effect. Previously live reminders return to REQUESTED:
 * their OS notification must be scheduled again (M1-08), so SCHEDULED is never restored as-is.
 */
async function restoreReminders(repositories: PlannerRepositories, entries: ReminderReversal[], stampAfter: (previous: ISODateTime) => ISODateTime) {
  for (const entry of entries) {
    const current = await repositories.reminders.findById(entry.id);
    if (!current || current.updatedAt !== entry.appliedUpdatedAt) reject('INELIGIBLE', changedMessage);
    const reminder = current as Reminder;
    const stamp = stampAfter(reminder.updatedAt);
    const next: Reminder = entry.status === 'CANCELLED' && entry.cancelledAt !== null
      ? { ...reminder, fireAt: entry.fireAt, status: 'CANCELLED', cancelledAt: entry.cancelledAt, lastError: entry.lastError, updatedAt: stamp }
      : { ...reminder, fireAt: entry.fireAt, status: 'REQUESTED', cancelledAt: null, lastError: null, updatedAt: stamp };
    if (!await repositories.reminders.update(next)) reject('INELIGIBLE', changedMessage);
  }
}

function restoredEvent(current: Event, prior: Data, stamp: ISODateTime): Event {
  const input = eventCandidateInput(current);
  for (const [key, value] of Object.entries(prior)) input[key === 'kind' ? 'timeKind' : key] = value;
  const { title, timeKind, startAt, endAt, fuzzyTime, date, timezone, location, visibility } = input;
  if (typeof title !== 'string' || !['EXACT', 'FUZZY', 'ALL_DAY'].includes(String(timeKind))
    || !(startAt === null || isUtcDateTime(startAt)) || !(endAt === null || isUtcDateTime(endAt))
    || !(fuzzyTime === null || typeof fuzzyTime === 'string') || !(date === null || isLocalDate(date))
    || typeof timezone !== 'string' || !(location === null || typeof location === 'string')
    || (visibility !== 'PUBLIC' && visibility !== 'PRIVATE')) {
    return reject('INELIGIBLE', '되돌리기 정보가 올바르지 않습니다.');
  }
  const candidate = { title, timeKind, startAt, endAt, fuzzyTime, date, timezone, location, visibility } as EventCandidate;
  try {
    return eventFromCandidate({ ...current, updatedAt: stamp }, candidate);
  } catch {
    return reject('INELIGIBLE', '되돌리기 정보가 올바르지 않습니다.');
  }
}

function restoredTask(current: Task, prior: Data, stamp: ISODateTime): Task {
  const next = { ...current, updatedAt: stamp };
  if ('title' in prior) next.title = typeof prior.title === 'string' ? prior.title : reject('INELIGIBLE', changedMessage);
  if ('dueAt' in prior) next.dueAt = prior.dueAt === null || isUtcDateTime(prior.dueAt) ? prior.dueAt : reject('INELIGIBLE', changedMessage);
  if ('visibility' in prior) next.visibility = prior.visibility === 'PUBLIC' || prior.visibility === 'PRIVATE' ? prior.visibility : reject('INELIGIBLE', changedMessage);
  if ('status' in prior) next.status = prior.status === 'OPEN' || prior.status === 'COMPLETED' || prior.status === 'CANCELLED' ? prior.status : reject('INELIGIBLE', changedMessage);
  if ('completedAt' in prior) next.completedAt = prior.completedAt === null || isUtcDateTime(prior.completedAt) ? prior.completedAt : reject('INELIGIBLE', changedMessage);
  return next;
}

/** Reverses one recent event/task/reminder action from its session UndoRecord.
 * Every reversal checks that the affected rows are exactly as the action left them; otherwise INELIGIBLE.
 * Reversal writes and the UNDO_ACTION evidence commit together or not at all.
 */
export function createPlannerUndo(dependencies: Pick<PlannerExecutionDependencies, 'unitOfWork' | 'nextLogId' | 'now'> & { nextActionId(): EntityId }) {
  let busy = false;
  return async function undo(record: UndoRecord | null): Promise<UndoResult> {
    if (busy) return { status: 'BUSY', message: '되돌리기 처리 중입니다.' };
    if (!record) return { status: 'UNAVAILABLE', message: '되돌릴 기록이 없습니다.' };
    // Snapshot before awaiting; evidence must not change under the transaction.
    const evidence: UndoRecord = JSON.parse(JSON.stringify(record));
    if (!SUPPORTED.includes(evidence.actionType) || !evidence.undoId?.trim() || !evidence.actionId?.trim()
      || !evidence.affectedEntityId?.trim() || !isUtcDateTime(evidence.createdAt) || !isUtcDateTime(evidence.reversibleUntil)
      || Date.parse(evidence.reversibleUntil) < Date.parse(evidence.createdAt) || !isData(evidence.reversalData)) {
      return { status: 'INELIGIBLE', message: '이 기록은 되돌릴 수 없습니다.' };
    }
    busy = true;
    try {
      const actionId = dependencies.nextActionId();
      const logId = dependencies.nextLogId();
      if (!actionId.trim() || !logId.trim()) throw new Error('Invalid Undo IDs');
      const proposal: ActionProposal = {
        actionId, type: 'UNDO_ACTION', sourceInput: '', inputMethod: 'MANUAL', dependsOnActionIds: [],
        payload: { undoOf: { undoId: evidence.undoId, actionId: evidence.actionId }, actionType: evidence.actionType },
      };
      return await dependencies.unitOfWork.run<UndoResult>(async (repositories) => {
        const now = dependencies.now();
        if (!isUtcDateTime(now) || Date.parse(now) < Date.parse(evidence.createdAt)) throw new Error('Invalid Undo clock');
        if (Date.parse(now) > Date.parse(evidence.reversibleUntil)) return { status: 'EXPIRED', message: '되돌리기 가능 시간이 끝났습니다.' };
        const stampAfter = (previous: ISODateTime) => new Date(Math.max(Date.parse(now), Date.parse(previous) + 1)).toISOString();
        const context: ApplyContext = { repositories, entityId: evidence.affectedEntityId, timestamp: now, stampAfter };
        const data = evidence.reversalData;
        const id = evidence.affectedEntityId;
        const { events, tasks, reminders } = repositories;

        switch (evidence.actionType) {
          case 'CREATE_EVENT':
          case 'CREATE_TASK': {
            const isEvent = evidence.actionType === 'CREATE_EVENT';
            const entity = isEvent ? await events.findById(id) : await tasks.findById(id);
            if (!entity) reject('UNAVAILABLE', goneMessage);
            const live = entity as Event | Task;
            if (live.createdAt !== evidence.createdAt || live.updatedAt !== live.createdAt) reject('INELIGIBLE', changedMessage);
            const stamp = stampAfter(live.updatedAt);
            const deleted = isEvent ? await events.softDelete(id, stamp) : await tasks.softDelete(id, stamp);
            if (!deleted) reject('INELIGIBLE', changedMessage);
            // Reminders added to the new item afterwards would otherwise point at a deleted target.
            await adjustTargetReminders(context, isEvent ? 'EVENT' : 'TASK', id, null, true);
            break;
          }
          case 'UPDATE_EVENT': {
            const current = await events.findById(id);
            if (!current) reject('UNAVAILABLE', goneMessage);
            const event = current as Event;
            if (event.updatedAt !== utc(data, 'appliedUpdatedAt') || !isData(data.prior)) reject('INELIGIBLE', changedMessage);
            const entries = reminderEntries(data);
            if (!await events.update(restoredEvent(event, data.prior as Data, stampAfter(event.updatedAt)))) reject('INELIGIBLE', changedMessage);
            await restoreReminders(repositories, entries, stampAfter);
            break;
          }
          case 'UPDATE_TASK': {
            const current = await tasks.findById(id);
            if (!current) reject('UNAVAILABLE', goneMessage);
            const task = current as Task;
            if (task.updatedAt !== utc(data, 'appliedUpdatedAt') || !isData(data.prior)) reject('INELIGIBLE', changedMessage);
            const entries = reminderEntries(data);
            if (!await tasks.update(restoredTask(task, data.prior as Data, stampAfter(task.updatedAt)))) reject('INELIGIBLE', changedMessage);
            await restoreReminders(repositories, entries, stampAfter);
            break;
          }
          case 'COMPLETE_EVENT': {
            const current = await events.findById(id);
            if (!current) reject('UNAVAILABLE', goneMessage);
            const event = current as Event;
            const priorStatus = data.priorStatus;
            if (event.status !== 'COMPLETED' || event.updatedAt !== utc(data, 'appliedUpdatedAt')
              || (priorStatus !== 'UPCOMING' && priorStatus !== 'PAST')) reject('INELIGIBLE', changedMessage);
            if (!await events.update({ ...event, status: priorStatus as 'UPCOMING' | 'PAST', updatedAt: stampAfter(event.updatedAt) })) reject('INELIGIBLE', changedMessage);
            break;
          }
          case 'COMPLETE_TASK': {
            const current = await tasks.findById(id);
            if (!current) reject('UNAVAILABLE', goneMessage);
            const task = current as Task;
            if (task.status !== 'COMPLETED' || task.updatedAt !== utc(data, 'appliedUpdatedAt') || data.priorStatus !== 'OPEN'
              || !(data.priorCompletedAt === null || isUtcDateTime(data.priorCompletedAt))) reject('INELIGIBLE', changedMessage);
            if (!await tasks.update({ ...task, status: 'OPEN', completedAt: data.priorCompletedAt as ISODateTime | null, updatedAt: stampAfter(task.updatedAt) })) reject('INELIGIBLE', changedMessage);
            break;
          }
          case 'DELETE_EVENT':
          case 'DELETE_TASK': {
            const deletedAt = utc(data, 'deletedAt');
            const entries = reminderEntries(data);
            const stamp = stampAfter(deletedAt);
            const restored = evidence.actionType === 'DELETE_EVENT'
              ? await events.restore(id, deletedAt, stamp) : await tasks.restore(id, deletedAt, stamp);
            if (!restored) reject('INELIGIBLE', '기록이 이미 복구되었거나 변경되었습니다.');
            await restoreReminders(repositories, entries, stampAfter);
            break;
          }
          case 'CREATE_REMINDER': {
            const current = await reminders.findById(id);
            if (!current || current.status === 'CANCELLED') reject('UNAVAILABLE', goneMessage);
            const reminder = current as Reminder;
            if (reminder.createdAt !== evidence.createdAt) reject('INELIGIBLE', changedMessage);
            const stamp = stampAfter(reminder.updatedAt);
            if (!await reminders.update({ ...reminder, status: 'CANCELLED', cancelledAt: stamp, updatedAt: stamp })) reject('INELIGIBLE', changedMessage);
            break;
          }
          case 'CANCEL_REMINDER': {
            const current = await reminders.findById(id);
            if (!current) reject('UNAVAILABLE', goneMessage);
            const reminder = current as Reminder;
            if (reminder.status !== 'CANCELLED' || reminder.updatedAt !== utc(data, 'appliedUpdatedAt')) reject('INELIGIBLE', changedMessage);
            // A reminder must not come back for a deleted target or one that lost its exact time.
            const target = reminder.targetType === 'EVENT' ? await events.findById(reminder.targetId) : await tasks.findById(reminder.targetId);
            if (!target || ('kind' in target && target.kind !== 'EXACT')) reject('INELIGIBLE', '알림 대상이 바뀌어 되돌릴 수 없습니다.');
            const stamp = stampAfter(reminder.updatedAt);
            if (!await reminders.update({ ...reminder, status: 'REQUESTED', cancelledAt: null, lastError: null, updatedAt: stamp })) reject('INELIGIBLE', changedMessage);
            break;
          }
          default:
            reject('INELIGIBLE', '이 기록은 되돌릴 수 없습니다.');
        }
        await repositories.actionLogs.append({
          id: logId, rawInput: '', proposal, validationResult: { actionId, status: 'VALID' },
          executionResult: { actionId, affectedEntityId: id, status: 'SUCCESS' }, createdAt: now,
        });
        return { status: 'SUCCESS', affectedEntityId: id };
      });
    } catch (error) {
      if (error instanceof UndoRejection) return error.result;
      // Do not make a second durable mutation to log a failed atomic operation.
      return { status: 'FAILED', message: '되돌리기를 확인하지 못했습니다. 목록을 확인하고 다시 시도해 주세요.' };
    } finally { busy = false; }
  };
}
