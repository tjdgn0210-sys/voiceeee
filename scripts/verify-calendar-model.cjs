// Development-only: node --test scripts/verify-calendar-model.cjs
// M1-05 calendar logic: which day an item belongs to (midnight, month end, leap day), ordering, grids and labels.
const { test } = require('node:test');
const { assert, createLoader } = require('./test-support.cjs');

const { load } = createLoader();
const model = load('src/application/planner/calendar-model.ts');

const TZ = 'Asia/Seoul';
const base = { endAt: null, timezone: TZ, location: null, status: 'UPCOMING', visibility: 'PRIVATE', sourceActionId: 'a', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null };
const exact = (id, startAt, extra = {}) => ({ ...base, id, title: id, kind: 'EXACT', startAt, fuzzyTime: null, date: null, ...extra });
const allDay = (id, date, extra = {}) => ({ ...base, id, title: id, kind: 'ALL_DAY', startAt: null, fuzzyTime: null, date, ...extra });
const fuzzy = (id, date, text, extra = {}) => ({ ...base, id, title: id, kind: 'FUZZY', startAt: null, fuzzyTime: text, date, ...extra });
const task = (id, dueAt, extra = {}) => ({ id, title: id, dueAt, status: 'OPEN', completedAt: null, visibility: 'PRIVATE', sourceActionId: 'a', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null, ...extra });

test('an exact event belongs to the day of its own timezone, also across midnight and month end', () => {
  assert.equal(model.eventDate(exact('late', '2026-10-31T14:30:00.000Z')), '2026-10-31', '23:30 KST');
  assert.equal(model.eventDate(exact('after', '2026-10-31T15:30:00.000Z')), '2026-11-01', '00:30 KST the next day');
  assert.equal(model.eventDate(exact('midnight', '2026-10-04T15:00:00.000Z')), '2026-10-05', '자정 = 00:00 of the next day');
  assert.equal(model.eventDate(exact('ny', '2026-10-04T02:00:00.000Z', { timezone: 'America/New_York' })), '2026-10-03');
  assert.equal(model.eventDate(allDay('d', '2026-10-05')), '2026-10-05');
  assert.equal(model.eventDate(fuzzy('f', null, '저녁쯤')), null, 'an old fuzzy event without a date has no day');
});

test('time labels: exact, with end, fuzzy, all-day, noon and midnight hours', () => {
  assert.equal(model.eventTimeLabel(exact('a', '2026-10-05T10:00:00.000Z')), '오후 7:00');
  assert.equal(model.eventTimeLabel(exact('b', '2026-10-05T10:00:00.000Z', { endAt: '2026-10-05T11:30:00.000Z' })), '오후 7:00 ~ 오후 8:30');
  assert.equal(model.eventTimeLabel(exact('c', '2026-10-05T03:00:00.000Z')), '오후 12:00');
  assert.equal(model.eventTimeLabel(exact('d', '2026-10-04T15:30:00.000Z')), '오전 12:30');
  assert.equal(model.eventTimeLabel(exact('e', '2026-10-05T10:00:00.000Z', { endAt: '2026-10-05T16:00:00.000Z' })), '오후 7:00', 'an end on another day is not shown');
  assert.equal(model.eventTimeLabel(fuzzy('f', '2026-10-05', '저녁쯤')), '저녁쯤');
  assert.equal(model.eventTimeLabel(allDay('g', '2026-10-05')), '종일');
});

test('a day is ordered all-day first, then by time, fuzzy last', () => {
  const events = [
    fuzzy('저녁쯤', '2026-10-05', '저녁쯤'),
    exact('오후', '2026-10-05T10:00:00.000Z'),
    allDay('종일', '2026-10-05'),
    exact('아침', '2026-10-04T23:00:00.000Z'),
  ];
  assert.deepEqual(model.sortDayEvents(events).map(item => item.id), ['종일', '아침', '오후', '저녁쯤']);
});

