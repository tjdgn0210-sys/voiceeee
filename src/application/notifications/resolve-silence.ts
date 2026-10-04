/**
 * Why an event's reminder will not ring (blueprint 8.2): global off > permission > own setting > friend setting.
 * The most restrictive setting wins, so the first matching reason is the one shown.
 */

/** Device notification permission. Only BLOCKED silences; UNDETERMINED means the OS prompt has not been answered yet. */
export type NotificationPermission = 'GRANTED' | 'BLOCKED' | 'UNDETERMINED';

export type SilenceInput = {
  /** Settings > notifications: all notifications. */
  allOn: boolean;
  /** Settings > notifications: reminders of my own events. */
  ownOn: boolean;
  permission: NotificationPermission;
  /** The sender's per-friend "event time reminders" switch; null when unknown or the item is not received. */
  friendNotifyEventTime: boolean | null;
  /** The event came from a friend (a received copy), not from the user. */
  isReceived: boolean;
};

export type SilenceReason = 'ALL_OFF' | 'PERMISSION_BLOCKED' | 'OWN_OFF' | 'FRIEND_OFF';

export type SilenceResult = { silent: false } | { silent: true; reason: SilenceReason };

export function resolveSilence(input: SilenceInput): SilenceResult {
  if (!input.allOn) return { silent: true, reason: 'ALL_OFF' };
  if (input.permission === 'BLOCKED') return { silent: true, reason: 'PERMISSION_BLOCKED' };
  if (!input.isReceived && !input.ownOn) return { silent: true, reason: 'OWN_OFF' };
  if (input.isReceived && input.friendNotifyEventTime === false) return { silent: true, reason: 'FRIEND_OFF' };
  return { silent: false };
}

/** One-line explanation for the event detail. `friendName` is the alias if the user set one, else the nickname. */
export function describeSilence(reason: SilenceReason, friendName: string): string {
  switch (reason) {
    case 'ALL_OFF': return '모든 알림이 꺼져 있어요';
    case 'PERMISSION_BLOCKED': return '기기의 알림 권한이 꺼져 있어요';
    case 'OWN_OFF': return '내 일정 알림이 꺼져 있어요';
    case 'FRIEND_OFF': return `${friendName}님 일정의 시각 알림을 꺼 두었어요`;
  }
}
