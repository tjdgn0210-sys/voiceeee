import type { Transaction } from '../../domain/transaction/transaction';
import type { TransactionRepository } from '../../domain/transaction/transaction-repository';
import type { ApplicationDatabase } from '../database';
import { assertQueryLimit } from './query-limit';

interface TransactionRow {
  id: string;
  type: Transaction['type'];
  amount: number;
  currency_code: string;
  category: string | null;
  memo: string | null;
  include_in_total: number;
  bundle_items: string | null;
  occurred_at: string;
  input_method: Transaction['inputMethod'];
  raw_input: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function parseBundleItems(row: TransactionRow): string[] | null {
  if (row.bundle_items === null) return null;
  const parsed: unknown = JSON.parse(row.bundle_items);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error(`Invalid persisted Transaction bundle items: ${row.id}`);
  }
  return parsed;
}

function fromRow(row: TransactionRow): Transaction {
  if (row.include_in_total !== 0 && row.include_in_total !== 1) throw new Error(`Invalid persisted Transaction total flag: ${row.id}`);
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    currencyCode: row.currency_code,
    category: row.category,
    memo: row.memo,
    includeInTotal: row.include_in_total === 1,
    bundleItems: parseBundleItems(row),
    occurredAt: row.occurred_at,
    inputMethod: row.input_method,
    rawInput: row.raw_input,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function bundleItemsJson(entity: Transaction): string | null {
  return entity.bundleItems === null ? null : JSON.stringify(entity.bundleItems);
}

/** Recent transactions use occurredAt, not creation time. */
export function createSqliteTransactionRepository(database: ApplicationDatabase): TransactionRepository & { listExpenses(limit: number): Promise<Transaction[]> } {
  return {
    async create(entity) {
      await database.runAsync(
        'INSERT INTO transactions (id, type, amount, currency_code, category, memo, include_in_total, bundle_items, occurred_at, input_method, raw_input, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        entity.id, entity.type, entity.amount, entity.currencyCode, entity.category, entity.memo, entity.includeInTotal ? 1 : 0, bundleItemsJson(entity), entity.occurredAt, entity.inputMethod, entity.rawInput, entity.createdAt, entity.updatedAt, entity.deletedAt,
      );
    },
    async findById(id) {
      const row = await database.getFirstAsync<TransactionRow>(
        'SELECT id, type, amount, currency_code, category, memo, include_in_total, bundle_items, occurred_at, input_method, raw_input, created_at, updated_at, deleted_at FROM transactions WHERE id = ? AND deleted_at IS NULL', id,
      );
      return row ? fromRow(row) : null;
    },
    async listRecent(limit) {
      assertQueryLimit(limit);
      const rows = await database.getAllAsync<TransactionRow>(
        "SELECT id, type, amount, currency_code, category, memo, include_in_total, bundle_items, occurred_at, input_method, raw_input, created_at, updated_at, deleted_at FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_at DESC, id ASC LIMIT ?", limit,
      );
      return rows.map(fromRow);
    },
    async listExpenses(limit) {
      assertQueryLimit(limit);
      const rows = await database.getAllAsync<TransactionRow>(
        "SELECT id, type, amount, currency_code, category, memo, include_in_total, bundle_items, occurred_at, input_method, raw_input, created_at, updated_at, deleted_at FROM transactions WHERE deleted_at IS NULL AND type = 'EXPENSE' ORDER BY occurred_at DESC, id ASC LIMIT ?", limit);
      return rows.map(fromRow);
    },
    async update(entity) {
      const result = await database.runAsync(
        'UPDATE transactions SET type = ?, amount = ?, currency_code = ?, category = ?, memo = ?, include_in_total = ?, bundle_items = ?, occurred_at = ?, input_method = ?, raw_input = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        entity.type, entity.amount, entity.currencyCode, entity.category, entity.memo, entity.includeInTotal ? 1 : 0, bundleItemsJson(entity), entity.occurredAt, entity.inputMethod, entity.rawInput, entity.updatedAt, entity.deletedAt, entity.id,
      );
      return result.changes > 0;
    },
    async softDelete(id, deletedAt) {
      const result = await database.runAsync(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        deletedAt, deletedAt, id,
      );
      return result.changes > 0;
    },
  };
}
