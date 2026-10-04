import type { ISODateTime, LocalDate } from '../common/primitives';
import type { Event, EventStatus } from './event';

/** Read-time lifecycle; PAST is never written to storage by elapsed time.
 * `todayInEventTimezone` is the caller-resolved calendar date of `now` in event.timezone.
 * Only UPCOMING changes: EXACT becomes PAST once its end (or start) has passed,
 * ALL_DAY and dated FUZZY once their date is before today. Undated FUZZY never does.
 * Never returns COMPLETED for an UPCOMING event.
 */
export function eventLifecycleStatus(event: Event, now: ISODateTime, todayInEventTimezone: LocalDate): EventStatus {
  if (event.status !== 'UPCOMING') return event.status;
  if (event.kind === 'EXACT') {
    return Date.parse(event.endAt ?? event.startAt) <= Date.parse(now) ? 'PAST' : 'UPCOMING';
  }
  if (event.date === null) return 'UPCOMING';
  return event.date < todayInEventTimezone ? 'PAST' : 'UPCOMING';
}
