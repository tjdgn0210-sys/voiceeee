import type { EntityId, ISODateTime, LocalDate, Timezone, Visibility } from '../common/primitives';

/** Elapsed time makes an event PAST, never automatically COMPLETED. */
export type EventStatus = 'UPCOMING' | 'PAST' | 'COMPLETED' | 'CANCELLED';

/** Validator checks timestamp validity and non-empty fuzzy text before persistence.
 * `date` is in the event timezone. FUZZY rows saved before migration 003 have no date;
 * the validator requires one for new FUZZY events. ALL_DAY events have no endAt.
 */
export type EventTime =
  | { kind: 'EXACT'; startAt: ISODateTime; fuzzyTime: null; date: null }
  | { kind: 'FUZZY'; startAt: null; fuzzyTime: string; date: LocalDate | null }
  | { kind: 'ALL_DAY'; startAt: null; fuzzyTime: null; date: LocalDate };

interface EventFields {
  id: EntityId;
  title: string;
  endAt: ISODateTime | null;
  timezone: Timezone;
  location: string | null;
  status: EventStatus;
  visibility: Visibility;
  sourceActionId: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

/** Exactly one time mode; unresolved input remains an ActionProposal.
 * Validator checks endAt ordering and exact-time requirements for linked reminders.
 */
export type Event = EventFields & EventTime;
