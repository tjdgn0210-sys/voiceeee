import type { ISODateTime, LocalDate, Timezone } from '../../domain/common/primitives';
import type { Transaction } from '../../domain/transaction/transaction';
import { addDays, daysInMonth, zonedWallTimeToUtc } from '../planner/zoned-time';

export const UNCATEGORIZED = '미분류';

export type CategoryTotal = { category: string; total: number; count: number };

export type MonthSummary = {
  /** Sum of the won expenses that count towards totals. */
  total: number;
  /** How many records are in that sum. */
  count: number;
  /** Same sum split by category, largest first (ties by name). */
  byCategory: CategoryTotal[];
  /** Records kept out of the total (include in total = off): still listed, never summed. */
  excludedCount: number;
};

/** "2026-10" for a date. */
export const monthOf = (date: LocalDate): string => date.slice(0, 7);

/** Month before or after `month` ("2026-01" - 1 = "2025-12"). */
export function shiftYearMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** UTC bounds [from, until) of a local calendar month, for the repository query. */
export function monthBounds(month: string, timeZone: Timezone): { from: ISODateTime; until: ISODateTime } {
  const [year, number] = month.split('-').map(Number);
  const first: LocalDate = `${year}-${String(number).padStart(2, '0')}-01`;
  const next = addDays(first, daysInMonth(year, number));
  const from = zonedWallTimeToUtc(first, '00:00', timeZone);
  const until = zonedWallTimeToUtc(next, '00:00', timeZone);
  if (!from || !until) throw new RangeError('Invalid month.');
  return { from, until };
}

/** Month totals (blueprint 11.2 E1). Only won expenses count; income and other currencies are listed elsewhere, never added. */
export function summarizeMonth(transactions: readonly Transaction[]): MonthSummary {
  const byCategory = new Map<string, CategoryTotal>();
  let total = 0;
  let count = 0;
  let excludedCount = 0;
  for (const item of transactions) {
    if (item.type !== 'EXPENSE' || item.currencyCode !== 'KRW') continue;
    if (!item.includeInTotal) { excludedCount += 1; continue; }
    total += item.amount;
    count += 1;
    const category = item.category?.trim() || UNCATEGORIZED;
    const entry = byCategory.get(category) ?? { category, total: 0, count: 0 };
    entry.total += item.amount;
    entry.count += 1;
    byCategory.set(category, entry);
  }
  return {
    total, count, excludedCount,
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
  };
}
