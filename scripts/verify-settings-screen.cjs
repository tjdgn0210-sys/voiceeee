// Development-only: node --test scripts/verify-settings-screen.cjs
// M1-14 local settings: the two-step reset (c), what it deletes and keeps, notification priority in the screen, links and licenses.
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { assert, createLoader, openMigratedDatabase, root } = require('./test-support.cjs');

const { load } = createLoader();
const reset = load('src/application/reset/local-data-reset.ts');
const { createSqliteLocalDataStore } = load('src/database/local-data-store.ts');
const { createSettingsService, DEFAULT_SETTINGS } = load('src/application/settings/app-settings.ts');
const { createSqliteSettingsRepository } = load('src/database/repositories/sqlite-settings-repository.ts');
const links = load('src/constants/app-links.ts');

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const TABLES = ['reminders', 'events', 'tasks', 'transactions', 'notes', 'capture_drafts', 'action_logs', 'settings'];

function seedEverything(db) {
  const now = '2026-10-04T00:00:00.000Z';
  db.raw.prepare("INSERT INTO transactions (id, type, amount, currency_code, category, memo, occurred_at, input_method, raw_input, created_at, updated_at) VALUES ('t1','EXPENSE',1000,'KRW',null,null,?, 'MANUAL', null, ?, ?)").run(now, now, now);
  db.raw.prepare("INSERT INTO tasks (id, title, due_at, status, completed_at, source_action_id, created_at, updated_at) VALUES ('k1','할 일',null,'OPEN',null,'a',?,?)").run(now, now);
  db.raw.prepare("INSERT INTO events (id, title, time_kind, start_at, timezone, status, source_action_id, created_at, updated_at) VALUES ('e1','일정','EXACT',?, 'Asia/Seoul','UPCOMING','a',?,?)").run('2026-10-05T00:00:00.000Z', now, now);
  db.raw.prepare("INSERT INTO reminders (id, target_type, target_id, fire_at, timezone, relative_offset_minutes, status, delivery_mode, created_at, updated_at) VALUES ('r1','EVENT','e1',?, 'Asia/Seoul',0,'SCHEDULED','LOCAL',?,?)").run('2026-10-05T00:00:00.000Z', now, now);
  db.raw.prepare("INSERT INTO settings (key, value) VALUES ('fontScale','1.5')").run();
}
const counts = db => Object.fromEntries(TABLES.map(table => [table, db.raw.prepare(`SELECT count(*) n FROM ${table}`).get().n]));

test('the confirmation word is required: anything else deletes nothing', async () => {
  const db = await openMigratedDatabase(load);
  seedEverything(db);
  let after = 0;
  const service = reset.createLocalDataReset({ store: createSqliteLocalDataStore(db), afterReset: async () => { after += 1; } });
  for (const word of ['', '지우기', 'delete', '삭제하기']) assert.equal((await service.reset(word)).status, 'NOT_CONFIRMED', word);
  assert.equal(counts(db).transactions, 1);
  assert.equal(after, 0);
  assert.ok(reset.isResetConfirmed(' 삭제 '), 'surrounding spaces are tolerated');
});

test('confirmed reset empties every personal table, then reconciles notifications', async () => {
  const db = await openMigratedDatabase(load);
  seedEverything(db);
  assert.ok(Object.values(counts(db)).some(value => value > 0));
  let after = 0;
  const service = reset.createLocalDataReset({ store: createSqliteLocalDataStore(db), afterReset: async () => { after += 1; } });
  assert.deepEqual(await service.reset('삭제'), { status: 'DONE' });
  assert.deepEqual(Object.values(counts(db)), TABLES.map(() => 0));
  assert.equal(after, 1);
  assert.equal(db.raw.prepare('PRAGMA user_version').get().user_version, 3, 'the schema is untouched');
});

