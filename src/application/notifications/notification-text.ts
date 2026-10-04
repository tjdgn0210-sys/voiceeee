/**
 * The line shown in the notification (blueprint 8.3):
 *   title shown:  "병원 예약 · 30분 후 (강남세브란스)"
 *   title hidden: "일정 알림 · 30분 후"
 * The offset is signed minutes from the start (0 = at the time, -30 = 30 minutes before).
 */

export type NotificationTarget = 'EVENT' | 'TASK';

/** How far away the start is when the notification rings: "지금", "30분 후", "1시간 후", "내일". */
export function offsetPhrase(offsetMinutes: number): string {
  const minutes = -offsetMinutes;
  if (minutes <= 0) return '지금';
  if (minutes === 1440) return '내일';
  if (minutes % 60 === 0 && minutes < 1440) return `${minutes / 60}시간 후`;
  if (minutes < 60) return `${minutes}분 후`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후`;
}

export function buildNotificationText(input: {
  target: NotificationTarget;
  title: string;
  location: string | null;
  /** null for a reminder with a fixed time and no offset. */
  offsetMinutes: number | null;
  showTitle: boolean;
}): string {
  const when = input.offsetMinutes === null ? null : offsetPhrase(input.offsetMinutes);
  if (input.target === 'TASK') {
    const due = when === null ? '' : when === '지금' ? ' · 지금 마감' : ` · 마감 ${when}`;
    return input.showTitle ? `${input.title}${due}` : `할 일 알림${due}`;
  }
  const suffix = when === null ? '' : ` · ${when}`;
  if (!input.showTitle) return `일정 알림${suffix}`;
  return `${input.title}${suffix}${input.location ? ` (${input.location})` : ''}`;
}
