// Development-only: node --test scripts/verify-planner-services.cjs
// M1-04 / M1-06: event and task input forms, the planner facade (create / edit / delete / complete / undo) and reminders,
// run against the real executors and repositories on a disposable in-memory SQLite.
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load, loaded } = createLoader();
const form = load('src/application/planner/event-form.ts');
const zoned = load('src/application/planner/zoned-time.ts');
const { createPlannerServices } = load('src/application/planner/planner-services.ts');
const { createUndoBar } = load('src/application/undo/undo-bar.ts');
const { createSqliteEventRepository } = load('src/database/repositories/sqlite-event-repository.ts');
const { createSqliteTaskRepository } = load('src/database/repositories/sqlite-task-repository.ts');
const { createSqliteReminderRepository } = load('src/database/repositories/sqlite-reminder-repository.ts');
const { createSqlitePlannerUnitOfWork } = load('src/database/sqlite-planner-unit-of-work.ts');

const TZ = 'Asia/Seoul';
const NOW = '2026-10-03T12:00:00.000Z'; // 2026-10-03 21:00 KST

async function setup(options = {}) {
  const db = await openMigratedDatabase(load);
  let clock = Date.parse(NOW);
  let counter = 0;
  let afterCalls = 0;
  const timers = [];
  const undoBar = createUndoBar({ setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimer: () => {} });
  const planner = createPlannerServices({
    events: createSqliteEventRepository(db),
    tasks: createSqliteTaskRepository(db),
    reminders: createSqliteReminderRepository(db),
    unitOfWork: createSqlitePlannerUnitOfWork(db),
    nextActionId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    nextLogId: () => `log-${++counter}`,
    now: () => new Date(clock).toISOString(),
    timezone: () => TZ,
    undoWindowMilliseconds: 60_000,
    undoBar,
    afterMutation: async () => { afterCalls += 1; return options.syncWarnings ?? []; },
  });
  return { db, planner, undoBar, tick: (ms = 1000) => { clock += ms; }, afterCalls: () => afterCalls };
}

const newEventForm = (overrides = {}) => ({
  ...form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: null }),
  title: '치과 예약', date: '2026-10-05', time: '15:00', ...overrides,
});

test('time helpers: zoned conversion, nonexistent DST time, date arithmetic', () => {
  assert.equal(zoned.zonedWallTimeToUtc('2026-10-05', '15:00', TZ), '2026-10-05T06:00:00.000Z');
  assert.equal(zoned.utcToZonedFields('2026-10-05T06:00:00.000Z', TZ).time, '15:00');
  assert.equal(zoned.zonedWallTimeToUtc('2026-03-08', '02:30', 'America/New_York'), null, 'DST gap');
  assert.equal(zoned.zonedWallTimeToUtc('2026-02-30', '10:00', TZ), null);
  assert.equal(zoned.zonedWallTimeToUtc('2026-10-05', '24:00', TZ), null);
  assert.equal(zoned.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(zoned.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(zoned.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(zoned.weekdayOf('2026-10-04'), 0);
  assert.equal(zoned.daysBetween('2026-10-04', '2026-10-31'), 27);
});

test('initial form: next whole hour, default reminder pre-selected, guests are private', () => {
  const initial = form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: 0 });
  assert.deepEqual([initial.date, initial.time], ['2026-10-03', '22:00']);
  assert.deepEqual(initial.reminderOffsets, [0]);
  assert.equal(initial.visibility, 'PRIVATE');
  assert.deepEqual(form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: null }).reminderOffsets, []);
  assert.deepEqual(form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: -30 }).reminderOffsets, [-30]);
  const lateNight = form.initialEventForm({ now: '2026-10-03T14:30:00.000Z', timezone: TZ, defaultReminder: null });
  assert.deepEqual([lateNight.date, lateNight.time], ['2026-10-04', '00:00']);
  assert.equal(form.initialEventForm({ now: NOW, timezone: TZ, defaultReminder: null, title: 'x'.repeat(150) }).title.length, 100);
});

