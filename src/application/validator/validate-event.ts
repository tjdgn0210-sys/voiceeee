import type { ActionType } from '../../domain/action/action-type';
import type { ISODateTime, LocalDate, Timezone, Visibility } from '../../domain/common/primitives';
import type { ActionProposal } from '../proposals/action-proposal';
import type { EventTimeKind } from '../proposals/action-payloads';
import { isLocalDate } from './local-date';
import { isUtcDateTime } from './utc-date-time';
import type { ClarificationRequest, ValidationResult } from './validation-result';

export type CreateEventProposal = Extract<ActionProposal, { type: 'CREATE_EVENT' }>;
export type UpdateEventProposal = Extract<ActionProposal, { type: 'UPDATE_EVENT' }>;
export type PlannerTargetProposal = Extract<ActionProposal, {
  type: 'COMPLETE_EVENT' | 'DELETE_EVENT' | 'COMPLETE_TASK' | 'DELETE_TASK' | 'CANCEL_REMINDER';
}>;

export const TITLE_MAX_LENGTH = 100;
export const LOCATION_MAX_LENGTH = 100;

/** Normalized, persistable event fields (title/location/fuzzyTime trimmed, blank location = null). */
export interface EventCandidate {
  title: string;
  timeKind: EventTimeKind;
  startAt: ISODateTime | null;
  endAt: ISODateTime | null;
  fuzzyTime: string | null;
  date: LocalDate | null;
  timezone: Timezone;
  location: string | null;
  visibility: Visibility;
}

export type CandidateCheck<T> =
  | { status: 'OK'; candidate: T }
  | { status: 'INVALID'; errorCode: string; errorMessage: string }
  | { status: 'MISSING'; missing: [MissingField, ...MissingField[]] };

export interface MissingField { field: string; question: string }

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Counts user-perceived code points, so Hangul and emoji count as one character each. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

export function isVisibility(value: unknown): value is Visibility {
  return value === 'PUBLIC' || value === 'PRIVATE';
}

/** Shared envelope check; payload-specific rules belong to each validator. */
export function hasProposalEnvelope(input: unknown, type: ActionType): input is Record<string, unknown> & { actionId: string; payload: Record<string, unknown> } {
  if (!isObject(input) || typeof input.actionId !== 'string' || !input.actionId.trim() || input.type !== type
    || typeof input.sourceInput !== 'string' || typeof input.inputMethod !== 'string'
    || !['MANUAL', 'VOICE', 'TEXT'].includes(input.inputMethod)
    || !Array.isArray(input.dependsOnActionIds)
    || !input.dependsOnActionIds.every(id => typeof id === 'string' && id.trim() && id !== input.actionId)
    || new Set(input.dependsOnActionIds).size !== input.dependsOnActionIds.length) return false;
  return isObject(input.payload);
}

export function actionIdOf(input: unknown): string {
  return isObject(input) && typeof input.actionId === 'string' ? input.actionId : '';
}

/** Converts a candidate check into the shared ValidationResult shape. */
export function toValidationResult<T>(actionId: string, check: CandidateCheck<T>): ValidationResult {
  if (check.status === 'INVALID') {
    return { actionId, status: 'INVALID', errorCode: check.errorCode, errorMessage: check.errorMessage };
  }
  if (check.status === 'MISSING') {
    const [first, ...rest] = check.missing.map((item): ClarificationRequest => ({
      actionId, field: `payload.${item.field}`, reason: 'MISSING', question: item.question,
    }));
    return { actionId, status: 'NEEDS_CLARIFICATION', clarifications: [first, ...rest] };
  }
  return { actionId, status: 'VALID' };
}

export function invalid<T>(errorCode: string, errorMessage: string): CandidateCheck<T> {
  return { status: 'INVALID', errorCode, errorMessage };
}

