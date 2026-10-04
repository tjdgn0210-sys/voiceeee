import type { EntityId, ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import type { EventRepository } from '../../domain/event/event-repository';
import type { Reminder, ReminderTargetType } from '../../domain/reminder/reminder';
import type { ReminderRepository } from '../../domain/reminder/reminder-repository';
import type { Task } from '../../domain/task/task';
import type { TaskRepository } from '../../domain/task/task-repository';
import { createEventExecutors } from '../executor/event-executors';
import type { ExecutionResult } from '../executor/execution-result';
import type { PlannerExecutionDependencies, PlannerExecutionOutcome } from '../executor/planner-execution';
import { createReminderExecutors } from '../executor/reminder-executors';
import { createTaskExecutors } from '../executor/task-executors';
import type { ActionProposal } from '../proposals/action-proposal';
import type { PlannerUnitOfWork } from '../repositories/planner-unit-of-work';
import type { UndoBar } from '../undo/undo-bar';
import type { UndoResult } from '../undo/undo-created-transaction';
import type { UndoRecord } from '../undo/undo-record';
import { createPlannerUndo } from '../undo/undo-planner-action';
import { validateCreateEvent, validatePlannerTarget, validateUpdateEvent } from '../validator/validate-event';
import { validateCreateReminder } from '../validator/validate-reminder';
import { validateCreateTask, validateUpdateTask } from '../validator/validate-task';
import type { ValidationResult } from '../validator/validation-result';
import {
  buildEventPayload, buildTaskPayload, eventChanges, liveOffsets, reminderLabel,
  type EventForm, type FormErrors, type TaskForm,
} from './event-form';
import { addDays, zonedWallTimeToUtc } from './zoned-time';

export interface PlannerServicesDependencies {
  events: Pick<EventRepository, 'findById' | 'listInRange' | 'listAll'>;
  tasks: Pick<TaskRepository, 'findById' | 'listAll'>;
  reminders: Pick<ReminderRepository, 'findById' | 'findByTarget' | 'listLive'>;
  unitOfWork: PlannerUnitOfWork;
  nextActionId(): EntityId;
  nextLogId(): EntityId;
  now(): ISODateTime;
  timezone(): Timezone;
  undoWindowMilliseconds: number;
  undoBar?: Pick<UndoBar, 'show'>;
  /** Runs after every committed change; returns warnings (e.g. OS reminders that could not be scheduled). Must not throw. */
  afterMutation?(): Promise<string[]>;
}

export type PlannerSaveResult =
  | { status: 'SAVED'; entityId: EntityId; /** Partial failures that the user must see (reminders, notifications). */ warnings: string[] }
  | { status: 'INVALID'; errors: FormErrors }
  | { status: 'FAILED'; message: string };

export type PlannerChangeResult = { status: 'DONE'; warnings: string[] } | { status: 'FAILED'; message: string };

/** What the calendar needs for a span of days. */
export interface PlannerRangeData { events: Event[]; tasks: Task[] }

const FAILURE_MESSAGES: Record<string, string> = {
  STALE_TARGET: '다른 곳에서 먼저 바뀌었어요. 다시 열어서 확인해 주세요',
  TARGET_NOT_FOUND: '이 항목을 찾을 수 없어요. 이미 삭제되었을 수 있어요',
  INVALID_STATE: '지금 상태에서는 할 수 없는 동작이에요',
  REMINDER_REQUIRES_EXACT_TIME: '정확한 시각이 있는 일정에만 알림을 붙일 수 있어요',
  REMINDER_REQUIRES_DUE_TIME: '마감 시각이 있는 할 일에만 알림을 붙일 수 있어요',
  ACTION_ID_CONFLICT: '같은 요청이 다른 내용으로 이미 쓰였어요. 다시 열어 주세요',
};

/** User-facing text for a failed execution; internal messages and database details are never shown. */
export function failureMessage(result: ExecutionResult, fallback = '저장하지 못했어요. 다시 시도해 주세요'): string {
  if (result.status === 'FAILED') return FAILURE_MESSAGES[result.errorCode] ?? fallback;
  if (result.status === 'PENDING_CLARIFICATION') return '입력이 부족해요. 내용을 확인해 주세요';
  return fallback;
}

function validationMessage(validation: ValidationResult): string {
  if (validation.status === 'NEEDS_CLARIFICATION') return validation.clarifications.map(item => item.question).join(' ');
  if (validation.status === 'INVALID') return FAILURE_MESSAGES[validation.errorCode] ?? '입력을 확인해 주세요';
  return '입력을 확인해 주세요';
}

/**
 * Application facade for events, tasks and their reminders. Screens call this; every change still runs
 * proposal → validation → executor (one atomic write with the ActionLog) → UndoRecord.
 */
export function createPlannerServices(dependencies: PlannerServicesDependencies) {
  const executionDependencies: PlannerExecutionDependencies = {
    unitOfWork: dependencies.unitOfWork,
    // Entity and undo identities are the action id, so a retried action resolves to the same rows.
    idsForAction: actionId => ({ entityId: actionId, undoId: actionId }),
    nextLogId: dependencies.nextLogId,
    now: dependencies.now,
    undoWindowMilliseconds: dependencies.undoWindowMilliseconds,
  };
  const eventExecutors = createEventExecutors(executionDependencies);
  const taskExecutors = createTaskExecutors(executionDependencies);
  const reminderExecutors = createReminderExecutors(executionDependencies);
  const undoAction = createPlannerUndo({
    unitOfWork: dependencies.unitOfWork, nextLogId: dependencies.nextLogId, now: dependencies.now, nextActionId: dependencies.nextActionId,
  });

  const proposalBase = () => ({ actionId: dependencies.nextActionId(), sourceInput: '', inputMethod: 'MANUAL' as const, dependsOnActionIds: [] as string[] });

  async function afterMutation(): Promise<string[]> {
    if (!dependencies.afterMutation) return [];
    try {
      return await dependencies.afterMutation();
    } catch {
      return ['알림 상태를 확인하지 못했어요. 앱을 다시 열면 다시 확인해요'];
    }
  }

  /** Reverses `record` and keeps OS notifications in step with the result. */
  async function undo(record: UndoRecord): Promise<UndoResult> {
    const result = await undoAction(record);
    if (result.status === 'SUCCESS') await afterMutation();
    return result;
  }

  function offerUndo(label: string, record: UndoRecord | null): void {
    if (!record || !dependencies.undoBar) return;
    dependencies.undoBar.show({ label, undo: () => undo(record) });
  }

  async function addReminders(targetType: ReminderTargetType, targetId: EntityId, offsets: readonly number[], timezone: Timezone): Promise<string[]> {
    const warnings: string[] = [];
    for (const offset of offsets) {
      const proposal: ActionProposal = {
        ...proposalBase(), type: 'CREATE_REMINDER',
        payload: { target: { kind: 'ENTITY', targetType, targetId }, fireAt: null, timezone, relativeOffsetMinutes: offset, deliveryMode: 'LOCAL' },
      };
      const validation = validateCreateReminder(proposal);
      let saved = false;
      if (validation.status === 'VALID' && proposal.type === 'CREATE_REMINDER') {
        const outcome = await reminderExecutors.create(proposal, validation);
        saved = outcome.result.status === 'SUCCESS';
      }
      if (!saved) warnings.push(`알림(${reminderLabel(offset)})을 저장하지 못했어요`);
    }
    return warnings;
  }

  async function cancelReminders(reminders: readonly Reminder[]): Promise<string[]> {
    const warnings: string[] = [];
    for (const reminder of reminders) {
      const proposal: ActionProposal = {
        ...proposalBase(), type: 'CANCEL_REMINDER', payload: { targetId: reminder.id, expectedUpdatedAt: reminder.updatedAt },
      };
      const validation = validatePlannerTarget(proposal, 'CANCEL_REMINDER');
      let done = false;
      if (validation.status === 'VALID' && proposal.type === 'CANCEL_REMINDER') {
        done = (await reminderExecutors.cancel(proposal, validation)).result.status === 'SUCCESS';
      }
      if (!done) warnings.push(`알림(${reminder.relativeOffsetMinutes === null ? '직접 지정' : reminderLabel(reminder.relativeOffsetMinutes)})을 취소하지 못했어요`);
    }
    return warnings;
  }

  /** Makes the live relative reminders of a target equal `wanted` (adds missing, cancels extra). */
  async function reconcileReminders(targetType: ReminderTargetType, targetId: EntityId, wanted: readonly number[], timezone: Timezone): Promise<string[]> {
    const current = await dependencies.reminders.findByTarget(targetType, targetId);
    const have = liveOffsets(current);
    const toCancel = current.filter(item => item.status !== 'CANCELLED' && item.relativeOffsetMinutes !== null && !wanted.includes(item.relativeOffsetMinutes));
    const toAdd = wanted.filter(offset => !have.includes(offset));
    return [...await cancelReminders(toCancel), ...await addReminders(targetType, targetId, toAdd, timezone)];
  }

  async function runCreateEvent(form: EventForm, actionId: EntityId | undefined): Promise<PlannerSaveResult> {
    const timezone = dependencies.timezone();
    const built = buildEventPayload(form, timezone);
    if (built.status === 'ERROR') return { status: 'INVALID', errors: built.errors };
    const proposal: ActionProposal = { ...proposalBase(), ...(actionId ? { actionId } : {}), type: 'CREATE_EVENT', payload: built.payload };
    const validation = validateCreateEvent(proposal);
    if (validation.status !== 'VALID' || proposal.type !== 'CREATE_EVENT') return { status: 'FAILED', message: validationMessage(validation) };
    const outcome = await eventExecutors.create(proposal, validation);
    if (outcome.result.status !== 'SUCCESS' || !outcome.result.affectedEntityId) return { status: 'FAILED', message: failureMessage(outcome.result) };
    const entityId = outcome.result.affectedEntityId;
    const warnings = form.timeKind === 'EXACT' ? await addReminders('EVENT', entityId, form.reminderOffsets, timezone) : [];
    warnings.push(...await afterMutation());
    offerUndo(`‘${built.payload.title?.trim()}’ 일정을 저장했어요`, outcome.undoRecord);
    return { status: 'SAVED', entityId, warnings };
  }

  async function runUpdateEvent(existing: Event, form: EventForm): Promise<PlannerSaveResult> {
    const timezone = dependencies.timezone();
    const built = buildEventPayload(form, existing.timezone);
    if (built.status === 'ERROR') return { status: 'INVALID', errors: built.errors };
    const changes = eventChanges(existing, built.payload);
    const warnings: string[] = [];
    if (Object.keys(changes).length) {
      const proposal: ActionProposal = {
        ...proposalBase(), type: 'UPDATE_EVENT', payload: { targetId: existing.id, expectedUpdatedAt: existing.updatedAt, changes },
      };
      const validation = validateUpdateEvent(proposal);
      if (validation.status !== 'VALID' || proposal.type !== 'UPDATE_EVENT') return { status: 'FAILED', message: validationMessage(validation) };
      const outcome = await eventExecutors.update(proposal, validation);
      if (outcome.result.status !== 'SUCCESS') {
        if (outcome.result.status === 'FAILED' && outcome.result.errorCode === 'INCOMPLETE_CHANGES') return { status: 'FAILED', message: '입력을 확인해 주세요' };
        return { status: 'FAILED', message: failureMessage(outcome.result) };
      }
    }
    // The executor retimes or cancels reminders when the time changed; this only applies the user's own selection.
    const wanted = form.timeKind === 'EXACT' ? form.reminderOffsets : [];
    if (form.timeKind === 'EXACT') warnings.push(...await reconcileReminders('EVENT', existing.id, wanted, timezone));
    warnings.push(...await afterMutation());
    return { status: 'SAVED', entityId: existing.id, warnings };
  }

  async function runCreateTask(form: TaskForm, actionId: EntityId | undefined): Promise<PlannerSaveResult> {
    const timezone = dependencies.timezone();
    const built = buildTaskPayload(form, timezone);
    if (built.status === 'ERROR') return { status: 'INVALID', errors: built.errors };
    const proposal: ActionProposal = { ...proposalBase(), ...(actionId ? { actionId } : {}), type: 'CREATE_TASK', payload: built.payload };
    const validation = validateCreateTask(proposal);
    if (validation.status !== 'VALID' || proposal.type !== 'CREATE_TASK') return { status: 'FAILED', message: validationMessage(validation) };
    const outcome = await taskExecutors.create(proposal, validation);
    if (outcome.result.status !== 'SUCCESS' || !outcome.result.affectedEntityId) return { status: 'FAILED', message: failureMessage(outcome.result) };
    const entityId = outcome.result.affectedEntityId;
    const warnings = built.payload.dueAt ? await addReminders('TASK', entityId, form.reminderOffsets, timezone) : [];
    warnings.push(...await afterMutation());
    offerUndo(`‘${built.payload.title?.trim()}’ 할 일을 저장했어요`, outcome.undoRecord);
    return { status: 'SAVED', entityId, warnings };
  }

  async function runUpdateTask(existing: Task, form: TaskForm): Promise<PlannerSaveResult> {
    const timezone = dependencies.timezone();
    const built = buildTaskPayload(form, timezone);
    if (built.status === 'ERROR') return { status: 'INVALID', errors: built.errors };
    const changes: Record<string, unknown> = {};
    if (built.payload.title?.trim() !== existing.title) changes.title = built.payload.title;
    if (built.payload.dueAt !== existing.dueAt) changes.dueAt = built.payload.dueAt;
    if (built.payload.visibility !== existing.visibility) changes.visibility = built.payload.visibility;
    const warnings: string[] = [];
    if (Object.keys(changes).length) {
      const proposal: ActionProposal = {
        ...proposalBase(), type: 'UPDATE_TASK', payload: { targetId: existing.id, expectedUpdatedAt: existing.updatedAt, changes },
      };
      const validation = validateUpdateTask(proposal);
      if (validation.status !== 'VALID' || proposal.type !== 'UPDATE_TASK') return { status: 'FAILED', message: validationMessage(validation) };
      const outcome = await taskExecutors.update(proposal, validation);
      if (outcome.result.status !== 'SUCCESS') return { status: 'FAILED', message: failureMessage(outcome.result) };
    }
    if (built.payload.dueAt) warnings.push(...await reconcileReminders('TASK', existing.id, form.reminderOffsets, timezone));
    warnings.push(...await afterMutation());
    return { status: 'SAVED', entityId: existing.id, warnings };
  }

  /** Delete / complete / reopen: one target action, one undo offer. */
  async function runTargetAction(
    kind: 'DELETE_EVENT' | 'COMPLETE_EVENT' | 'DELETE_TASK' | 'COMPLETE_TASK',
    target: { id: EntityId; updatedAt: ISODateTime },
    undoLabel: string,
  ): Promise<PlannerChangeResult> {
    const proposal = { ...proposalBase(), type: kind, payload: { targetId: target.id, expectedUpdatedAt: target.updatedAt } } as ActionProposal;
    const validation = validatePlannerTarget(proposal, kind);
    if (validation.status !== 'VALID') return { status: 'FAILED', message: validationMessage(validation) };
    let outcome: PlannerExecutionOutcome;
    if (proposal.type === 'DELETE_EVENT') outcome = await eventExecutors.delete(proposal, validation);
    else if (proposal.type === 'COMPLETE_EVENT') outcome = await eventExecutors.complete(proposal, validation);
    else if (proposal.type === 'DELETE_TASK') outcome = await taskExecutors.delete(proposal, validation);
    else if (proposal.type === 'COMPLETE_TASK') outcome = await taskExecutors.complete(proposal, validation);
    else return { status: 'FAILED', message: '지원하지 않는 동작이에요' };
    if (outcome.result.status !== 'SUCCESS') return { status: 'FAILED', message: failureMessage(outcome.result, '처리하지 못했어요. 다시 시도해 주세요') };
    const warnings = await afterMutation();
    offerUndo(undoLabel, outcome.undoRecord);
    return { status: 'DONE', warnings };
  }

  async function reopenTask(task: Task): Promise<PlannerChangeResult> {
    const proposal: ActionProposal = {
      ...proposalBase(), type: 'UPDATE_TASK', payload: { targetId: task.id, expectedUpdatedAt: task.updatedAt, changes: { status: 'OPEN' } },
    };
    const validation = validateUpdateTask(proposal);
    if (validation.status !== 'VALID' || proposal.type !== 'UPDATE_TASK') return { status: 'FAILED', message: validationMessage(validation) };
    const outcome = await taskExecutors.update(proposal, validation);
    if (outcome.result.status !== 'SUCCESS') return { status: 'FAILED', message: failureMessage(outcome.result, '처리하지 못했어요. 다시 시도해 주세요') };
    const warnings = await afterMutation();
    offerUndo(`‘${task.title}’ 할 일을 다시 열었어요`, outcome.undoRecord);
    return { status: 'DONE', warnings };
  }

  return {
    now: dependencies.now,
    newActionId: dependencies.nextActionId,
    timezone: dependencies.timezone,

    /** Events and tasks around [fromDate, untilDate). Events are widened by a day on both sides so zone edges are not lost. */
    async loadRange(fromDate: LocalDate, untilDate: LocalDate): Promise<PlannerRangeData> {
      const timezone = dependencies.timezone();
      const fromAt = zonedWallTimeToUtc(addDays(fromDate, -1), '00:00', timezone);
      const untilAt = zonedWallTimeToUtc(addDays(untilDate, 1), '00:00', timezone);
      if (!fromAt || !untilAt) throw new RangeError('Invalid calendar range.');
      const [events, tasks] = await Promise.all([
        dependencies.events.listInRange({ fromAt, untilAt, fromDate: addDays(fromDate, -1), untilDate: addDays(untilDate, 1) }),
        dependencies.tasks.listAll(),
      ]);
      return { events, tasks };
    },
    listAllEvents: () => dependencies.events.listAll(),
    listAllTasks: () => dependencies.tasks.listAll(),
    findEvent: (id: EntityId) => dependencies.events.findById(id),
    findTask: (id: EntityId) => dependencies.tasks.findById(id),
    remindersOf: (targetType: ReminderTargetType, id: EntityId) => dependencies.reminders.findByTarget(targetType, id),
    liveReminders: () => dependencies.reminders.listLive(),

    createEvent: runCreateEvent,
    updateEvent: runUpdateEvent,
    deleteEvent: (event: Event) => runTargetAction('DELETE_EVENT', event, `‘${event.title}’ 일정을 삭제했어요`),
    completeEvent: (event: Event) => runTargetAction('COMPLETE_EVENT', event, `‘${event.title}’ 일정을 완료로 표시했어요`),

    createTask: runCreateTask,
    updateTask: runUpdateTask,
    deleteTask: (task: Task) => runTargetAction('DELETE_TASK', task, `‘${task.title}’ 할 일을 삭제했어요`),
    completeTask: (task: Task) => runTargetAction('COMPLETE_TASK', task, `‘${task.title}’ 할 일을 완료했어요`),
    reopenTask,

    undo,
  };
}

export type PlannerServices = ReturnType<typeof createPlannerServices>;