test('form validation: end before start, empty title, fuzzy text, bad date and time', () => {
  const endBefore = form.buildEventPayload(newEventForm({ endTime: '14:00' }), TZ);
  assert.equal(endBefore.status, 'ERROR');
  assert.equal(endBefore.errors.endTime, '종료 시각은 시작 시각보다 뒤여야 해요');
  assert.equal(form.buildEventPayload(newEventForm({ endTime: '15:00' }), TZ).status, 'ERROR');
  assert.equal(form.buildEventPayload(newEventForm({ endTime: '16:30' }), TZ).status, 'OK');
  assert.equal(form.buildEventPayload(newEventForm({ title: '   ' }), TZ).errors.title, '제목을 입력해 주세요');
  assert.equal(form.buildEventPayload(newEventForm({ title: 'a'.repeat(101) }), TZ).errors.title, '제목은 100자까지 쓸 수 있어요');
  assert.equal(form.buildEventPayload(newEventForm({ location: 'a'.repeat(101) }), TZ).errors.location, '장소는 100자까지 쓸 수 있어요');
  assert.ok(form.buildEventPayload(newEventForm({ timeKind: 'FUZZY', fuzzyTime: '' }), TZ).errors.fuzzyTime);
  assert.ok(form.buildEventPayload(newEventForm({ date: '2026-13-01' }), TZ).errors.date);
  assert.ok(form.buildEventPayload(newEventForm({ time: '25:00' }), TZ).errors.time);
  assert.ok(form.buildEventPayload(newEventForm({ timeKind: 'ALL_DAY', date: '' }), TZ).errors.date);
});

test('M1-04 three time kinds are saved and read back; an all-day or fuzzy event never gets reminders', async () => {
  const { planner, db } = await setup();
  const exact = await planner.createEvent(newEventForm({ endTime: '16:00', location: '강남', reminderOffsets: [0, -30] }));
  assert.equal(exact.status, 'SAVED');
  assert.deepEqual(exact.warnings, []);
  const event = await planner.findEvent(exact.entityId);
  assert.equal(event.kind, 'EXACT');
  assert.equal(event.startAt, '2026-10-05T06:00:00.000Z');
  assert.equal(event.endAt, '2026-10-05T07:00:00.000Z');
  assert.equal(event.location, '강남');
  assert.equal(event.visibility, 'PRIVATE');
  const reminders = await planner.remindersOf('EVENT', event.id);
  assert.deepEqual(reminders.map(item => [item.relativeOffsetMinutes, item.fireAt, item.status]), [
    [-30, '2026-10-05T05:30:00.000Z', 'REQUESTED'], [0, '2026-10-05T06:00:00.000Z', 'REQUESTED'],
  ]);

  const fuzzy = await planner.createEvent(newEventForm({ title: '저녁 약속', timeKind: 'FUZZY', fuzzyTime: '저녁쯤', reminderOffsets: [0] }));
  assert.equal(fuzzy.status, 'SAVED');
  const fuzzyEvent = await planner.findEvent(fuzzy.entityId);
  assert.deepEqual([fuzzyEvent.kind, fuzzyEvent.fuzzyTime, fuzzyEvent.date, fuzzyEvent.startAt], ['FUZZY', '저녁쯤', '2026-10-05', null]);
  assert.equal((await planner.remindersOf('EVENT', fuzzyEvent.id)).length, 0, 'fuzzy: no reminder');

  const allDay = await planner.createEvent(newEventForm({ title: '휴가', timeKind: 'ALL_DAY', endTime: '17:00', reminderOffsets: [-60] }));
  assert.equal(allDay.status, 'SAVED');
  const allDayEvent = await planner.findEvent(allDay.entityId);
  assert.deepEqual([allDayEvent.kind, allDayEvent.date, allDayEvent.startAt, allDayEvent.endAt], ['ALL_DAY', '2026-10-05', null, null]);
  assert.equal((await planner.remindersOf('EVENT', allDayEvent.id)).length, 0, 'all-day: no reminder');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM reminders').get().n, 2);
});