test('a failure in the middle rolls everything back and says nothing was deleted', async () => {
  const db = await openMigratedDatabase(load);
  seedEverything(db);
  const failing = { ...db, withExclusiveTransactionAsync: async work => db.withExclusiveTransactionAsync(async tx => work({ ...tx, runAsync: async (sql, ...params) => { if (/DELETE FROM tasks/.test(sql)) throw new Error('disk error'); return tx.runAsync(sql, ...params); } })) };
  let after = 0;
  const service = reset.createLocalDataReset({ store: createSqliteLocalDataStore(failing), afterReset: async () => { after += 1; } });
  const result = await service.reset('삭제');
  assert.equal(result.status, 'FAILED');
  assert.match(result.message, /기록은 그대로 있어요/);
  assert.equal(counts(db).reminders, 1, 'the earlier DELETE was rolled back');
  assert.equal(after, 0);
});

test('records gone but notifications not cleaned: the user is told, not shown a success', async () => {
  const db = await openMigratedDatabase(load);
  seedEverything(db);
  const service = reset.createLocalDataReset({ store: createSqliteLocalDataStore(db), afterReset: async () => { throw new Error('os'); } });
  const result = await service.reset('삭제');
  assert.equal(result.status, 'FAILED');
  assert.match(result.message, /기록은 지웠지만/);
  assert.equal(counts(db).transactions, 0);
});

test('after a reset the settings are the defaults, but the first-run screens do not come back', async () => {
  const db = await openMigratedDatabase(load);
  const settings = createSettingsService(createSqliteSettingsRepository(db));
  await settings.update({ fontScale: 1.5, allOn: false, onboardingDone: true });
  const service = reset.createLocalDataReset({ store: createSqliteLocalDataStore(db), afterReset: async () => {} });
  await service.reset('삭제');
  assert.deepEqual(await settings.load(), DEFAULT_SETTINGS, 'every setting row is gone');
  const next = await settings.update(reset.SETTINGS_AFTER_RESET);
  assert.deepEqual(next, { ...DEFAULT_SETTINGS, onboardingDone: true });
});

test('the screen needs two steps and the typed word; the button is red and disabled until it matches', () => {
  const source = read('src/features/settings/reset-section.tsx');
  assert.match(source, /setOpen\(true\)/);
  assert.match(source, /disabled=\{working \|\| !isResetConfirmed\(word\)\}/);
  assert.match(source, /styles\.danger/);
  assert.match(source, /로그인하지 않았으므로 백업이 없어서 되돌릴 수 없어요/);
});

test('"all notifications" off visibly overrides the rows below it, and every change is applied to the system', () => {
  const source = read('src/features/settings/notification-settings.tsx');
  assert.match(source, /const off = !settings\.allOn/);
  for (const row of ['내 일정 알림', '잠금 화면에 일정 제목 표시']) assert.match(source.slice(source.indexOf(row)), /disabled=\{off\}/, row);
  assert.match(source, /disabled=\{off\}\s*\n\s*onChange/);
  assert.match(source, /await update\(patch\);\s*\n\s*const report = await sync\(\)/);
});

test('links: only https pages and real-looking addresses become rows; nothing is invented', () => {
  assert.equal(links.isWebUrl('https://example.com/terms'), true);
  assert.equal(links.isWebUrl('http://example.com'), false);
  assert.equal(links.isWebUrl('javascript:alert(1)'), false);
  assert.equal(links.isWebUrl(''), false);
  assert.equal(links.isEmail('help@example.com'), true);
  assert.equal(links.isEmail('not an email'), false);
  assert.deepEqual(links.APP_LINKS, { termsUrl: '', privacyUrl: '', contactEmail: '' }, 'no address is built into the app');
  const about = read('src/features/settings/about-section.tsx');
  assert.match(about, /isWebUrl\(APP_LINKS\.termsUrl\) && /);
  assert.match(about, /isWebUrl\(APP_LINKS\.privacyUrl\) && /);
  assert.match(about, /isEmail\(APP_LINKS\.contactEmail\) && /);
  assert.match(read('.env.example'), /EXPO_PUBLIC_TERMS_URL=/);
});

test('the license list covers every direct dependency', () => {
  const manifest = JSON.parse(read('package.json'));
  const { OPEN_SOURCE_PACKAGES } = load('src/constants/open-source-licenses.ts');
  assert.deepEqual(OPEN_SOURCE_PACKAGES.map(item => item.name).sort(), Object.keys(manifest.dependencies).sort(), 'run: node scripts/generate-licenses.cjs');
  assert.ok(OPEN_SOURCE_PACKAGES.every(item => item.license && item.license !== 'UNKNOWN'));
});
