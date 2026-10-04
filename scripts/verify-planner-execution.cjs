// Development-only: node scripts/verify-planner-execution.cjs (Node 22.13+).
// Event/task/reminder executors and Undo against real migrations/repositories on disposable in-memory SQLite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const loaded = new Set();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  loaded.add(path.relative(root, file).replaceAll('\\', '/'));
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = name => {
    assert(name.startsWith('.'), `Planner flow must not import a native runtime: ${name}`);
    return load(path.resolve(path.dirname(file), name) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}

const { createEventExecutors } = load('src/application/executor/event-executors.ts');
const { createTaskExecutors } = load('src/application/executor/task-executors.ts');
const { createReminderExecutors } = load('src/application/executor/reminder-executors.ts');
const { validateCreateEvent, validateUpdateEvent, validatePlannerTarget } = load('src/application/validator/validate-event.ts');
const { validateCreateTask, validateUpdateTask } = load('src/application/validator/validate-task.ts');
const { validateCreateReminder } = load('src/application/validator/validate-reminder.ts');
// 11. Application executors and validators reach storage only through the unit-of-work interface.
const applicationModules = [...loaded];
assert(applicationModules.every(file => file.startsWith('src/application/') || file.startsWith('src/domain/')), applicationModules.join(', '));

const t0 = '2026-10-03T00:00:00.000Z';
const start = '2026-10-04T10:00:00.000Z';
const later = '2026-10-04T12:00:00.000Z';

async function main() {
  const db = new DatabaseSync(':memory:');
  let rejectCommit = false;
  const api = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
    getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async work => {
      db.exec('BEGIN');
      try { await work(api); if (rejectCommit) throw new Error('simulated commit failure'); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  await load('src/database/migrations/migrate.ts').migrateDatabase(api);
  const { createSqlitePlannerUnitOfWork } = load('src/database/sqlite-planner-unit-of-work.ts');
  const events = load('src/database/repositories/sqlite-event-repository.ts').createSqliteEventRepository(api);
  const tasks = load('src/database/repositories/sqlite-task-repository.ts').createSqliteTaskRepository(api);
  const reminders = load('src/database/repositories/sqlite-reminder-repository.ts').createSqliteReminderRepository(api);

  let clock = Date.parse(t0);
  let sequence = 0;
  const now = () => new Date(clock).toISOString();
  const tick = (ms = 1000) => { clock += ms; };
  const dependencies = {
    unitOfWork: createSqlitePlannerUnitOfWork(api),
    idsForAction: actionId => ({ entityId: `id-${actionId}`, undoId: `undo-${actionId}` }),
    nextLogId: () => `log-${++sequence}`,
    now,
    undoWindowMilliseconds: 60_000,
  };
  const eventX = createEventExecutors(dependencies);
  const taskX = createTaskExecutors(dependencies);
  const reminderX = createReminderExecutors(dependencies);
  const counts = () => ({
    events: db.prepare('SELECT count(*) n FROM events').get().n,
    tasks: db.prepare('SELECT count(*) n FROM tasks').get().n,
    reminders: db.prepare('SELECT count(*) n FROM reminders').get().n,
    logs: db.prepare('SELECT count(*) n FROM action_logs').get().n,
  });
  const run = async (executor, validate, proposal) => executor(proposal, validate(proposal));
  const proposal = (actionId, type, payload) => ({ actionId, type, sourceInput: '', inputMethod: 'MANUAL', dependsOnActionIds: [], payload });
  const eventPayload = changes => ({ title: '치과', timeKind: 'EXACT', startAt: start, endAt: null, fuzzyTime: null, date: null, timezone: 'Asia/Seoul', location: '강남', visibility: 'PRIVATE', ...changes });
  const createEvent = (id, changes = {}) => run(eventX.create, validateCreateEvent, proposal(id, 'CREATE_EVENT', eventPayload(changes)));
  const updateEvent = (id, target, changes) => run(eventX.update, validateUpdateEvent, proposal(id, 'UPDATE_EVENT', { targetId: target.id, expectedUpdatedAt: target.updatedAt, changes }));
  const targetAction = (executor, type) => (id, target) => run(executor, input => validatePlannerTarget(input, type), proposal(id, type, { targetId: target.id, expectedUpdatedAt: target.updatedAt }));
  const completeEvent = targetAction(eventX.complete, 'COMPLETE_EVENT');
  const deleteEvent = targetAction(eventX.delete, 'DELETE_EVENT');
  const createTask = (id, changes = {}) => run(taskX.create, validateCreateTask, proposal(id, 'CREATE_TASK', { title: '보고서 내기', dueAt: start, visibility: 'PRIVATE', ...changes }));
  const updateTask = (id, target, changes) => run(taskX.update, validateUpdateTask, proposal(id, 'UPDATE_TASK', { targetId: target.id, expectedUpdatedAt: target.updatedAt, changes }));
  const completeTask = targetAction(taskX.complete, 'COMPLETE_TASK');
  const deleteTask = targetAction(taskX.delete, 'DELETE_TASK');
  const createReminder = (id, targetType, targetId, changes = {}) => run(reminderX.create, validateCreateReminder, proposal(id, 'CREATE_REMINDER', { target: { kind: 'ENTITY', targetType, targetId }, fireAt: null, timezone: 'Asia/Seoul', relativeOffsetMinutes: -30, deliveryMode: 'LOCAL', ...changes }));
  const cancelReminder = targetAction(reminderX.cancel, 'CANCEL_REMINDER');
  const lastLog = () => { const row = db.prepare('SELECT * FROM action_logs ORDER BY rowid DESC LIMIT 1').get(); return { ...row, proposal: JSON.parse(row.proposal_json), result: JSON.parse(row.execution_result_json) }; };
  const ok = outcome => { assert.equal(outcome.result.status, 'SUCCESS', JSON.stringify(outcome.result)); return outcome; };
  const failedWith = (outcome, code) => { assert.equal(outcome.result.status, 'FAILED'); assert.equal(outcome.result.errorCode, code, outcome.result.errorMessage); };

  // 1. Create three event kinds; ActionLog + UndoRecord; idempotent retry; conflicting reuse rejected.
  const exactOut = ok(await createEvent('e-exact'));
  const exact = await events.findById('id-e-exact');
  assert.deepEqual({ kind: exact.kind, startAt: exact.startAt, status: exact.status, visibility: exact.visibility, sourceActionId: exact.sourceActionId, createdAt: exact.createdAt },
    { kind: 'EXACT', startAt: start, status: 'UPCOMING', visibility: 'PRIVATE', sourceActionId: 'e-exact', createdAt: t0 });
  assert.equal(lastLog().proposal.type, 'CREATE_EVENT');
  assert.deepEqual(lastLog().result, { actionId: 'e-exact', affectedEntityId: 'id-e-exact', status: 'SUCCESS' });
  assert.deepEqual(exactOut.undoRecord, { undoId: 'undo-e-exact', actionId: 'e-exact', actionType: 'CREATE_EVENT', affectedEntityId: 'id-e-exact', reversibleUntil: '2026-10-03T00:01:00.000Z', reversalData: {}, affectedReminderIds: [], createdAt: t0 });
  ok(await createEvent('e-fuzzy', { timeKind: 'FUZZY', startAt: null, fuzzyTime: ' 저녁쯤 ', date: '2026-10-04', location: '  ' }));
  const fuzzy = await events.findById('id-e-fuzzy');
  assert.deepEqual([fuzzy.kind, fuzzy.fuzzyTime, fuzzy.date, fuzzy.location], ['FUZZY', '저녁쯤', '2026-10-04', null]);
  ok(await createEvent('e-allday', { timeKind: 'ALL_DAY', startAt: null, date: '2026-10-05', visibility: 'PUBLIC' }));
  assert.deepEqual([(await events.findById('id-e-allday')).kind, (await events.findById('id-e-allday')).visibility], ['ALL_DAY', 'PUBLIC']);
  const before = counts();
  const replay = ok(await createEvent('e-exact'));
  assert.equal(replay.undoRecord, null);
  assert.deepEqual(counts(), before);
  failedWith(await createEvent('e-exact', { title: '다른 제목' }), 'ACTION_ID_CONFLICT');
  assert.deepEqual(counts(), before);
  console.log('PASS: EXACT/FUZZY/ALL_DAY creation with ActionLog and UndoRecord; idempotent retry; conflicting action ID rejected.');

  // 2. Validation failures and clarifications write nothing.
  const p = proposal('bad', 'CREATE_EVENT', eventPayload({ title: '가'.repeat(101) }));
  failedWith(await eventX.create(p, validateCreateEvent(p)), 'TITLE_TOO_LONG');
  const missing = proposal('missing', 'CREATE_EVENT', eventPayload({ timeKind: 'FUZZY', startAt: null, fuzzyTime: '저녁쯤', date: null }));
  assert.equal((await eventX.create(missing, validateCreateEvent(missing))).result.status, 'PENDING_CLARIFICATION');
  const forged = proposal('forged', 'CREATE_EVENT', eventPayload({ endAt: start }));
  failedWith(await eventX.create(forged, { actionId: 'forged', status: 'VALID' }), 'END_BEFORE_START');
  const valid = proposal('mismatch', 'CREATE_EVENT', eventPayload());
  failedWith(await eventX.create(valid, { actionId: 'other', status: 'VALID' }), 'VALIDATION_REQUIRED');
  const dependent = { ...proposal('dep', 'CREATE_EVENT', eventPayload()), dependsOnActionIds: ['e-exact'] };
  assert.equal((await eventX.create(dependent, validateCreateEvent(dependent))).result.status, 'SKIPPED_DEPENDENCY');
  assert.deepEqual(counts(), before);
  console.log('PASS: invalid, incomplete, forged-VALID, mismatched and dependent proposals write nothing.');

  // 7. Reminders: EXACT event only (D-3), REQUESTED never SCHEDULED, fireAt consistency, task due time.
  tick();
  const rOut = ok(await createReminder('r1', 'EVENT', 'id-e-exact'));
  const r1 = await reminders.findById('id-r1');
  assert.deepEqual([r1.status, r1.fireAt, r1.relativeOffsetMinutes, r1.lastError], ['REQUESTED', '2026-10-04T09:30:00.000Z', -30, null]);
  assert.deepEqual(rOut.undoRecord.affectedReminderIds, ['id-r1']);
  ok(await createReminder('r-abs', 'EVENT', 'id-e-exact', { relativeOffsetMinutes: null, fireAt: '2026-10-04T08:00:00.000Z' }));
  failedWith(await createReminder('r-allday', 'EVENT', 'id-e-allday', { relativeOffsetMinutes: 0 }), 'REMINDER_REQUIRES_EXACT_TIME');
  failedWith(await createReminder('r-allday-abs', 'EVENT', 'id-e-allday', { relativeOffsetMinutes: null, fireAt: start }), 'REMINDER_REQUIRES_EXACT_TIME');
  failedWith(await createReminder('r-fuzzy', 'EVENT', 'id-e-fuzzy'), 'REMINDER_REQUIRES_EXACT_TIME');
  failedWith(await createReminder('r-missing', 'EVENT', 'nope'), 'TARGET_NOT_FOUND');
  failedWith(await createReminder('r-mismatch', 'EVENT', 'id-e-exact', { fireAt: '2026-10-04T09:00:00.000Z' }), 'FIRE_AT_MISMATCH');
  ok(await createTask('t-undated', { dueAt: null }));
  failedWith(await createReminder('r-undated', 'TASK', 'id-t-undated', { relativeOffsetMinutes: -10 }), 'REMINDER_REQUIRES_DUE_TIME');
  assert.equal(db.prepare("SELECT count(*) n FROM reminders WHERE status = 'SCHEDULED'").get().n, 0);
  console.log('PASS: reminders saved as REQUESTED; ALL_DAY/FUZZY/missing targets, fireAt mismatch and undated relative task reminders rejected.');

  // 3. Update events: fields, stale evidence, retiming, switching to ALL_DAY cancels reminders.
  tick();
  let current = await events.findById('id-e-exact');
  failedWith(await updateEvent('u-stale', { ...current, updatedAt: t0.replace('00.000Z', '01.000Z') }, { title: 'x' }), 'STALE_TARGET');
  const titleOut = ok(await updateEvent('u-title', current, { title: '치과 검진', location: null }));
  current = await events.findById('id-e-exact');
  assert.deepEqual([current.title, current.location], ['치과 검진', null]);
  assert.deepEqual(titleOut.undoRecord.reversalData, { prior: { title: '치과', location: '강남' }, appliedUpdatedAt: current.updatedAt, reminders: [] });
  failedWith(await updateEvent('u-end', current, { endAt: '2026-10-04T09:00:00.000Z' }), 'END_BEFORE_START');
  failedWith(await updateEvent('u-fuzzy-incomplete', current, { timeKind: 'FUZZY', fuzzyTime: '저녁쯤' }), 'INCOMPLETE_CHANGES');
  tick();
  const moved = ok(await updateEvent('u-move', current, { startAt: later }));
  assert.equal((await reminders.findById('id-r1')).fireAt, '2026-10-04T11:30:00.000Z');
  assert.equal((await reminders.findById('id-r1')).status, 'REQUESTED');
  assert.equal((await reminders.findById('id-r-abs')).fireAt, '2026-10-04T08:00:00.000Z'); // absolute stays
  assert.deepEqual(moved.undoRecord.affectedReminderIds, ['id-r1']);
  tick();
  current = await events.findById('id-e-exact');
  const toAllDay = ok(await updateEvent('u-allday', current, { timeKind: 'ALL_DAY', date: '2026-10-04' }));
  current = await events.findById('id-e-exact');
  assert.deepEqual([current.kind, current.startAt, current.date, current.endAt], ['ALL_DAY', null, '2026-10-04', null]);
  assert.deepEqual((await reminders.findByTarget('EVENT', 'id-e-exact')).map(r => r.status), ['CANCELLED', 'CANCELLED']);
  assert.deepEqual(toAllDay.undoRecord.affectedReminderIds.sort(), ['id-r-abs', 'id-r1']);
  console.log('PASS: event update with concurrency check, end/shape rules, relative reminder retiming and cancellation on ALL_DAY.');

  // 4. Complete events; CANCELLED cannot complete; complete leaves reminders untouched.
  tick();
  ok(await createEvent('e-done'));
  ok(await createReminder('r-done', 'EVENT', 'id-e-done'));
  tick();
  ok(await completeEvent('c-done', await events.findById('id-e-done')));
  assert.equal((await events.findById('id-e-done')).status, 'COMPLETED');
  assert.equal((await reminders.findById('id-r-done')).status, 'REQUESTED');
  failedWith(await completeEvent('c-again', await events.findById('id-e-done')), 'INVALID_STATE');
  db.prepare("UPDATE events SET status = 'CANCELLED' WHERE id = 'id-e-fuzzy'").run();
  failedWith(await completeEvent('c-cancelled', await events.findById('id-e-fuzzy')), 'INVALID_STATE');
  db.prepare("UPDATE events SET status = 'PAST' WHERE id = 'id-e-allday'").run();
  ok(await completeEvent('c-past', await events.findById('id-e-allday')));
  console.log('PASS: complete UPCOMING/PAST events; CANCELLED and already COMPLETED rejected; reminders untouched by completion.');

  // 5. Delete events: soft delete and linked reminders cancelled.
  tick();
  const delOut = ok(await deleteEvent('d-done', await events.findById('id-e-done')));
  assert.equal(await events.findById('id-e-done'), null);
  assert.notEqual(db.prepare("SELECT deleted_at FROM events WHERE id = 'id-e-done'").get().deleted_at, null);
  assert.equal((await reminders.findById('id-r-done')).status, 'CANCELLED');
  assert.deepEqual(delOut.undoRecord.affectedReminderIds, ['id-r-done']);
  failedWith(await deleteEvent('d-again', { id: 'id-e-done', updatedAt: delOut.undoRecord.reversalData.deletedAt }), 'TARGET_NOT_FOUND');
  console.log('PASS: event soft deletion cancels linked reminders; deleted targets cannot be changed again.');

  // 6. Tasks: create, update, due retiming, complete, reopen, delete.
  tick();
  ok(await createTask('t1'));
  ok(await createReminder('r-task', 'TASK', 'id-t1', { relativeOffsetMinutes: -60 }));
  let task = await tasks.findById('id-t1');
  assert.deepEqual([task.status, task.dueAt, task.visibility], ['OPEN', start, 'PRIVATE']);
  tick();
  ok(await updateTask('tu1', task, { title: '보고서 제출', dueAt: later, visibility: 'PUBLIC' }));
  task = await tasks.findById('id-t1');
  assert.deepEqual([task.title, task.dueAt, task.visibility], ['보고서 제출', later, 'PUBLIC']);
  assert.equal((await reminders.findById('id-r-task')).fireAt, '2026-10-04T11:00:00.000Z');
  failedWith(await updateTask('tu-reopen-open', task, { status: 'OPEN' }), 'INVALID_STATE');
  tick();
  ok(await completeTask('tc1', task));
  task = await tasks.findById('id-t1');
  assert.deepEqual([task.status, task.completedAt], ['COMPLETED', task.updatedAt]);
  assert.equal((await reminders.findById('id-r-task')).status, 'REQUESTED');
  failedWith(await completeTask('tc-again', task), 'INVALID_STATE');
  tick();
  ok(await updateTask('tu-reopen', task, { status: 'OPEN' }));
  task = await tasks.findById('id-t1');
  assert.deepEqual([task.status, task.completedAt], ['OPEN', null]);
  tick();
  ok(await updateTask('tu-clear-due', task, { dueAt: null }));
  assert.equal((await reminders.findById('id-r-task')).status, 'CANCELLED');
  tick();
  ok(await deleteTask('td1', await tasks.findById('id-t1')));
  assert.equal(await tasks.findById('id-t1'), null);
  console.log('PASS: task create/update/retime/complete/reopen/clear-due/delete; completion leaves reminders untouched.');

  // 8. Cancel reminders; already cancelled is a no-op failure.
  tick();
  ok(await createEvent('e-r'));
  ok(await createReminder('r-c', 'EVENT', 'id-e-r'));
  tick();
  const cancelOut = ok(await cancelReminder('rc1', await reminders.findById('id-r-c')));
  const cancelled = await reminders.findById('id-r-c');
  assert.deepEqual([cancelled.status, cancelled.cancelledAt], ['CANCELLED', cancelled.updatedAt]);
  assert.deepEqual(cancelOut.undoRecord.reversalData, { priorStatus: 'REQUESTED', priorLastError: null, appliedUpdatedAt: cancelled.updatedAt });
  const snapshot = counts();
  failedWith(await cancelReminder('rc2', cancelled), 'ALREADY_CANCELLED');
  assert.deepEqual(counts(), snapshot);
  console.log('PASS: reminder cancellation records cancelledAt; cancelling again changes nothing.');

  // 10. Atomicity: a failed commit leaves no event, reminder change or log, and reports FAILED.
  tick();
  const beforeFailure = counts();
  const target = await events.findById('id-e-r');
  rejectCommit = true;
  failedWith(await createEvent('e-rollback'), 'ATOMIC_PERSISTENCE_FAILED');
  const deleteFailure = await deleteEvent('d-rollback', target);
  rejectCommit = false;
  failedWith(deleteFailure, 'ATOMIC_PERSISTENCE_FAILED');
  assert.equal(deleteFailure.undoRecord, null);
  assert.deepEqual(counts(), beforeFailure);
  assert.deepEqual(await events.findById('id-e-r'), target);
  console.log('PASS: commit failure rolls back entity, reminder and evidence writes and is reported as FAILED without Undo.');

  // 9. Undo for each of the ten actions, plus expiry, changed targets, repeats and rollback.
  const { createPlannerUndo } = load('src/application/undo/undo-planner-action.ts');
  let undoSequence = 0;
  const undo = createPlannerUndo({ ...dependencies, nextActionId: () => `undo-action-${++undoSequence}` });
  const tables = () => JSON.stringify(['events', 'tasks', 'reminders'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  const undone = async record => {
    const logs = counts().logs;
    const result = await undo(record);
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    assert.equal(counts().logs, logs + 1);
    const log = lastLog();
    assert.equal(log.proposal.type, 'UNDO_ACTION');
    assert.deepEqual(log.proposal.payload, { undoOf: { undoId: record.undoId, actionId: record.actionId }, actionType: record.actionType });
    assert.deepEqual(log.result, { actionId: log.proposal.actionId, affectedEntityId: record.affectedEntityId, status: 'SUCCESS' });
  };
  const refused = async (record, status) => {
    const before = counts();
    const rows = tables();
    const result = await undo(record);
    assert.equal(result.status, status, JSON.stringify(result));
    assert.deepEqual(counts(), before);
    assert.equal(tables(), rows);
  };

  // CREATE_EVENT: soft-deletes the new event and cancels reminders added to it.
  tick();
  const ue1 = ok(await createEvent('ue1'));
  ok(await createReminder('ru1', 'EVENT', 'id-ue1'));
  await undone(ue1.undoRecord);
  assert.equal(await events.findById('id-ue1'), null);
  assert.equal((await reminders.findById('id-ru1')).status, 'CANCELLED');
  await refused(ue1.undoRecord, 'UNAVAILABLE');

  // UPDATE_EVENT: fields and retimed reminder restored; undoing a switch to ALL_DAY restores EXACT and its reminder.
  tick();
  ok(await createEvent('ue2'));
  ok(await createReminder('ru2', 'EVENT', 'id-ue2'));
  tick();
  const ue2 = ok(await updateEvent('uu2', await events.findById('id-ue2'), { title: '바뀐 제목', startAt: later }));
  assert.equal((await reminders.findById('id-ru2')).fireAt, '2026-10-04T11:30:00.000Z');
  tick();
  await undone(ue2.undoRecord);
  let e2 = await events.findById('id-ue2');
  assert.deepEqual([e2.title, e2.startAt, e2.kind], ['치과', start, 'EXACT']);
  assert.deepEqual([(await reminders.findById('id-ru2')).fireAt, (await reminders.findById('id-ru2')).status], ['2026-10-04T09:30:00.000Z', 'REQUESTED']);
  tick();
  const ue2b = ok(await updateEvent('uu2b', e2, { timeKind: 'ALL_DAY', date: '2026-10-04' }));
  assert.equal((await reminders.findById('id-ru2')).status, 'CANCELLED');
  tick();
  await undone(ue2b.undoRecord);
  e2 = await events.findById('id-ue2');
  assert.deepEqual([e2.kind, e2.startAt, e2.date, e2.location], ['EXACT', start, null, '강남']);
  assert.deepEqual([(await reminders.findById('id-ru2')).status, (await reminders.findById('id-ru2')).cancelledAt], ['REQUESTED', null]);

  // COMPLETE_EVENT -> prior status.
  tick();
  const ue2c = ok(await completeEvent('uc2', e2));
  tick();
  await undone(ue2c.undoRecord);
  assert.equal((await events.findById('id-ue2')).status, 'UPCOMING');

  // DELETE_EVENT -> restored with its reminder back to REQUESTED.
  tick();
  const ue2d = ok(await deleteEvent('ud2', await events.findById('id-ue2')));
  assert.equal((await reminders.findById('id-ru2')).status, 'CANCELLED');
  tick();
  await undone(ue2d.undoRecord);
  assert.equal((await events.findById('id-ue2')).title, '치과');
  assert.equal((await reminders.findById('id-ru2')).status, 'REQUESTED');
  await refused(ue2d.undoRecord, 'INELIGIBLE');
  console.log('PASS: Undo of CREATE/UPDATE (incl. kind change)/COMPLETE/DELETE_EVENT restores fields, status and linked reminders, with UNDO_ACTION evidence.');

  // Task actions.
  tick();
  const ut1 = ok(await createTask('ut1'));
  await undone(ut1.undoRecord);
  assert.equal(await tasks.findById('id-ut1'), null);
  tick();
  ok(await createTask('ut2'));
  ok(await createReminder('rt2', 'TASK', 'id-ut2', { relativeOffsetMinutes: -60 }));
  tick();
  const ut2u = ok(await updateTask('utu2', await tasks.findById('id-ut2'), { title: '새 할 일', dueAt: null, visibility: 'PUBLIC' }));
  assert.equal((await reminders.findById('id-rt2')).status, 'CANCELLED');
  tick();
  await undone(ut2u.undoRecord);
  let t2 = await tasks.findById('id-ut2');
  assert.deepEqual([t2.title, t2.dueAt, t2.visibility], ['보고서 내기', start, 'PRIVATE']);
  assert.deepEqual([(await reminders.findById('id-rt2')).status, (await reminders.findById('id-rt2')).fireAt], ['REQUESTED', '2026-10-04T09:00:00.000Z']);
  tick();
  const ut2c = ok(await completeTask('utc2', t2));
  tick();
  await undone(ut2c.undoRecord);
  t2 = await tasks.findById('id-ut2');
  assert.deepEqual([t2.status, t2.completedAt], ['OPEN', null]);
  tick();
  const ut2d = ok(await deleteTask('utd2', t2));
  tick();
  await undone(ut2d.undoRecord);
  assert.equal((await tasks.findById('id-ut2')).status, 'OPEN');
  assert.equal((await reminders.findById('id-rt2')).status, 'REQUESTED');
  console.log('PASS: Undo of CREATE/UPDATE/COMPLETE/DELETE_TASK restores fields, status and linked reminders.');

  // Reminder actions.
  tick();
  const ur1 = ok(await createReminder('ur1', 'EVENT', 'id-ue2', { relativeOffsetMinutes: -10 }));
  await undone(ur1.undoRecord);
  assert.equal((await reminders.findById('id-ur1')).status, 'CANCELLED');
  tick();
  const urc = ok(await cancelReminder('urc', await reminders.findById('id-ru2')));
  tick();
  await undone(urc.undoRecord);
  assert.deepEqual([(await reminders.findById('id-ru2')).status, (await reminders.findById('id-ru2')).cancelledAt], ['REQUESTED', null]);
  tick();
  ok(await createEvent('ue5'));
  ok(await createReminder('ru5', 'EVENT', 'id-ue5'));
  tick();
  const ur5 = ok(await cancelReminder('urc5', await reminders.findById('id-ru5')));
  ok(await deleteEvent('ud5', await events.findById('id-ue5')));
  await refused(ur5.undoRecord, 'INELIGIBLE');
  console.log('PASS: Undo of CREATE/CANCEL_REMINDER; a cancelled reminder is not revived for a deleted target.');

  // Expiry, changed targets, invalid records and rollback.
  tick();
  const late = ok(await createEvent('ue6'));
  tick(60_001);
  await refused(late.undoRecord, 'EXPIRED');
  tick();
  const edited = ok(await createEvent('ue7'));
  tick();
  const firstEdit = ok(await updateEvent('uu7', await events.findById('id-ue7'), { title: '한 번' }));
  tick();
  ok(await updateEvent('uu7b', await events.findById('id-ue7'), { title: '두 번' }));
  await refused(edited.undoRecord, 'INELIGIBLE');
  await refused(firstEdit.undoRecord, 'INELIGIBLE');
  await refused(null, 'UNAVAILABLE');
  await refused({ ...late.undoRecord, actionType: 'CREATE_TRANSACTION' }, 'INELIGIBLE');
  const lastEdit = ok(await updateEvent('uu7c', await events.findById('id-ue7'), { title: '세 번' }));
  await refused({ ...lastEdit.undoRecord, reversalData: { ...lastEdit.undoRecord.reversalData, prior: 'broken' } }, 'INELIGIBLE');
  tick();
  const rollback = ok(await createEvent('ue8'));
  rejectCommit = true;
  const rolled = await undo(rollback.undoRecord);
  rejectCommit = false;
  assert.equal(rolled.status, 'FAILED');
  assert.notEqual(await events.findById('id-ue8'), null);
  await undone(rollback.undoRecord);
  console.log('PASS: Undo refuses expired, changed, repeated, foreign and malformed records without writing; commit failure reports FAILED and changes nothing.');
  db.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
