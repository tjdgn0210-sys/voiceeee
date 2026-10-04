import type { EntityId, ISODateTime, LocalDate } from '../common/primitives';
import type { Event } from './event';

/** Normal reads exclude soft-deleted rows. Writes accept full validated entities.
 * update preserves id/createdAt and never restores a deleted row.
 * update/softDelete return false when no live row matches; database errors propagate.
 * softDelete sets both deletedAt and updatedAt to the supplied timestamp.
 * restore is only for Undo of a deletion: it clears deletedAt when it still equals
 * expectedDeletedAt, sets updatedAt to restoredAt, and returns false otherwise.
 */
export interface EventRepository {
  create(entity: Event): Promise<void>;
  findById(id: EntityId): Promise<Event | null>;
  listUpcoming(): Promise<Event[]>;
  /** Live events of any status that start in [fromAt, untilAt) (EXACT) or fall on [fromDate, untilDate) (ALL_DAY and dated FUZZY). */
  listInRange(range: { fromAt: ISODateTime; untilAt: ISODateTime; fromDate: LocalDate; untilDate: LocalDate }): Promise<Event[]>;
  /** Every live event, for export. Order: EXACT by start, then dated, then undated. */
  listAll(): Promise<Event[]>;
  update(entity: Event): Promise<boolean>;
  softDelete(id: EntityId, deletedAt: ISODateTime): Promise<boolean>;
  restore(id: EntityId, expectedDeletedAt: ISODateTime, restoredAt: ISODateTime): Promise<boolean>;
}
