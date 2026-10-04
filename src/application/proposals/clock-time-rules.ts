/**
 * Deterministic clock-time resolution (blueprint 4.4, AGENTS.md "AMBIGUOUS TIME").
 *
 * Pure and dependency-free so the M3 gateway can mirror it. The server cannot import this file, so both
 * sides are checked against the same vectors in docs/impl/time-vectors.json.
 * The AI only reports the spoken numbers and whether an AM/PM cue existed; the final time is computed here.
 */

export type ClockTimeKind = 'EVENT' | 'EXPENSE';

export type ClockTimeInput = {
  /** Reference instant, UTC ISO. */
  now: string;
  /** IANA timezone the user speaks in, e.g. 'Asia/Seoul'. */
  timeZone: string;
  /** 0 = today (or no date said), 1 = tomorrow, ... counted on the calendar of `timeZone`. */
  dayOffset: number;
  /** The spoken number: 0 and 13-23 are 24-hour expressions; 1-12 are 12-hour numbers. */
  hour: number;
  minute: number;
  /** AM/PM cue the user said (오전, 오후, 아침, 저녁 ...); null/undefined when there was none. */
  meridiem?: 'AM' | 'PM' | null;
  /** The user answered [예] to "내일로 할까요?". */
  confirmedNextDay?: boolean;
  kind: ClockTimeKind;
};

export type ClockTimeResult =
  | { status: 'OK'; at: string; autoMeridiem: boolean }
  | { status: 'ASK_MERIDIEM' }
  | { status: 'ASK_TOMORROW' }
  | { status: 'ASK_YESTERDAY' };

type WallClock = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock reading of an instant, expressed as if it were UTC (milliseconds). */
function wallClockAsUtcMs(utcMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
}

function dateInZone(utcMs: number, timeZone: string): WallClock {
  const wall = new Date(wallClockAsUtcMs(utcMs, timeZone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/** Instant of a wall-clock time in `timeZone`; `day` may overflow the month (Date.UTC normalizes it). */
function instantOf(date: WallClock, dayShift: number, hour: number, minute: number, timeZone: string): number {
  const wallMs = Date.UTC(date.year, date.month - 1, date.day + dayShift, hour, minute);
  let utcMs = wallMs;
  for (let attempt = 0; attempt < 2; attempt += 1) utcMs = wallMs - (wallClockAsUtcMs(utcMs, timeZone) - utcMs);
  return utcMs;
}

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
}

/** Resolves a spoken clock time into one UTC instant or the question to ask. Throws RangeError for malformed input. */
export function resolveClockTime(input: ClockTimeInput): ClockTimeResult {
  const { hour, minute, timeZone } = input;
  assertInteger('hour', hour, 0, 23);
  assertInteger('minute', minute, 0, 59);
  assertInteger('dayOffset', input.dayOffset, -3660, 3660);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new RangeError('now must be a valid ISO date-time.');
  const confirmedNextDay = input.confirmedNextDay === true;
  if (confirmedNextDay && input.kind !== 'EVENT') throw new RangeError('confirmedNextDay applies to events only.');

  const today = dateInZone(nowMs, timeZone);
  const dayOffset = input.dayOffset + (confirmedNextDay ? 1 : 0);
  const instantAt = (dayShift: number, hour24: number) => instantOf(today, dayShift, hour24, minute, timeZone);
  const ok = (utcMs: number, autoMeridiem: boolean): ClockTimeResult => ({ status: 'OK', at: new Date(utcMs).toISOString(), autoMeridiem });

  // 0시, 자정 and 오전 12시 are 00:00 of the day after the stated date (D-10). 13-23 are used as spoken.
  if (hour === 0 || (hour === 12 && input.meridiem === 'AM')) return ok(instantAt(dayOffset + 1, 0), false);
  if (hour >= 13) return ok(instantAt(dayOffset, hour), false);
  // A cue wins over every rule below.
  if (input.meridiem === 'AM') return ok(instantAt(dayOffset, hour), false);
  if (input.meridiem === 'PM') return ok(instantAt(dayOffset, (hour % 12) + 12), false);

  return input.kind === 'EXPENSE'
    ? resolveExpense(dayOffset, hour, instantAt, nowMs, ok)
    : resolveEvent(dayOffset, hour, confirmedNextDay, instantAt, nowMs, ok);
}

type InstantAt = (dayShift: number, hour24: number) => number;
type Ok = (utcMs: number, autoMeridiem: boolean) => ClockTimeResult;

/** An event is in the future: the nearest time after now today, a fixed rule on later days. */
function resolveEvent(dayOffset: number, hour: number, confirmedNextDay: boolean, instantAt: InstantAt, nowMs: number, ok: Ok): ClockTimeResult {
  if (dayOffset === 0 && !confirmedNextDay) {
    if (hour === 12) {
      const noon = instantAt(0, 12);
      return noon > nowMs ? ok(noon, false) : { status: 'ASK_TOMORROW' };
    }
    const upcoming = [instantAt(0, hour), instantAt(0, hour + 12)].find(candidate => candidate > nowMs);
    return upcoming === undefined ? { status: 'ASK_TOMORROW' } : ok(upcoming, true);
  }
  if (hour === 12) return ok(instantAt(dayOffset, 12), false);
  if (hour <= 6) return ok(instantAt(dayOffset, hour + 12), true);
  // 7-11: ask, unless the user already postponed to the next day after the afternoon passed (4.4).
  return confirmedNextDay ? ok(instantAt(dayOffset, hour + 12), true) : { status: 'ASK_MERIDIEM' };
}

/** An expense is in the past: the nearest time before now today. Never assume yesterday. */
function resolveExpense(dayOffset: number, hour: number, instantAt: InstantAt, nowMs: number, ok: Ok): ClockTimeResult {
  if (dayOffset !== 0) return hour === 12 ? ok(instantAt(dayOffset, 12), false) : { status: 'ASK_MERIDIEM' };
  if (hour === 12) {
    const noon = instantAt(0, 12);
    return noon <= nowMs ? ok(noon, false) : { status: 'ASK_YESTERDAY' };
  }
  const passed = [instantAt(0, hour + 12), instantAt(0, hour)].find(candidate => candidate <= nowMs);
  return passed === undefined ? { status: 'ASK_YESTERDAY' } : ok(passed, true);
}