/** Title is required: blank asks a question, over 100 characters is rejected. */
export function checkTitle(value: unknown, question: string): { title: string } | { missing: MissingField } | { invalid: CandidateCheck<never> } {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return { missing: { field: 'title', question } };
  }
  if (typeof value !== 'string') return { invalid: invalid('INVALID_TITLE', 'title must be a string.') };
  const title = value.trim();
  if (textLength(title) > TITLE_MAX_LENGTH) {
    return { invalid: invalid('TITLE_TOO_LONG', `title must be at most ${TITLE_MAX_LENGTH} characters.`) };
  }
  return { title };
}

/** Pure check of a complete event candidate; used for creation and for merged updates.
 * Invalid supplied values take precedence over missing-field questions.
 */
export function checkEventCandidate(payload: Record<string, unknown>): CandidateCheck<EventCandidate> {
  const missing: MissingField[] = [];
  const title = checkTitle(payload.title, '일정 제목이 무엇인가요?');
  if ('invalid' in title) return title.invalid;
  if ('missing' in title) missing.push(title.missing);

  if (typeof payload.timezone !== 'string' || !payload.timezone.trim()) {
    return invalid('INVALID_TIMEZONE', 'timezone must be a non-empty IANA timezone identifier.');
  }
  if (!isVisibility(payload.visibility)) return invalid('INVALID_VISIBILITY', 'visibility must be PUBLIC or PRIVATE.');

  let location: string | null = null;
  if (payload.location !== null && payload.location !== undefined) {
    if (typeof payload.location !== 'string') return invalid('INVALID_LOCATION', 'location must be a string or null.');
    location = payload.location.trim() || null;
    if (location !== null && textLength(location) > LOCATION_MAX_LENGTH) {
      return invalid('LOCATION_TOO_LONG', `location must be at most ${LOCATION_MAX_LENGTH} characters.`);
    }
  }

  const startAt = payload.startAt ?? null;
  const endAt = payload.endAt ?? null;
  const fuzzyTime = payload.fuzzyTime ?? null;
  const date = payload.date ?? null;
  if (startAt !== null && !isUtcDateTime(startAt)) return invalid('INVALID_START_AT', 'startAt must be a valid absolute UTC ISO timestamp.');
  if (endAt !== null && !isUtcDateTime(endAt)) return invalid('INVALID_END_AT', 'endAt must be a valid absolute UTC ISO timestamp.');
  if (date !== null && !isLocalDate(date)) return invalid('INVALID_DATE', 'date must be a real calendar date in YYYY-MM-DD form.');
  if (fuzzyTime !== null && typeof fuzzyTime !== 'string') return invalid('INVALID_FUZZY_TIME', 'fuzzyTime must be a string or null.');

  const timeKind = payload.timeKind ?? null;
  let candidateTime: Pick<EventCandidate, 'startAt' | 'endAt' | 'fuzzyTime' | 'date'> | null = null;
  if (timeKind === null) {
    missing.push({ field: 'timeKind', question: '언제인가요?' });
  } else if (timeKind === 'EXACT') {
    if (fuzzyTime !== null || date !== null) return invalid('INVALID_TIME_SHAPE', 'EXACT events must not have fuzzyTime or date.');
    if (startAt === null) missing.push({ field: 'startAt', question: '몇 시인가요?' });
    else if (endAt !== null && Date.parse(endAt) <= Date.parse(startAt)) {
      return invalid('END_BEFORE_START', '종료 시각은 시작 시각보다 뒤여야 해요.');
    }
    if (startAt !== null) candidateTime = { startAt, endAt, fuzzyTime: null, date: null };
  } else if (timeKind === 'FUZZY') {
    if (startAt !== null || endAt !== null) return invalid('INVALID_TIME_SHAPE', 'FUZZY events must not have startAt or endAt.');
    const text = typeof fuzzyTime === 'string' ? fuzzyTime.trim() : '';
    if (!text) missing.push({ field: 'fuzzyTime', question: '대략 언제쯤인가요?' });
    if (date === null) missing.push({ field: 'date', question: '어느 날인가요?' });
    if (text && date !== null) candidateTime = { startAt: null, endAt: null, fuzzyTime: text, date };
  } else if (timeKind === 'ALL_DAY') {
    if (startAt !== null || endAt !== null || fuzzyTime !== null) {
      return invalid('INVALID_TIME_SHAPE', 'ALL_DAY events must not have startAt, endAt or fuzzyTime.');
    }
    if (date === null) missing.push({ field: 'date', question: '어느 날인가요?' });
    else candidateTime = { startAt: null, endAt: null, fuzzyTime: null, date };
  } else {
    return invalid('INVALID_TIME_KIND', 'timeKind must be EXACT, FUZZY or ALL_DAY.');
  }

  const [first, ...rest] = missing;
  if (first) return { status: 'MISSING', missing: [first, ...rest] };
  if (!('title' in title) || candidateTime === null || timeKind === null) return invalid('INVALID_PROPOSAL', 'Event candidate is incomplete.');
  return {
    status: 'OK',
    candidate: {
      title: title.title, timeKind, ...candidateTime,
      timezone: payload.timezone, location, visibility: payload.visibility,
    },
  };
}

