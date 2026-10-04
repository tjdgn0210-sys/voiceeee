// Development-only: node scripts/verify-planner-validation.cjs (Node 22.13+).
// Pure event/task/reminder validators and the read-time event lifecycle; no database or native APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = name => {
    assert(name.startsWith('.'), `Validators must stay pure: ${name}`);
    return load(path.resolve(path.dirname(file), name) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}

const { validateCreateEvent, validateUpdateEvent, validatePlannerTarget } = load('src/application/validator/validate-event.ts');
const { validateCreateTask, validateUpdateTask } = load('src/application/validator/validate-task.ts');
const { validateCreateReminder, resolveReminderFireAt } = load('src/application/validator/validate-reminder.ts');
const { isLocalDate, localDateIn } = load('src/application/validator/local-date.ts');
const { eventLifecycleStatus } = load('src/domain/event/event-lifecycle.ts');

const start = '2026-10-03T10:00:00.000Z';
const proposal = (type, payload, extra = {}) => ({ actionId: 'a1', type, sourceInput: '', inputMethod: 'MANUAL', dependsOnActionIds: [], payload, ...extra });
const exact = (changes = {}) => proposal('CREATE_EVENT', { title: '치과', timeKind: 'EXACT', startAt: start, endAt: null, fuzzyTime: null, date: null, timezone: 'Asia/Seoul', location: null, visibility: 'PRIVATE', ...changes });
const fuzzy = (changes = {}) => exact({ timeKind: 'FUZZY', startAt: null, fuzzyTime: '저녁쯤', date: '2026-10-03', ...changes });
const allDay = (changes = {}) => exact({ timeKind: 'ALL_DAY', startAt: null, date: '2026-10-03', ...changes });
const status = result => result.status;
const code = result => result.errorCode;
const fields = result => result.clarifications.map(item => item.field);

// 1. Title: required, trimmed, at most 100 characters counted per character (Hangul/emoji = 1).
for (const title of [null, '', '   ']) {
  const result = validateCreateEvent(exact({ title }));
  assert.equal(status(result), 'NEEDS_CLARIFICATION');
  assert.deepEqual(fields(result), ['payload.title']);
}
assert.equal(status(validateCreateEvent(exact({ title: '가'.repeat(100) }))), 'VALID');
assert.equal(status(validateCreateEvent(exact({ title: '😀'.repeat(100) }))), 'VALID');
assert.equal(code(validateCreateEvent(exact({ title: '가'.repeat(101) }))), 'TITLE_TOO_LONG');
assert.equal(code(validateCreateEvent(exact({ title: 7 }))), 'INVALID_TITLE');
console.log('PASS: event title required, trimmed and limited to 100 characters (Hangul/emoji counted once).');

// 2. Location: optional, at most 100 characters.
assert.equal(status(validateCreateEvent(exact({ location: '강'.repeat(100) }))), 'VALID');
assert.equal(code(validateCreateEvent(exact({ location: '강'.repeat(101) }))), 'LOCATION_TOO_LONG');
console.log('PASS: location limited to 100 characters.');

// 3. EXACT: UTC instants only, end strictly after start.
assert.equal(code(validateCreateEvent(exact({ startAt: '2026-10-03T19:00:00+09:00' }))), 'INVALID_START_AT');
assert.equal(code(validateCreateEvent(exact({ endAt: start }))), 'END_BEFORE_START');
assert.equal(code(validateCreateEvent(exact({ endAt: '2026-10-03T09:00:00.000Z' }))), 'END_BEFORE_START');
assert.equal(status(validateCreateEvent(exact({ endAt: '2026-10-03T11:00:00.000Z' }))), 'VALID');
assert.deepEqual(fields(validateCreateEvent(exact({ startAt: null }))), ['payload.startAt']);
assert.equal(code(validateCreateEvent(exact({ date: '2026-10-03' }))), 'INVALID_TIME_SHAPE');
console.log('PASS: EXACT requires a UTC start, rejects end <= start and stray date.');

// 4. FUZZY: text and (for new events) date are required.
assert.equal(status(validateCreateEvent(fuzzy())), 'VALID');
assert.deepEqual(fields(validateCreateEvent(fuzzy({ fuzzyTime: '  ' }))), ['payload.fuzzyTime']);
assert.deepEqual(fields(validateCreateEvent(fuzzy({ date: null }))), ['payload.date']);
assert.equal(code(validateCreateEvent(fuzzy({ date: '2026-02-30' }))), 'INVALID_DATE');
assert.equal(code(validateCreateEvent(fuzzy({ endAt: start }))), 'INVALID_TIME_SHAPE');
console.log('PASS: FUZZY requires text and a date; impossible dates and end times rejected.');

