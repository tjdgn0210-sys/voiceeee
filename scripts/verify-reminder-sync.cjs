// Development-only: node --test scripts/verify-reminder-sync.cjs
// M1-08: reminder states against a fake system-notification adapter, the 64-nearest rule, retiming, settings, and the notification text.
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load, loaded } = createLoader();
const form = load('src/application/planner/event-form.ts');
const { createPlannerServices } = load('src/application/planner/planner-services.ts');
const { createReminderSync } = load('src/application/notifications/reminder-sync.ts');
const text = load('src/application/notifications/notification-text.ts');
const status = load('src/application/notifications/reminder-status.ts');
const { createSettingsService } = load('src/application/settings/app-settings.ts');
const { createUndoBar } = load('src/application/undo/undo-bar.ts');
const { createSqliteEventRepository } = load('src/database/repositories/sqlite-event-repository.ts');
const { createSqliteTaskRepository } = load('src/database/repositories/sqlite-task-repository.ts');
const { createSqliteReminderRepository } = load('src/database/repositories/sqlite-reminder-repository.ts');
const { createSqliteSettingsRepository } = load('src/database/repositories/sqlite-settings-repository.ts');
const { createSqlitePlannerUnitOfWork } = load('src/database/sqlite-planner-unit-of-work.ts');

const TZ = 'Asia/Seoul';
const START = '2026-10-03T00:00:00.000Z'; // 09:00 KST on the 3rd

function fakeAdapter() {
  const adapter = {
    permission: 'GRANTED',
    failWith: null,
    scheduled: new Map(),
    calls: [],
    async getPermissionState() { return adapter.permission; },
    async requestPermission() { return adapter.permission; },
    async schedule(request) {
      adapter.calls.push(['schedule', request.reminderId]);
      if (adapter.permission !== 'GRANTED') return { status: 'PERMISSION_BLOCKED' };
      if (adapter.failWith) return { status: 'FAILED', reason: adapter.failWith };
      adapter.scheduled.set(request.reminderId, { fireAt: request.fireAt, title: request.title });
      return { status: 'SCHEDULED' };
    },
    async cancel(id) { adapter.calls.push(['cancel', id]); adapter.scheduled.delete(id); },
    async listScheduledIds() { return [...adapter.scheduled.keys()]; },
  };
  return adapter;
}

async function setup({ limit } = {}) {
  const db = await openMigratedDatabase(load);
  let clock = Date.parse(START);
  let counter = 0;
  const adapter = fakeAdapter();
  const events = createSqliteEventRepository(db);
  const tasks = createSqliteTaskRepository(db);
  const reminders = createSqliteReminderRepository(db);
  const settings = createSettingsService(createSqliteSettingsRepository(db));
  const now = () => new Date(clock).toISOString();
  const sync = createReminderSync({ reminders, events, tasks, adapter, loadSettings: settings.load, now, limit });
  const undoBar = createUndoBar({ setTimer: () => 1, clearTimer: () => {} });
  const planner = createPlannerServices({
    events, tasks, reminders, unitOfWork: createSqlitePlannerUnitOfWork(db),
    nextActionId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, nextLogId: () => `log-${++counter}`,
    now, timezone: () => TZ, undoWindowMilliseconds: 60_000, undoBar,
    afterMutation: async () => (await sync.sync()).warnings,
  });
  const eventForm = (overrides = {}) => ({ ...form.initialEventForm({ now: START, timezone: TZ, defaultReminder: null }), title: '병원 예약', date: '2026-10-05', time: '15:00', ...overrides });
  const states = async () => (await reminders.listLive()).map(item => [item.relativeOffsetMinutes, item.status, item.lastError]);
  return { db, planner, sync, adapter, settings, reminders, eventForm, states, advance: ms => { clock += ms; }, undoBar };
}

test('a new reminder becomes SCHEDULED only after the system accepted it, with the text of blueprint 8.3', async () => {
  const { planner, adapter, eventForm, states } = await setup();
  const saved = await planner.createEvent(eventForm({ location: '강남세브란스', reminderOffsets: [-30] }));
  assert.deepEqual(saved.warnings, []);
  assert.deepEqual(await states(), [[-30, 'SCHEDULED', null]]);
  const [entry] = [...adapter.scheduled.values()];
  assert.equal(entry.title, '병원 예약 · 30분 후 (강남세브란스)');
  assert.equal(entry.fireAt, '2026-10-05T05:30:00.000Z');
});

test('the lock-screen title setting hides the title and place', async () => {
  const { planner, adapter, eventForm, settings } = await setup();
  await settings.update({ lockscreenShowTitle: false });
  await planner.createEvent(eventForm({ location: '강남세브란스', reminderOffsets: [-30] }));
  assert.equal([...adapter.scheduled.values()][0].title, '일정 알림 · 30분 후');
});

