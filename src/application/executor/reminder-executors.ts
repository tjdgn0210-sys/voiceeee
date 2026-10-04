import type { Reminder } from '../../domain/reminder/reminder';
import { validatePlannerTarget } from '../validator/validate-event';
import {
  resolveReminderFireAt, validateCreateReminder, type CreateReminderProposal, type ReminderTarget,
} from '../validator/validate-reminder';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ValidationResult } from '../validator/validation-result';
import {
  PlannerActionError, requireCurrent, runPlannerAction, type PlannerExecutionDependencies, type PlannerExecutionOutcome,
} from './planner-execution';

type CancelReminderProposal = Extract<ActionProposal, { type: 'CANCEL_REMINDER' }>;

/** Persists reminder state only; never schedules or cancels OS notifications (M1-08).
 * New reminders are REQUESTED. SCHEDULED is recorded only after real scheduling succeeds.
 */
export function createReminderExecutors(dependencies: PlannerExecutionDependencies) {
  return {
    create(proposal: CreateReminderProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, validateCreateReminder, async (snapshot, context) => {
        const { payload } = snapshot;
        // ACTION targets always carry a dependency, so they were skipped before reaching here.
        if (payload.target?.kind !== 'ENTITY' || payload.timezone === null) {
          throw new PlannerActionError('INVALID_PROPOSAL', 'Reminder target must be an existing entity.');
        }
        const { targetType, targetId } = payload.target;
        let target: ReminderTarget;
        if (targetType === 'EVENT') {
          const event = await context.repositories.events.findById(targetId);
          if (!event) throw new PlannerActionError('TARGET_NOT_FOUND', 'The event does not exist or was deleted.');
          target = { targetType, event };
        } else {
          const task = await context.repositories.tasks.findById(targetId);
          if (!task) throw new PlannerActionError('TARGET_NOT_FOUND', 'The task does not exist or was deleted.');
          target = { targetType, task };
        }
        const time = resolveReminderFireAt({ fireAt: payload.fireAt, relativeOffsetMinutes: payload.relativeOffsetMinutes }, target);
        if (time.status === 'INVALID') throw new PlannerActionError(time.errorCode, time.errorMessage);
        const reminder: Reminder = {
          id: context.entityId, targetType, targetId, fireAt: time.fireAt, timezone: payload.timezone,
          relativeOffsetMinutes: payload.relativeOffsetMinutes, deliveryMode: 'LOCAL', lastError: null,
          status: 'REQUESTED', cancelledAt: null, createdAt: context.timestamp, updatedAt: context.timestamp,
        };
        await context.repositories.reminders.create(reminder);
        return { affectedEntityId: reminder.id, reversalData: {}, affectedReminderIds: [reminder.id] };
      });
    },

    cancel(proposal: CancelReminderProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, input => validatePlannerTarget(input, 'CANCEL_REMINDER'), async (snapshot, context) => {
        const { reminders } = context.repositories;
        const current = requireCurrent(await reminders.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        if (current.status === 'CANCELLED') throw new PlannerActionError('ALREADY_CANCELLED', 'The reminder is already cancelled.');
        const stamp = context.stampAfter(current.updatedAt);
        if (!await reminders.update({ ...current, status: 'CANCELLED', cancelledAt: stamp, updatedAt: stamp })) {
          throw new PlannerActionError('TARGET_NOT_FOUND', 'The reminder changed during the operation.');
        }
        return {
          affectedEntityId: current.id,
          reversalData: { priorStatus: current.status, priorLastError: current.lastError, appliedUpdatedAt: stamp },
          affectedReminderIds: [current.id],
        };
      });
    },
  };
}