test('an invalid form saves nothing; the same action id is not saved twice (retry safety)', async () => {
  const { planner, db } = await setup();
  const invalid = await planner.createEvent(newEventForm({ endTime: '10:00' }));
  assert.equal(invalid.status, 'INVALID');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM events').get().n, 0);
  const id = planner.newActionId();
  const first = await planner.createEvent(newEventForm(), id);
  const second = await planner.createEvent(newEventForm(), id);
  assert.equal(first.status, 'SAVED');
  assert.equal(second.status, 'SAVED');
  assert.equal(first.entityId, second.entityId);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM events').get().n, 1);
  const conflict = await planner.createEvent(newEventForm({ title: '다른 일정' }), id);
  assert.equal(conflict.status, 'FAILED', 'same id with different input is rejected');
});

test('a failed reminder is reported as a warning while the event stays saved (partial success)', async () => {
  const { planner } = await setup();
  const result = await planner.createEvent(newEventForm({ reminderOffsets: [0, 5] }));
  assert.equal(result.status, 'SAVED');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /알림/);
  assert.equal((await planner.remindersOf('EVENT', result.entityId)).length, 1);
});

test('warnings from the notification step are passed to the screen', async () => {
  const { planner } = await setup({ syncWarnings: ['알림 권한이 꺼져 있어요'] });
  const result = await planner.createEvent(newEventForm());
  assert.deepEqual(result.warnings, ['알림 권한이 꺼져 있어요']);
});

test('creating offers an undo on the bar; undoing removes the event and cancels its reminders', async () => {
  const { planner, undoBar, db, afterCalls } = await setup();
  const result = await planner.createEvent(newEventForm({ reminderOffsets: [0] }));
  assert.equal(undoBar.getState().status, 'SHOWN');
  const before = afterCalls();
  await undoBar.run();
  assert.equal(undoBar.getState().status, 'DONE');
  assert.equal(await planner.findEvent(result.entityId), null);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM reminders WHERE status = 'CANCELLED'").get().n, 1);
  assert.ok(afterCalls() > before, 'notifications are reconciled after an undo');
});

test('editing: a time change retimes reminders, the selection adds and cancels, a kind switch cancels all', async () => {
  const { planner, tick } = await setup();
  const created = await planner.createEvent(newEventForm({ reminderOffsets: [0, -30] }));
  tick();
  let event = await planner.findEvent(created.entityId);
  let edit = form.eventFormFromEvent(event, TZ, await planner.remindersOf('EVENT', event.id));
  assert.deepEqual(edit.reminderOffsets, [0, -30]);
  assert.equal(edit.time, '15:00');

  const moved = await planner.updateEvent(event, { ...edit, time: '16:00', reminderOffsets: [0, -60] });
  assert.equal(moved.status, 'SAVED');
  event = await planner.findEvent(created.entityId);
  const live = (await planner.remindersOf('EVENT', event.id)).filter(item => item.status !== 'CANCELLED');
  assert.deepEqual(live.map(item => [item.relativeOffsetMinutes, item.fireAt]), [
    [-60, '2026-10-05T06:00:00.000Z'], [0, '2026-10-05T07:00:00.000Z'],
  ]);
  tick();

  edit = form.eventFormFromEvent(event, TZ, await planner.remindersOf('EVENT', event.id));
  const allDay = await planner.updateEvent(event, { ...edit, timeKind: 'ALL_DAY' });
  assert.equal(allDay.status, 'SAVED');
  event = await planner.findEvent(created.entityId);
  assert.deepEqual([event.kind, event.date, event.startAt], ['ALL_DAY', '2026-10-05', null]);
  assert.equal((await planner.remindersOf('EVENT', event.id)).filter(item => item.status !== 'CANCELLED').length, 0);
});

