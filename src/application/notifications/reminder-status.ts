import type { ISODateTime } from '../../domain/common/primitives';
import type { Reminder } from '../../domain/reminder/reminder';

export type ReminderStatusView = {
  text: string;
  /** Needs the user's attention (failed, blocked). */
  attention: boolean;
  /** Shows a "다시 시도" button: only a real scheduling failure qualifies, not a limit or a passed time. */
  retryable: boolean;
};

/**
 * What the user reads for one reminder. SCHEDULED only says it was handed to the system: delivery is never claimed.
 * REQUESTED without an error is simply not scheduled yet (waiting, or beyond the system's pending limit).
 */
export function describeReminder(reminder: Reminder, now: ISODateTime): ReminderStatusView {
  switch (reminder.status) {
    case 'CANCELLED':
      return { text: '취소됨', attention: false, retryable: false };
    case 'SCHEDULED':
      return { text: '예약됨', attention: false, retryable: false };
    case 'PERMISSION_BLOCKED':
      return { text: '알림 꺼짐 · 기기의 알림 권한이 꺼져 있어요', attention: true, retryable: false };
    case 'REQUESTED':
      if (reminder.lastError !== null) return { text: '예약 실패, 다시 시도', attention: true, retryable: true };
      if (Date.parse(reminder.fireAt) <= Date.parse(now)) return { text: '알림 시각이 지났어요', attention: false, retryable: false };
      return { text: '예약 대기', attention: false, retryable: false };
  }
}
