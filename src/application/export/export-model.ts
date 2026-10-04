import type { ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';
import type { Event } from '../../domain/event/event';
import { eventLifecycleStatus } from '../../domain/event/event-lifecycle';
import type { Reminder } from '../../domain/reminder/reminder';
import type { Transaction } from '../../domain/transaction/transaction';
import { EVENT_STATUS_LABELS, eventDate } from '../planner/calendar-model';
import { reminderLabel } from '../planner/event-form';
import { addDays, utcToZonedFields } from '../planner/zoned-time';
import { isLocalDate, localDateIn } from '../validator/local-date';
import { amount, text, type XlsxCell, type XlsxSheet } from './xlsx-writer';

/** What to export (blueprint 10.3): a period and which records. */
export type ExportPeriod =
  | { kind: 'ALL' }
  | { kind: 'THIS_MONTH' }
  | { kind: 'RANGE'; from: LocalDate; to: LocalDate };

export type ExportKind = 'EXPENSE' | 'EVENT' | 'BOTH';

export type ExportOptions = { period: ExportPeriod; kind: ExportKind };

export type ExportInput = {
  transactions: readonly Transaction[];
  events: readonly Event[];
  /** Reminders by event id (cancelled ones are ignored here). */
  remindersByEvent: ReadonlyMap<string, readonly Reminder[]>;
  now: ISODateTime;
  timezone: Timezone;
};

export type ExportResult = {
  expenseSheet: XlsxSheet;
  eventSheet: XlsxSheet;
  expenseCount: number;
  eventCount: number;
};

export const EXPENSE_HEADER = ['날짜', '시간', '구분', '금액', '카테고리', '메모', '입력 방식', '출처', '합계 포함'] as const;
export const EVENT_HEADER = ['시작 날짜', '시작 시간', '종료', '제목', '장소', '상태', '알림', '출처', '공개', '수정됨'] as const;

const INPUT_METHOD_LABELS = { MANUAL: '직접', TEXT: '텍스트', VOICE: '음성' } as const;

/** Inclusive first and last day of the period, or null for "everything". Throws RangeError for a malformed or reversed range. */
export function periodBounds(period: ExportPeriod, now: ISODateTime, timezone: Timezone): { from: LocalDate; to: LocalDate } | null {
  if (period.kind === 'ALL') return null;
  if (period.kind === 'THIS_MONTH') {
    const today = localDateIn(timezone, now);
    const [year, month] = today.split('-').map(Number);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return { from: first, to: addDays(nextMonth, -1) };
  }
  if (!isLocalDate(period.from) || !isLocalDate(period.to)) throw new RangeError('날짜를 2026-10-04 모양으로 입력해 주세요');
  if (period.from > period.to) throw new RangeError('끝나는 날이 시작하는 날보다 빠를 수 없어요');
  return { from: period.from, to: period.to };
}

/** Periods are checked as dates in the viewer's timezone, so a late-night record belongs to its own local day. */
export function validatePeriod(period: ExportPeriod, now: ISODateTime, timezone: Timezone): string | null {
  try {
    periodBounds(period, now, timezone);
    return null;
  } catch (error) {
    return error instanceof RangeError ? error.message : '기간을 확인해 주세요';
  }
}

const within = (date: LocalDate | null, bounds: { from: LocalDate; to: LocalDate } | null) =>
  bounds === null || (date !== null && date >= bounds.from && date <= bounds.to);

function expenseRow(transaction: Transaction, timezone: Timezone): XlsxCell[] {
  const when = utcToZonedFields(transaction.occurredAt, timezone);
  return [
    text(when.date), text(when.time), text(transaction.type === 'EXPENSE' ? '지출' : '수입'), amount(transaction.amount),
    text(transaction.category ?? ''), text(transaction.memo ?? ''), text(INPUT_METHOD_LABELS[transaction.inputMethod]),
    // Received items (M4) will say "OO님이 입력"; everything in M1 is the user's own.
    text('내가 입력'), text(transaction.includeInTotal ? '예' : '아니오'),
  ];
}

function eventRow(event: Event, reminders: readonly Reminder[], now: ISODateTime): XlsxCell[] {
  const date = eventDate(event) ?? '';
  let start = '';
  let end = '';
  if (event.kind === 'EXACT') {
    start = utcToZonedFields(event.startAt, event.timezone).time;
    if (event.endAt) {
      const endFields = utcToZonedFields(event.endAt, event.timezone);
      // An end on another day keeps its date so the row is not misleading.
      end = endFields.date === date ? endFields.time : `${endFields.date} ${endFields.time}`;
    }
  } else start = event.kind === 'ALL_DAY' ? '종일' : event.fuzzyTime;
  const offsets = reminders
    .filter(item => item.status !== 'CANCELLED' && item.relativeOffsetMinutes !== null)
    .map(item => item.relativeOffsetMinutes as number)
    .sort((a, b) => b - a)
    .map(reminderLabel);
  const status = eventLifecycleStatus(event, now, localDateIn(event.timezone, now));
  return [
    text(date), text(start), text(end), text(event.title), text(event.location ?? ''), text(EVENT_STATUS_LABELS[status]),
    text(offsets.join(', ')), text('내가 입력'), text(event.visibility === 'PUBLIC' ? '공개' : '비공개'), text('아니오'),
  ];
}

/** Rows for the two sheets. Deleted records are never passed in (repositories exclude them). Sorted by date and time. */
export function buildExport(input: ExportInput, options: ExportOptions): ExportResult {
  const bounds = periodBounds(options.period, input.now, input.timezone);
  const wantExpenses = options.kind !== 'EVENT';
  const wantEvents = options.kind !== 'EXPENSE';

  const transactions = wantExpenses
    ? input.transactions
      .filter(item => within(utcToZonedFields(item.occurredAt, input.timezone).date, bounds))
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id))
    : [];
  const events = wantEvents
    ? input.events
      .filter(item => within(eventDate(item), bounds) || (bounds === null && eventDate(item) === null))
      .sort((a, b) => {
        const left = `${eventDate(a) ?? '0000-00-00'} ${a.kind === 'EXACT' ? utcToZonedFields(a.startAt, a.timezone).time : a.kind === 'ALL_DAY' ? '00:00' : '99:99'}`;
        const right = `${eventDate(b) ?? '0000-00-00'} ${b.kind === 'EXACT' ? utcToZonedFields(b.startAt, b.timezone).time : b.kind === 'ALL_DAY' ? '00:00' : '99:99'}`;
        return left.localeCompare(right) || a.id.localeCompare(b.id);
      })
    : [];

  return {
    expenseSheet: { name: '지출', header: [...EXPENSE_HEADER], rows: transactions.map(item => expenseRow(item, input.timezone)), widths: [12, 8, 8, 12, 12, 30, 12, 12, 10] },
    eventSheet: {
      name: '일정', header: [...EVENT_HEADER],
      rows: events.map(item => eventRow(item, input.remindersByEvent.get(item.id) ?? [], input.now)),
      widths: [12, 12, 10, 30, 20, 8, 20, 12, 8, 8],
    },
    expenseCount: transactions.length,
    eventCount: events.length,
  };
}

export function exportFileName(now: ISODateTime, timezone: Timezone): string {
  return `VoiceLife_${localDateIn(timezone, now)}.xlsx`;
}

