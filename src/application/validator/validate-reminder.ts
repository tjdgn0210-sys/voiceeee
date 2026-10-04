import type { ISODateTime } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import type { Task } from '../../domain/task/task';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ValidationResult } from './validation-result';
import { isUtcDateTime } from './utc-date-time';
import { actionIdOf, hasProposalEnvelope, isObject } from './validate-event';

export type CreateReminderProposal = Extract<ActionProposal, { type: 'CREATE_REMINDER' }>;

/** Signed minutes from the target time: negative = before, 0 = at the time (D-15). */
export function isReminderOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value <= 0;
}

/** Target-independent checks. Target existence and exact-time rules run inside the executor transaction. */
export function validateCreateReminder(input: unknown): ValidationResult {
  const actionId = actionIdOf(input);
  const fail = (errorCode: string, errorMessage: string): ValidationResult => ({ actionId, status: 'INVALID', errorCode, errorMessage });
  if (!hasProposalEnvelope(input, 'CREATE_REMINDER')) return fail('INVALID_PROPOSAL', 'Expected a structurally valid CREATE_REMINDER proposal.');
  const { payload } = input;
  if (payload.deliveryMode !== 'LOCAL') return fail('INVALID_DELIVERY_MODE', 'deliveryMode must be LOCAL.');
  if (typeof payload.timezone !== 'string' || !payload.timezone.trim()) return fail('INVALID_TIMEZONE', 'timezone must be a non-empty IANA timezone identifier.');
  const offset = payload.relativeOffsetMinutes ?? null;
  if (offset !== null && !isReminderOffset(offset)) return fail('INVALID_OFFSET', 'relativeOffsetMinutes must be an integer of 0 or less.');
  const fireAt = payload.fireAt ?? null;
  if (fireAt !== null && !isUtcDateTime(fireAt)) return fail('INVALID_FIRE_AT', 'fireAt must be a valid absolute UTC ISO timestamp.');
  const target = payload.target ?? null;
  if (target !== null) {
    if (!isObject(target) || (target.targetType !== 'EVENT' && target.targetType !== 'TASK')) return fail('INVALID_TARGET', 'target must reference an EVENT or TASK.');
    if (target.kind === 'ENTITY') {
      if (typeof target.targetId !== 'string' || !target.targetId.trim()) return fail('INVALID_TARGET', 'target.targetId must be a non-empty ID.');
    } else if (target.kind === 'ACTION') {
      const dependsOn = input.dependsOnActionIds as string[];
      if (typeof target.actionId !== 'string' || !dependsOn.includes(target.actionId)) {
        return fail('INVALID_TARGET', 'ACTION targets must also appear in dependsOnActionIds.');
      }
    } else return fail('INVALID_TARGET', 'target.kind must be ENTITY or ACTION.');
  }
  const questions: { field: string; question: string }[] = [];
  if (target === null) questions.push({ field: 'target', question: '무엇에 대한 알림인가요?' });
  if (fireAt === null && offset === null) questions.push({ field: 'fireAt', question: '언제 알려 드릴까요?' });
  const [first, ...rest] = questions.map(item => ({ actionId, field: `payload.${item.field}`, reason: 'MISSING' as const, question: item.question }));
  if (first) return { actionId, status: 'NEEDS_CLARIFICATION', clarifications: [first, ...rest] };
  return { actionId, status: 'VALID' };
}

export type ReminderTarget = { targetType: 'EVENT'; event: Event } | { targetType: 'TASK'; task: Task };

export type ReminderTimeCheck =
  | { status: 'OK'; fireAt: ISODateTime }
  | { status: 'INVALID'; errorCode: string; errorMessage: string };

/** Resolves fireAt against a live target. Event reminders need an EXACT event (D-3: no ALL_DAY or FUZZY);
 * relative reminders need a target time, and a supplied fireAt must equal target time + offset.
 */
export function resolveReminderFireAt(
  payload: { fireAt: ISODateTime | null; relativeOffsetMinutes: number | null }, target: ReminderTarget,
): ReminderTimeCheck {
  let targetTime: ISODateTime | null;
  if (target.targetType === 'EVENT') {
    if (target.event.kind !== 'EXACT') {
      return { status: 'INVALID', errorCode: 'REMINDER_REQUIRES_EXACT_TIME', errorMessage: '정확한 시각이 있는 일정에만 알림을 붙일 수 있어요.' };
    }
    targetTime = target.event.startAt;
  } else targetTime = target.task.dueAt;

  if (payload.relativeOffsetMinutes === null) {
    if (payload.fireAt === null) return { status: 'INVALID', errorCode: 'INVALID_FIRE_AT', errorMessage: 'fireAt is required without an offset.' };
    return { status: 'OK', fireAt: new Date(Date.parse(payload.fireAt)).toISOString() };
  }
  if (targetTime === null) {
    return { status: 'INVALID', errorCode: 'REMINDER_REQUIRES_DUE_TIME', errorMessage: '마감 시각이 있는 할 일에만 상대 알림을 붙일 수 있어요.' };
  }
  const computed = relativeFireAt(targetTime, payload.relativeOffsetMinutes);
  if (payload.fireAt !== null && Date.parse(payload.fireAt) !== Date.parse(computed)) {
    return { status: 'INVALID', errorCode: 'FIRE_AT_MISMATCH', errorMessage: 'fireAt must equal the target time plus the offset.' };
  }
  return { status: 'OK', fireAt: computed };
}

export function relativeFireAt(targetTime: ISODateTime, offsetMinutes: number): ISODateTime {
  return new Date(Date.parse(targetTime) + offsetMinutes * 60_000).toISOString();
}