// 5. ALL_DAY: date required, no start/end/fuzzy text.
assert.equal(status(validateCreateEvent(allDay())), 'VALID');
assert.deepEqual(fields(validateCreateEvent(allDay({ date: null }))), ['payload.date']);
assert.equal(code(validateCreateEvent(allDay({ startAt: start }))), 'INVALID_TIME_SHAPE');
assert.equal(code(validateCreateEvent(allDay({ endAt: start }))), 'INVALID_TIME_SHAPE');
assert.equal(code(validateCreateEvent(allDay({ date: '2026/10/03' }))), 'INVALID_DATE');
assert.equal(code(validateCreateEvent(exact({ timeKind: 'SOMETIME' }))), 'INVALID_TIME_KIND');
assert.deepEqual(fields(validateCreateEvent(exact({ title: null, timeKind: null }))), ['payload.title', 'payload.timeKind']);
console.log('PASS: ALL_DAY requires a date and no times; unknown time kinds rejected; several missing fields asked together.');

// 6. Visibility, timezone, envelopes; task rules.
assert.equal(code(validateCreateEvent(exact({ visibility: 'FRIENDS' }))), 'INVALID_VISIBILITY');
assert.equal(code(validateCreateEvent(exact({ timezone: ' ' }))), 'INVALID_TIMEZONE');
assert.equal(code(validateCreateEvent({ ...exact(), type: 'CREATE_TASK' })), 'INVALID_PROPOSAL');
assert.equal(code(validateCreateEvent({ ...exact(), dependsOnActionIds: ['a1'] })), 'INVALID_PROPOSAL');
const task = (changes = {}) => proposal('CREATE_TASK', { title: '보고서 내기', dueAt: null, visibility: 'PRIVATE', ...changes });
assert.equal(status(validateCreateTask(task())), 'VALID');
assert.deepEqual(fields(validateCreateTask(task({ title: ' ' }))), ['payload.title']);
assert.equal(code(validateCreateTask(task({ title: '가'.repeat(101) }))), 'TITLE_TOO_LONG');
assert.equal(code(validateCreateTask(task({ dueAt: '2026-10-03' }))), 'INVALID_DUE_AT');
assert.equal(code(validateCreateTask(task({ visibility: null }))), 'INVALID_VISIBILITY');
const update = (type, changes, extra = {}) => proposal(type, { targetId: 't1', expectedUpdatedAt: start, changes, ...extra });
assert.equal(status(validateUpdateEvent(update('UPDATE_EVENT', { title: '새 제목' }))), 'VALID');
assert.equal(code(validateUpdateEvent(update('UPDATE_EVENT', {}))), 'INVALID_PROPOSAL');
assert.equal(code(validateUpdateEvent(update('UPDATE_EVENT', { status: 'CANCELLED' }))), 'INVALID_PROPOSAL');
assert.equal(code(validateUpdateEvent(update('UPDATE_EVENT', { title: 'x' }, { expectedUpdatedAt: undefined }))), 'INVALID_PROPOSAL');
assert.deepEqual(fields(validateUpdateEvent(update('UPDATE_EVENT', { title: 'x' }, { targetId: null }))), ['payload.targetId']);
assert.equal(status(validateUpdateTask(update('UPDATE_TASK', { status: 'OPEN' }))), 'VALID');
assert.equal(code(validateUpdateTask(update('UPDATE_TASK', { status: 'COMPLETED' }))), 'INVALID_STATUS_CHANGE');
assert.equal(status(validatePlannerTarget(proposal('DELETE_EVENT', { targetId: 't1', expectedUpdatedAt: start }), 'DELETE_EVENT')), 'VALID');
assert.equal(code(validatePlannerTarget(proposal('COMPLETE_TASK', { targetId: 't1' }), 'COMPLETE_TASK')), 'INVALID_PROPOSAL');
console.log('PASS: visibility/timezone/envelope checks, task title/due rules, update and target envelopes (concurrency evidence required).');

