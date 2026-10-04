// Development-only: node --test scripts/verify-export.cjs
// M1-13 Excel export: a valid .xlsx container, text cells that can never run as formulas, column order, deleted records, periods.
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load } = createLoader();
const writer = load('src/application/export/xlsx-writer.ts');
const model = load('src/application/export/export-model.ts');
const { createExportService } = load('src/application/export/export-service.ts');
const form = load('src/application/planner/event-form.ts');
const { createPlannerServices } = load('src/application/planner/planner-services.ts');
const { createUndoBar } = load('src/application/undo/undo-bar.ts');
const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
const { createSqliteEventRepository } = load('src/database/repositories/sqlite-event-repository.ts');
const { createSqliteTaskRepository } = load('src/database/repositories/sqlite-task-repository.ts');
const { createSqliteReminderRepository } = load('src/database/repositories/sqlite-reminder-repository.ts');
const { createSqliteTransactionRepository } = load('src/database/repositories/sqlite-transaction-repository.ts');
const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');
const { createSqlitePlannerUnitOfWork } = load('src/database/sqlite-planner-unit-of-work.ts');

const TZ = 'Asia/Seoul';
const NOW = '2026-10-15T03:00:00.000Z'; // 12:00 KST on Oct 15

// --- a tiny zip reader for stored archives, used to check what the writer produced --------------
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const entries = {};
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(pointer, true), 0x02014b50, 'central entry');
    const method = view.getUint16(pointer + 10, true);
    const crc = view.getUint32(pointer + 16, true);
    const size = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = Buffer.from(bytes.subarray(pointer + 46, pointer + 46 + nameLength)).toString('utf8');
    assert.equal(method, 0);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, 'local header');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const data = bytes.subarray(localOffset + 30 + localNameLength, localOffset + 30 + localNameLength + size);
    assert.equal(writer.crc32(data), crc, `crc of ${name}`);
    entries[name] = Buffer.from(data).toString('utf8');
    pointer += 46 + nameLength;
  }
  return entries;
}

const cellValues = xml => [...xml.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)"(?: t="inlineStr")?>(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)]
  .map(match => ({ ref: match[1], style: Number(match[2]), text: match[3], number: match[4] }));
