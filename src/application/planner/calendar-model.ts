import type { ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';
import type { Event, EventStatus } from '../../domain/event/event';
import { eventLifecycleStatus } from '../../domain/event/event-lifecycle';
import type { Task } from '../../domain/task/task';
import { localDateIn } from '../validator/local-date';
import { addDays, daysInMonth, utcToZonedFields, weekdayOf } from './zoned-time';

/** Pure calendar logic (blueprint 7.3, 11.2 K1): which day an item belongs to, how a day is ordered, and the month and week grids. */

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Local calendar day of an event in its own timezone; null for an old FUZZY event that never had a date. */
export function eventDate(event: Event): LocalDate | null {
  return event.kind === 'EXACT' ? utcToZonedFields(event.startAt, event.timezone).date : event.date;
}

/** Local calendar day of a task's due time in `timeZone`; null when it has no due time. */
export function taskDate(task: Task, timeZone: Timezone): LocalDate | null {
  return task.dueAt === null ? null : utcToZonedFields(task.dueAt, timeZone).date;
}

/** 오전 / 오후 with a 12-hour clock: "오후 7:00", "오전 12:30". */
export function clockLabel(time24: string): string {
  const [hour, minute] = time24.split(':').map(Number);
  const period = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${hour12}:${String(minute).padStart(2, '0')}`;
}

/** What the list shows for the time: exact "오후 7:00" (with an end "오후 7:00 ~ 8:30"), fuzzy "저녁쯤", all-day "종일". */
export function eventTimeLabel(event: Event): string {
  if (event.kind === 'ALL_DAY') return '종일';
  if (event.kind === 'FUZZY') return event.fuzzyTime;
  const start = utcToZonedFields(event.startAt, event.timezone);
  const label = clockLabel(start.time);
  if (!event.endAt) return label;
  const end = utcToZonedFields(event.endAt, event.timezone);
  return end.date === start.date ? `${label} ~ ${clockLabel(end.time)}` : label;
}

/** Order within one day: all-day first, then by time, fuzzy last (blueprint M1-05). */
function eventOrder(event: Event): [number, string, string] {
  if (event.kind === 'ALL_DAY') return [0, '', event.title];
  if (event.kind === 'EXACT') return [1, event.startAt, event.title];
  return [2, '', event.title];
}

export function sortDayEvents(events: readonly Event[]): Event[] {
  return [...events].sort((a, b) => {
    const left = eventOrder(a);
    const right = eventOrder(b);
    return left[0] - right[0] || left[1].localeCompare(right[1]) || left[2].localeCompare(right[2]) || a.id.localeCompare(b.id);
  });
}

export type DayEvent = { event: Event; status: EventStatus };

export type CalendarDay = {
  date: LocalDate;
  events: DayEvent[];
  tasks: Task[];
};

export type CalendarIndex = {
  days: Map<LocalDate, CalendarDay>;
  /** Open tasks without a due time. */
  undatedTasks: Task[];
  /** Open tasks whose due day is before today, oldest first. */
  overdueTasks: Task[];
  today: LocalDate;
};

/** Groups events and tasks by local day. `now` and `timeZone` decide "today", PAST status and overdue. */
export function indexCalendar(events: readonly Event[], tasks: readonly Task[], now: ISODateTime, timeZone: Timezone): CalendarIndex {
  const today = localDateIn(timeZone, now);
  const days = new Map<LocalDate, CalendarDay>();
  const dayOf = (date: LocalDate) => {
    let day = days.get(date);
    if (!day) { day = { date, events: [], tasks: [] }; days.set(date, day); }
    return day;
  };
  for (const event of sortDayEvents(events)) {
    const date = eventDate(event);
    if (date === null) continue;
    dayOf(date).events.push({ event, status: eventLifecycleStatus(event, now, localDateIn(event.timezone, now)) });
  }
  const undatedTasks: Task[] = [];
  const overdueTasks: Task[] = [];
  for (const task of tasks) {
    const date = taskDate(task, timeZone);
    if (date === null) {
      if (task.status === 'OPEN') undatedTasks.push(task);
      continue;
    }
    if (task.status === 'OPEN' && date < today) overdueTasks.push(task);
    dayOf(date).tasks.push(task);
  }
  for (const day of days.values()) day.tasks.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.title.localeCompare(b.title));
  overdueTasks.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  return { days, undatedTasks, overdueTasks, today };
}

/** Day with no entry yet is still a day: the screen can show it as empty. */
export function dayOrEmpty(index: CalendarIndex, date: LocalDate): CalendarDay {
  return index.days.get(date) ?? { date, events: [], tasks: [] };
}

/** Weeks of a month (Sunday first). Days outside the month are included so every row has seven days. */
export function monthGrid(year: number, month: number): LocalDate[][] {
  const first: LocalDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lead = weekdayOf(first);
  const total = Math.ceil((lead + daysInMonth(year, month)) / 7) * 7;
  const start = addDays(first, -lead);
  const weeks: LocalDate[][] = [];
  for (let offset = 0; offset < total; offset += 7) weeks.push(weekDates(addDays(start, offset)));
  return weeks;
}

/** The seven days (Sunday to Saturday) around a date. */
export function weekDates(date: LocalDate): LocalDate[] {
  const start = addDays(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** First day shown and the day after the last one, for the repository query. */
export function visibleRange(view: 'month' | 'week', anchor: LocalDate): { from: LocalDate; until: LocalDate } {
  if (view === 'week') {
    const week = weekDates(anchor);
    return { from: week[0], until: addDays(week[6], 1) };
  }
  const [year, month] = anchor.split('-').map(Number);
  const grid = monthGrid(year, month);
  return { from: grid[0][0], until: addDays(grid[grid.length - 1][6], 1) };
}

/** Same day-of-month in another month, clamped to the month length (Jan 31 + 1 month = Feb 28). */
export function shiftMonth(date: LocalDate, delta: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  const clamped = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

export function monthTitle(date: LocalDate): string {
  const [year, month] = date.split('-').map(Number);
  return `${year}년 ${month}월`;
}

/** "10월 4일 (일)". */
export function dateLabel(date: LocalDate): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일 (${WEEKDAY_NAMES[weekdayOf(date)]})`;
}

export function weekTitle(date: LocalDate): string {
  const week = weekDates(date);
  const [, startMonth, startDay] = week[0].split('-').map(Number);
  const [, endMonth, endDay] = week[6].split('-').map(Number);
  return startMonth === endMonth ? `${startMonth}월 ${startDay}일 ~ ${endDay}일` : `${startMonth}월 ${startDay}일 ~ ${endMonth}월 ${endDay}일`;
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { UPCOMING: '예정', PAST: '지남', COMPLETED: '완료', CANCELLED: '취소' };
