import type { EntityId, ISODateTime } from '../../domain/common/primitives';
import type { NotificationPermission } from './resolve-silence';

export type ScheduleRequest = {
  /** Used as the system notification identifier, so scheduling again replaces the earlier one. */
  reminderId: EntityId;
  fireAt: ISODateTime;
  /** The whole visible line (blueprint 8.3). */
  title: string;
};

export type ScheduleOutcome =
  | { status: 'SCHEDULED' }
  | { status: 'PERMISSION_BLOCKED' }
  | { status: 'FAILED'; reason: string };

/**
 * The operating system's local notifications. Implemented in adapters/notifications; the application layer only sees this contract.
 * `schedule` returning SCHEDULED means the system accepted the request, not that a notification was shown.
 */
export interface NotificationAdapter {
  getPermissionState(): Promise<NotificationPermission>;
  /** Shows the system prompt when the user has not answered yet; returns the resulting state. */
  requestPermission(): Promise<NotificationPermission>;
  schedule(request: ScheduleRequest): Promise<ScheduleOutcome>;
  cancel(reminderId: EntityId): Promise<void>;
  /** Identifiers (reminder ids) the system still has pending. */
  listScheduledIds(): Promise<EntityId[]>;
}