test('editing with a stale copy fails instead of overwriting', async () => {
  const { planner, tick } = await setup();
  const created = await planner.createEvent(newEventForm());
  const stale = await planner.findEvent(created.entityId);
  tick();
  await planner.updateEvent(stale, { ...form.eventFormFromEvent(stale, TZ, []), title: '먼저 바뀜' });
  tick();
  const result = await planner.updateEvent(stale, { ...form.eventFormFromEvent(stale, TZ, []), title: '늦게 바뀜' });
  assert.equal(result.status, 'FAILED');
  assert.equal((await planner.findEvent(created.entityId)).title, '먼저 바뀜');
});

test('delete and complete go through the pipeline and can be undone', async () => {
  const { planner, undoBar, tick } = await setup();
  const created = await planner.createEvent(newEventForm({ reminderOffsets: [0] }));
  tick();
  await undoBar.dismiss();
  let event = await planner.findEvent(created.entityId);
  assert.equal((await planner.completeEvent(event)).status, 'DONE');
  event = await planner.findEvent(created.entityId);
  assert.equal(event.status, 'COMPLETED');
  await undoBar.run();
  assert.equal((await planner.findEvent(created.entityId)).status, 'UPCOMING');
  tick();
  event = await planner.findEvent(created.entityId);
  assert.equal((await planner.deleteEvent(event)).status, 'DONE');
  assert.equal(await planner.findEvent(created.entityId), null);
  assert.equal(undoBar.getState().status, 'SHOWN');
  await undoBar.run();
  event = await planner.findEvent(created.entityId);
  assert.ok(event, 'restored');
  assert.equal((await planner.remindersOf('EVENT', event.id)).filter(item => item.status === 'REQUESTED').length, 1, 'reminder is back');
  const stale = { ...event, updatedAt: '2020-01-01T00:00:00.000Z' };
  assert.equal((await planner.deleteEvent(stale)).status, 'FAILED');
});

test('loadRange returns events by kind inside the range and all tasks', async () => {
  const { planner } = await setup();
  await planner.createEvent(newEventForm({ title: '10/5 오후', date: '2026-10-05' }));
  await planner.createEvent(newEventForm({ title: '10/5 종일', date: '2026-10-05', timeKind: 'ALL_DAY' }));
  await planner.createEvent(newEventForm({ title: '10/20', date: '2026-10-20' }));
  await planner.createTask({ ...form.initialTaskForm({ now: NOW, timezone: TZ }), title: '할 일' });
  const range = await planner.loadRange('2026-10-01', '2026-10-08');
  assert.deepEqual(range.events.map(item => item.title).sort(), ['10/5 오후', '10/5 종일']);
  assert.equal(range.tasks.length, 1);
  assert.equal((await planner.listAllEvents()).length, 3);
});

