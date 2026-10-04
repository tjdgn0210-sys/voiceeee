import type { ISODateTime } from '../../domain/common/primitives';
import type { EventRepository } from '../../domain/event/event-repository';
import type { Reminder } from '../../domain/reminder/reminder';
import type { ReminderRepository } from '../../domain/reminder/reminder-repository';
import type { TaskRepository } from '../../domain/task/task-repository';
import type { AppSettings } from '../settings/app-settings';
import type { NotificationAdapter } from './notification-adapter';
import { buildNotificationText } from './notification-text';
import { resolveSilence, type NotificationPermission } from './resolve-silence';

/** iOS keeps at most 64 pending local notifications (blueprint 8.2); the nearest ones are scheduled and the rest wait. */
export const PENDING_NOTIFICATION_LIMIT = 64;

export type ReminderSyncDependencies = {
  reminders: Pick<ReminderRepository, 'listLive' | 'update'>;
  events: Pick<EventRepository, 'findById'>;
  tasks: Pick<TaskRepository, 'findById'>;
  adapter: NotificationAdapter;
  loadSettings(): Promise<AppSettings>;
  now(): ISODateTime;
  /** Lower only in tests. */
  limit?: number;
};

export type ReminderSyncReport = {
  permission: NotificationPermission;
  scheduled: number;
  /** Scheduling attempts the system rejected: these stay REQUESTED with a reason. */
  failed: number;
  /** Reminders waiting for permission. */
  blocked: number;
  /** Not scheduled yet only because of the pending limit. */
  waiting: number;
  /** What the user should read after a change; empty when everything is in order. */
  warnings: string[];
};

type Candidate = { reminder: Reminder; title: string };

/**
 * Keeps the system's pending notifications equal to the reminders the app wants, and records the result on each reminder:
 * SCHEDULED only after the system accepted it; PERMISSION_BLOCKED when notifications are not allowed; REQUESTED plus a reason when scheduling failed.
 * A reminder that is simply beyond the 64 nearest stays REQUESTED without a reason. Calls are queued, so two syncs never interleave.
 * Delivery is never claimed: SCHEDULED only means the system has it.
 */
