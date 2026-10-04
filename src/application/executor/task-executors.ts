import type { Task } from '../../domain/task/task';
import type { ReversalValue } from '../undo/undo-record';
import { validatePlannerTarget } from '../validator/validate-event';
import {
  checkTaskCandidate, validateCreateTask, validateUpdateTask, type CreateTaskProposal, type UpdateTaskProposal,
} from '../validator/validate-task';
import type { ActionProposal } from '../proposals/action-proposal';
import type { ValidationResult } from '../validator/validation-result';
import {
  adjustTargetReminders, PlannerActionError, requireCurrent, runPlannerAction,
  type PlannerExecutionDependencies, type PlannerExecutionOutcome,
} from './planner-execution';

type TaskTargetProposal = Extract<ActionProposal, { type: 'COMPLETE_TASK' | 'DELETE_TASK' }>;

/** Fields an update may change and Undo may restore. */
export const TASK_EDITABLE_FIELDS = ['title', 'dueAt', 'visibility', 'status', 'completedAt'] as const;

/** Create, update (including reopen), complete and delete tasks through the shared pipeline.
 * A dueAt change retimes relative reminders; clearing dueAt cancels them; deleting cancels all.
 * Completing a task leaves its reminders unchanged (README 3.1 #19).
 */
export function createTaskExecutors(dependencies: PlannerExecutionDependencies) {
  return {
    create(proposal: CreateTaskProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, validateCreateTask, async (snapshot, context) => {
        const check = checkTaskCandidate(snapshot.payload as unknown as Record<string, unknown>);
        if (check.status !== 'OK') throw new PlannerActionError('INVALID_PROPOSAL', 'Task input changed after validation.');
        const task: Task = {
          id: context.entityId, ...check.candidate, status: 'OPEN', completedAt: null, sourceActionId: snapshot.actionId,
          createdAt: context.timestamp, updatedAt: context.timestamp, deletedAt: null,
        };
        await context.repositories.tasks.create(task);
        return { affectedEntityId: task.id, reversalData: {}, affectedReminderIds: [] };
      });
    },

    update(proposal: UpdateTaskProposal, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, validateUpdateTask, async (snapshot, context) => {
        const { tasks } = context.repositories;
        const current = requireCurrent(await tasks.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        const { status, ...fieldChanges } = snapshot.payload.changes;
        const check = checkTaskCandidate({ title: current.title, dueAt: current.dueAt, visibility: current.visibility, ...fieldChanges });
        if (check.status === 'INVALID') throw new PlannerActionError(check.errorCode, check.errorMessage);
        if (check.status === 'MISSING') throw new PlannerActionError('INCOMPLETE_CHANGES', 'Missing after the change: title.');
        if (status === 'OPEN' && current.status !== 'COMPLETED') {
          throw new PlannerActionError('INVALID_STATE', 'Only a completed task can be reopened.');
        }
        const stamp = context.stampAfter(current.updatedAt);
        const next: Task = {
          ...current, ...check.candidate, updatedAt: stamp,
          ...(status === 'OPEN' ? { status: 'OPEN' as const, completedAt: null } : {}),
        };
        const prior: { [key: string]: ReversalValue } = {};
        for (const field of TASK_EDITABLE_FIELDS) if (next[field] !== current[field]) prior[field] = current[field];
        if (!await tasks.update(next)) throw new PlannerActionError('TARGET_NOT_FOUND', 'The task changed during the operation.');
        const reminders = next.dueAt !== current.dueAt
          ? await adjustTargetReminders(context, 'TASK', next.id, next.dueAt, false) : [];
        return {
          affectedEntityId: next.id, reversalData: { prior, appliedUpdatedAt: stamp, reminders },
          affectedReminderIds: reminders.map(item => item.id),
        };
      });
    },

    complete(proposal: Extract<TaskTargetProposal, { type: 'COMPLETE_TASK' }>, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, input => validatePlannerTarget(input, 'COMPLETE_TASK'), async (snapshot, context) => {
        const { tasks } = context.repositories;
        const current = requireCurrent(await tasks.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        if (current.status !== 'OPEN') throw new PlannerActionError('INVALID_STATE', `A ${current.status} task cannot be completed.`);
        const stamp = context.stampAfter(current.updatedAt);
        if (!await tasks.update({ ...current, status: 'COMPLETED', completedAt: stamp, updatedAt: stamp })) {
          throw new PlannerActionError('TARGET_NOT_FOUND', 'The task changed during the operation.');
        }
        return {
          affectedEntityId: current.id,
          reversalData: { priorStatus: current.status, priorCompletedAt: current.completedAt, appliedUpdatedAt: stamp },
          affectedReminderIds: [],
        };
      });
    },

    delete(proposal: Extract<TaskTargetProposal, { type: 'DELETE_TASK' }>, validation: ValidationResult): Promise<PlannerExecutionOutcome> {
      return runPlannerAction(dependencies, proposal, validation, input => validatePlannerTarget(input, 'DELETE_TASK'), async (snapshot, context) => {
        const { tasks } = context.repositories;
        const current = requireCurrent(await tasks.findById(snapshot.payload.targetId!), snapshot.payload.expectedUpdatedAt);
        const stamp = context.stampAfter(current.updatedAt);
        if (!await tasks.softDelete(current.id, stamp)) throw new PlannerActionError('TARGET_NOT_FOUND', 'The task changed during the operation.');
        const reminders = await adjustTargetReminders(context, 'TASK', current.id, null, true);
        return {
          affectedEntityId: current.id, reversalData: { deletedAt: stamp, reminders },
          affectedReminderIds: reminders.map(item => item.id),
        };
      });
    },
  };
}