test('M1-06 tasks: no due date, due date with reminder, complete toggle with undo, overdue stays open', async () => {
  const { planner, undoBar, tick } = await setup();
  const base = form.initialTaskForm({ now: NOW, timezone: TZ });
  const noDue = await planner.createTask({ ...base, title: '마감 없는 일', hasDue: false });
  assert.equal(noDue.status, 'SAVED');
  assert.equal((await planner.findTask(noDue.entityId)).dueAt, null);

  const withDue = await planner.createTask({ ...base, title: '서류 제출', hasDue: true, date: '2026-10-06', time: '18:00', reminderOffsets: [-60] });
  assert.equal(withDue.status, 'SAVED');
  const task = await planner.findTask(withDue.entityId);
  assert.equal(task.dueAt, '2026-10-06T09:00:00.000Z');
  const reminders = await planner.remindersOf('TASK', task.id);
  assert.deepEqual(reminders.map(item => [item.relativeOffsetMinutes, item.fireAt]), [[-60, '2026-10-06T08:00:00.000Z']]);

  assert.equal((await planner.createTask({ ...base, title: '' })).status, 'INVALID');
  assert.equal((await planner.createTask({ ...base, title: 'x', hasDue: true, date: '2026-99-99' })).status, 'INVALID');

  tick();
  assert.equal((await planner.completeTask(task)).status, 'DONE');
  let done = await planner.findTask(task.id);
  assert.equal(done.status, 'COMPLETED');
  await undoBar.run();
  done = await planner.findTask(task.id);
  assert.equal(done.status, 'OPEN');
  tick();
  assert.equal((await planner.completeTask(done)).status, 'DONE');
  tick();
  done = await planner.findTask(task.id);
  assert.equal((await planner.reopenTask(done)).status, 'DONE');
  assert.equal((await planner.findTask(task.id)).status, 'OPEN');
  tick();
  // Overdue: a task whose due time has passed is still open and listed.
  const overdue = await planner.createTask({ ...base, title: '지난 일', hasDue: true, date: '2026-10-01', time: '09:00' });
  assert.equal((await planner.findTask(overdue.entityId)).status, 'OPEN');
  assert.equal((await planner.listAllTasks()).filter(item => item.status === 'OPEN').length, 3);
});

test('editing a task retimes its reminder; removing the due date cancels it', async () => {
  const { planner, tick } = await setup();
  const base = form.initialTaskForm({ now: NOW, timezone: TZ });
  const created = await planner.createTask({ ...base, title: '보고서', hasDue: true, date: '2026-10-06', time: '18:00', reminderOffsets: [-60] });
  tick();
  let task = await planner.findTask(created.entityId);
  let edit = form.taskFormFromTask(task, TZ, await planner.remindersOf('TASK', task.id));
  assert.deepEqual(edit.reminderOffsets, [-60]);
  assert.equal((await planner.updateTask(task, { ...edit, time: '20:00' })).status, 'SAVED');
  task = await planner.findTask(created.entityId);
  const live = (await planner.remindersOf('TASK', task.id)).filter(item => item.status !== 'CANCELLED');
  assert.equal(live[0].fireAt, '2026-10-06T10:00:00.000Z');
  tick();
  edit = form.taskFormFromTask(task, TZ, live);
  assert.equal((await planner.updateTask(task, { ...edit, hasDue: false, reminderOffsets: [] })).status, 'SAVED');
  assert.equal((await planner.findTask(created.entityId)).dueAt, null);
  assert.equal((await planner.remindersOf('TASK', created.entityId)).filter(item => item.status !== 'CANCELLED').length, 0);
});

test('the undo bar shows the latest action only, hides after its duration, and reports a failed reversal', async () => {
  const timers = [];
  const bar = createUndoBar({ setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimer: () => {} });
  let ran = 0;
  bar.show({ label: '첫 번째', undo: async () => { ran += 1; return { status: 'SUCCESS', affectedEntityId: 'a' }; } });
  bar.show({ label: '두 번째', undo: async () => ({ status: 'INELIGIBLE', message: '기록이 변경되어 되돌릴 수 없습니다.' }) });
  assert.equal(bar.getState().entry.label, '두 번째');
  assert.equal(timers.at(-1).ms, 8000);
  await bar.run();
  assert.equal(bar.getState().status, 'FAILED');
  assert.equal(bar.getState().message, '기록이 변경되어 되돌릴 수 없습니다.');
  assert.equal(ran, 0);
  bar.show({ label: '세 번째', undo: async () => { throw new Error('boom'); } });
  await bar.run();
  assert.equal(bar.getState().status, 'FAILED');
  bar.show({ label: '네 번째', undo: async () => ({ status: 'SUCCESS', affectedEntityId: 'x' }) });
  timers.at(-1).callback();
  assert.equal(bar.getState().status, 'HIDDEN');
});

test('this flow reaches storage only through application, domain and database modules', () => {
  const files = [...loaded];
  assert.ok(files.every(file => /^src\/(application|domain|database)\//.test(file)), files.join(', '));
});
