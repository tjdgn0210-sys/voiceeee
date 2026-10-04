// Development-only: node --test scripts/verify-expense-summary.cjs
// M1-15 expense screen: month total, category totals, records kept out of the total, month boundaries in the local timezone.
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load } = createLoader();
const summary = load('src/application/expenses/expense-summary.ts');
const { createSqliteTransactionRepository } = load('src/database/repositories/sqlite-transaction-repository.ts');

const record = (id, amount, category, extra = {}) => ({
  id, type: 'EXPENSE', amount, currencyCode: 'KRW', category, memo: null, includeInTotal: true, bundleItems: null,
  occurredAt: '2026-10-05T03:00:00.000Z', inputMethod: 'MANUAL', rawInput: null, createdAt: '2026-10-05T03:00:00.000Z', updatedAt: '2026-10-05T03:00:00.000Z', deletedAt: null, ...extra,
});

test('the month total adds only won expenses that count; categories are split and sorted by amount', () => {
  const result = summary.summarizeMonth([
    record('a', 7000, '식비'), record('b', 5000, '식비'), record('c', 12000, '교통'), record('d', 3000, null), record('e', 1000, '  '),
    record('f', 2000, '쇼핑', { includeInTotal: false }),
    record('g', 500000, '월급', { type: 'INCOME' }),
    record('h', 30, '해외', { currencyCode: 'USD' }),
  ]);
  assert.equal(result.total, 28000);
  assert.equal(result.count, 5);
  assert.equal(result.excludedCount, 1);
  assert.deepEqual(result.byCategory, [
    { category: '교통', total: 12000, count: 1 }, { category: '식비', total: 12000, count: 2 }, { category: '미분류', total: 4000, count: 2 },
  ]);
  assert.equal(result.byCategory.reduce((sum, item) => sum + item.total, 0), result.total, 'categories add up to the total');
});

test('an empty month is zero, not an error', () => {
  assert.deepEqual(summary.summarizeMonth([]), { total: 0, count: 0, excludedCount: 0, byCategory: [] });
});

test('a record kept out of the total never reaches the sum, even when it is the only one', () => {
  const result = summary.summarizeMonth([record('x', 9999, '식비', { includeInTotal: false })]);
  assert.deepEqual([result.total, result.count, result.excludedCount, result.byCategory.length], [0, 0, 1, 0]);
});

test('month bounds follow the local calendar: 00:00 of the first day to 00:00 of the next month', () => {
  assert.deepEqual(summary.monthBounds('2026-10', 'Asia/Seoul'), { from: '2026-09-30T15:00:00.000Z', until: '2026-10-31T15:00:00.000Z' });
  assert.deepEqual(summary.monthBounds('2028-02', 'Asia/Seoul'), { from: '2028-01-31T15:00:00.000Z', until: '2028-02-29T15:00:00.000Z' });
  assert.deepEqual(summary.monthBounds('2026-12', 'Asia/Seoul').until, '2026-12-31T15:00:00.000Z');
  assert.equal(summary.shiftYearMonth('2026-01', -1), '2025-12');
  assert.equal(summary.shiftYearMonth('2026-12', 1), '2027-01');
  assert.equal(summary.shiftYearMonth('2026-10', 0), '2026-10');
  assert.equal(summary.monthOf('2026-10-04'), '2026-10');
});

test('the repository returns exactly the month: a record at 23:59 on the last day is in, 00:00 the next day is out', async () => {
  const db = await openMigratedDatabase(load);
  const repository = createSqliteTransactionRepository(db);
  const bounds = summary.monthBounds('2026-10', 'Asia/Seoul');
  const at = (id, occurredAt, extra = {}) => repository.create(record(id, 1000, '식비', { occurredAt, ...extra }));
  await at('before', '2026-09-30T14:59:00.000Z'); // 23:59 KST on Sep 30
  await at('first', '2026-09-30T15:00:00.000Z'); // 00:00 KST on Oct 1
  await at('last', '2026-10-31T14:59:00.000Z'); // 23:59 KST on Oct 31
  await at('after', '2026-10-31T15:00:00.000Z'); // 00:00 KST on Nov 1
  await at('gone', '2026-10-10T00:00:00.000Z', { deletedAt: '2026-10-11T00:00:00.000Z' });
  const rows = await repository.listBetween(bounds.from, bounds.until);
  assert.deepEqual(rows.map(item => item.id), ['last', 'first']);
  assert.equal(summary.summarizeMonth(rows).total, 2000);
});

test('a record excluded from the total is stored, listed, and flagged in the row text', async () => {
  const db = await openMigratedDatabase(load);
  const repository = createSqliteTransactionRepository(db);
  await repository.create(record('kept', 1000, '식비'));
  await repository.create(record('left-out', 4000, '식비', { includeInTotal: false, bundleItems: ['김밥', '라면'] }));
  const rows = await repository.listBetween('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  const leftOut = rows.find(item => item.id === 'left-out');
  assert.equal(leftOut.includeInTotal, false);
  assert.deepEqual(leftOut.bundleItems, ['김밥', '라면'], 'bundle items are kept apart from the memo');
  assert.equal(summary.summarizeMonth(rows).total, 1000);
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/features/money/expenses-screen.tsx'), 'utf8');
  assert.match(source, /합계에서 제외/);
});
