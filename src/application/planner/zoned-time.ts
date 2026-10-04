import type { ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';
import { isLocalDate } from '../validator/local-date';

/**
 * Wall-clock helpers for one IANA timezone (events keep their own timezone, blueprint 13.4).
 * Pure and dependency-free; they use Intl.DateTimeFormat, so Node and Hermes must both ship the timezone data.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: Timezone): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of an instant, expressed as if it were UTC (milliseconds). */
function wallClockAsUtcMs(utcMs: number, timeZone: Timezone): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
}

const pad = (value: number) => String(value).padStart(2, '0');

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function deviceTimeZone(): Timezone {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

/** Date and time (HH:mm) of an instant in `timeZone`. */
export function utcToZonedFields(instant: ISODateTime, timeZone: Timezone): { date: LocalDate; time: string } {
  const wall = new Date(wallClockAsUtcMs(Date.parse(instant), timeZone));
  return {
    date: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    time: `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`,
  };
}

/** UTC instant of a wall-clock date and time in `timeZone`; null for malformed input or a time that does not exist (DST gap). */
export function zonedWallTimeToUtc(date: string, time: string, timeZone: Timezone): ISODateTime | null {
  if (!isLocalDate(date) || !isClockTime(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  let utcMs = wallMs;
  for (let attempt = 0; attempt < 2; attempt += 1) utcMs = wallMs - (wallClockAsUtcMs(utcMs, timeZone) - utcMs);
  const back = utcToZonedFields(new Date(utcMs).toISOString(), timeZone);
  return back.date === date && back.time === time ? new Date(utcMs).toISOString() : null;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const parse = (value: LocalDate) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