test('without permission the reminder is PERMISSION_BLOCKED, the user is told, and granting later schedules it', async () => {
  const { planner, adapter, eventForm, states, sync } = await setup();
  adapter.permission = 'BLOCKED';
  const saved = await planner.createEvent(eventForm({ reminderOffsets: [0] }));
  assert.equal(saved.status, 'SAVED');
  assert.match(saved.warnings[0], /권한/);
  assert.deepEqual(await states(), [[0, 'PERMISSION_BLOCKED', null]]);
  assert.equal(adapter.scheduled.size, 0);
  adapter.permission = 'GRANTED';
  const report = await sync.sync();
  assert.equal(report.scheduled, 1);
  assert.deepEqual(await states(), [[0, 'SCHEDULED', null]]);
});

test('an unanswered permission prompt: the system refuses, the reminder is PERMISSION_BLOCKED, never SCHEDULED', async () => {
  const { planner, adapter, eventForm, states } = await setup();
  adapter.permission = 'UNDETERMINED';
  const saved = await planner.createEvent(eventForm({ reminderOffsets: [0] }));
  assert.equal(saved.status, 'SAVED');
  assert.deepEqual(await states(), [[0, 'PERMISSION_BLOCKED', null]]);
});

test('a failed scheduling stays REQUESTED with its reason ("예약 실패, 다시 시도"); a retry clears it', async () => {
  const { planner, adapter, eventForm, states, sync, reminders, advance } = await setup();
  adapter.failWith = 'system error';
  const saved = await planner.createEvent(eventForm({ reminderOffsets: [0] }));
  assert.equal(saved.status, 'SAVED', 'the event is saved');
  assert.match(saved.warnings[0], /예약하지 못했어요/);
  assert.deepEqual(await states(), [[0, 'REQUESTED', 'system error']]);
  const [reminder] = await reminders.listLive();
  assert.deepEqual(status.describeReminder(reminder, new Date(Date.parse(START)).toISOString()), { text: '예약 실패, 다시 시도', attention: true, retryable: true });
  advance(1000);
  adapter.failWith = null;
  await sync.sync();
  assert.deepEqual(await states(), [[0, 'SCHEDULED', null]]);
});

test('reminder status text: scheduled, waiting, passed, blocked; delivery is never claimed', async () => {
  const base = { id: 'r', targetType: 'EVENT', targetId: 'e', fireAt: '2026-10-05T06:00:00.000Z', timezone: TZ, relativeOffsetMinutes: 0, deliveryMode: 'LOCAL', lastError: null, createdAt: START, updatedAt: START, cancelledAt: null };
  const early = '2026-10-04T00:00:00.000Z';
  const late = '2026-10-06T00:00:00.000Z';
  assert.equal(status.describeReminder({ ...base, status: 'SCHEDULED' }, early).text, '예약됨');
  assert.equal(status.describeReminder({ ...base, status: 'REQUESTED' }, early).text, '예약 대기');
  assert.equal(status.describeReminder({ ...base, status: 'REQUESTED' }, late).text, '알림 시각이 지났어요');
  assert.equal(status.describeReminder({ ...base, status: 'REQUESTED' }, late).retryable, false);
  assert.match(status.describeReminder({ ...base, status: 'PERMISSION_BLOCKED' }, early).text, /알림 꺼짐/);
  assert.equal(status.describeReminder({ ...base, status: 'CANCELLED', cancelledAt: late }, early).text, '취소됨');
  for (const view of ['SCHEDULED', 'REQUESTED', 'PERMISSION_BLOCKED']) assert.doesNotMatch(status.describeReminder({ ...base, status: view }, early).text, /전달|울렸/);
});

