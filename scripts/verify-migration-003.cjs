// Development-only: node scripts/verify-migration-003.cjs (Node 22.13+ with node:sqlite).
// Upgrades a real version-2 database (migrations 001 + 002) to version 3 on disposable SQLite files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) throw new Error(`Unexpected runtime import: ${specifier}`);
    return load(path.resolve(path.dirname(file), specifier) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}

function adapter(db) {
  const api = {
    execAsync: async sql => { db.exec(sql); },
    getFirstAsync: async sql => db.prepare(sql).get() ?? null,
    withExclusiveTransactionAsync: async work => {
      db.exec('BEGIN');
      try { await work(api); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return api;
}

const { migrateDatabase } = load('src/database/migrations/migrate.ts');
const { migrations } = load('src/database/migrations/index.ts');
const versionTwo = migrations.filter(migration => migration.version <= 2);
const now = '2026-10-03T01:00:00.000Z';
const common = { created_at: now, updated_at: now };

function insert(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
}
const version = db => db.prepare('PRAGMA user_version').get().user_version;
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row }));

// Records written by the version-2 app, before migration 003 exists.
function seedVersionTwo(db) {
  insert(db, 'transactions', { ...common, id: 'expense', type: 'EXPENSE', amount: 8000, currency_code: 'KRW', category: '식비', memo: '점심', occurred_at: now, input_method: 'VOICE', raw_input: '점심 8천원 썼어' });
  insert(db, 'transactions', { ...common, id: 'income', type: 'INCOME', amount: 50000, currency_code: 'KRW', occurred_at: now, input_method: 'MANUAL', deleted_at: now });
  insert(db, 'events', { ...common, id: 'exact', title: '치과', time_kind: 'EXACT', start_at: now, end_at: '2026-10-03T02:00:00.000Z', timezone: 'Asia/Seoul', location: '강남', status: 'UPCOMING', source_action_id: 'a-exact' });
  insert(db, 'events', { ...common, id: 'fuzzy', title: '민수 만나기', time_kind: 'FUZZY', fuzzy_time: '저녁쯤', timezone: 'Asia/Seoul', status: 'PAST', source_action_id: 'a-fuzzy' });
  insert(db, 'tasks', { ...common, id: 'task', title: '보고서 내기', due_at: now, status: 'OPEN', source_action_id: 'a-task' });
  insert(db, 'reminders', { ...common, id: 'reminder', target_type: 'EVENT', target_id: 'exact', fire_at: '2026-10-03T00:30:00.000Z', timezone: 'Asia/Seoul', relative_offset_minutes: -30, status: 'SCHEDULED', delivery_mode: 'LOCAL' });
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vlm-migration-003-'));
  const filename = path.join(temporary, 'v2.db');
  let db;
  try {
    db = new DatabaseSync(filename);
    await migrateDatabase(adapter(db), versionTwo);
    assert.equal(version(db), 2);
    seedVersionTwo(db);
    const before = Object.fromEntries(['transactions', 'events', 'tasks', 'reminders'].map(table => [table, rows(db, table)]));

    await migrateDatabase(adapter(db));
    assert.equal(version(db), 3);

    // Every old column keeps its value; new columns take their defaults.
    const after = Object.fromEntries(['transactions', 'events', 'tasks', 'reminders'].map(table => [table, rows(db, table)]));
    const withDefaults = {
      transactions: before.transactions.map(row => ({ ...row, include_in_total: 1, bundle_items: null })),
      events: before.events.map(row => ({ ...row, date: null, visibility: 'PRIVATE' })),
      tasks: before.tasks.map(row => ({ ...row, visibility: 'PRIVATE' })),
      reminders: before.reminders.map(row => ({ ...row, last_error: null })),
    };
    for (const table of Object.keys(withDefaults)) {
      assert.equal(after[table].length, before[table].length, `${table} row count`);
      assert.deepEqual(after[table].map(row => ({ ...row })), withDefaults[table].map(row => ({ ...row })), `${table} data`);
    }
    assert.deepEqual(columns(db, 'settings'), ['key', 'value']);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'events_v3'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'events_status_start_at_idx' AND tbl_name = 'events'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").get().n, 6);
    console.log('PASS: version-2 data preserved through 003 (events rebuilt), defaults applied, settings created, events index recreated.');

    // Applying again (same connection, then after reopening) changes nothing.
    await migrateDatabase(adapter(db));
    db.close();
    db = new DatabaseSync(filename);
    await migrateDatabase(adapter(db));
    assert.equal(version(db), 3);
    for (const table of Object.keys(withDefaults)) assert.deepEqual(rows(db, table), after[table], `${table} after reapply`);
    console.log('PASS: reapplying and reopening are no-ops.');

    // New constraints accept valid shapes and reject invalid values.
    const event = { ...common, id: 'new', title: '휴가', timezone: 'Asia/Seoul', status: 'UPCOMING', source_action_id: 'a-new' };
    insert(db, 'events', { ...event, id: 'all-day', time_kind: 'ALL_DAY', date: '2026-10-03', visibility: 'PUBLIC' });
    insert(db, 'events', { ...event, id: 'leap-day', time_kind: 'ALL_DAY', date: '2028-02-29' });
    insert(db, 'events', { ...event, id: 'dated-fuzzy', time_kind: 'FUZZY', fuzzy_time: '저녁쯤', date: '2026-10-03' });
    for (const patch of [
      { time_kind: 'ALL_DAY' },
      { time_kind: 'ALL_DAY', date: '2026-10-03', start_at: now },
      { time_kind: 'ALL_DAY', date: '2026-10-03', fuzzy_time: '저녁쯤' },
      { time_kind: 'ALL_DAY', date: '2026-10-03', end_at: now },
      { time_kind: 'EXACT', start_at: now, date: '2026-10-03' },
      { time_kind: 'ALL_DAY', date: '2026/10/03' },
      { time_kind: 'ALL_DAY', date: '2026-02-30' },
      { time_kind: 'ALL_DAY', date: '2027-02-29' },
      { time_kind: 'ALL_DAY', date: '2026-10-03T00:00' },
      { time_kind: 'ALL_DAY', date: '2026-10-03', visibility: 'FRIENDS' },
    ]) assert.throws(() => insert(db, 'events', { ...event, id: 'invalid', ...patch }), undefined, JSON.stringify(patch));

    assert.throws(() => insert(db, 'tasks', { ...common, id: 'bad-task', title: 'x', status: 'OPEN', source_action_id: 'a', visibility: 'FRIENDS' }));
    const transaction = { ...common, id: 'bundle', type: 'EXPENSE', amount: 12000, currency_code: 'KRW', occurred_at: now, input_method: 'TEXT' };
    insert(db, 'transactions', { ...transaction, include_in_total: 0, bundle_items: '["아이스크림","생수","밥"]' });
    for (const patch of [{ include_in_total: 2 }, { bundle_items: '{}' }, { bundle_items: 'broken' }, { bundle_items: '"생수"' }]) {
      assert.throws(() => insert(db, 'transactions', { ...transaction, id: 'invalid', ...patch }), undefined, JSON.stringify(patch));
    }
    insert(db, 'settings', { key: 'fontScale', value: '1.3' });
    insert(db, 'settings', { key: 'followSystemFont', value: 'false' });
    assert.throws(() => insert(db, 'settings', { key: 'fontScale', value: '1.0' }));
    assert.throws(() => insert(db, 'settings', { key: 'broken', value: 'not json' }));
    assert.throws(() => insert(db, 'settings', { key: null, value: '1' }));
    console.log('PASS: ALL_DAY/dated FUZZY accepted; bad shapes, dates, visibility, total flag, bundle JSON and settings rejected.');
  } finally {
    if (db?.isOpen) db.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  // A failure late in 003 (settings already exists) rolls back the events rebuild and every ALTER.
  const failing = new DatabaseSync(':memory:');
  try {
    await migrateDatabase(adapter(failing), versionTwo);
    seedVersionTwo(failing);
    failing.exec('CREATE TABLE settings (key TEXT)');
    const before = Object.fromEntries(['transactions', 'events', 'tasks', 'reminders'].map(table => [table, rows(failing, table)]));
    const schemaBefore = failing.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all().map(row => ({ ...row }));
    await assert.rejects(migrateDatabase(adapter(failing)), /already exists/);
    assert.equal(version(failing), 2);
    assert.deepEqual(failing.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all().map(row => ({ ...row })), schemaBefore);
    for (const table of Object.keys(before)) assert.deepEqual(rows(failing, table), before[table], `${table} after rollback`);
    assert(!columns(failing, 'events').includes('date'));
    assert(!columns(failing, 'tasks').includes('visibility'));
    assert(!columns(failing, 'transactions').includes('include_in_total'));
    assert(!columns(failing, 'reminders').includes('last_error'));
    assert.throws(() => insert(failing, 'events', { ...common, id: 'all-day', title: 'x', time_kind: 'ALL_DAY', timezone: 'Asia/Seoul', status: 'UPCOMING', source_action_id: 'a' }));
    console.log('PASS: mid-migration failure rolls back everything; version stays 2 with schema and data unchanged.');
  } finally { failing.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