test('indexing: events and tasks per day, status by lifecycle, deleted-free input only', () => {
  const now = '2026-10-05T03:00:00.000Z'; // 12:00 KST on the 5th
  const events = [
    exact('지난 약속', '2026-10-05T01:00:00.000Z'),
    exact('이따 약속', '2026-10-05T10:00:00.000Z'),
    exact('끝난 약속', '2026-10-05T01:00:00.000Z', { status: 'COMPLETED' }),
    allDay('어제 종일', '2026-10-04'),
    allDay('오늘 종일', '2026-10-05'),
  ];
  const tasks = [
    task('마감 지남', '2026-10-03T09:00:00.000Z'),
    task('오늘 마감', '2026-10-05T14:00:00.000Z'),
    task('날짜 없음', null),
    task('끝낸 일', '2026-10-03T09:00:00.000Z', { status: 'COMPLETED', completedAt: '2026-10-03T10:00:00.000Z' }),
    task('끝낸 날짜 없음', null, { status: 'COMPLETED', completedAt: '2026-10-03T10:00:00.000Z' }),
  ];
  const index = model.indexCalendar(events, tasks, now, TZ);
  assert.equal(index.today, '2026-10-05');
  const day = model.dayOrEmpty(index, '2026-10-05');
  assert.deepEqual(day.events.map(item => [item.event.id, item.status]), [
    ['오늘 종일', 'UPCOMING'], ['끝난 약속', 'COMPLETED'], ['지난 약속', 'PAST'], ['이따 약속', 'UPCOMING'],
  ]);
  assert.equal(model.dayOrEmpty(index, '2026-10-04').events[0].status, 'PAST', 'an all-day event of yesterday is past');
  assert.deepEqual(day.tasks.map(item => item.id), ['오늘 마감']);
  assert.deepEqual(index.overdueTasks.map(item => item.id), ['마감 지남']);
  assert.deepEqual(index.undatedTasks.map(item => item.id), ['날짜 없음'], 'a completed undated task is not listed');
  assert.deepEqual(model.dayOrEmpty(index, '2026-10-20'), { date: '2026-10-20', events: [], tasks: [] });
  assert.ok(model.dayOrEmpty(index, '2026-10-03').tasks.some(item => item.id === '끝낸 일'), 'a completed task stays on its day');
});

test('"today" follows the viewer timezone at the day boundary', () => {
  const now = '2026-10-05T15:30:00.000Z'; // 00:30 KST on the 6th
  assert.equal(model.indexCalendar([], [], now, 'Asia/Seoul').today, '2026-10-06');
  assert.equal(model.indexCalendar([], [], now, 'UTC').today, '2026-10-05');
});

test('month grid: weeks start on Sunday, rows are full, month ends and leap February are right', () => {
  const october = model.monthGrid(2026, 10);
  assert.equal(october.length, 5);
  assert.deepEqual(october[0], ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(october[4].slice(-2), ['2026-10-30', '2026-10-31']);
  assert.equal(model.monthGrid(2026, 11)[0][0], '2026-11-01', 'Nov 2026 starts on a Sunday');
  assert.ok(october.every(week => week.length === 7));
  const leap = model.monthGrid(2028, 2).flat();
  assert.ok(leap.includes('2028-02-29'));
  assert.equal(model.monthGrid(2026, 2).length, 4, 'Feb 2026 starts on Sunday and has 28 days');
  assert.equal(model.monthGrid(2026, 8).length, 6, 'Aug 2026 needs six rows');
});

test('week and visible ranges, month shifting with clamping', () => {
  assert.deepEqual(model.weekDates('2026-10-04'), ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  assert.deepEqual(model.visibleRange('week', '2026-10-31'), { from: '2026-10-25', until: '2026-11-01' });
  assert.deepEqual(model.visibleRange('month', '2026-10-15'), { from: '2026-09-27', until: '2026-11-01' });
  assert.equal(model.shiftMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(model.shiftMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(model.shiftMonth('2026-12-15', 1), '2027-01-15');
  assert.equal(model.shiftMonth('2026-01-15', -1), '2025-12-15');
});

test('titles and labels', () => {
  assert.equal(model.monthTitle('2026-10-04'), '2026년 10월');
  assert.equal(model.dateLabel('2026-10-04'), '10월 4일 (일)');
  assert.equal(model.weekTitle('2026-10-04'), '10월 4일 ~ 10일');
  assert.equal(model.weekTitle('2026-10-30'), '10월 25일 ~ 31일');
  assert.equal(model.weekTitle('2026-09-30'), '9월 27일 ~ 10월 3일');
  assert.equal(model.EVENT_STATUS_LABELS.PAST, '지남');
});
