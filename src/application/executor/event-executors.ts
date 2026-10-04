import type { Event, EventTime } from '../../domain/event/event';
import type { ReversalValue } from '../undo/undo-record';
import {
  checkEventCandidate, validateCreateEvent, validatePlannerTarget, validateUpdateEvent,
  type CreateEventProposal, type EventCandidate, type UpdateEventProposal,
} from '../validator/validate-event';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ValidationResult } from '../validator/validation-result';
import {
  adjustTargetReminders, PlannerActionError, requireCurrent, runPlannerAction,
  type PlannerExecutionDependencies, type PlannerExecutionOutcome,
} from './planner-execution';

type EventTargetProposal = Extract<ActionProposal, { type: 'COMPLETE_EVENT' | 'DELETE_EVENT' }>;
type EventFieldsOnly = Omit<Event, keyof EventTime>;

/** Fields an update may change and Undo may restore, in Event terms. */
export const EVENT_EDITABLE_FIELDS = ['title', 'kind', 'startAt', 'endAt', 'fuzzyTime', 'date', 'timezone', 'location', 'visibility'] as const;

export function eventFromCandidate(fields: EventFieldsOnly, candidate: EventCandidate): Event {
  const base = { ...fields, title: candidate.title, endAt: candidate.endAt, timezone: candidate.timezone, location: candidate.location, visibility: candidate.visibility };
  if (candidate.timeKind === 'EXACT' && candidate.startAt !== null) {
    return { ...base, kind: 'EXACT', startAt: candidate.startAt, fuzzyTime: null, date: null };
  }
  if (candidate.timeKind === 'FUZZY' && candidate.fuzzyTime !== null) {
    return { ...base, kind: 'FUZZY', startAt: null, fuzzyTime: candidate.fuzzyTime, date: candidate.date };
  }
  if (candidate.timeKind === 'ALL_DAY' && candidate.date !== null) {
    return { ...base, endAt: null, kind: 'ALL_DAY', startAt: null, fuzzyTime: null, date: candidate.date };
  }
  throw new PlannerActionError('INVALID_TIME_SHAPE', 'Event time fields do not match the time kind.');
}

/** Candidate input that reproduces an existing event (used to merge partial changes). */
export function eventCandidateInput(event: Event): Record<string, unknown> {
  return {
    title: event.title, timeKind: event.kind, startAt: event.startAt, endAt: event.endAt, fuzzyTime: event.fuzzyTime,
    date: event.date, timezone: event.timezone, location: event.location, visibility: event.visibility,
  };
}

function eventFields(event: Event): EventFieldsOnly {
  return {
    id: event.id, title: event.title, endAt: event.endAt, timezone: event.timezone, location: event.location,
    status: event.status, visibility: event.visibility, sourceActionId: event.sourceActionId,
    createdAt: event.createdAt, updatedAt: event.updatedAt, deletedAt: event.deletedAt,
  };
}

/** Create, update, complete and delete events through proposal → validation → atomic write → ActionLog.
 * Reminders stay consistent: a time change retimes relative reminders; leaving EXACT or deleting cancels them.
 * Completing an event leaves its reminders unchanged (README 3.1 #19).
 */
export function createEventExecutors(dependencies: PlannerExecutionDependencies) {
  return {
    create(proposal: CreateEventProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, validateCreateEvent, async (snapshot, context) => {
        const check = checkEventCandidate(snapshot.payload as unknown as Record<string, unknown>);
        if (check.status !== 'OK') throw new PlannerActionError('INVALID_PROPOSAL', 'Event input changed after validation.');
        const event = eventFromCandidate({
          id: context.entityId, title: '', endAt: null, timezone: '', location: null, status: 'UPCOMING', visibility: 'PRIVATE',
          sourceActionId: snapshot.actionId, createdAt: context.timestamp, updatedAt: context.timestamp, deletedAt: null,
        }, check.candidate);
        await context.repositories.events.create(event);
        return { affectedEntityId: event.id, reversalData: {}, affectedReminderIds: [] };
      });
    },

    update(proposal: UpdateEventProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, validateUpdateEvent, async (snapshot, context) => {
        const { events } = context.repositories;
        const current = requireCurrent(await events.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        const changes = snapshot.payload.changes as Record<string, unknown>;
        const input = eventCandidateInput(current);
        if (changes.timeKind !== undefined && changes.timeKind !== current.kind) {
          // Switching kind starts from empty time fields; only the supplied ones apply.
          Object.assign(input, { startAt: null, endAt: null, fuzzyTime: null, date: null });
        }
        Object.assign(input, changes);
        const check = checkEventCandidate(input);
        if (check.status === 'INVALID') throw new PlannerActionError(check.errorCode, check.errorMessage);
        if (check.status === 'MISSING') {
          throw new PlannerActionError('INCOMPLETE_CHANGES', `Missing after the change: ${check.missing.map(item => item.field).join(', ')}.`);
        }
        const stamp = context.stampAfter(current.updatedAt);
        const next = eventFromCandidate({ ...eventFields(current), updatedAt: stamp }, check.candidate);
        const prior: { [key: string]: ReversalValue } = {};
        for (const field of EVENT_EDITABLE_FIELDS) if (next[field] !== current[field]) prior[field] = current[field];
        if (!await events.update(next)) throw new PlannerActionError('TARGET_NOT_FOUND', 'The event changed during the operation.');
        let reminders: Awaited<ReturnType<typeof adjustTargetReminders>> = [];
        if (next.kind !== 'EXACT') reminders = await adjustTargetReminders(context, 'EVENT', next.id, null, true);
        else if (current.kind === 'EXACT' && next.startAt !== current.startAt) {
          reminders = await adjustTargetReminders(context, 'EVENT', next.id, next.startAt, false);
        }
        return {
          affectedEntityId: next.id, reversalData: { prior, appliedUpdatedAt: stamp, reminders },
          affectedReminderIds: reminders.map(item => item.id),
        };
      });
    },

    complete(proposal: Extract<EventTargetProposal, { type: 'COMPLETE_EVENT' }>, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, input => validatePlannerTarget(input, 'COMPLETE_EVENT'), async (snapshot, context) => {
        const { events } = context.repositories;
        const current = requireCurrent(await events.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
          throw new PlannerActionError('INVALID_STATE', `A ${current.status} event cannot be completed.`);
        }
        const stamp = context.stampAfter(current.updatedAt);
        if (!await events.update({ ...current, status: 'COMPLETED', updatedAt: stamp })) {
          throw new PlannerActionError('TARGET_NOT_FOUND', 'The event changed during the operation.');
        }
        return { affectedEntityId: current.id, reversalData: { priorStatus: current.status, appliedUpdatedAt: stamp }, affectedReminderIds: [] };
      });
    },

    delete(proposal: Extract<EventTargetProposal, { type: 'DELETE_EVENT' }>, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, input => validatePlannerTarget(input, 'DELETE_EVENT'), async (snapshot, context) => {
        const { events } = context.repositories;
        const current = requireCurrent(await events.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        const stamp = context.stampAfter(current.updatedAt);
        if (!await events.softDelete(current.id, stamp)) throw new PlannerActionError('TARGET_NOT_FOUND', 'The event changed during the operation.');
        const reminders = await adjustTargetReminders(context, 'EVENT', current.id, null, true);
        return {
          affectedEntityId: current.id, reversalData: { deletedAt: stamp, reminders },
          affectedReminderIds: reminders.map(item => item.id),
        };
      });
    },
  };
}
