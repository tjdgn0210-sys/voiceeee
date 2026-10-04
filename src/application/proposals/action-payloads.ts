import type { ActionType } from '../../domain/action/action-type';
import type { CaptureDraft } from '../../domain/draft/draft';
import type { CurrencyCode, EntityId, ISODateTime, LocalDate, Timezone, Visibility } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import type { ReminderDeliveryMode, ReminderTargetType } from '../../domain/reminder/reminder';
import type { TransactionType } from '../../domain/transaction/transaction';

/** Null required values mean unresolved input, not permission to persist an invalid entity. */
export interface CreateTransactionPayload {
  transactionType: TransactionType | null;
  amount: number | null;
  currencyCode: CurrencyCode | null;
  category: string | null;
  memo: string | null;
  occurredAt: ISODateTime | null;
}

export interface CreateTaskPayload {
  title: string | null;
  dueAt: ISODateTime | null;
  /** Chosen by the caller (guests always PRIVATE); never inferred here. */
  visibility: Visibility;
}

export type EventTimeKind = Event['kind'];

/** EXACT uses startAt; FUZZY uses fuzzyTime + date; ALL_DAY uses date. Unused time fields are null. */
export interface CreateEventPayload {
  title: string | null;
  timeKind: EventTimeKind | null;
  startAt: ISODateTime | null;
  endAt: ISODateTime | null;
  fuzzyTime: string | null;
  /** YYYY-MM-DD in timezone; required for FUZZY and ALL_DAY. */
  date: LocalDate | null;
  timezone: Timezone | null;
  location: string | null;
  visibility: Visibility;
}

export interface CreateNotePayload {
  content: string | null;
  tags: string[];
}

export type ReminderTargetReference =
  | { kind: 'ENTITY'; targetType: ReminderTargetType; targetId: EntityId }
  | { kind: 'ACTION'; targetType: ReminderTargetType; actionId: EntityId };

export interface CreateReminderPayload {
  /** ACTION references must also appear in dependsOnActionIds. */
  target: ReminderTargetReference | null;
  fireAt: ISODateTime | null;
  timezone: Timezone | null;
  /** Signed offset from Event.startAt or Task.dueAt; requires a resolvable target time. */
  relativeOffsetMinutes: number | null;
  deliveryMode: ReminderDeliveryMode;
}

/** Omitted patch fields are unchanged; null explicitly clears or requests clarification.
 * Validators must reject empty patches and null for required persisted fields.
 * JSON producers must omit unchanged keys rather than write undefined.
 */
export interface UpdatePayload<T> {
  targetId: EntityId | null;
  expectedUpdatedAt?: ISODateTime;
  changes: Partial<T>;
}

/** Null means the target still needs clarification; never infer a bulk deletion.
 * Planner actions (events, tasks, reminders) require expectedUpdatedAt as concurrency evidence.
 */
export interface TargetPayload {
  targetId: EntityId | null;
  expectedUpdatedAt?: ISODateTime;
}

/** Links a creation reversal to its original evidence; not a generic delete authorization. */
export interface DeleteTransactionPayload extends TargetPayload {
  expectedUpdatedAt?: ISODateTime;
  confirmed?: boolean;
  undoOf?: { undoId: EntityId; actionId: EntityId };
}

/** Completion time is the execution time; callers do not supply it. */
export type CompletePayload = TargetPayload;

/** Reverses one recent action using its session UndoRecord; evidence only, not a free-form command. */
export interface UndoActionPayload {
  undoOf: { undoId: EntityId; actionId: EntityId };
  actionType: ActionType;
}

export interface ActionPayloadMap {
  SAVE_DRAFT: { slot: string; draft: CaptureDraft };
  DISCARD_DRAFT: { slot: string };
  CREATE_TRANSACTION: CreateTransactionPayload;
  UPDATE_TRANSACTION: UpdatePayload<CreateTransactionPayload>;
  DELETE_TRANSACTION: DeleteTransactionPayload;
  CREATE_TASK: CreateTaskPayload;
  /** status may only be 'OPEN', which reopens a completed task. */
  UPDATE_TASK: UpdatePayload<CreateTaskPayload & { status: 'OPEN' }>;
  COMPLETE_TASK: CompletePayload;
  DELETE_TASK: TargetPayload;
  CREATE_EVENT: CreateEventPayload;
  UPDATE_EVENT: UpdatePayload<CreateEventPayload>;
  COMPLETE_EVENT: CompletePayload;
  DELETE_EVENT: TargetPayload;
  CREATE_NOTE: CreateNotePayload;
  UPDATE_NOTE: UpdatePayload<CreateNotePayload>;
  DELETE_NOTE: TargetPayload;
  CREATE_REMINDER: CreateReminderPayload;
  UPDATE_REMINDER: UpdatePayload<CreateReminderPayload>;
  CANCEL_REMINDER: TargetPayload;
  UNDO_ACTION: UndoActionPayload;
}