const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('crc32 matches the standard check value', () => {
  assert.equal(writer.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('the container has every required part, valid CRCs, and well-formed workbook relations', () => {
  const bytes = writer.buildXlsx([
    { name: '지출', header: ['날짜', '금액'], rows: [[writer.text('2026-10-01'), writer.amount(12000)]] },
    { name: '일정', header: ['제목'], rows: [[writer.text('치과')]] },
  ]);
  const parts = readZip(bytes);
  assert.deepEqual(Object.keys(parts).sort(), [
    '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
  ]);
  assert.match(parts['xl/workbook.xml'], /<sheet name="지출" sheetId="1" r:id="rId1"\/><sheet name="일정" sheetId="2" r:id="rId2"\/>/);
  assert.match(parts['xl/_rels/workbook.xml.rels'], /Id="rId3"[^>]*styles\.xml/);
  for (const part of Object.values(parts)) assert.match(part, /^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?>/);
  const first = cellValues(parts['xl/worksheets/sheet1.xml']);
  assert.deepEqual(first.map(cell => [cell.ref, cell.style]), [['A1', 1], ['B1', 1], ['A2', 0], ['B2', 2]]);
  assert.equal(first.find(cell => cell.ref === 'B2').number, '12000');
});

test('the container is a valid zip for an independent reader (python zipfile), when python is available', t => {
  const python = spawnSync('python', ['-c', 'print(1)']);
  if (python.status !== 0) { t.skip('python not available'); return; }
  const file = path.join(os.tmpdir(), `vlm-export-${process.pid}.xlsx`);
  fs.writeFileSync(file, writer.buildXlsx([{ name: '지출', header: ['금액'], rows: [[writer.amount(1)]] }]));
  try {
    const result = spawnSync('python', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(len(z.namelist()))', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '6');
  } finally { fs.rmSync(file, { force: true }); }
});

test('formula injection: =, +, -, @ at the start stay text with a quote prefix, and nothing is ever written as a formula', () => {
  const dangerous = ['=1+1', '+SUM(A1)', '-2', '@x', '=HYPERLINK("http://example.com","x")', '\t=cmd'];
  const bytes = writer.buildXlsx([{ name: '지출', header: ['메모'], rows: dangerous.map(value => [writer.text(value)]) }]);
  const sheet = readZip(bytes)['xl/worksheets/sheet1.xml'];
  assert.ok(!/<f[ >]/.test(sheet), 'no formula element');
  const cells = cellValues(sheet).slice(1);
  assert.equal(cells.length, dangerous.length);
  cells.forEach((cell, index) => {
    assert.equal(cell.style, 3, `${dangerous[index]} uses the quote-prefix style`);
    assert.equal(unescape(cell.text), dangerous[index]);
  });
  assert.match(readZip(bytes)['xl/styles.xml'], /quotePrefix="1"/);
  assert.equal(cellValues(readZip(writer.buildXlsx([{ name: 'a', header: ['h'], rows: [[writer.text('일반 메모')]] }]))['xl/worksheets/sheet1.xml'])[1].style, 0);
});

test('XML-significant and control characters are escaped or dropped; the sheet name is checked', () => {
  const bytes = writer.buildXlsx([{ name: '지출', header: ['메모'], rows: [[writer.text('a<b>&"c" \u0000\u0008ok')]] }]);
  const cell = cellValues(readZip(bytes)['xl/worksheets/sheet1.xml'])[1];
  assert.equal(unescape(cell.text), 'a<b>&"c" ok');
  assert.throws(() => writer.buildXlsx([{ name: 'a/b', header: [], rows: [] }]), RangeError);
  assert.throws(() => writer.buildXlsx([{ name: 'x'.repeat(32), header: [], rows: [] }]), RangeError);
  assert.throws(() => writer.buildXlsx([]), RangeError);
  assert.throws(() => writer.buildXlsx([{ name: 'a', header: [], rows: [[writer.amount(Number.NaN)]] }]), RangeError);
});

async function seed() {
  const db = await openMigratedDatabase(load);
  let clock = Date.parse(NOW);
  let counter = 0;
  const events = createSqliteEventRepository(db);
  const reminders = createSqliteReminderRepository(db);
  const transactions = createSqliteTransactionRepository(db);
  const now = () => new Date(clock).toISOString();
  const undoBar = createUndoBar({ setTimer: () => 1, clearTimer: () => {} });
  const planner = createPlannerServices({
    events, tasks: createSqliteTaskRepository(db), reminders, unitOfWork: createSqlitePlannerUnitOfWork(db),
    nextActionId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, nextLogId: () => `log-${++counter}`,
    now, timezone: () => TZ, undoWindowMilliseconds: 60_000, undoBar,
  });
  const expenses = createManualExpenses({
    transactions, unitOfWork: createSqliteTransactionCreationUnitOfWork(db), nextActionId: () => `exp-${++counter}`, nextLogId: () => `elog-${++counter}`,
    idsForAction: id => ({ transactionId: id, undoId: id }), now, undoWindowMilliseconds: 60_000,
  });
  const expense = (occurredAt, amount, memo, category, method = 'MANUAL') => expenses.save({
    actionId: `exp-${++counter}`, type: 'CREATE_TRANSACTION', sourceInput: '', inputMethod: method, dependsOnActionIds: [],
    payload: { transactionType: 'EXPENSE', amount, currencyCode: 'KRW', category, memo, occurredAt },
  });
  const eventForm = overrides => ({ ...form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: null }), ...overrides });
  const service = createExportService({
    transactions, events, reminders, now, timezone: () => TZ,
    sink: { saved: [], async saveAndShare(name, bytes) { this.saved.push({ name, bytes }); } },
  });
  return { db, planner, expense, eventForm, service, transactions, sink: null, advance: ms => { clock += ms; } };
}

test('the exported sheets: header order, values, status and reminder text', async () => {
  const { planner, expense, eventForm, db, transactions } = await seed();
  await expense('2026-10-14T15:30:00.000Z', 12000, '김밥 라면', '식비', 'VOICE');
  await planner.createEvent(eventForm({ title: '치과', date: '2026-10-20', time: '15:00', endTime: '16:00', location: '강남', reminderOffsets: [0, -30] }));
  await planner.createEvent(eventForm({ title: '휴가', date: '2026-10-21', timeKind: 'ALL_DAY' }));
  await planner.createEvent(eventForm({ title: '저녁 약속', date: '2026-10-21', timeKind: 'FUZZY', fuzzyTime: '저녁쯤' }));
  await planner.createEvent(eventForm({ title: '지난 일정', date: '2026-10-10', time: '09:00' }));
  const events = createSqliteEventRepository(db);
  const reminders = createSqliteReminderRepository(db);
  const live = await reminders.listLive();
  const byEvent = new Map();
  for (const reminder of live) byEvent.set(reminder.targetId, [...(byEvent.get(reminder.targetId) ?? []), reminder]);
  const result = model.buildExport({ transactions: await transactions.listAll(), events: await events.listAll(), remindersByEvent: byEvent, now: NOW, timezone: TZ }, { period: { kind: 'ALL' }, kind: 'BOTH' });
  assert.deepEqual(result.expenseSheet.header, ['날짜', '시간', '구분', '금액', '카테고리', '메모', '입력 방식', '출처', '합계 포함']);
  assert.deepEqual(result.eventSheet.header, ['시작 날짜', '시작 시간', '종료', '제목', '장소', '상태', '알림', '출처', '공개', '수정됨']);
  const flat = rows => rows.map(row => row.map(cell => (cell.kind === 'amount' ? cell.value : cell.value)));
  assert.deepEqual(flat(result.expenseSheet.rows), [['2026-10-15', '00:30', '지출', 12000, '식비', '김밥 라면', '음성', '내가 입력', '예']]);
  assert.equal(result.expenseSheet.rows[0][3].kind, 'amount', 'the amount is a number cell (#,##0)');
  assert.deepEqual(flat(result.eventSheet.rows), [
    ['2026-10-10', '09:00', '', '지난 일정', '', '지남', '', '내가 입력', '비공개', '아니오'],
    ['2026-10-20', '15:00', '16:00', '치과', '강남', '예정', '정시, 30분 전', '내가 입력', '비공개', '아니오'],
    ['2026-10-21', '종일', '', '휴가', '', '예정', '', '내가 입력', '비공개', '아니오'],
    ['2026-10-21', '저녁쯤', '', '저녁 약속', '', '예정', '', '내가 입력', '비공개', '아니오'],
  ]);
  assert.equal(result.expenseCount, 1);
  assert.equal(result.eventCount, 4);
});

test('deleted records are excluded; an expense kept out of totals says so', async () => {
  const { planner, expense, eventForm, service, db, transactions } = await seed();
  const saved = await expense('2026-10-14T15:30:00.000Z', 3000, '지울 지출', null);
  const gone = await planner.createEvent(eventForm({ title: '지울 일정', date: '2026-10-20' }));
  await planner.createEvent(eventForm({ title: '남길 일정', date: '2026-10-20' }));
  db.raw.prepare('UPDATE transactions SET deleted_at = ? WHERE id = ?').run(NOW, saved.outcome.result.affectedEntityId);
  db.raw.prepare('UPDATE events SET deleted_at = ? WHERE id = ?').run(NOW, gone.entityId);
  await expense('2026-10-14T16:30:00.000Z', 5000, '합계 제외', null);
  db.raw.prepare("UPDATE transactions SET include_in_total = 0 WHERE memo = '합계 제외'").run();
  const preview = await service.preview({ period: { kind: 'ALL' }, kind: 'BOTH' });
  assert.deepEqual([preview.expenseCount, preview.eventCount], [1, 1]);
  const result = model.buildExport({ transactions: await transactions.listAll(), events: [], remindersByEvent: new Map(), now: NOW, timezone: TZ }, { period: { kind: 'ALL' }, kind: 'EXPENSE' });
  assert.equal(result.expenseSheet.rows[0][8].value, '아니오');
});

test('periods: all, this month, and a chosen range are inclusive and use local dates; bad ranges are rejected', async () => {
  const { planner, expense, eventForm, service } = await seed();
  await expense('2026-09-30T14:59:00.000Z', 1000, '9월 말', null); // 23:59 KST on Sep 30
  await expense('2026-09-30T15:00:00.000Z', 2000, '10월 첫날 0시', null); // 00:00 KST on Oct 1
  await expense('2026-10-31T14:59:00.000Z', 3000, '10월 말', null); // 23:59 KST on Oct 31
  await expense('2026-10-31T15:00:00.000Z', 4000, '11월 첫날', null);
  await planner.createEvent(eventForm({ title: '10월 일정', date: '2026-10-31' }));
  await planner.createEvent(eventForm({ title: '11월 일정', date: '2026-11-01' }));
  const count = async period => { const preview = await service.preview({ period, kind: 'BOTH' }); return [preview.expenseCount, preview.eventCount]; };
  assert.deepEqual(await count({ kind: 'ALL' }), [4, 2]);
  assert.deepEqual(await count({ kind: 'THIS_MONTH' }), [2, 1]);
  assert.deepEqual(await count({ kind: 'RANGE', from: '2026-10-01', to: '2026-10-31' }), [2, 1]);
  assert.deepEqual(await count({ kind: 'RANGE', from: '2026-10-31', to: '2026-10-31' }), [1, 1]);
  assert.deepEqual(await count({ kind: 'RANGE', from: '2026-12-01', to: '2026-12-31' }), [0, 0]);
  assert.deepEqual(model.periodBounds({ kind: 'THIS_MONTH' }, NOW, TZ), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(model.periodBounds({ kind: 'THIS_MONTH' }, '2028-02-10T00:00:00.000Z', TZ), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(model.periodBounds({ kind: 'THIS_MONTH' }, '2026-12-10T00:00:00.000Z', TZ), { from: '2026-12-01', to: '2026-12-31' });
  assert.equal((await service.preview({ period: { kind: 'RANGE', from: '2026-10-31', to: '2026-10-01' }, kind: 'BOTH' })).status, 'INVALID_PERIOD');
  assert.equal((await service.preview({ period: { kind: 'RANGE', from: '2026-13-01', to: '2026-10-01' }, kind: 'BOTH' })).status, 'INVALID_PERIOD');
});

test('kind selects the sheets: expenses only, events only, or both; an empty choice makes no file', async () => {
  const { planner, expense, eventForm, db } = await seed();
  await expense('2026-10-14T15:30:00.000Z', 1000, '지출', null);
  await planner.createEvent(eventForm({ title: '일정', date: '2026-10-20' }));
  const saved = [];
  const events = createSqliteEventRepository(db);
  const service = createExportService({
    transactions: createSqliteTransactionRepository(db), events, reminders: createSqliteReminderRepository(db), now: () => NOW, timezone: () => TZ,
    sink: { async saveAndShare(name, bytes) { saved.push({ name, bytes }); } },
  });
  const names = async kind => {
    saved.length = 0;
    const outcome = await service.create({ period: { kind: 'ALL' }, kind });
    return [outcome.status, saved.length ? Object.keys(readZip(saved[0].bytes)).filter(name => name.startsWith('xl/worksheets/')).length : 0, saved.length ? readZip(saved[0].bytes)['xl/workbook.xml'].match(/name="([^"]+)"/g) : null];
  };
  assert.deepEqual(await names('BOTH'), ['DONE', 2, ['name="지출"', 'name="일정"']]);
  assert.deepEqual(await names('EXPENSE'), ['DONE', 1, ['name="지출"']]);
  assert.deepEqual(await names('EVENT'), ['DONE', 1, ['name="일정"']]);
  saved.length = 0;
  assert.equal((await service.create({ period: { kind: 'RANGE', from: '2027-01-01', to: '2027-01-31' }, kind: 'BOTH' })).status, 'EMPTY');
  assert.equal(saved.length, 0, 'no file for an empty period');
});

test('a failing file sink is reported as a failure, never as success', async () => {
  const { expense, db } = await seed();
  await expense('2026-10-14T15:30:00.000Z', 1000, '지출', null);
  const service = createExportService({
    transactions: createSqliteTransactionRepository(db), events: createSqliteEventRepository(db), reminders: createSqliteReminderRepository(db),
    now: () => NOW, timezone: () => TZ, sink: { async saveAndShare() { throw new Error('disk full'); } },
  });
  const outcome = await service.create({ period: { kind: 'ALL' }, kind: 'EXPENSE' });
  assert.equal(outcome.status, 'FAILED');
  assert.match(outcome.message, /기간을 줄여서 다시 시도해 주세요/);
});

test('formula-like memos and titles reach the file as protected text', async () => {
  const { planner, expense, eventForm, db } = await seed();
  await expense('2026-10-14T15:30:00.000Z', 1000, '=1+1', null);
  await expense('2026-10-14T15:31:00.000Z', 1000, '+SUM(A1)', null);
  await planner.createEvent(eventForm({ title: '@x', date: '2026-10-20' }));
  await planner.createEvent(eventForm({ title: '-2', date: '2026-10-20' }));
  const saved = [];
  const service = createExportService({
    transactions: createSqliteTransactionRepository(db), events: createSqliteEventRepository(db), reminders: createSqliteReminderRepository(db),
    now: () => NOW, timezone: () => TZ, sink: { async saveAndShare(name, bytes) { saved.push(bytes); } },
  });
  assert.equal((await service.create({ period: { kind: 'ALL' }, kind: 'BOTH' })).status, 'DONE');
  const parts = readZip(saved[0]);
  for (const sheet of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(!/<f[ >]/.test(parts[sheet]));
    const quoted = cellValues(parts[sheet]).filter(cell => cell.style === 3).map(cell => unescape(cell.text));
    assert.ok(quoted.length >= 2, sheet);
  }
});