test('only the nearest reminders are scheduled; the rest wait without an error, and a refill schedules them', async () => {
  const { planner, adapter, eventForm, states, sync, advance } = await setup({ limit: 3 });
  for (const day of ['05', '06', '07', '08', '09']) await planner.createEvent(eventForm({ title: `일정 ${day}`, date: `2026-10-${day}`, reminderOffsets: [0] }));
  assert.equal(adapter.scheduled.size, 3);
  const all = await states();
  assert.deepEqual(all.map(item => item[1]), ['SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'REQUESTED', 'REQUESTED']);
  assert.ok(all.every(item => item[2] === null), 'waiting for the limit is not a failure');
  const titles = [...adapter.scheduled.values()].map(item => item.title).sort();
  assert.deepEqual(titles, ['일정 05 · 지금', '일정 06 · 지금', '일정 07 · 지금']);
  // The first reminder rings and passes; the next sync fills the freed place with the nearest waiting one.
  advance(3 * 86_400_000 - 8 * 3600_000);
  await sync.sync();
  assert.equal(adapter.scheduled.size, 3);
  assert.ok([...adapter.scheduled.values()].some(item => item.title === '일정 08 · 지금'));
});

test('changing the event time reschedules the same reminder at the new time', async () => {
  const { planner, adapter, eventForm, states, advance } = await setup();
  const saved = await planner.createEvent(eventForm({ reminderOffsets: [-30] }));
  advance(1000);
  const event = await planner.findEvent(saved.entityId);
  const edit = form.eventFormFromEvent(event, TZ, await planner.remindersOf('EVENT', event.id));
  const result = await planner.updateEvent(event, { ...edit, time: '18:00' });
  assert.equal(result.status, 'SAVED');
  assert.deepEqual(await states(), [[-30, 'SCHEDULED', null]]);
  assert.deepEqual([...adapter.scheduled.values()].map(item => item.fireAt), ['2026-10-05T08:30:00.000Z']);
  assert.equal(adapter.scheduled.size, 1, 'the old time is not left behind');
});

test('deleting cancels the system notification; undoing the delete schedules it again', async () => {
  const { planner, adapter, eventForm, undoBar, advance } = await setup();
  const saved = await planner.createEvent(eventForm({ reminderOffsets: [0] }));
  advance(1000);
  const event = await planner.findEvent(saved.entityId);
  assert.equal(adapter.scheduled.size, 1);
  await planner.deleteEvent(event);
  assert.equal(adapter.scheduled.size, 0);
  await undoBar.run();
  assert.equal(adapter.scheduled.size, 1);
});

test('turning all notifications off clears the system and keeps reminders REQUESTED; turning on schedules again', async () => {
  const { planner, adapter, eventForm, states, settings, sync } = await setup();
  await planner.createEvent(eventForm({ reminderOffsets: [0] }));
  await settings.update({ allOn: false });
  await sync.sync();
  assert.equal(adapter.scheduled.size, 0);
  assert.deepEqual(await states(), [[0, 'REQUESTED', null]]);
  await settings.update({ allOn: true, ownOn: false });
  await sync.sync();
  assert.equal(adapter.scheduled.size, 0, 'own reminders off');
  await settings.update({ ownOn: true });
  await sync.sync();
  assert.deepEqual(await states(), [[0, 'SCHEDULED', null]]);
});

test('past reminders are not scheduled and a completed task no longer rings', async () => {
  const { planner, adapter, eventForm, states, sync, advance } = await setup();
  await planner.createEvent(eventForm({ date: '2026-10-03', time: '12:00', reminderOffsets: [0] }));
  assert.equal(adapter.scheduled.size, 1);
  advance(4 * 3600_000);
  await sync.sync();
  assert.equal(adapter.scheduled.size, 0, 'the system no longer holds a past reminder');
  assert.deepEqual((await states())[0][1], 'SCHEDULED', 'its state is kept: delivery is neither claimed nor denied');

  const task = await planner.createTask({ ...form.initialTaskForm({ now: new Date(Date.parse(START) + 4 * 3600_000).toISOString(), timezone: TZ }), title: '서류', hasDue: true, date: '2026-10-06', time: '18:00', reminderOffsets: [-60] });
  assert.equal([...adapter.scheduled.values()][0].title, '서류 · 마감 1시간 후');
  advance(1000);
  await planner.completeTask(await planner.findTask(task.entityId));
  assert.equal(adapter.scheduled.size, 0, 'a completed task is no longer reminded');
});

test('two syncs at once never interleave: each reminder is handed to the system once', async () => {
  const { planner, adapter, eventForm, sync } = await setup();
  await planner.createEvent(eventForm({ reminderOffsets: [0, -30] }));
  adapter.calls.length = 0;
  await Promise.all([sync.sync(), sync.sync(), sync.sync()]);
  assert.equal(adapter.calls.filter(call => call[0] === 'schedule').length, 0, 'already scheduled: nothing is sent again');
});

test('notification text: blueprint 8.3 examples and the other offsets', () => {
  const event = (offset, showTitle = true, location = '강남세브란스') => text.buildNotificationText({ target: 'EVENT', title: '병원 예약', location, offsetMinutes: offset, showTitle });
  assert.equal(event(-30), '병원 예약 · 30분 후 (강남세브란스)');
  assert.equal(event(-30, false), '일정 알림 · 30분 후');
  assert.equal(event(0), '병원 예약 · 지금 (강남세브란스)');
  assert.equal(event(-60, true, null), '병원 예약 · 1시간 후');
  assert.equal(event(-1440, true, null), '병원 예약 · 내일');
  assert.equal(event(-90, true, null), '병원 예약 · 1시간 30분 후');
  assert.equal(text.buildNotificationText({ target: 'TASK', title: '서류', location: null, offsetMinutes: 0, showTitle: false }), '할 일 알림 · 지금 마감');
});

test('this flow stays in application, domain and database code', () => {
  assert.ok([...loaded].every(file => /^src\/(application|domain|database|utils)\//.test(file)), [...loaded].join(', '));
});
