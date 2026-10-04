import type { LocalDate, Timezone, Visibility } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import type { Reminder } from '../../domain/reminder/reminder';
import type { Task } from '../../domain/task/task';
import type { CreateEventPayload, CreateTaskPayload, EventTimeKind } from '../proposals/action-payloads';
import { isLocalDate, localDateIn } from '../validator/local-date';
import { checkEventCandidate } from '../validator/validate-event';
import { checkTaskCandidate } from '../validator/validate-task';
import { addDays, isClockTime, utcToZonedFields, zonedWallTimeToUtc } from './zoned-time';

/** Reminder choices of the input forms: signed minutes from the start, 0 = at the time (D-15). */
export const REMINDER_OFFSETS = [0, -10, -30, -60, -1440] as const;

export function reminderLabel(offset: number): string {
  if (offset === 0) return '정시';
  if (offset === -1440) return '하루 전';
  if (offset % 60 === 0) return `${-offset / 60}시간 전`;
  return `${-offset}분 전`;
}

export const TIME_KIND_LABELS: Record<EventTimeKind, string> = { EXACT: '정확한 시각', FUZZY: '대략적 시간', ALL_DAY: '종일' };
export const FUZZY_SUGGESTIONS = ['아침쯤', '점심쯤', '오후쯤', '저녁쯤', '밤쯤'] as const;

export type EventForm = {
  title: string;
  timeKind: EventTimeKind;
  /** YYYY-MM-DD in the event timezone. */
  date: string;
  /** HH:mm, used by EXACT only. */
  time: string;
  /** HH:mm on the same date, EXACT only; empty = no end. */
  endTime: string;
  /** Text for FUZZY, e.g. "저녁쯤". */
  fuzzyTime: string;
  location: string;
  /** Selected reminder offsets; applied to EXACT events only. */
  reminderOffsets: number[];
  visibility: Visibility;
};

export type EventFormField = 'title' | 'date' | 'time' | 'endTime' | 'fuzzyTime' | 'location' | 'reminders';
export type FormErrors = Partial<Record<EventFormField, string>>;

/** Next whole hour after `now`, in the timezone (23:30 gives 00:00 of the next day). */
export function nextWholeHour(now: string, timeZone: Timezone): { date: LocalDate; time: string } {
  const current = utcToZonedFields(now, timeZone);
  const hour = Number(current.time.slice(0, 2)) + 1;
  if (hour >= 24) return { date: addDays(current.date, 1), time: '00:00' };
  return { date: current.date, time: `${String(hour).padStart(2, '0')}:00` };
}

export function initialEventForm(input: {
  now: string; timezone: Timezone; defaultReminder: number | null; title?: string; date?: LocalDate; visibility?: Visibility;
}): EventForm {
  const next = nextWholeHour(input.now, input.timezone);
  return {
    title: (input.title ?? '').slice(0, 100),
    timeKind: 'EXACT',
    date: input.date ?? next.date,
    time: next.time,
    endTime: '',
    fuzzyTime: '',
    location: '',
    // The default reminder is pre-selected and can be deselected: nothing selected means no reminder.
    reminderOffsets: input.defaultReminder === null ? [] : [input.defaultReminder],
    visibility: input.visibility ?? 'PRIVATE',
  };
}

/** Offsets of the live (not cancelled) relative reminders, nearest to the start first. */
export function liveOffsets(reminders: readonly Reminder[]): number[] {
  const offsets = reminders
    .filter(item => item.status !== 'CANCELLED' && item.relativeOffsetMinutes !== null)
    .map(item => item.relativeOffsetMinutes as number);
  return [...new Set(offsets)].sort((a, b) => b - a);
}

export function eventFormFromEvent(event: Event, timezone: Timezone, reminders: readonly Reminder[]): EventForm {
  const start = event.kind === 'EXACT' ? utcToZonedFields(event.startAt, event.timezone) : null;
  const end = event.kind === 'EXACT' && event.endAt ? utcToZonedFields(event.endAt, event.timezone) : null;
  return {
    title: event.title,
    timeKind: event.kind,
    date: start?.date ?? event.date ?? utcToZonedFields(event.createdAt, timezone).date,
    time: start?.time ?? '09:00',
    // An end on another day cannot be shown in this form.
    endTime: end && start && end.date === start.date ? end.time : '',
    fuzzyTime: event.fuzzyTime ?? '',
    location: event.location ?? '',
    reminderOffsets: liveOffsets(reminders),
    visibility: event.visibility,
  };
}

const FIELD_OF_MISSING: Record<string, EventFormField> = { title: 'title', startAt: 'time', fuzzyTime: 'fuzzyTime', date: 'date', timeKind: 'date' };
const FIELD_OF_ERROR: Record<string, EventFormField> = {
  TITLE_TOO_LONG: 'title', INVALID_TITLE: 'title', END_BEFORE_START: 'endTime', INVALID_END_AT: 'endTime',
  LOCATION_TOO_LONG: 'location', INVALID_LOCATION: 'location', INVALID_DATE: 'date', INVALID_START_AT: 'time',
};
const ERROR_TEXT: Record<string, string> = {
  TITLE_TOO_LONG: '제목은 100자까지 쓸 수 있어요',
  LOCATION_TOO_LONG: '장소는 100자까지 쓸 수 있어요',
  END_BEFORE_START: '종료 시각은 시작 시각보다 뒤여야 해요',
};

