import type { ISODateTime, Timezone } from '../../domain/common/primitives';
import type { EventRepository } from '../../domain/event/event-repository';
import type { Reminder } from '../../domain/reminder/reminder';
import type { ReminderRepository } from '../../domain/reminder/reminder-repository';
import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import { buildExport, exportFileName, validatePeriod, type ExportOptions } from './export-model';
import { buildXlsx, type XlsxSheet } from './xlsx-writer';

/** Saves the file and opens the system share sheet. Implemented in adapters/export; rejects when it cannot. */
export interface ExportFileSink {
  saveAndShare(fileName: string, bytes: Uint8Array): Promise<void>;
}

export type ExportPreview =
  | { status: 'OK'; expenseCount: number; eventCount: number }
  | { status: 'INVALID_PERIOD'; message: string };

export type ExportOutcome =
  | { status: 'DONE'; fileName: string; expenseCount: number; eventCount: number }
  /** Nothing to export for this choice: no file is made. */
  | { status: 'EMPTY' }
  | { status: 'INVALID_PERIOD'; message: string }
  /** The file could not be made or shared. The screen must not show a completion message. */
  | { status: 'FAILED'; message: string };

export type ExportServiceDependencies = {
  transactions: Pick<TransactionRepository, 'listAll'>;
  events: Pick<EventRepository, 'listAll'>;
  reminders: Pick<ReminderRepository, 'listLive'>;
  sink: ExportFileSink;
  now(): ISODateTime;
  timezone(): Timezone;
};

/** Excel export (blueprint 10.3): works offline and for guests, and reads only local records. */
export function createExportService(dependencies: ExportServiceDependencies) {
  async function collect(options: ExportOptions) {
    const now = dependencies.now();
    const timezone = dependencies.timezone();
    const [transactions, events, live] = await Promise.all([
      options.kind === 'EVENT' ? Promise.resolve([]) : dependencies.transactions.listAll(),
      options.kind === 'EXPENSE' ? Promise.resolve([]) : dependencies.events.listAll(),
      options.kind === 'EXPENSE' ? Promise.resolve([] as Reminder[]) : dependencies.reminders.listLive(),
    ]);
    const remindersByEvent = new Map<string, Reminder[]>();
    for (const reminder of live) {
      if (reminder.targetType !== 'EVENT') continue;
      remindersByEvent.set(reminder.targetId, [...(remindersByEvent.get(reminder.targetId) ?? []), reminder]);
    }
    return { result: buildExport({ transactions, events, remindersByEvent, now, timezone }, options), now, timezone };
  }

  return {
    async preview(options: ExportOptions): Promise<ExportPreview> {
      const problem = validatePeriod(options.period, dependencies.now(), dependencies.timezone());
      if (problem) return { status: 'INVALID_PERIOD', message: problem };
      const { result } = await collect(options);
      return { status: 'OK', expenseCount: result.expenseCount, eventCount: result.eventCount };
    },

    async create(options: ExportOptions): Promise<ExportOutcome> {
      const problem = validatePeriod(options.period, dependencies.now(), dependencies.timezone());
      if (problem) return { status: 'INVALID_PERIOD', message: problem };
      try {
        const { result, now, timezone } = await collect(options);
        const sheets: XlsxSheet[] = [];
        if (options.kind !== 'EVENT') sheets.push(result.expenseSheet);
        if (options.kind !== 'EXPENSE') sheets.push(result.eventSheet);
        const total = (options.kind !== 'EVENT' ? result.expenseCount : 0) + (options.kind !== 'EXPENSE' ? result.eventCount : 0);
        if (total === 0) return { status: 'EMPTY' };
        const fileName = exportFileName(now, timezone);
        await dependencies.sink.saveAndShare(fileName, buildXlsx(sheets));
        return { status: 'DONE', fileName, expenseCount: result.expenseCount, eventCount: result.eventCount };
      } catch {
        return { status: 'FAILED', message: '파일을 만들지 못했어요. 용량이나 저장 권한 문제일 수 있어요. 기간을 줄여서 다시 시도해 주세요' };
      }
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
