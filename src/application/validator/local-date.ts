import type { ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';

/** Real calendar dates only: 2026-02-30 and 2026-1-3 are rejected. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Calendar date of an instant in an IANA timezone. Throws for an unknown timezone or instant. */
export function localDateIn(timezone: Timezone, instant: ISODateTime): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: 'year' | 'month' | 'day') => parts.find(item => item.type === type)?.value;
  const result = `${part('year')}-${part('month')}-${part('day')}`;
  if (!isLocalDate(result)) throw new Error('Could not resolve a local date.');
  return result;
}