/** Form fields to the CREATE_EVENT payload; failures carry a message for the input they belong to. */
export function buildEventPayload(form: EventForm, timezone: Timezone): { status: 'OK'; payload: CreateEventPayload } | { status: 'ERROR'; errors: FormErrors } {
  const errors: FormErrors = {};
  if (!isLocalDate(form.date)) errors.date = '날짜를 2026-10-04 모양으로 입력해 주세요';
  let startAt: string | null = null;
  let endAt: string | null = null;
  if (form.timeKind === 'EXACT' && !errors.date) {
    if (!isClockTime(form.time)) errors.time = '시간을 15:00 모양으로 입력해 주세요';
    else {
      startAt = zonedWallTimeToUtc(form.date, form.time, timezone);
      if (startAt === null) errors.time = '이 시각은 존재하지 않아요';
    }
    if (form.endTime.trim()) {
      if (!isClockTime(form.endTime)) errors.endTime = '종료 시각을 17:00 모양으로 입력해 주세요';
      else {
        endAt = zonedWallTimeToUtc(form.date, form.endTime, timezone);
        if (endAt === null) errors.endTime = '이 시각은 존재하지 않아요';
      }
    }
  }
  const payload: CreateEventPayload = {
    title: form.title,
    timeKind: form.timeKind,
    startAt,
    endAt,
    fuzzyTime: form.timeKind === 'FUZZY' ? form.fuzzyTime : null,
    date: form.timeKind === 'EXACT' || !isLocalDate(form.date) ? null : form.date,
    timezone,
    location: form.location,
    visibility: form.visibility,
  };
  // The shared validator owns every remaining rule; it runs once parsing succeeded.
  const check = Object.keys(errors).length ? null : checkEventCandidate({ ...payload });
  if (check?.status === 'INVALID') errors[FIELD_OF_ERROR[check.errorCode] ?? 'title'] = ERROR_TEXT[check.errorCode] ?? check.errorMessage;
  if (check?.status === 'MISSING') {
    for (const item of check.missing) {
      const field = FIELD_OF_MISSING[item.field] ?? 'title';
      errors[field] = field === 'title' ? '제목을 입력해 주세요' : field === 'fuzzyTime' ? '대략 언제쯤인지 적어 주세요 (예: 저녁쯤)' : item.question;
    }
  }
  if (Object.keys(errors).length) return { status: 'ERROR', errors };
  return { status: 'OK', payload };
}

/** Differences between an existing event and the edited payload, as an UPDATE_EVENT patch (changed keys only). */
export function eventChanges(existing: Event, next: CreateEventPayload): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const was: Record<string, unknown> = {
    title: existing.title, timeKind: existing.kind, startAt: existing.startAt, endAt: existing.endAt, fuzzyTime: existing.fuzzyTime,
    date: existing.date, timezone: existing.timezone, location: existing.location, visibility: existing.visibility,
  };
  const wanted: Record<string, unknown> = {
    ...next, title: (next.title ?? '').trim(), location: next.location?.trim() || null, fuzzyTime: next.fuzzyTime?.trim() || null,
  };
  for (const key of Object.keys(was)) if (was[key] !== wanted[key]) changes[key] = wanted[key];
  // A kind switch starts from empty time fields in the executor, so every field of the new kind must be present.
  if ('timeKind' in changes) for (const key of ['startAt', 'endAt', 'fuzzyTime', 'date']) changes[key] = wanted[key];
  return changes;
}

export type TaskForm = {
  title: string;
  /** Whether the task has a due date. */
  hasDue: boolean;
  date: string;
  time: string;
  reminderOffsets: number[];
  visibility: Visibility;
};

export function initialTaskForm(input: { now: string; timezone: Timezone; title?: string; date?: LocalDate; visibility?: Visibility }): TaskForm {
  const next = nextWholeHour(input.now, input.timezone);
  return {
    title: (input.title ?? '').slice(0, 100),
    hasDue: input.date !== undefined,
    date: input.date ?? next.date,
    time: input.date ? '18:00' : next.time,
    reminderOffsets: [],
    visibility: input.visibility ?? 'PRIVATE',
  };
}

export function taskFormFromTask(task: Task, timezone: Timezone, reminders: readonly Reminder[]): TaskForm {
  const due = task.dueAt ? utcToZonedFields(task.dueAt, timezone) : null;
  return {
    title: task.title,
    hasDue: due !== null,
    date: due?.date ?? utcToZonedFields(task.createdAt, timezone).date,
    time: due?.time ?? '18:00',
    reminderOffsets: liveOffsets(reminders),
    visibility: task.visibility,
  };
}

export function buildTaskPayload(form: TaskForm, timezone: Timezone): { status: 'OK'; payload: CreateTaskPayload } | { status: 'ERROR'; errors: FormErrors } {
  const errors: FormErrors = {};
  let dueAt: string | null = null;
  if (form.hasDue) {
    if (!isLocalDate(form.date)) errors.date = '날짜를 2026-10-04 모양으로 입력해 주세요';
    else if (!isClockTime(form.time)) errors.time = '시간을 18:00 모양으로 입력해 주세요';
    else {
      dueAt = zonedWallTimeToUtc(form.date, form.time, timezone);
      if (dueAt === null) errors.time = '이 시각은 존재하지 않아요';
    }
  }
  const payload: CreateTaskPayload = { title: form.title, dueAt, visibility: form.visibility };
  if (Object.keys(errors).length === 0) {
    const check = checkTaskCandidate({ ...payload });
    if (check.status === 'INVALID') errors[check.errorCode === 'TITLE_TOO_LONG' ? 'title' : 'date'] = ERROR_TEXT[check.errorCode] ?? check.errorMessage;
    if (check.status === 'MISSING') errors.title = '제목을 입력해 주세요';
  }
  if (Object.keys(errors).length) return { status: 'ERROR', errors };
  return { status: 'OK', payload };
}

/** Today's date in a timezone. */
export function todayIn(timezone: Timezone, now: string): LocalDate {
  return localDateIn(timezone, now);
}
