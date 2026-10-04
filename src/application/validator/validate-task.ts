import type { ISODateTime, Visibility } from '../../domain/common/primitives';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ValidationResult } from './validation-result';
import { isUtcDateTime } from './utc-date-time';
import {
  actionIdOf, checkTitle, hasProposalEnvelope, invalid, isVisibility, toValidationResult, validateUpdateEnvelope,
  type CandidateCheck,
} from './validate-event';

export type CreateTaskProposal = Extract<ActionProposal, { type: 'CREATE_TASK' }>;
export type UpdateTaskProposal = Extract<ActionProposal, { type: 'UPDATE_TASK' }>;

export interface TaskCandidate {
  title: string;
  dueAt: ISODateTime | null;
  visibility: Visibility;
}

/** Pure check of a complete task candidate; used for creation and for merged updates. */
export function checkTaskCandidate(payload: Record<string, unknown>): CandidateCheck<TaskCandidate> {
  const title = checkTitle(payload.title, '할 일 제목이 무엇인가요?');
  if ('invalid' in title) return title.invalid;
  const dueAt = payload.dueAt ?? null;
  if (dueAt !== null && !isUtcDateTime(dueAt)) return invalid('INVALID_DUE_AT', 'dueAt must be a valid absolute UTC ISO timestamp or null.');
  if (!isVisibility(payload.visibility)) return invalid('INVALID_VISIBILITY', 'visibility must be PUBLIC or PRIVATE.');
  if ('missing' in title) return { status: 'MISSING', missing: [title.missing] };
  return { status: 'OK', candidate: { title: title.title, dueAt, visibility: payload.visibility } };
}

export function validateCreateTask(input: unknown): ValidationResult {
  const actionId = actionIdOf(input);
  if (!hasProposalEnvelope(input, 'CREATE_TASK')) {
    return { actionId, status: 'INVALID', errorCode: 'INVALID_PROPOSAL', errorMessage: 'Expected a structurally valid CREATE_TASK proposal.' };
  }
  return toValidationResult(actionId, checkTaskCandidate(input.payload));
}

/** Structure only, plus status: only 'OPEN' (reopen) may be requested through an update. */
export function validateUpdateTask(input: unknown): ValidationResult {
  const result = validateUpdateEnvelope(input, 'UPDATE_TASK', ['title', 'dueAt', 'visibility', 'status']);
  if (result.status !== 'VALID') return result;
  const changes = (input as UpdateTaskProposal).payload.changes;
  if ('status' in changes && changes.status !== 'OPEN') {
    return { actionId: result.actionId, status: 'INVALID', errorCode: 'INVALID_STATUS_CHANGE', errorMessage: 'UPDATE_TASK may only reopen a task (status OPEN).' };
  }
  return result;
}
