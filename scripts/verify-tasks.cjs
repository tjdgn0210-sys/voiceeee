// Development-only: node --test scripts/verify-tasks.cjs
// M1-06 to-dos: no due date, overdue, completion toggle with undo, reminders, guest visibility, and their place in the calendar.
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load } = createLoader();
const form = load('src/application/planner/event-form.ts');
const model = load('src/application/planner/calendar-model.ts');
const { createPlannerServices } = load('src/application/planner/planner-services.ts');
const { createUndoBar } = load('src/application/undo/undo-bar.ts');
const { createSqliteEventRepository } = load('src/database/repositories/sqlite-event-repository.ts');
const { createSqliteTaskRepository } = load('src/database/repositories/sqlite-task-repository.ts');
const { createSqliteReminderRepository } = load('src/database/repositories/sqlite-reminder-repository.ts');
const { createSqlitePlannerUnitOfWork } = load('src/database/sqlite-planner-unit-of-work.ts');

const TZ = 'Asia/Seoul';
let clock;

async function setup(start = '2026-10-05T03:00:00.000Z') {
  const db = await openMigratedDatabase(load);
  clock = Date.parse(start);
  let counter = 0;
  const timers = [];
  const undoBar = createUndoBar({ setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimer: () => {} });
  const planner = createPlannerServices({
    events: createSqliteEventRepository(db), tasks: createSqliteTaskRepository(db), reminders: createSqliteReminderRepository(db),
    unitOfWork: createSqlitePlannerUnitOfWork(db),
    nextActionId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, nextLogId: () => `log-${++counter}`,
    now: () => new Date(clock).toISOString(), timezone: () => TZ, undoWindowMilliseconds: 60_000, undoBar,
  });
  const blank = () => form.initialTaskForm({ now: new Date(clock).toISOString(), timezone: TZ });
  return { db, planner, undoBar, blank, tick: (ms = 1000) => { clock += ms; } };
}

const view = async planner => {
  const range = await planner.loadRange('2026-10-01', '2026-11-01');
  return model.indexCalendar(range.events, range.tasks, planner.now(), TZ);
};

test('a to-do without a due date is kept, listed as undated, and never overdue', async () => {
  const { planner, blank } = await setup();
  const saved = await planner.createTask({ ...blank(), title: '언젠가 할 일', hasDue: false });
  assert.equal(saved.status, 'SAVED');
  const index = await view(planner);
  assert.deepEqual(index.undatedTasks.map(item => item.title), ['언젠가 할 일']);
  assert.equal(index.overdueTasks.length, 0);
  assert.equal([...index.days.values()].reduce((sum, day) => sum + day.tasks.length, 0), 0, 'it is under no day');
});

test('a to-do under its due day; a passed due time is listed as overdue and stays open', async () => {
  const { planner, blank } = await setup();
  await planner.createTask({ ...blank(), title: '오늘 마감', hasDue: true, date: '2026-10-05', time: '18:00' });
  await planner.createTask({ ...blank(), title: '어제 마감', hasDue: true, date: '2026-10-04', time: '09:00' });
  const index = await view(planner);
  assert.deepEqual(model.dayOrEmpty(index, '2026-10-05').tasks.map(item => item.title), ['오늘 마감']);
  assert.deepEqual(index.overdueTasks.map(item => item.title), ['어제 마감']);
  assert.equal(index.overdueTasks[0].status, 'OPEN');
});

test('midnight and month-end due times land on the right day', async () => {
  const { planner, blank } = await setup();
  await planner.createTask({ ...blank(), title: '자정 마감', hasDue: true, date: '2026-10-31', time: '23:59' });
  await planner.createTask({ ...blank(), title: '월초 새벽', hasDue: true, date: '2026-11-01', time: '00:00' });
  const index = await view(planner);
  assert.deepEqual(model.dayOrEmpty(index, '2026-10-31').tasks.map(item => item.title), ['자정 마감']);
  assert.deepEqual(model.dayOrEmpty(index, '2026-11-01').tasks.map(item => item.title), ['월초 새벽']);
});