export function createReminderSync(dependencies: ReminderSyncDependencies) {
  const limit = dependencies.limit ?? PENDING_NOTIFICATION_LIMIT;
  let tail: Promise<unknown> = Promise.resolve();

  async function setState(reminder: Reminder, status: 'REQUESTED' | 'SCHEDULED' | 'PERMISSION_BLOCKED', lastError: string | null): Promise<void> {
    if (reminder.status === status && reminder.lastError === lastError) return;
    // Bookkeeping of the system's state, not a user change: no ActionLog or Undo, and updatedAt moves so stale edits are still caught.
    const stamp = new Date(Math.max(Date.parse(dependencies.now()), Date.parse(reminder.updatedAt) + 1)).toISOString();
    await dependencies.reminders.update({ ...reminder, status, cancelledAt: null, lastError, updatedAt: stamp } as Reminder);
  }

  async function candidateFor(reminder: Reminder, settings: AppSettings): Promise<Candidate | null> {
    if (reminder.targetType === 'EVENT') {
      const event = await dependencies.events.findById(reminder.targetId);
      if (!event || event.kind !== 'EXACT') return null;
      return {
        reminder,
        title: buildNotificationText({ target: 'EVENT', title: event.title, location: event.location, offsetMinutes: reminder.relativeOffsetMinutes, showTitle: settings.lockscreenShowTitle }),
      };
    }
    const task = await dependencies.tasks.findById(reminder.targetId);
    if (!task || task.status !== 'OPEN') return null;
    return {
      reminder,
      title: buildNotificationText({ target: 'TASK', title: task.title, location: null, offsetMinutes: reminder.relativeOffsetMinutes, showTitle: settings.lockscreenShowTitle }),
    };
  }

  async function run(): Promise<ReminderSyncReport> {
    const settings = await dependencies.loadSettings();
    const permission = await dependencies.adapter.getPermissionState();
    const now = Date.parse(dependencies.now());
    const silence = resolveSilence({ allOn: settings.allOn, ownOn: settings.ownOn, permission, friendNotifyEventTime: null, isReceived: false });
    const live = await dependencies.reminders.listLive();
    const pending = new Set(await dependencies.adapter.listScheduledIds());

    // Who may ring: upcoming, target still valid, and no setting or missing permission silences it.
    // A switch set to off by the user keeps reminders REQUESTED (nothing is pending); a missing permission shows as PERMISSION_BLOCKED.
    const wanted: Candidate[] = [];
    const idle: Reminder[] = [];
    for (const reminder of live) {
      const candidate = await candidateFor(reminder, settings);
      if (!candidate || Date.parse(reminder.fireAt) <= now) { idle.push(reminder); continue; }
      if (silence.silent && silence.reason !== 'PERMISSION_BLOCKED') { idle.push(reminder); continue; }
      wanted.push(candidate);
    }
    wanted.sort((a, b) => Date.parse(a.reminder.fireAt) - Date.parse(b.reminder.fireAt) || a.reminder.id.localeCompare(b.reminder.id));
    const near = wanted.slice(0, limit);
    const far = wanted.slice(limit);
    const keep = new Set(permission === 'BLOCKED' ? [] : near.map(item => item.reminder.id));

    // The system must not keep anything we no longer want (cancelled, deleted, silenced, beyond the limit, or past).
    for (const id of pending) if (!keep.has(id)) { await dependencies.adapter.cancel(id); pending.delete(id); }

    const report: ReminderSyncReport = { permission, scheduled: 0, failed: 0, blocked: 0, waiting: far.length, warnings: [] };

    for (const reminder of idle) {
      // Past reminders keep their state (a SCHEDULED one has rung or was missed; we never claim which).
      if (Date.parse(reminder.fireAt) <= now) continue;
      if (reminder.status !== 'REQUESTED' || reminder.lastError !== null) await setState(reminder, 'REQUESTED', null);
    }
    for (const { reminder } of far) {
      if (reminder.status !== 'REQUESTED' || reminder.lastError !== null) await setState(reminder, 'REQUESTED', null);
    }

    for (const { reminder, title } of near) {
      if (permission === 'BLOCKED') {
        await setState(reminder, 'PERMISSION_BLOCKED', null);
        report.blocked += 1;
        continue;
      }
      // Already handed to the system with the current time and text: nothing to do. A REQUESTED one is always sent again (it was retimed or retried).
      if (reminder.status === 'SCHEDULED' && pending.has(reminder.id)) { report.scheduled += 1; continue; }
      const outcome = await dependencies.adapter.schedule({ reminderId: reminder.id, fireAt: reminder.fireAt, title });
      if (outcome.status === 'SCHEDULED') {
        await setState(reminder, 'SCHEDULED', null);
        report.scheduled += 1;
      } else if (outcome.status === 'PERMISSION_BLOCKED') {
        await setState(reminder, 'PERMISSION_BLOCKED', null);
        report.blocked += 1;
      } else {
        await setState(reminder, 'REQUESTED', outcome.reason);
        report.failed += 1;
      }
    }

    if (report.blocked > 0) report.warnings.push('기기의 알림 권한이 꺼져 있어 알림이 울리지 않아요. 설정에서 알림을 켜 주세요');
    if (report.failed > 0) report.warnings.push(`알림 ${report.failed}개를 예약하지 못했어요. 일정 상세에서 다시 시도할 수 있어요`);
    return report;
  }

  return {
    /** Reconciles the system's notifications with the saved reminders. Never throws for a single reminder; a broken adapter rejects the whole call. */
    sync(): Promise<ReminderSyncReport> {
      const result = tail.then(run);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

export type ReminderSync = ReturnType<typeof createReminderSync>;