const EVENT_CHANGE_KEYS = ['title', 'timeKind', 'startAt', 'endAt', 'fuzzyTime', 'date', 'timezone', 'location', 'visibility'];

export function validateCreateEvent(input: unknown): ValidationResult {
  const actionId = actionIdOf(input);
  if (!hasProposalEnvelope(input, 'CREATE_EVENT')) {
    return { actionId, status: 'INVALID', errorCode: 'INVALID_PROPOSAL', errorMessage: 'Expected a structurally valid CREATE_EVENT proposal.' };
  }
  return toValidationResult(actionId, checkEventCandidate(input.payload));
}

/** Structure only: the merged result is checked against the current event by the executor. */
export function validateUpdateEvent(input: unknown): ValidationResult {
  return validateUpdateEnvelope(input, 'UPDATE_EVENT', EVENT_CHANGE_KEYS);
}

export function validateUpdateEnvelope(input: unknown, type: ActionType, allowedKeys: readonly string[]): ValidationResult {
  const actionId = actionIdOf(input);
  const fail = (errorMessage: string): ValidationResult => ({ actionId, status: 'INVALID', errorCode: 'INVALID_PROPOSAL', errorMessage });
  if (!hasProposalEnvelope(input, type)) return fail(`Expected a structurally valid ${type} proposal.`);
  const { payload } = input;
  if (typeof payload.targetId !== 'string' || !payload.targetId.trim()) {
    return { actionId, status: 'NEEDS_CLARIFICATION', clarifications: [{ actionId, field: 'payload.targetId', reason: 'MISSING', question: '어떤 항목을 바꿀까요?' }] };
  }
  if (!isUtcDateTime(payload.expectedUpdatedAt)) return fail('expectedUpdatedAt is required concurrency evidence.');
  const changes = payload.changes;
  if (!isObject(changes)) return fail('changes must be an object.');
  const keys = Object.keys(changes);
  if (!keys.length) return fail('changes must not be empty.');
  if (keys.some(key => !allowedKeys.includes(key) || changes[key] === undefined)) return fail('changes contains an unsupported or undefined field.');
  return { actionId, status: 'VALID' };
}

/** Complete, delete and cancel actions: a live target plus concurrency evidence. */
export function validatePlannerTarget(input: unknown, type: PlannerTargetProposal['type']): ValidationResult {
  const actionId = actionIdOf(input);
  if (!hasProposalEnvelope(input, type)) {
    return { actionId, status: 'INVALID', errorCode: 'INVALID_PROPOSAL', errorMessage: `Expected a structurally valid ${type} proposal.` };
  }
  if (typeof input.payload.targetId !== 'string' || !input.payload.targetId.trim()) {
    return { actionId, status: 'NEEDS_CLARIFICATION', clarifications: [{ actionId, field: 'payload.targetId', reason: 'MISSING', question: '어떤 항목인가요?' }] };
  }
  if (!isUtcDateTime(input.payload.expectedUpdatedAt)) {
    return { actionId, status: 'INVALID', errorCode: 'INVALID_PROPOSAL', errorMessage: 'expectedUpdatedAt is required concurrency evidence.' };
  }
  return { actionId, status: 'VALID' };
}