test('completing removes a to-do from the overdue list; the undo bar brings it back', async () => {
  const { planner, blank, undoBar, tick } = await setup();
  const created = await planner.createTask({ ...blank(), title: '밀린 일', hasDue: true, date: '2026-10-03', time: '09:00' });
  tick();
  let task = await planner.findTask(created.entityId);
  assert.equal((await view(planner)).overdueTasks.length, 1);
  assert.equal((await planner.completeTask(task)).status, 'DONE');
  let index = await view(planner);
  assert.equal(index.overdueTasks.length, 0);
  assert.equal(model.dayOrEmpty(index, '2026-10-03').tasks[0].status, 'COMPLETED', 'it stays on its day, marked done');
  assert.equal(undoBar.getState().status, 'SHOWN');
  await undoBar.run();
  index = await view(planner);
  assert.equal(index.overdueTasks.length, 1);
  task = await planner.findTask(created.entityId);
  assert.equal(task.status, 'OPEN');
  assert.equal(task.completedAt, null);
});

test('completing twice from a stale copy fails instead of double-writing', async () => {
  const { planner, blank, tick } = await setup();
  const created = await planner.createTask({ ...blank(), title: '한 번만', hasDue: false });
  tick();
  const stale = await planner.findTask(created.entityId);
  assert.equal((await planner.completeTask(stale)).status, 'DONE');
  tick();
  const second = await planner.completeTask(stale);
  assert.equal(second.status, 'FAILED');
  assert.match(second.message, /바뀌|다시/);
});

test('reopening a done to-do and deleting with undo', async () => {
  const { planner, blank, undoBar, tick } = await setup();
  const created = await planner.createTask({ ...blank(), title: '지울 일', hasDue: false });
  tick();
  let task = await planner.findTask(created.entityId);
  await planner.completeTask(task);
  tick();
  task = await planner.findTask(created.entityId);
  assert.equal((await planner.reopenTask(task)).status, 'DONE');
  tick();
  task = await planner.findTask(created.entityId);
  assert.equal((await planner.deleteTask(task)).status, 'DONE');
  assert.equal(await planner.findTask(created.entityId), null);
  assert.equal((await view(planner)).undatedTasks.length, 0);
  await undoBar.run();
  assert.equal((await planner.findTask(created.entityId)).status, 'OPEN');
});

test('a to-do with a due time can have reminders; without a due date they are not saved', async () => {
  const { planner, blank } = await setup();
  const withDue = await planner.createTask({ ...blank(), title: '알림 있는 일', hasDue: true, date: '2026-10-06', time: '18:00', reminderOffsets: [0, -30] });
  assert.equal(withDue.status, 'SAVED');
  assert.deepEqual((await planner.remindersOf('TASK', withDue.entityId)).map(item => item.relativeOffsetMinutes), [-30, 0]);
  const noDue = await planner.createTask({ ...blank(), title: '알림 못 받는 일', hasDue: false, reminderOffsets: [0] });
  assert.equal(noDue.status, 'SAVED');
  assert.equal((await planner.remindersOf('TASK', noDue.entityId)).length, 0);
});

test('guests save private to-dos and the form starts private', async () => {
  const { planner, blank } = await setup();
  assert.equal(blank().visibility, 'PRIVATE');
  const saved = await planner.createTask({ ...blank(), title: '비공개 할 일' });
  assert.equal((await planner.findTask(saved.entityId)).visibility, 'PRIVATE');
});

test('title rules: required, 100 characters at most', async () => {
  const { planner, blank } = await setup();
  assert.equal((await planner.createTask({ ...blank(), title: '  ' })).errors.title, '제목을 입력해 주세요');
  assert.equal((await planner.createTask({ ...blank(), title: 'ㄱ'.repeat(100) })).status, 'SAVED');
  assert.equal((await planner.createTask({ ...blank(), title: 'ㄱ'.repeat(101) })).errors.title, '제목은 100자까지 쓸 수 있어요');
});