// 7. Reminder offsets: integers of 0 or less only; target-time rules.
const reminder = (changes = {}) => proposal('CREATE_REMINDER', { target: { kind: 'ENTITY', targetType: 'EVENT', targetId: 'e1' }, fireAt: null, timezone: 'Asia/Seoul', relativeOffsetMinutes: -30, deliveryMode: 'LOCAL', ...changes });
for (const offset of [0, -10, -30, -60, -1440]) assert.equal(status(validateCreateReminder(reminder({ relativeOffsetMinutes: offset }))), 'VALID');
for (const offset of [10, 0.5, -1.5, NaN, '30']) assert.equal(code(validateCreateReminder(reminder({ relativeOffsetMinutes: offset }))), 'INVALID_OFFSET');
assert.deepEqual(fields(validateCreateReminder(reminder({ relativeOffsetMinutes: null }))), ['payload.fireAt']);
assert.deepEqual(fields(validateCreateReminder(reminder({ target: null }))), ['payload.target']);
assert.equal(code(validateCreateReminder(reminder({ target: { kind: 'ACTION', targetType: 'EVENT', actionId: 'other' } }))), 'INVALID_TARGET');
assert.equal(status(validateCreateReminder({ ...reminder({ target: { kind: 'ACTION', targetType: 'EVENT', actionId: 'other' } }), dependsOnActionIds: ['other'] })), 'VALID');
const eventBase = { kind: 'EXACT', startAt: start, fuzzyTime: null, date: null };
assert.deepEqual(resolveReminderFireAt({ fireAt: null, relativeOffsetMinutes: -30 }, { targetType: 'EVENT', event: eventBase }), { status: 'OK', fireAt: '2026-10-03T09:30:00.000Z' });
assert.deepEqual(resolveReminderFireAt({ fireAt: null, relativeOffsetMinutes: 0 }, { targetType: 'EVENT', event: eventBase }), { status: 'OK', fireAt: start });
assert.equal(code(resolveReminderFireAt({ fireAt: '2026-10-03T09:00:00.000Z', relativeOffsetMinutes: -30 }, { targetType: 'EVENT', event: eventBase })), 'FIRE_AT_MISMATCH');
assert.equal(code(resolveReminderFireAt({ fireAt: start, relativeOffsetMinutes: null }, { targetType: 'EVENT', event: { kind: 'ALL_DAY', startAt: null, fuzzyTime: null, date: '2026-10-03' } })), 'REMINDER_REQUIRES_EXACT_TIME');
assert.equal(code(resolveReminderFireAt({ fireAt: null, relativeOffsetMinutes: -10 }, { targetType: 'EVENT', event: { kind: 'FUZZY', startAt: null, fuzzyTime: '저녁쯤', date: '2026-10-03' } })), 'REMINDER_REQUIRES_EXACT_TIME');
assert.equal(code(resolveReminderFireAt({ fireAt: null, relativeOffsetMinutes: -10 }, { targetType: 'TASK', task: { dueAt: null } })), 'REMINDER_REQUIRES_DUE_TIME');
assert.deepEqual(resolveReminderFireAt({ fireAt: '2026-10-03T08:00:00Z', relativeOffsetMinutes: null }, { targetType: 'TASK', task: { dueAt: null } }), { status: 'OK', fireAt: '2026-10-03T08:00:00.000Z' });
console.log('PASS: reminder offsets (integer <= 0), required target/time, ACTION dependency link, exact-time and due-time rules, fireAt consistency.');

// 8. Local dates and read-time lifecycle (PAST is computed, never COMPLETED).
assert(isLocalDate('2028-02-29'));
for (const value of ['2027-02-29', '2026-02-30', '2026-13-01', '2026-1-3', '2026/10/03', null]) assert(!isLocalDate(value));
assert.equal(localDateIn('Asia/Seoul', '2026-10-03T14:59:59.000Z'), '2026-10-03');
assert.equal(localDateIn('Asia/Seoul', '2026-10-03T15:00:00.000Z'), '2026-10-04'); // KST midnight, UTC still Oct 3
assert.equal(localDateIn('Asia/Seoul', '2026-12-31T15:00:00.000Z'), '2027-01-01');
assert.throws(() => localDateIn('Not/AZone', start));
const event = changes => ({ status: 'UPCOMING', endAt: null, ...eventBase, ...changes });
assert.equal(eventLifecycleStatus(event({}), '2026-10-03T09:59:59.000Z', '2026-10-03'), 'UPCOMING');
assert.equal(eventLifecycleStatus(event({}), start, '2026-10-03'), 'PAST');
assert.equal(eventLifecycleStatus(event({ endAt: '2026-10-03T11:00:00.000Z' }), '2026-10-03T10:30:00.000Z', '2026-10-03'), 'UPCOMING');
assert.equal(eventLifecycleStatus(event({ endAt: '2026-10-03T11:00:00.000Z' }), '2026-10-03T11:00:00.000Z', '2026-10-03'), 'PAST');
const allDayEvent = event({ kind: 'ALL_DAY', startAt: null, date: '2026-10-03' });
assert.equal(eventLifecycleStatus(allDayEvent, '2026-10-03T14:59:59.000Z', localDateIn('Asia/Seoul', '2026-10-03T14:59:59.000Z')), 'UPCOMING');
assert.equal(eventLifecycleStatus(allDayEvent, '2026-10-03T15:00:00.000Z', localDateIn('Asia/Seoul', '2026-10-03T15:00:00.000Z')), 'PAST');
assert.equal(eventLifecycleStatus(event({ kind: 'FUZZY', startAt: null, fuzzyTime: '저녁쯤', date: null }), '2030-01-01T00:00:00.000Z', '2030-01-01'), 'UPCOMING');
for (const stored of ['COMPLETED', 'CANCELLED', 'PAST']) assert.equal(eventLifecycleStatus(event({ status: stored }), '2030-01-01T00:00:00.000Z', '2030-01-01'), stored);
console.log('PASS: local dates (leap/impossible/KST midnight/year end) and read-time lifecycle: elapsed -> PAST, never COMPLETED; undated FUZZY unchanged.');
