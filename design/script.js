// 목업 데이터: src/domain/transaction/transaction.ts 의 Transaction 형태와 같다.
// - amount: 양의 정수 (지출도 음수로 쓰지 않음)
// - occurredAt/createdAt/updatedAt: UTC ISO 문자열 (끝이 Z)
// - inputMethod: 'MANUAL' | 'VOICE' | 'TEXT'

// 오늘 기준 날짜를 만들어 UTC ISO 문자열로 바꾼다. (언제 열어도 "오늘" 합계가 보이도록)
function localTimeIso(daysAgo, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function makeTransaction(id, amount, category, memo, daysAgo, hour, minute, inputMethod, rawInput) {
  const occurredAt = localTimeIso(daysAgo, hour, minute);
  return {
    id,
    type: 'EXPENSE',
    amount,
    currencyCode: 'KRW',
    category,
    memo,
    occurredAt,
    inputMethod,
    rawInput,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
  };
}

const mockTransactions = [
  makeTransaction('7d3f1c2a-0001-4a6b-9c1e-000000000001', 8000, '식비', '점심', 0, 12, 30, 'VOICE', '점심 8천원 썼어'),
  makeTransaction('7d3f1c2a-0002-4a6b-9c1e-000000000002', 4500, '카페', '아메리카노', 0, 9, 10, 'TEXT', '아메리카노 4500원'),
  makeTransaction('7d3f1c2a-0003-4a6b-9c1e-000000000003', 1450, '교통', null, 0, 8, 20, 'MANUAL', null),
  makeTransaction('7d3f1c2a-0004-4a6b-9c1e-000000000004', 32000, null, '친구 생일 선물, 포장비 포함. 메모가 길면 두 줄까지만 보이고 나머지는 말줄임표로 잘리는지 확인하기 위한 문장입니다.', 1, 19, 45, 'MANUAL', null),
  makeTransaction('7d3f1c2a-0005-4a6b-9c1e-000000000005', 12900, '생활', '세제', 2, 15, 0, 'TEXT', '세제 12900원 샀어'),
];
// 시나리오가 기록을 추가하므로 처음 모습을 기억해 둔다
const baseTransactions = [...mockTransactions];

// ---------- 캘린더 목업: Event(src/domain/event/event.ts) · Task(src/domain/task/task.ts) 와 같은 필드 ----------
// - Event: 시간이 정확하면 kind 'EXACT' + startAt(UTC ISO). 시간이 모호한 말("저녁쯤")은 날짜를 알 수 없어 캘린더에 올리지 않는다.
// - 지난 약속은 자동으로 COMPLETED 가 되지 않고 PAST 가 된다.
// - Task: dueAt(UTC ISO), 상태 OPEN → 체크하면 COMPLETED + completedAt. 날짜만 말한 마감은 그날 23:59 로 둔다.
// - 삭제는 deletedAt 을 채우는 소프트 삭제.
const TIMEZONE = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const clone = item => ({ ...item });
const pad2 = number => String(number).padStart(2, '0');
let idCounter = 0;
const newId = group => `7d3f1c2a-${group}-4a6b-9c1e-${String(Date.now()).slice(-8)}${String(++idCounter).padStart(4, '0')}`;

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

// 한 달 뒤/앞으로: 31일 → 30일뿐인 달이면 말일로 맞춘다
function addMonths(date, count) {
  const result = new Date(date.getFullYear(), date.getMonth() + count, 1);
  const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), last));
  return result;
}

const startOfWeek = date => addDays(startOfDay(date), -date.getDay()); // 일요일 시작
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = offset => addDays(startOfDay(new Date()), offset);

function atTime(date, hour, minute) {
  const result = startOfDay(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

const dateKey = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// "2026-10-02" 처럼 적은 날짜를 읽는다. 없는 날짜(2026-02-31)는 null.
function parseDateKey(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const valid = date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  return valid ? date : null;
}

// "15:00" 처럼 24시간으로 적은 시간을 읽는다
function parseClock(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function makeEventAt(id, title, start, durationMinutes, location) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    kind: 'EXACT',
    startAt: start.toISOString(),
    fuzzyTime: null,
    endAt: new Date(start.getTime() + durationMinutes * 60000).toISOString(),
    timezone: TIMEZONE,
    location: location ?? null,
    status: start.getTime() < Date.now() ? 'PAST' : 'UPCOMING',
    sourceActionId: `action-${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isPublic: false, // 친구에게 공개할지 (7장). 새 항목은 만드는 곳에서 기본값을 넣는다
  };
}

function makeTaskAt(id, title, due) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    dueAt: due.toISOString(),
    status: 'OPEN',
    completedAt: null,
    sourceActionId: `action-${id}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isPublic: false,
  };
}

const mockEvents = [
  makeEventAt('7d3f1c2a-1001-4a6b-9c1e-000000000001', '팀 미팅', atTime(dayStart(0), 14, 0), 60, '3층 회의실'),
  makeEventAt('7d3f1c2a-1002-4a6b-9c1e-000000000002', '병원 예약', atTime(dayStart(2), 10, 30), 30, '내과'),
  makeEventAt('7d3f1c2a-1003-4a6b-9c1e-000000000003', '가족 저녁', atTime(dayStart(4), 19, 0), 120, null),
];
const mockTasks = [
  makeTaskAt('7d3f1c2a-1101-4a6b-9c1e-000000000001', '택배 보내기', atTime(dayStart(0), 18, 0)),
  makeTaskAt('7d3f1c2a-1102-4a6b-9c1e-000000000002', '공과금 내기', atTime(dayStart(1), 23, 59)),
];
// 로그인한 상태의 예시: 일부는 공개, 일부는 비공개 (7장)
mockEvents[0].isPublic = true;
mockEvents[2].isPublic = true;
mockTasks[0].isPublic = true;
const baseEvents = mockEvents.map(clone);
const baseTasks = mockTasks.map(clone);

// 캘린더 화면 상태: 어떤 방식(일/주/월)으로, 어느 날을 보고 있는지
const VIEWS = ['day', 'week', 'month'];
let calView = 'week';
let focusDate = dayStart(0);

// 시나리오·"처음으로"가 호출한다: 지출·약속·할 일을 처음 모습으로 되돌리고 오늘을 보여 준다 (보기 방식은 그대로)
function restoreTransactions() {
  mockTransactions.splice(0, mockTransactions.length, ...baseTransactions);
  mockEvents.splice(0, mockEvents.length, ...baseEvents.map(clone));
  mockTasks.splice(0, mockTasks.length, ...baseTasks.map(clone));
  focusDate = dayStart(0);
}

// 앱의 expenses.summary(오늘 0시 ~ 내일 0시)와 같은 계산
function todaySummary(items) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const today = items.filter(item => {
    const time = Date.parse(item.occurredAt);
    return item.type === 'EXPENSE' && item.currencyCode === 'KRW' && !item.deletedAt && item.includeInTotal !== false && time >= start.getTime() && time < end.getTime();
  });
  return { total: today.reduce((sum, item) => sum + item.amount, 0), count: today.length };
}

// ---------- 표시 형식: home-screen.tsx 와 같은 규칙 ----------
function formatAmount(item) {
  return item.amount.toLocaleString('ko-KR') + (item.currencyCode === 'KRW' ? '원' : ` ${item.currencyCode}`);
}

function formatInputMethod(inputMethod) {
  return inputMethod === 'VOICE' ? '음성' : inputMethod === 'TEXT' ? '문장' : '직접 입력';
}

function formatMeta(item) {
  const when = new Date(item.occurredAt).toLocaleString('ko-KR');
  // 친구가 보낸 지출은 입력 방식 대신 보낸 사람(별명 우선)을 보여 준다
  return item.fromId ? `${when} · 보낸 사람: ${nameOfId(item.fromId)}` : `${when} · ${formatInputMethod(item.inputMethod)}`;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

// FlatList renderItem 한 줄: 위 줄에 분류(왼쪽)와 금액(오른쪽), 아래에 메모와 날짜
// parts 는 시나리오에서 캐릭터가 글자를 하나씩 적을 때 쓴다.
function buildRecord(item) {
  const record = document.createElement('button');
  record.className = 'record';
  record.setAttribute('aria-label', `${item.category ?? '미분류'} ${item.amount.toLocaleString('ko-KR')}원, 상세 보기`);

  const title = textElement('p', 'recordTitle', item.category ?? '미분류');
  const amount = textElement('p', 'recordAmount', formatAmount(item));
  const memo = textElement('p', 'text twoLines', item.memo ?? '메모 없음');
  const meta = textElement('p', 'muted', formatMeta(item));

  const top = document.createElement('div');
  top.className = 'rowBetween';
  top.append(title, amount);
  record.append(top, memo, meta);
  return { record, parts: [title, amount, memo, meta] };
}

function renderRecord(item) {
  const { record } = buildRecord(item);
  if (item.includeInTotal === false) record.append(makeDiv('tag tagExcluded', textElement('p', 'tagText', '합계 제외')));
  record.addEventListener('click', () => openExpenseDetail(item.id));
  return record;
}

// ---------- 공통 도우미 ----------
function byId(id) {
  return document.getElementById(id);
}

function show(id, visible) {
  byId(id).hidden = !visible;
}

function setDisabled(id, disabled) {
  byId(id).classList.toggle('disabled', disabled);
}

// 눌린 상태 표시: 버튼과 그 안의 글자에 각각 클래스를 붙인다 (앱에서는 두 스타일을 배열로 합친다)
function setActive(button, active, buttonClass, textClass) {
  button.classList.toggle(buttonClass, active);
  button.firstElementChild.classList.toggle(textClass, active);
  button.setAttribute('aria-pressed', String(active));
}

// 디자인 확인용 버튼 강조
function highlight(selector, isActive) {
  document.querySelectorAll(selector).forEach(button => {
    const active = isActive(button);
    button.classList.toggle('designButtonActive', active);
    button.firstElementChild.classList.toggle('designButtonTextActive', active);
  });
}

// ---------- 캘린더 ----------
// 한 줄(약속/할 일)의 화면 요소를 id 로 찾을 수 있게 모아 둔다 (캐릭터가 체크하러 갈 때 쓴다)
const agendaRows = new Map();

// 한 날의 약속·할 일을 시간 순으로 (삭제된 것은 제외)
function itemsForDate(date) {
  const from = startOfDay(date).getTime();
  const to = addDays(startOfDay(date), 1).getTime();
  const within = iso => iso !== null && Date.parse(iso) >= from && Date.parse(iso) < to;
  const events = mockEvents.filter(item => item.deletedAt === null && (item.kind === 'EXACT' || item.kind === 'FUZZY' || item.kind === 'ALL_DAY') && within(item.startAt))
    .map(item => ({ type: 'EVENT', date: startOfDay(date), at: item.kind === 'ALL_DAY' ? startOfDay(date).getTime() : item.kind === 'FUZZY' ? fuzzyAt(item) : Date.parse(item.startAt), item }));
  const tasks = mockTasks.filter(item => item.deletedAt === null && within(item.dueAt))
    .map(item => ({ type: 'TASK', date: startOfDay(date), at: Date.parse(item.dueAt), item }));
  return [...events, ...tasks].sort((a, b) => a.at - b.at);
}

const hasItems = date => itemsForDate(date).length > 0;

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

// 약속은 시각, 할 일은 "마감" (23:59 는 날짜만 정한 마감이라 시각을 숨긴다)
function agendaLabel(entry) {
  if (entry.type === 'EVENT') return eventTimeLabel(entry.item);
  const due = new Date(entry.item.dueAt);
  return due.getHours() === 23 && due.getMinutes() === 59 ? '마감' : `마감 ${formatClock(entry.item.dueAt)}`;
}

const dayLabel = date => `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;

function calendarTitle() {
  if (calView === 'day') return dayLabel(focusDate);
  if (calView === 'month') return `${focusDate.getFullYear()}년 ${focusDate.getMonth() + 1}월`;
  const first = startOfWeek(focusDate);
  const last = addDays(first, 6);
  return first.getMonth() === last.getMonth()
    ? `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getDate()}일`
    : `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`;
}

// 한 줄: 왼쪽에 시각(포인트 색)과 제목(누르면 수정), 할 일이면 오른쪽에 체크 칸(누르면 완료). parts 는 캐릭터가 적을 때 쓴다.
function buildAgendaItem(entry) {
  const done = entry.type === 'TASK' && entry.item.status === 'COMPLETED';
  const record = document.createElement('div');
  record.className = 'agendaItem';
  const label = textElement('p', 'agendaTime', agendaLabel(entry));
  const canceled = entry.type === 'EVENT' && entry.item.status === 'CANCELED';
  const title = textElement('p', done || canceled ? 'agendaTitle agendaTitleDone' : 'agendaTitle', entry.item.title);
  const text = document.createElement('div');
  text.className = 'agendaText';
  text.append(label, title);
  // 친구가 보낸 일정은 누가 넣었는지 항상 보여 준다 (설계도 6.1)
  if (entry.type === 'EVENT' && entry.item.fromId) text.append(buildSenderLine(entry.item.fromId));
  // 친구 일정을 내 캘린더에 복사한 일정의 출처 (설계도 7.2)
  if (entry.type === 'EVENT' && entry.item.copiedFromId) text.append(textElement('p', 'agendaSource', `${nameOfId(entry.item.copiedFromId)}님 일정에서 복사`));
  // 친구에게 공개 중인 일정 · 할 일 표시 (설계도 12.2 "공개 표시" 추가)
  if (itemIsPublic(entry.item)) text.append(makeDiv('tag tagPublic', textElement('p', 'tagText', '공개')));
  // 보낸 사람이 고치거나 취소하면 눈에 띄게 표시한다 (설계도 6.5)
  if (entry.type === 'EVENT' && entry.item.editedAt && !canceled) text.append(makeDiv('tag tagEdited', textElement('p', 'tagText', `수정됨 · ${editedStamp(entry.item.editedAt)}`)));
  if (canceled) text.append(makeDiv('tag tagCanceled', textElement('p', 'tagText', '취소됨')), textElement('p', 'agendaWarn', '보낸 사람이 취소했어요'));
  // 기기 알림 권한이 꺼져 있으면 알림이 예약되어도 울리지 않으므로 일정 카드에 알린다 (설계도 8.2)
  if (entry.type === 'EVENT' && ((entry.item.status === 'UPCOMING' && notifPermission === 'BLOCKED') || itemSilentReason(entry.item))) text.append(textElement('p', 'agendaWarn', '알림 꺼짐'));
  if (entry.type === 'EVENT' && entry.item.reminderFailed) text.append(textElement('p', 'agendaWarn', '알림 예약 실패'));
  const main = document.createElement('button');
  main.className = 'agendaMain';
  main.setAttribute('aria-label', `${agendaLabel(entry)} ${entry.item.title}, 상세 보기`);
  main.append(text);
  main.addEventListener('click', () => openItemDetail(entry.type, entry.item.id));
  record.append(main);
  if (entry.type === 'TASK') {
    const toggle = document.createElement('button');
    toggle.className = 'taskToggle';
    toggle.setAttribute('role', 'checkbox');
    toggle.setAttribute('aria-checked', String(done));
    toggle.setAttribute('aria-label', `${entry.item.title} ${done ? '완료 취소' : '완료'}`);
    const box = document.createElement('div');
    box.className = done ? 'taskBox taskBoxDone' : 'taskBox';
    if (done) box.append(textElement('p', 'taskCheck', '✓'));
    toggle.append(box);
    toggle.addEventListener('click', () => toggleTask(entry.item.id));
    record.append(toggle);
  }
  agendaRows.set(entry.item.id, record);
  return { record, parts: [label, title] };
}

// 할 일 체크: 완료 ↔ 되돌리기 (Task.status OPEN ↔ COMPLETED, completedAt)
function setTaskDone(id, done) {
  const task = mockTasks.find(item => item.id === id);
  if (!task) return;
  const now = new Date().toISOString();
  task.status = done ? 'COMPLETED' : 'OPEN';
  task.completedAt = done ? now : null;
  task.updatedAt = now;
  renderCalendar();
}

function toggleTask(id) {
  const task = mockTasks.find(item => item.id === id);
  if (task) setTaskDone(id, task.status !== 'COMPLETED');
}

function pickDate(date) {
  focusDate = startOfDay(date);
  renderCalendar();
}

function dotClass(date, active) {
  return hasItems(date) ? (active ? 'dayDot dayDotOnActive' : 'dayDot dayDotOn') : 'dayDot';
}

// 주 보기의 한 칸: 요일 + 날짜 + 일정 점
function buildWeekCell(date) {
  const active = sameDay(date, focusDate);
  const today = sameDay(date, dayStart(0));
  const cell = document.createElement('button');
  cell.className = active ? 'dayCell dayCellActive' : 'dayCell';
  cell.setAttribute('aria-label', dayLabel(date));
  cell.setAttribute('aria-pressed', String(active));
  const dot = buildDots(date, active);
  cell.append(
    textElement('p', active ? 'dayName dayNameActive' : 'dayName', WEEKDAYS[date.getDay()]),
    textElement('p', active ? 'dayNum dayNumActive' : today ? 'dayNum dayNumToday' : 'dayNum', String(date.getDate())),
    dot,
  );
  cell.addEventListener('click', () => pickDate(date));
  return cell;
}

// 월 보기의 한 칸: 날짜 + 일정 점. 이번 달이 아닌 날은 옅게.
function buildMonthCell(date) {
  const active = sameDay(date, focusDate);
  const today = sameDay(date, dayStart(0));
  const inMonth = date.getMonth() === focusDate.getMonth();
  const cell = document.createElement('button');
  cell.className = active ? 'monthCell monthCellActive' : 'monthCell';
  cell.setAttribute('aria-label', dayLabel(date));
  cell.setAttribute('aria-pressed', String(active));
  const numClass = active ? 'monthNum monthNumActive' : today ? 'monthNum monthNumToday' : inMonth ? 'monthNum' : 'monthNum monthNumOut';
  const dot = buildDots(date, active);
  cell.append(textElement('p', numClass, String(date.getDate())), dot);
  cell.addEventListener('click', () => pickDate(date));
  return cell;
}

function buildGrid() {
  if (calView === 'day') return [];
  if (calView === 'week') {
    const strip = document.createElement('div');
    strip.className = 'weekStrip';
    const first = startOfWeek(focusDate);
    strip.append(...Array.from({ length: 7 }, (_, index) => buildWeekCell(addDays(first, index))));
    return [strip];
  }
  const head = document.createElement('div');
  head.className = 'monthHead';
  head.append(...WEEKDAYS.map(name => textElement('p', 'monthHeadText', name)));
  const gridStart = startOfWeek(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1));
  const rows = Array.from({ length: 6 }, (_, week) => {
    const row = document.createElement('div');
    row.className = 'monthRow';
    row.append(...Array.from({ length: 7 }, (_, index) => buildMonthCell(addDays(gridStart, week * 7 + index))));
    return row;
  });
  return [head, ...rows];
}

function renderCalendar() {
  agendaRows.clear();
  document.querySelectorAll('[data-view]').forEach(button => setActive(button, button.dataset.view === calView, 'segmentButtonActive', 'segmentTextActive'));
  byId('calLabel').textContent = calendarTitle();
  show('todayButton', !sameDay(focusDate, dayStart(0)));
  byId('calGrid').replaceChildren(...buildGrid());
  show('agendaDate', calView !== 'day');
  byId('agendaDate').textContent = dayLabel(focusDate);
  const entries = itemsForDate(focusDate);
  byId('agenda').replaceChildren(...(entries.length ? entries.map(entry => buildAgendaItem(entry).record) : [textElement('p', 'agendaEmpty', '일정이 없어요')]));
}

function shiftCalendar(direction) {
  focusDate = calView === 'day' ? addDays(focusDate, direction) : calView === 'week' ? addDays(focusDate, 7 * direction) : addMonths(focusDate, direction);
  renderCalendar();
}

function changeView(view) {
  calView = view;
  try { localStorage.setItem('calendarView', view); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  renderCalendar();
}

// ---------- 하단 시트 (화면 설정 · 일정 편집) ----------
const sheets = { settings: ['settingsSheet', 'settingsBackdrop'], edit: ['editSheet', 'editBackdrop'] };

function showSheet(name, visible) {
  sheets[name].forEach(id => show(id, visible));
}

// 편집 시트가 다루는 대상: 새로 만들기(new) 또는 기존 항목 수정(edit)
let editing = null;

function applyEditType(type) {
  editing.type = type;
  show('editTimeField', type === 'EVENT');
  byId('editDateLabel').textContent = type === 'EVENT' ? '날짜' : '마감 날짜';
  byId('editHeading').textContent = editing.mode === 'new' ? (type === 'EVENT' ? '새 일정' : '새 할 일') : (type === 'EVENT' ? '일정 수정' : '할 일 수정');
  document.querySelectorAll('[data-type]').forEach(button => setActive(button, button.dataset.type === type, 'segmentButtonActive', 'segmentTextActive'));
}

function openEditSheet(mode, type, title, date, time, id) {
  editing = { mode, type, id };
  byId('editTitle').value = title;
  byId('editDate').value = dateKey(date);
  byId('editTime').value = time;
  show('editError', false);
  show('typeSegment', mode === 'new');
  show('editDelete', mode === 'edit');
  applyEditType(type);
  showSheet('edit', true);
}

function openEdit(entry) {
  const when = new Date(entry.type === 'EVENT' ? entry.item.startAt : entry.item.dueAt);
  openEditSheet('edit', entry.type, entry.item.title, when, `${pad2(when.getHours())}:${pad2(when.getMinutes())}`, entry.item.id);
}

function openNew() {
  openEditSheet('new', 'EVENT', '', focusDate, '09:00', null);
}

function closeEdit() {
  editing = null;
  showSheet('edit', false);
}

function saveEdit() {
  if (!editing) return;
  const title = byId('editTitle').value.trim();
  const date = parseDateKey(byId('editDate').value);
  const existing = editing.mode === 'edit' ? (editing.type === 'EVENT' ? mockEvents : mockTasks).find(item => item.id === editing.id) : null;
  // 할 일은 날짜만 고른다: 기존 시각은 그대로, 새로 만들면 그날 23:59 마감
  const taskClock = existing ? { hour: new Date(existing.dueAt).getHours(), minute: new Date(existing.dueAt).getMinutes() } : { hour: 23, minute: 59 };
  const clock = editing.type === 'EVENT' ? parseClock(byId('editTime').value) : taskClock;
  const error = !title ? '제목을 적어 주세요' : !date ? '날짜를 2026-10-02 처럼 적어 주세요' : !clock ? '시간을 15:00 처럼 적어 주세요' : '';
  if (error) {
    byId('editError').textContent = error;
    show('editError', false);
    show('editError', true);
    return;
  }
  const when = atTime(date, clock.hour, clock.minute);
  const now = new Date().toISOString();
  if (!existing) {
    const created = editing.type === 'EVENT' ? makeEventAt(newId(2000), title, when, 60, null) : makeTaskAt(newId(2100), title, when);
    created.isPublic = !isGuest() && editing.isPublic === true;
    (editing.type === 'EVENT' ? mockEvents : mockTasks).push(created);
  } else if (editing.type === 'EVENT') {
    const length = existing.endAt ? Date.parse(existing.endAt) - Date.parse(existing.startAt) : 3600000;
    existing.title = title;
    existing.startAt = when.toISOString();
    existing.endAt = new Date(when.getTime() + length).toISOString();
    existing.status = when.getTime() < Date.now() ? 'PAST' : 'UPCOMING';
    existing.updatedAt = now;
  } else {
    existing.title = title;
    existing.dueAt = when.toISOString();
    existing.updatedAt = now;
  }
  if (existing && !isGuest()) existing.isPublic = editing.isPublic === true;
  focusDate = startOfDay(date);
  closeEdit();
  renderCalendar();
}

function deleteEdit() {
  if (!editing || editing.mode !== 'edit') return;
  const target = (editing.type === 'EVENT' ? mockEvents : mockTasks).find(item => item.id === editing.id);
  if (target) {
    const now = new Date().toISOString();
    target.deletedAt = now;
    target.updatedAt = now;
  }
  closeEdit();
  renderCalendar();
}

// ---------- 상태별 화면 ----------
// 오늘 합계: 숫자와 "원"을 따로 그려 숫자만 크게 보여 준다 (앱에서는 중첩 Text)
function renderSummary(summary, error) {
  byId('summaryNumber').textContent = error ? '확인 필요' : summary ? summary.total.toLocaleString('ko-KR') : '—';
  byId('summaryUnit').textContent = summary && !error ? '원' : '';
  byId('summaryCaption').textContent = summary && !error ? `${summary.count}건 · 기기 현지 날짜 기준` : '기록을 확인하고 있습니다.';
}

function render(state) {
  stopScenario();
  const loading = state === 'loading';
  const error = state === 'error';
  const items = loading || error || state === 'empty' ? [] : mockTransactions.filter(item => !item.deletedAt);
  const summary = loading ? null : todaySummary(items);

  renderSummary(summary, error);

  // 실행취소 카드 (저장 직후)
  show('undoCard', state === 'undo');
  byId('undoLabel').textContent = `${mockTransactions[0].category || '미분류'} ${mockTransactions[0].amount.toLocaleString('ko-KR')}원 저장됨`;

  // 빠른 기록 카드
  const listening = state === 'listening';
  const review = state === 'review';
  byId('voiceButtonText').textContent = listening ? '말하기 마치기' : '말하기 시작';
  show('voiceCancel', listening);
  show('partialText', listening);
  const input = byId('captureInput');
  input.value = review ? '점심 7000원 썼어' : '';
  input.readOnly = listening;
  show('draftStatus', review);
  setDisabled('analyzeButton', listening);
  show('reviewCard', review);
  byId('reviewDate').textContent = `${new Date(localTimeIso(0, 12, 0)).toLocaleString('ko-KR')} · 지출`;
  setDisabled('manualButton', listening);
  show('discardButton', review);

  // 로딩 / 오류 / 빈 목록 / 목록
  show('loadingIndicator', loading);
  show('errorBox', error);
  show('emptyCard', !loading && !error && items.length === 0);
  const list = byId('recordList');
  list.replaceChildren(...items.map(renderRecord));
  list.hidden = items.length === 0;

  renderCalendar();
  renderOverlay(state);
  highlight('[data-state]', button => button.dataset.state === state);
}

// ---------- 첫 화면: 녹음 오버레이 (앱에서는 Modal) ----------
// 앱의 실제 음성 상태에 맞춘 3가지. 이유 문구는 voice-expense-capture.ts 의 기존 문구를 재사용했다.
// 오버레이가 보일 때 뒤의 홈은 위 render() 가 "기본" 상태로 그린다 (start* 는 기존 분기에 걸리지 않음).
// 부가 설명은 두지 않는다: 사용 불가일 때만 이유를 한 줄 보여 준다.
const overlayStates = {
  // LISTENING: 실제로 듣는 중
  start: { chip: '녹음 중', message: '', button: '녹음 그만하고 화면으로 가기', recording: true, sleepy: false },
  // CHECKING: 마이크 권한 확인 중 (앱 첫 실행 때 권한 팝업이 뜨는 구간)
  startChecking: { chip: '마이크 확인 중', message: '', button: '화면으로 가기', recording: false, sleepy: true },
  // 사용 불가: 권한 거부, 오프라인 음성 인식 미지원, 웹 등
  startUnavailable: { chip: '녹음할 수 없어요', message: '이 기기에서 오프라인 음성 인식을 사용할 수 없어요.', button: '화면으로 가기', recording: false, sleepy: false },
};

// 동작 줄이기: 시스템 설정 + 확인용 토글. 앱에서는 reanimated 의 useReducedMotion().
const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let reducedMotion = motionQuery ? motionQuery.matches : false;
let overlayRecording = false;

// data-anim="listen": 녹음 중일 때만 움직임 (튀기, 물결, 빨간 점)
// data-anim="always": 녹음 상태와 무관 (눈 깜빡임, 갸웃, 연필). 동작 줄이기에서는 둘 다 멈춘다.
function applyMotion() {
  document.querySelectorAll('[data-anim]').forEach(element => {
    const still = reducedMotion || (element.dataset.anim === 'listen' && !overlayRecording);
    element.classList.toggle('still', still);
  });
  highlight('[data-motion]', () => reducedMotion);
}

// 디자인 확인용 패널: 평소에는 접어 두고, 첫 화면·시나리오를 시작하면 자동으로 접어 화면을 넓게 쓴다
function setBarOpen(open) {
  show('designPanel', open);
  byId('designToggleText').textContent = open ? '접기' : '펼치기';
  byId('designToggle').setAttribute('aria-expanded', String(open));
  fitOverlay();
  onPageScroll();
}

function renderOverlay(state) {
  const config = overlayStates[state];
  const overlay = byId('startOverlay');
  overlay.classList.toggle('overlayFade', false);
  if (config) setBarOpen(false);
  show('startOverlay', Boolean(config));
  if (config) fitOverlay();
  if (!config) {
    show('pet', false);
    return;
  }
  overlay.setAttribute('aria-label', config.chip);
  byId('overlayChip').textContent = config.chip;
  byId('overlayPhrase').textContent = config.message;
  show('overlayPhrase', Boolean(config.message));
  byId('overlayButtonText').textContent = config.button;
  byId('chipDot').classList.toggle('chipDotIdle', !config.recording);
  document.querySelectorAll('[data-eye]').forEach(eye => eye.classList.toggle('eyeSleepy', config.sleepy));
  overlayRecording = config.recording;
  applyMotion();

  // 캐릭터를 오버레이 자리에 앉힌다 (오버레이를 먼저 보이게 해야 자리를 잴 수 있다)
  resetPet();
  show('pet', true);
  placePetAtStage();
}

// ---------- 캐릭터 연출 ----------
// pet 은 화면 전체 기준(fixed)이라 오버레이가 사라진 뒤에도 남아 목록 위로 날아갈 수 있다.
// 앱에서는 reanimated 의 translate/scale 값과 onLayout 으로 잰 위치로 옮긴다.
const PET_W = 144; // 통통한 몸: 가로가 세로보다 조금 길다
const PET_H = 126;
let petPose = { cx: 0, cy: 0, scale: 1, rotate: 0 };
let petAtStage = false;
let overlayFrozen = false; // 시나리오가 스크롤하는 동안 오버레이 위치가 바뀌어 튀지 않게 고정
let runId = 0;
let pendingAnswer = null;

const poseTransform = pose => `translate(${pose.cx - PET_W / 2}px, ${pose.cy - PET_H / 2}px) rotate(${pose.rotate}deg) scale(${pose.scale})`;

const NOD = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.07, 0.92)' }, { transform: 'scale(0.97, 1.05)' }, { transform: 'scale(1, 1)' }];
const LAND = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.14, 0.84)' }, { transform: 'scale(1, 1)' }];
const HOP = [{ transform: 'translateY(0px)' }, { transform: 'translateY(-18px)' }, { transform: 'translateY(0px)' }];
const SHAKE = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)' }, { transform: 'rotate(9deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0deg)' }];
const FLIP_TO_BACK = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
const FLIP_TO_FRONT = [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }];
const SLUMP = [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.1, 0.88)' }]; // 풀 죽어 납작하게 가라앉기
const UNSLUMP = [{ transform: 'scale(1.1, 0.88)' }, { transform: 'scale(1, 1)' }];

// 기다림: 동작 줄이기에서는 길게 기다리지 않는다
const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? Math.min(ms, 300) : ms));

// 움직임 한 번: 끝나면 마지막 값을 실제 스타일로 확정한다. 동작 줄이기에서는 움직임 없이 바로 확정.
function animate(element, frames, ms, easing = 'ease-in-out') {
  const last = frames[frames.length - 1];
  if (reducedMotion || typeof element.animate !== 'function') {
    Object.assign(element.style, last);
    return Promise.resolve();
  }
  const run = element.animate(frames, { duration: ms, easing, fill: 'forwards' });
  const finish = () => { Object.assign(element.style, last); run.cancel(); };
  return run.finished.then(finish, () => {});
}

function placePet(cx, cy, scale) {
  petPose = { cx, cy, scale, rotate: 0 };
  const pet = byId('pet');
  pet.style.opacity = '1';
  pet.style.transform = poseTransform(petPose);
}

function stageCenter() {
  const rect = byId('petStage').getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}

function placePetAtStage() {
  const { cx, cy } = stageCenter();
  placePet(cx, cy, 1);
  petAtStage = true;
}

// 디자인 확인용: 오버레이는 확인용 패널 아래에서 시작한다. 패널이 스크롤로 사라지면 맨 위부터 덮는다.
// (앱에는 이 패널이 없으므로 변환하지 않는다)
function fitOverlay() {
  if (overlayFrozen) return;
  const barBottom = Math.max(0, Math.round(byId('designBar').getBoundingClientRect().bottom));
  byId('startOverlay').style.top = `${barBottom}px`;
}

// 글씨 크기나 창 크기가 바뀌면 오버레이 안의 캐릭터 자리도 옮겨진다
function settlePet() {
  if (petAtStage && !byId('startOverlay').hidden && !overlayFrozen) placePetAtStage();
}

// 통통 튀는 정도: 평소(녹음 중)는 크게 튀고, 적거나 물어볼 때는 살짝만 출렁인다
function setJelly(soft) {
  byId('petJelly').classList.toggle('jellyBounce', !soft);
  byId('petJelly').classList.toggle('jellySoft', soft);
}

// 디자인 확인용: 확인용 패널이 화면 밖이면 "위로" 버튼을 보여 준다
function onPageScroll() {
  byId('designTop').hidden = byId('designBar').getBoundingClientRect().bottom > 0;
  if (!byId('startOverlay').hidden) {
    fitOverlay();
    settlePet();
  }
}

// 이전 연출의 흔적(뒤돌기, 연필, 말풍선, 진행 중인 움직임)을 모두 지운다
function resetPet() {
  ['pet', 'petBob', 'petTurn', 'bubble'].forEach(id => {
    const element = byId(id);
    if (typeof element.getAnimations === 'function') element.getAnimations().forEach(run => run.cancel());
  });
  byId('petBob').style.transform = '';
  byId('petTurn').style.transform = '';
  byId('bubble').style.transform = '';
  byId('bubble').style.opacity = '';
  byId('bubble').hidden = true;
  byId('pencil').hidden = true;
  byId('petArm').classList.toggle('armWrite', false);
  byId('petTilt').classList.toggle('petSway', false);
  setJelly(false);
}

// 진행 중인 시나리오를 취소한다 (다른 상태 버튼을 누르거나 다시 시작할 때)
function stopScenario() {
  runId++;
  overlayFrozen = false;
  pendingAnswer = null;
  byId('bubble').hidden = true;
  byId('petTilt').classList.toggle('petSway', false);
}

// 부채꼴로 날아가기: 출발 → 위로 솟은 중간 지점 → 도착. 날면서 크기가 줄고 살짝 기운다.
function flyTo(cx, cy, scale, ms) {
  petAtStage = false;
  const from = petPose;
  const mid = { cx: (from.cx + cx) / 2, cy: Math.min(from.cy, cy) - 90, scale: (from.scale + scale) / 2, rotate: from.cx < cx ? -10 : 10 };
  const to = { cx, cy, scale, rotate: 0 };
  petPose = to;
  return animate(byId('pet'), [{ transform: poseTransform(from) }, { transform: poseTransform(mid) }, { transform: poseTransform(to) }], ms, 'cubic-bezier(0.4, 0, 0.2, 1)');
}

// 작아지며 사라지기
function vanish() {
  const small = { ...petPose, scale: 0 };
  return animate(byId('pet'), [{ transform: poseTransform(petPose), opacity: '1' }, { transform: poseTransform(small), opacity: '0' }], 320, 'ease-in');
}

async function fadeOutOverlay(alive) {
  const overlay = byId('startOverlay');
  if (reducedMotion) {
    show('startOverlay', false);
    return;
  }
  overlay.classList.toggle('overlayFade', true);
  await wait(600);
  if (alive()) {
    show('startOverlay', false);
    overlay.classList.toggle('overlayFade', false);
  }
}

// 목록 맨 위에 빈 줄(적을 자리)을 만든다. 캐릭터가 옆에 설 수 있게 글자가 오른쪽으로 비켜 있다.
function openSlot(tx) {
  const built = buildRecord(tx);
  built.parts.forEach(part => { part.textContent = ''; });
  built.record.classList.toggle('recordWriting', true);
  const list = byId('recordList');
  list.hidden = false;
  list.prepend(built.record);
  return built;
}

function scrollSlotIntoView(record) {
  const rect = record.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.4));
}

function slotSpot(record) {
  const rect = record.getBoundingClientRect();
  return { cx: rect.left + 38, cy: rect.top + 50 };
}

async function typeInto(element, text, perChar, alive) {
  if (reducedMotion) {
    element.textContent = text;
    return;
  }
  for (let i = 1; i <= text.length; i++) {
    if (!alive()) return;
    element.textContent = text.slice(0, i);
    await wait(perChar);
  }
}

// 확인 말풍선: 캐릭터 머리 위에 뜨고, 사용자의 대답을 기다린다
function placeBubble() {
  const bubble = byId('bubble');
  const box = bubble.getBoundingClientRect();
  const radius = (PET_H / 2) * petPose.scale;
  const left = Math.min(Math.max(petPose.cx - 40, 12), window.innerWidth - box.width - 12);
  const top = Math.max(petPose.cy - radius - 16 - box.height, 8);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  byId('bubbleTail').style.left = `${Math.min(Math.max(petPose.cx - left - 8, 18), box.width - 34)}px`;
}

// 말풍선: 버튼 글자는 [왼쪽(눈에 띄는 쪽) = 'yes', 오른쪽 = 'no'] 순서. sway=false 면 갸웃거리지 않는다.
function ask(message, labels = ['맞아요', '아니에요'], sway = true) {
  return new Promise(resolve => {
    pendingAnswer = resolve;
    byId('bubbleText').textContent = message;
    byId('bubbleYesText').textContent = labels[0];
    byId('bubbleNoText').textContent = labels[1];
    const bubble = byId('bubble');
    bubble.hidden = false;
    placeBubble();
    byId('petTilt').classList.toggle('petSway', sway);
    setJelly(true);
    void animate(bubble, [{ transform: 'scale(0.85)', opacity: '0' }, { transform: 'scale(1)', opacity: '1' }], 220, 'ease-out');
  });
}

function answer(value) {
  if (!pendingAnswer) return;
  const resolve = pendingAnswer;
  pendingAnswer = null;
  byId('bubble').hidden = true;
  byId('petTilt').classList.toggle('petSway', false);
  resolve(value);
}

// 뒤돌아서 연필로 한 글자씩 적고, 다시 돌아서 두 번 통통 뛴다
async function writeRecord(slot, tx, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  const [title, amount, memo, meta] = slot.parts;
  await typeInto(title, tx.category ?? '미분류', 80, alive);
  await typeInto(amount, formatAmount(tx), 80, alive);
  await typeInto(memo, tx.memo ?? '메모 없음', 80, alive);
  await typeInto(meta, formatMeta(tx), 18, alive);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  slot.record.classList.toggle('recordWriting', false);
  mockTransactions.unshift(tx);
  renderSummary(todaySummary(mockTransactions), false);
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 캘린더의 해당 날짜로 넘기고, 그 날 목록 맨 위에 빈 줄(적을 자리)을 만든다
function openAgendaSlot(entry) {
  focusDate = startOfDay(entry.date);
  renderCalendar();
  const built = buildAgendaItem(entry);
  built.parts.forEach(part => { part.textContent = ''; });
  built.record.classList.toggle('agendaWriting', true);
  byId('agenda').replaceChildren(built.record, ...itemsForDate(entry.date).map(item => buildAgendaItem(item).record));
  return built;
}

// 뒤돌아서 연필로 시각과 제목을 한 글자씩 적고, 날짜 칸에 점이 생기고, 다시 돌아서 두 번 통통 뛴다
async function writeAgenda(slot, entry, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  const [label, title] = slot.parts;
  await typeInto(label, agendaLabel(entry), 80, alive);
  await typeInto(title, entry.item.title, 80, alive);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  (entry.type === 'EVENT' ? mockEvents : mockTasks).push(entry.item);
  renderCalendar();
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 말로 "끝났어"라고 하면: 그 할 일 줄로 날아가 옆에 서고
function openCompleteSlot(thing) {
  const task = mockTasks.find(item => item.id === thing.taskId);
  focusDate = startOfDay(new Date(task.dueAt));
  renderCalendar();
  const record = agendaRows.get(task.id);
  record.classList.toggle('agendaWriting', true);
  return { record, parts: [] };
}

// 뒤돌아서 연필로 체크 표시를 긋고 → 체크 칸이 채워지고 → 다시 돌아서 두 번 통통 뛴다 (사람 대신 캐릭터가 체크한다)
async function writeComplete(slot, thing, alive) {
  const turn = byId('petTurn');
  setJelly(true);
  await animate(turn, FLIP_TO_BACK, 450);
  if (!alive()) return;
  byId('pencil').hidden = false;
  byId('petArm').classList.toggle('armWrite', true);
  await wait(1000);
  if (!alive()) return;
  byId('petArm').classList.toggle('armWrite', false);
  byId('pencil').hidden = true;
  await animate(turn, FLIP_TO_FRONT, 450);
  if (!alive()) return;
  setTaskDone(thing.taskId, true);
  await animate(byId('petBob'), HOP, 320);
  await animate(byId('petBob'), HOP, 320);
}

// 목록을 원래 기록들로 다시 그린다 (캐릭터가 적으려고 만든 빈 줄을 치운다)
function rebuildList() {
  const list = byId('recordList');
  const living = mockTransactions.filter(item => !item.deletedAt);
  list.replaceChildren(...living.map(renderRecord));
  list.hidden = living.length === 0;
}

// 삐짐: 고개를 젓고 → 천천히 등을 돌리고 → 풀 죽어 납작하게 가라앉는다
async function sulk(alive) {
  const bob = byId('petBob');
  await animate(bob, SHAKE, 520);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_BACK, 700);
  if (!alive()) return;
  await animate(bob, SLUMP, 450);
}

// "직접 적기": 다시 앞을 보고 → 직접 입력하는 칸으로 날아가 → 통통 뛰고 사라진 뒤 → 그 칸에 커서를 둔다
async function goManual(alive) {
  const bob = byId('petBob');
  await animate(bob, UNSLUMP, 250);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_FRONT, 450);
  if (!alive()) return;
  rebuildList();
  const input = byId('captureInput');
  window.scrollTo(0, Math.max(0, window.scrollY + input.getBoundingClientRect().top - window.innerHeight * 0.4));
  const rect = input.getBoundingClientRect();
  await flyTo(rect.left + 40, rect.top - 30, 0.5, 900);
  if (!alive()) return;
  await animate(bob, HOP, 320);
  if (!alive()) return;
  await vanish();
  if (!alive()) return;
  show('pet', false);
  input.focus();
}

// "다시 말하기": 다시 앞을 보고 → 첫 화면 오버레이가 다시 덮이며 → 제자리로 날아가 다시 듣는다
async function goRetry(alive) {
  await animate(byId('petBob'), UNSLUMP, 250);
  if (!alive()) return;
  await animate(byId('petTurn'), FLIP_TO_FRONT, 450);
  if (!alive()) return;
  rebuildList();
  overlayFrozen = false;
  window.scrollTo(0, 0);
  const overlay = byId('startOverlay');
  overlay.classList.toggle('overlayFade', false);
  show('startOverlay', true);
  fitOverlay();
  const stage = stageCenter();
  void animate(overlay, [{ opacity: '0' }, { opacity: '1' }], 500, 'ease-out').then(() => { overlay.style.opacity = ''; });
  await flyTo(stage.cx, stage.cy, 1, 900);
  if (alive()) render('start'); // 다시 듣는 중 상태로 정리 (캐릭터는 이미 그 자리에 있다)
}

// 시나리오: 캐릭터가 말을 듣고 → 적을 자리로 날아가서 → (애매하면 물어보고) → 뒤돌아 대신 적는다.
// 말로 시킨 일은 항상 캐릭터가 사람 대신 한다.
// target: 'expense'(최근 기록) · 'calendar'(캘린더에 적기) · 'complete'(할 일 체크). question 이 있으면 적기 전에 말풍선으로 묻는다.
function newVoiceTransaction(amount, category, memo, rawInput) {
  const now = new Date();
  return makeTransaction(newId(6), amount, category, memo, 0, now.getHours(), now.getMinutes(), 'VOICE', rawInput);
}

function newCalendarEvent(title, offset, hour, minute) {
  const date = dayStart(offset);
  return { type: 'EVENT', date, item: { ...makeEventAt(newId(2000), title, atTime(date, hour, minute), 60, null), isPublic: defaultPublicNow() } };
}

function newCalendarTask(title, offset) {
  const date = dayStart(offset);
  return { type: 'TASK', date, item: { ...makeTaskAt(newId(2100), title, atTime(date, 23, 59)), isPublic: defaultPublicNow() } };
}

// "7시" 처럼 오전/오후가 모호한 시간을 사용자가 고른 시각으로 바꾼다
function withHour(entry, hour) {
  const start = atTime(entry.date, hour, 0);
  return { ...entry, item: { ...entry.item, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString(), status: start.getTime() < Date.now() ? 'PAST' : 'UPCOMING' } };
}

const targets = {
  expense: { open: openSlot, write: writeRecord },
  calendar: { open: openAgendaSlot, write: writeAgenda },
  complete: { open: openCompleteSlot, write: writeComplete },
};

const scenarios = {
  // 분명한 지출: 바로 적는다
  clear: { target: 'expense', build: () => newVoiceTransaction(12000, '식비', '저녁', '저녁 만이천 원 썼어') },
  // 애매한 지출: 먼저 확인 메시지를 보낸다. "아니에요"를 누르면 삐진다.
  confirm: {
    target: 'expense',
    build: () => newVoiceTransaction(7000, '식비', '점심', '점심 칠천 원'),
    question: { text: tx => `${tx.memo} ${tx.amount.toLocaleString('ko-KR')}원, 맞나요?`, labels: ['맞아요', '아니에요'], sulkOnNo: true },
  },
  // 분명한 약속: "내일 오후 3시에 치과 예약" → 내일 칸에 일정으로 적는다
  event: { target: 'calendar', build: () => newCalendarEvent('치과 예약', 1, 15, 0) },
  // 분명한 할 일: "모레까지 보고서 제출" → 모레 칸에 할 일로 적는다
  task: { target: 'calendar', build: () => newCalendarTask('보고서 제출', 2) },
  // 애매한 시간: "내일 7시에 약속" 은 오전인지 오후인지 마음대로 정하지 않고 묻는다 (제품 결정 2번)
  time: {
    target: 'calendar',
    build: () => newCalendarEvent('약속', 1, 19, 0),
    question: { text: () => '내일 7시, 오전인가요 오후인가요?', labels: ['오후 7시', '오전 7시'], resolve: (entry, reply) => withHour(entry, reply === 'yes' ? 19 : 7) },
  },
  // 할 일 완료: "택배 보내기 끝났어" → 캐릭터가 그 할 일 옆에서 체크해 준다
  done: { target: 'complete', build: () => ({ taskId: baseTasks[0].id }) },
};

async function runScenario(kind) {
  restoreTransactions();
  window.scrollTo(0, 0);
  render('start');
  const id = ++runId;
  const alive = () => id === runId;
  const spec = scenarios[kind];
  const target = targets[spec.target];
  let thing = spec.build();
  const bob = byId('petBob');

  await wait(1800); // 듣는 중
  if (!alive()) return;
  await animate(bob, NOD, 480); // 알아들었다는 끄덕임
  if (!alive()) return;

  // 오버레이가 아직 덮고 있을 때 자리를 만들고 스크롤해 두면 화면이 튀는 모습이 보이지 않는다
  const slot = target.open(thing);
  overlayFrozen = true;
  scrollSlotIntoView(slot.record);
  const spot = slotSpot(slot.record);
  void fadeOutOverlay(alive);
  await flyTo(spot.cx, spot.cy, 0.5, 1100);
  if (!alive()) return;
  await animate(bob, LAND, 260);
  if (!alive()) return;

  if (spec.question) {
    const reply = await ask(spec.question.text(thing), spec.question.labels);
    if (!alive()) return;
    if (reply === 'no' && spec.question.sulkOnNo) {
      // 입력할 곳·방법을 몰라 사용자가 "아니에요"를 누르면 삐져서 등을 돌리고, 직접 적을지 다시 말할지 묻는다
      await sulk(alive);
      if (!alive()) return;
      const choice = await ask('모르겠어요', ['직접 적기', '다시 말하기'], false);
      if (!alive()) return;
      await (choice === 'yes' ? goManual(alive) : goRetry(alive));
      return;
    }
    if (spec.question.resolve) thing = spec.question.resolve(thing, reply);
    await animate(bob, NOD, 480);
    if (!alive()) return;
  }

  await target.write(slot, thing, alive);
  if (!alive()) return;
  await vanish();
  if (alive()) render('default');
}

// ---------- 글자 크기 (설계도 10.2): 70~200%, 10%씩 14단계, 기본 100% ----------
// 앱에서는 모든 글자가 하나의 크기 함수를 거쳐 fontSize 에 곱해진다. 여백 · 아이콘은 절반만 커진다(미리보기에는 아직 적용하지 않았다).
const FONT_MIN = 70;
const FONT_MAX = 200;
const FONT_STEP = 10;
const FONT_STEPS = Array.from({ length: (FONT_MAX - FONT_MIN) / FONT_STEP + 1 }, (_, index) => FONT_MIN + index * FONT_STEP);
// percent: 앱 안에서 정한 크기, follow: 기기 설정 따르기, system: (디자인 확인용) 지금 기기 설정의 글자 크기
const fontState = { percent: 100, follow: false, system: 100 };
const clampFontPercent = value => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(value / FONT_STEP) * FONT_STEP));
// 기기 설정을 따를 때는 기기 크기만 쓴다. 앱 크기와 곱하지 않는다 (설계도 10.2).
const effectiveFontPercent = () => (fontState.follow ? clampFontPercent(fontState.system) : fontState.percent);

function loadFontScale() {
  try {
    const savedPercent = Number(localStorage.getItem('fontPercent'));
    const legacyPercent = Number(localStorage.getItem('fontScale')) * 100; // 예전 3단계(0.9 / 1 / 1.2) 값을 옮긴다
    if (FONT_STEPS.includes(savedPercent)) fontState.percent = savedPercent;
    else if (legacyPercent > 0) fontState.percent = clampFontPercent(legacyPercent);
    fontState.follow = localStorage.getItem('fontFollow') === '1';
  } catch {
    /* 미리보기에서 저장된 값을 못 읽어도 기본 100% 로 둔다 */
  }
  return effectiveFontPercent() / 100;
}

function applyFontScale(scale, save) {
  document.documentElement.style.setProperty('--fs', String(scale));
  if (save) {
    try {
      localStorage.setItem('fontPercent', String(fontState.percent));
      localStorage.setItem('fontFollow', fontState.follow ? '1' : '0');
    } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  }
  renderFontPage();
  settlePet();
}

function setFontPercent(percent) {
  fontState.percent = clampFontPercent(percent);
  applyFontScale(effectiveFontPercent() / 100, true);
}

function setFontFollow(follow) {
  fontState.follow = follow;
  applyFontScale(effectiveFontPercent() / 100, true);
}

function setSystemFont(percent) {
  fontState.system = percent;
  applyFontScale(effectiveFontPercent() / 100, false);
}

// 글자 크기 화면 + 설정 줄의 현재 값. 화면이 아직 없는 시점에 불려도 안전하다.
function renderFontPage() {
  const percent = effectiveFontPercent();
  const index = FONT_STEPS.indexOf(percent);
  const locked = fontState.follow;
  byId('fontValue').textContent = `${percent}%${locked ? ' · 기기 설정' : ''}`;
  byId('fontPercentLabel').textContent = `${percent}%`;
  byId('fontSliderFill').style.flexGrow = String(index);
  byId('fontSliderRest').style.flexGrow = String(FONT_STEPS.length - 1 - index);
  const slider = byId('fontSlider');
  slider.setAttribute('aria-valuenow', String(percent));
  slider.setAttribute('aria-valuetext', `${percent}%`);
  slider.setAttribute('aria-disabled', String(locked));
  slider.tabIndex = locked ? -1 : 0;
  slider.classList.toggle('disabled', locked);
  setDisabled('fontMinus', locked || percent <= FONT_MIN);
  setDisabled('fontPlus', locked || percent >= FONT_MAX);
  setDisabled('fontReset', locked || percent === 100);
  setSwitch('rowFontFollow', 'fontFollowToggle', fontState.follow, false);
  byId('fontSystemLine').textContent = `지금 기기의 글자 크기: ${fontState.system}%${fontState.system !== clampFontPercent(fontState.system) ? ` (앱에서는 ${clampFontPercent(fontState.system)}%까지만 써요)` : ''}`;
  highlight('[data-fontsys]', button => Number(button.dataset.fontsys) === fontState.system);
  highlight('[data-fontset]', button => !fontState.follow && Number(button.dataset.fontset) === fontState.percent);
}

// ---------- 색 고르기: 포인트 색 + 바탕색 두 가지만 고르면 나머지는 자동으로 만든다 ----------
// 라이트/다크 모드 대신 사용자가 직접 고른다. 밝은 바탕이든 어두운 바탕이든 글자 대비가 모자라지 않게 보정한다.
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const rgbToHex = rgb => `#${rgb.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
// a 에서 b 쪽으로 amount(0~1)만큼 섞는다
const mix = (a, b, amount) => {
  const from = hexToRgb(a), to = hexToRgb(b);
  return rgbToHex(from.map((value, index) => value * (1 - amount) + to[index] * amount));
};
const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToHex(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = (hue / 60) % 6;
  const second = chroma * (1 - Math.abs((part % 2) - 1));
  const [r, g, b] = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second], [0, second, chroma], [second, 0, chroma], [chroma, 0, second]][Math.floor(part)];
  const offset = lightness - chroma / 2;
  return rgbToHex([r + offset, g + offset, b + offset].map(value => value * 255));
}

// fg 가 bg 위에서 min 대비를 못 넘으면, 색상과 채도는 그대로 두고 밝기만 조금씩 옮겨 맞춘다 (검정과 섞는 방식보다 색이 탁해지지 않는다).
// direction: -1 = 어둡게, +1 = 밝게. 같은 글자색이 여러 면 위에 놓일 때는 방향을 하나로 정해서 서로 엇갈리지 않게 한다.
function ensureContrast(fg, bg, min, direction = luminance(bg) > 0.18 ? -1 : 1) {
  if (contrastRatio(fg, bg) >= min) return fg;
  const [hue, saturation, lightness] = hexToHsl(fg);
  for (let step = 1; step <= 40; step++) {
    const candidate = hslToHex(hue, saturation, Math.min(1, Math.max(0, lightness + direction * step * 0.025)));
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return direction < 0 ? '#000000' : '#FFFFFF';
}

const ensureOnAll = (fg, backgrounds, min, direction) => backgrounds.reduce((color, bg) => ensureContrast(color, bg, min, direction), fg);

// 글자(검정/흰색)가 4.5 대비를 낼 수 있는 밝기 안으로 면을 맞춘다. 중간 밝기 바탕에서 면들이 서로 다른 쪽으로 치우치지 않게 한다.
function fitSurface(color, light) {
  let result = color;
  for (let step = 0; step < 20; step++) {
    const lum = luminance(result);
    if (light ? lum >= 0.19 : lum <= 0.17) break;
    result = mix(result, light ? '#FFFFFF' : '#000000', 0.1);
  }
  return result;
}

function buildPalette(accentColor, base) {
  const light = luminance(base) > 0.18; // 밝은 바탕이면 어두운 글자, 어두운 바탕이면 밝은 글자
  const textDir = light ? -1 : 1;
  const canvas = base;
  const paper = fitSurface(light ? mix(base, '#FFFFFF', 0.65) : mix(base, '#FFFFFF', 0.06), light);
  const inputFill = fitSurface(light ? mix(paper, '#000000', 0.05) : mix(paper, '#000000', 0.12), light);
  const reviewFill = fitSurface(mix(paper, accentColor, 0.12), light);
  const nowFill = fitSurface(mix(canvas, accentColor, 0.16), light);
  const surfaces = [canvas, paper, inputFill, reviewFill];
  const inkSeed = light ? mix(accentColor, '#000000', 0.82) : mix(accentColor, '#FFFFFF', 0.9);
  const ink = ensureOnAll(inkSeed, surfaces, 10, textDir);
  const line = mix(canvas, ink, 0.13);
  const muted = ensureOnAll(mix(ink, canvas, 0.38), surfaces, 4.5, textDir);
  const accent = ensureOnAll(accentColor, surfaces, 4.5, textDir);
  const placeholder = ensureContrast(mix(ink, inputFill, 0.45), inputFill, 4.5, textDir);
  const danger = ensureOnAll('#C0392B', surfaces, 4.5, textDir);

  // 버튼·히어로 면: 포인트 색 그대로 두고, 그 위 글자는 흰색/짙은색 중 잘 보이는 쪽. 그래도 모자라면 면의 밝기를 조금 조정한다.
  const darkText = mix(accentColor, '#000000', 0.85);
  const onPrimary = contrastRatio('#FFFFFF', accentColor) >= contrastRatio(darkText, accentColor) ? '#FFFFFF' : darkText;
  const fillDir = luminance(onPrimary) > 0.5 ? -1 : 1; // 글자가 흰색이면 면을 어둡게, 짙은색이면 면을 밝게
  const primaryFill = ensureContrast(accentColor, onPrimary, 4.5, fillDir);
  const heroMuted = ensureContrast(mix(onPrimary, primaryFill, 0.3), primaryFill, 4.5, -fillDir);

  const petBody = light ? '#17151C' : '#050507';
  const petRim = light ? petBody : ensureContrast(mix(canvas, '#FFFFFF', 0.5), canvas, 3, 1);

  return {
    ink, muted, accent, primaryFill, onPrimary, canvas, paper, line, danger, inputFill, placeholder,
    heroFill: primaryFill, heroInk: onPrimary, heroMuted, reviewFill, nowFill,
    dangerFill: mix(paper, danger, 0.1), dangerLine: mix(paper, danger, 0.4),
    overlayFill: `${canvas}EE`, petBody, petRim, petEye: '#FFFFFF',
  };
}

const ACCENT_PRESETS = [['연보라', '#B8A7F2'], ['분홍', '#F2A7C8'], ['하늘', '#9CCBF2'], ['민트', '#9DE0C6'], ['살구', '#F5BC9A'], ['진보라', '#6D56C9']];
const BASE_PRESETS = [['연보라', '#F4F1FB'], ['흰색', '#FFFFFF'], ['크림', '#F7F2E8'], ['연회색', '#F1F2F5'], ['밤', '#18161F']];
const DEFAULT_COLORS = { accent: ACCENT_PRESETS[0][1], base: BASE_PRESETS[0][1] };
let colors = { ...DEFAULT_COLORS };
const swatchRefs = {};

function loadColors() {
  try {
    const saved = JSON.parse(localStorage.getItem('themeColors'));
    const valid = value => typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
    return saved && valid(saved.accent) && valid(saved.base) ? { accent: saved.accent.toUpperCase(), base: saved.base.toUpperCase() } : { ...DEFAULT_COLORS };
  } catch {
    return { ...DEFAULT_COLORS };
  }
}

// 고른 색 견본에 테두리를 붙이고, 직접 고른 색이면 "직접 고르기" 칸을 눌린 모양으로
function updateSwatches() {
  Object.entries(swatchRefs).forEach(([key, ref]) => {
    const presets = key === 'accent' ? ACCENT_PRESETS : BASE_PRESETS;
    let matched = false;
    ref.buttons.forEach((button, index) => {
      const on = presets[index][1] === colors[key];
      matched = matched || on;
      button.classList.toggle('swatchOn', on);
      button.setAttribute('aria-pressed', String(on));
    });
    ref.custom.classList.toggle('swatchCustomOn', !matched);
    if (ref.input.value.toUpperCase() !== colors[key]) ref.input.value = colors[key];
  });
}

function applyColors(next, save) {
  colors = { accent: next.accent.toUpperCase(), base: next.base.toUpperCase() };
  Object.entries(buildPalette(colors.accent, colors.base)).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key}`, value));
  updateSwatches();
  if (save) {
    try { localStorage.setItem('themeColors', JSON.stringify(colors)); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
  }
}

// 견본 줄: 프리셋 동그라미들 + 마지막에 색 선택기(직접 고르기). 선택기는 한 번만 만들어 둔다 (고르는 동안 다시 그리면 닫혀 버린다)
function buildSwatchRow(rowId, key, label, presets) {
  const buttons = presets.map(([name, color]) => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.setAttribute('aria-label', `${label} ${name}`);
    const dot = document.createElement('div');
    dot.className = 'swatchDot';
    dot.style.backgroundColor = color;
    button.append(dot);
    button.addEventListener('click', () => applyColors({ ...colors, [key]: color }, true));
    return button;
  });
  const custom = document.createElement('div');
  custom.className = 'swatchCustom';
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'colorInput';
  input.setAttribute('aria-label', `${label} 직접 고르기`);
  input.addEventListener('input', () => applyColors({ ...colors, [key]: input.value }, true));
  custom.append(input);
  byId(rowId).replaceChildren(...buttons, custom);
  swatchRefs[key] = { buttons, custom, input };
}

// ======================================================================
// 요금제 · 설정 · 가족·친구 (백엔드 연결 전 목업)
// 아래 데이터는 앱의 실제 타입이 아직 없다. 백엔드 설계가 정해지면 필드 이름이 바뀔 수 있는 "임시 형태"이다.
// 알림 값은 앱의 Reminder.relativeOffsetMinutes 와 같은 부호 규칙: 0 = 정시, -60 = 1시간 전.
// ======================================================================
const REMINDER_OFFSETS = [0, -10, -30, -60, -1440];
const reminderLabel = minutes => (minutes === 0 ? '정시' : minutes === -60 ? '1시간 전' : minutes === -1440 ? '하루 전' : `${Math.abs(minutes)}분 전`);
const reminderListLabel = list => (list.length ? [...list].sort((a, b) => b - a).map(reminderLabel).join(', ') : '알림 없음');

// 받기 방식(수신 모드): 받는 사람이 친구별 · 종류별(일정 / 지출)로 정한다. 값 이름은 설계도 12.3 과 같다.
// 서버가 도착 시점에 이 값으로 처리 방식을 정한다. 보내는 사람에게는 "받지 않기"만 (보내기 화면의 비활성 표시로) 보인다.
const RECEIVE_MODE_KEYS = ['ASK', 'ALWAYS_ADD', 'ALWAYS_VIEW', 'NOT_ALLOWED'];
const RECEIVE_LABEL = { ASK: '매번 묻기', ALWAYS_ADD: '항상 넣기', ALWAYS_VIEW: '항상 확인만', NOT_ALLOWED: '받지 않기' };
// 첫 연결 때 묻는 세 가지 (설계도 5.3). "받지 않기"는 친구 상세에서만 고른다.
const FIRST_CONNECT_MODES = ['ASK', 'ALWAYS_ADD', 'ALWAYS_VIEW'];
const KIND_INFO = {
  EVENT: { noun: '일정', addTo: '캘린더', addLabel: '캘린더에 넣기', addedNotice: '캘린더에 넣었어요', alwaysAdd: '항상 캘린더에 넣기', modeField: 'receiveEvent', theirField: 'theirReceiveEvent' },
  EXPENSE: { noun: '지출', addTo: '지출', addLabel: '지출에 넣기', addedNotice: '지출에 넣었어요', alwaysAdd: '항상 지출에 넣기', modeField: 'receiveExpense', theirField: 'theirReceiveExpense' },
};
const RELATION_LABEL = { FAMILY: '가족', FRIEND: '친구' };
const FRIEND_LIMIT = 30; // 보낸 요청 대기 중인 사람도 센다 (설계도 5.2)
const INBOX_DAYS = 30; // "확인만" 항목이 수신함에 머무는 날수 (설계도 6.3)
const DAILY_ADD_LIMIT = 20; // 한 보낸 사람이 같은 받는 사람에게 하루에 "항상 넣기"로 자동 처리되는 최대 건수 (설계도 6.3)

function receiveHint(kind, mode) {
  const noun = KIND_INFO[kind].noun;
  if (mode === 'ASK') return `${noun}이 오면 알려 주고, 넣을지 확인만 할지 내가 정해요.`;
  if (mode === 'ALWAYS_ADD') return kind === 'EVENT' ? '받는 즉시 내 캘린더에 들어가고 알림이 예약돼요.' : '받는 즉시 내 지출에 들어가요.';
  if (mode === 'ALWAYS_VIEW') return `수신함에만 ${INBOX_DAYS}일 동안 보관해요. 나중에 직접 넣을 수 있어요.`;
  return `이 사람이 보내는 ${noun}은 받지 않아요. 상대의 보내기 화면에는 "이 친구는 받기를 꺼 두었어요"라고만 보여요.`;
}

function firstConnectLabel(kind, mode) {
  return mode === 'ASK' ? '매번 물어보기' : mode === 'ALWAYS_ADD' ? KIND_INFO[kind].alwaysAdd : RECEIVE_LABEL[mode];
}

// ---------- 계정(요금제) 상태 ----------
// 플랜(설계도 9.1): 무료(체험) · 기본 월 2,900원 · 플러스 월 7,900원(부가세 포함). 한도는 서버가 정하고 앱은 보여 주기만 한다.
// aiUsed/aiLimit: 체험(평생) 또는 이번 결제 주기(월) 사용량. dayUsed/dayLimit: 오늘(KST) 사용량, 자정에 초기화.
// periodStartDaysAgo: 결제 주기 시작일(구매일 기준). 월 한도는 이 날로부터 1개월마다 초기화된다.
// shareTrial: 공유 체험 남은 횟수(무료 회원만). expired: 구독이 끝나 무료로 돌아온 상태.
const PLAN_INFO = {
  FREE: { name: '무료', price: '0원' },
  BASIC: { name: '기본', price: '월 2,900원' },
  PLUS: { name: '플러스', price: '월 7,900원' },
};
const PLAN_FEATURES = {
  FREE: [['on', 'AI 해석 체험 3회 (평생, 사용한 횟수는 다시 채워지지 않아요)'], ['on', '공유 체험 1회 (일정만, 받는 사람 1명)'], ['on', '백업 · 친구 · 일정과 지출 받기'], ['on', '직접 입력은 제한 없음'], ['off', '일정 · 지출 보내기 (구독 전용)']],
  BASIC: [['on', 'AI 해석 매달 150회, 하루 20회'], ['on', '일정 · 지출 보내기 하루 50건'], ['on', '받는 사람의 알림 시각 정하기'], ['on', '구독 중에는 체험 횟수를 쓰지 않고 남겨 둬요']],
  PLUS: [['on', 'AI 해석 매달 500회, 하루 40회'], ['on', '일정 · 지출 보내기 하루 50건'], ['on', '기본의 모든 기능']],
};
const PLAN_KEY = { FREE: 'free', BASIC: 'basic', PLUS: 'plus' };
const ACCOUNT_PRESETS = {
  free: { plan: 'FREE', aiUsed: 1, aiLimit: 3, dayUsed: 0, dayLimit: null, limitKind: 'LIFETIME', shareTrial: 1, periodStartDaysAgo: 0, expired: false },
  freeOut: { plan: 'FREE', aiUsed: 3, aiLimit: 3, dayUsed: 0, dayLimit: null, limitKind: 'LIFETIME', shareTrial: 0, periodStartDaysAgo: 0, expired: false },
  basic: { plan: 'BASIC', aiUsed: 118, aiLimit: 150, dayUsed: 7, dayLimit: 20, limitKind: 'MONTHLY', shareTrial: null, periodStartDaysAgo: 12, expired: false },
  basicOut: { plan: 'BASIC', aiUsed: 150, aiLimit: 150, dayUsed: 7, dayLimit: 20, limitKind: 'MONTHLY', shareTrial: null, periodStartDaysAgo: 12, expired: false },
  basicDayOut: { plan: 'BASIC', aiUsed: 118, aiLimit: 150, dayUsed: 20, dayLimit: 20, limitKind: 'MONTHLY', shareTrial: null, periodStartDaysAgo: 12, expired: false },
  plus: { plan: 'PLUS', aiUsed: 412, aiLimit: 500, dayUsed: 15, dayLimit: 40, limitKind: 'MONTHLY', shareTrial: null, periodStartDaysAgo: 20, expired: false },
  // 구독이 끝난 뒤: 남은 체험이 있으면 다시 쓸 수 있다 (설계도 9.1). 이미 보낸 항목의 수정·취소, 받은 항목, 친구, 받기 설정, 백업은 그대로 (9.3).
  expired: { plan: 'FREE', aiUsed: 1, aiLimit: 3, dayUsed: 0, dayLimit: null, limitKind: 'LIFETIME', shareTrial: 1, periodStartDaysAgo: 0, expired: true },
};
let accountKey = 'free';
let account = { ...ACCOUNT_PRESETS.free };
const isPaid = () => account.plan !== 'FREE';
const monthRemaining = () => Math.max(0, account.aiLimit - account.aiUsed);
const dayRemaining = () => (account.dayLimit === null ? Infinity : Math.max(0, account.dayLimit - account.dayUsed));
// 지금 쓸 수 있는 AI 해석 횟수: 체험은 평생 남은 횟수, 구독은 이번 달과 오늘 중 적은 쪽
const aiRemaining = () => Math.min(monthRemaining(), dayRemaining());
// 막힌 이유: 'TRIAL'(체험 소진) · 'MONTH'(월 한도) · 'DAY'(하루 한도) · null(사용 가능)
const aiBlock = () => (monthRemaining() === 0 ? (account.limitKind === 'LIFETIME' ? 'TRIAL' : 'MONTH') : dayRemaining() === 0 ? 'DAY' : null);

function resetLabel() {
  const date = addMonths(addDays(startOfDay(new Date()), -account.periodStartDaysAgo), 1);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function usageView() {
  const ratio = account.aiUsed / account.aiLimit;
  if (account.limitKind === 'LIFETIME') {
    return { label: '무료 체험 AI 해석', number: String(monthRemaining()), unit: '회 남음', ratio, caption: `체험 ${account.aiLimit}회 중 ${account.aiUsed}회 사용 · 사용한 횟수는 다시 채워지지 않아요`, extra: account.shareTrial ? '공유 체험 1회 남음 (일정만, 받는 사람 1명)' : '공유 체험을 모두 썼어요' };
  }
  const today = dayRemaining() === 0 ? `오늘 ${account.dayLimit}회를 모두 썼어요. 내일 0시에 다시 쓸 수 있어요.` : `오늘 ${account.dayUsed} / ${account.dayLimit}회 사용 · 내일 0시에 초기화돼요`;
  return { label: '이번 달 AI 해석', number: String(monthRemaining()), unit: '회 남음', ratio, caption: `${account.aiUsed} / ${account.aiLimit}회 사용 · ${resetLabel()}에 초기화돼요`, extra: today };
}

// 홈 한 줄: 막혔으면 이유와 언제 다시 쓰는지, 아니면 남은 횟수
function usageLine() {
  const block = aiBlock();
  if (block === 'TRIAL') return 'AI 해석 체험을 모두 썼어요. 직접 입력은 계속 쓸 수 있어요.';
  if (block === 'MONTH') return `이번 달 AI 해석을 모두 썼어요. ${resetLabel()}에 다시 채워져요. 직접 입력은 계속 쓸 수 있어요.`;
  if (block === 'DAY') return '오늘 AI 해석을 모두 썼어요. 내일 0시에 다시 채워져요. 직접 입력은 계속 쓸 수 있어요.';
  return account.limitKind === 'LIFETIME' ? `AI 해석 체험 ${monthRemaining()}회 남음` : `AI 해석 오늘 ${dayRemaining()}회 · 이번 달 ${monthRemaining()}회 남음`;
}

// 구독하기: 실제로는 스토어 결제 화면 → 영수증을 서버가 검증한 뒤에만 권한이 열린다 (설계도 9.4). 여기서는 결과만 흉내 낸다.
// 기본 → 플러스는 이번 주기 사용량이 이어지고 한도만 커진다 (설계도 9.1).
function subscribe(planKey) {
  const key = PLAN_KEY[planKey];
  const next = { ...ACCOUNT_PRESETS[key] };
  if (isPaid()) {
    next.aiUsed = account.aiUsed;
    next.dayUsed = account.dayUsed;
    next.periodStartDaysAgo = account.periodStartDaysAgo;
  } else {
    next.aiUsed = 0;
    next.dayUsed = 0;
    next.periodStartDaysAgo = 0;
  }
  accountKey = key;
  account = next;
  planNotice = `${PLAN_INFO[planKey].name} 구독이 시작됐어요.`;
  renderAccountViews();
}

// 구매 복원 결과 (목업: 디자인 확인용 버튼이 결과를 고른다). 설계도 9.4
let restoreOutcome = 'NONE';
let planNotice = '';
let pendingPlanReason = '';

function restorePurchase(outcome) {
  restoreOutcome = outcome ?? restoreOutcome;
  if (restoreOutcome === 'FOUND') {
    if (isPaid()) {
      planNotice = '이미 구독 중이에요.';
    } else {
      subscribe('BASIC');
      planNotice = '구독을 복원했어요.';
    }
  } else if (restoreOutcome === 'OTHER') {
    planNotice = '다른 계정에서 사용 중인 구독이에요.';
  } else {
    planNotice = '복원할 구독을 찾지 못했어요.';
  }
  renderAccountViews();
}

const PLAN_REASONS = {
  trial: 'AI 해석 체험을 모두 썼어요. 구독하면 계속 쓸 수 있어요.',
  month: '이번 달 AI 해석 한도를 모두 썼어요. 플러스는 매달 500회예요.',
  day: '오늘 AI 해석 한도를 모두 썼어요. 내일 0시에 다시 쓸 수 있고, 플러스는 하루 40회예요.',
  send: '보내기는 구독 기능이에요. 공유 체험 1회를 이미 썼어요.',
};

// 요금제 화면으로 가는 입구: 왜 왔는지 위에 한 줄 보여 준다 (설계도 9.2 진입 경로)
function openPlan(reason) {
  pendingPlanReason = reason ?? '';
  openPage('plan');
  renderPlanPage();
}

// ---------- 사람 목록 (목업) ----------
// nickname: 상대가 정한 실제 닉네임. alias: 내가 붙인 표시 이름(내 화면에서만 보인다, 비우면 닉네임으로 돌아간다).
// receiveEvent / receiveExpense: 이 사람이 보낸 일정 · 지출을 내가 처리하는 방식.
// theirReceiveEvent / theirReceiveExpense: 상대가 내가 보내는 것을 처리하는 방식. 보내는 쪽에는 "받지 않기"만 공개된다(보내기 화면에서 비활성).
// deliversNow: 목업 전용. 상대 앱이 바로 가져가면 "전달 완료", 아니면 "전달 대기 중"으로 보인다.
// withdrawn: 탈퇴한 사용자. 마지막 표시 이름 뒤에 "(탈퇴)"를 붙여 보여 준다.
const mockPeople = [
  { id: 'p-mom', photo: { tone: 0, zoom: 1, x: 0, y: 0 }, nickname: 'mom_kim', alias: '어머니', relation: 'FAMILY', status: 'CONNECTED', receiveEvent: 'ALWAYS_ADD', receiveExpense: 'ASK', theirReceiveEvent: 'ALWAYS_ADD', theirReceiveExpense: 'ASK', deliversNow: true, defaultReminders: [-60, -1440], withdrawn: false, notifyArrival: true, notifyEventTime: true, hiddenAll: false, inAudience: false },
  { id: 'p-dad', nickname: 'dad1962', alias: '아버지', relation: 'FAMILY', status: 'CONNECTED', receiveEvent: 'ASK', receiveExpense: 'ASK', theirReceiveEvent: 'ASK', theirReceiveExpense: 'ASK', deliversNow: false, defaultReminders: [-60], withdrawn: false, notifyArrival: true, notifyEventTime: true, hiddenAll: false, inAudience: false },
  { id: 'p-minsu', photo: { tone: 1, zoom: 1.4, x: 20, y: -10 }, nickname: 'sky_77', alias: '큰아들 민수', relation: 'FRIEND', status: 'CONNECTED', receiveEvent: 'ASK', receiveExpense: 'ASK', theirReceiveEvent: 'ASK', theirReceiveExpense: 'ASK', deliversNow: false, defaultReminders: [-30], withdrawn: false, notifyArrival: true, notifyEventTime: true, hiddenAll: false, inAudience: false },
  { id: 'p-jieun', nickname: 'jieun_p', alias: '', relation: 'FRIEND', status: 'CONNECTED', receiveEvent: 'NOT_ALLOWED', receiveExpense: 'ASK', theirReceiveEvent: 'NOT_ALLOWED', theirReceiveExpense: 'ASK', deliversNow: true, defaultReminders: [-30], withdrawn: false, notifyArrival: true, notifyEventTime: true, hiddenAll: false, inAudience: false },
];
const mockFriendRequests = [{ id: 'fr-1', nickname: 'junho_p' }];
// 받았지만 아직 정하지 않은 항목 (받기 방식이 "매번 묻기"일 때). 일정은 startAt, 지출은 amount · category.
const mockReceived = [{ id: 'rc-1', kind: 'EVENT', fromId: 'p-minsu', title: '저녁 약속', startAt: atTime(dayStart(3), 19, 0), offsets: [-60] }];
// 수신함: "확인만" 처리된 항목. daysLeft 일이 지나면 자동 삭제된다.
const mockInbox = [
  { id: 'ib-1', kind: 'EVENT', fromId: 'p-dad', title: '병원 검진', startAt: atTime(dayStart(5), 9, 30), offsets: [-1440], daysLeft: 27 },
  { id: 'ib-2', kind: 'EXPENSE', fromId: 'p-mom', title: '가족 외식', amount: 45000, category: '식비', daysLeft: 12 },
];
// 보낸 항목: 보낸 사람에게는 4가지 전달 상태만 보인다 (설계도 6.4). 받는 사람이 넣었는지 확인만 했는지는 알 수 없다.
const SEND_STATUS_LABEL = { PENDING: '전달 대기 중', DELIVERED: '전달 완료', EXPIRED: '만료됨', CANCELED: '취소됨' };
const mockSent = [
  { id: 'sn-1', toId: 'p-mom', kind: 'EVENT', title: '병원 예약 안내', status: 'DELIVERED' },
  { id: 'sn-2', toId: 'p-minsu', kind: 'EVENT', title: '만나기', status: 'PENDING' },
  { id: 'sn-3', toId: 'p-dad', kind: 'EXPENSE', title: '12,000원 · 점심', status: 'EXPIRED' },
  { id: 'sn-4', toId: 'p-jieun', kind: 'EVENT', title: '독서 모임', status: 'CANCELED' },
];
const mockLinkNotices = []; // 내가 만든 링크로 누가 연결됐을 때 보이는 "OO님과 연결됐어요" 알림 (설계도 5.1)
// 차단 목록 (설계도 5.2 · 11.2 T8): shownName 은 차단할 때 내 화면에 보이던 이름, daysAgo 는 차단한 지 며칠 됐는지
const mockBlocked = [{ id: 'b-1', nickname: '광고봇', shownName: '광고봇', daysAgo: 12 }];
const snapshot = () => structuredClone({ people: mockPeople, requests: mockFriendRequests, received: mockReceived, inbox: mockInbox, sent: mockSent, blocked: mockBlocked });
const baseState = snapshot();
const MY_NICKNAME = 'voice_user';
const KNOWN_NICKNAMES = ['seoyeon_lee', 'hanbit_k', '봄날']; // 목업: 서버가 없어서 이 닉네임만 "찾아진다"
const formerNames = {}; // 연결을 끊은 사람의 마지막 표시 이름 (받은 항목의 출처 표시용)
const dailyAddCount = {}; // 보낸 사람별: 오늘 "항상 넣기"로 자동 처리된 건수
const alwaysChecked = new Set(); // 받은 카드에서 "항상 이렇게"가 체크된 항목 id
let friendCountOverride = null; // 디자인 확인용: 친구 수가 가득 찬 상태 흉내
let peopleNotice = '';

const connectedPeople = () => mockPeople.filter(person => person.status === 'CONNECTED');
const personById = id => mockPeople.find(person => person.id === id);
const displayName = person => `${person.alias || person.nickname}${person.withdrawn ? ' (탈퇴)' : ''}`;
const nameOfId = id => {
  const person = personById(id);
  return person ? displayName(person) : (formerNames[id] ?? '알 수 없는 사용자');
};
const friendCount = () => friendCountOverride ?? mockPeople.length;
const initialOf = name => Array.from(name)[0] ?? '?';

// ---------- 알림 설정 (설계도 8.2) ----------
// 우선순위: 전체 끔 > 친구별 설정 > 항목별 알림. 더 제한적인 설정이 적용된다.
// ownDefault: 새 일정의 기본 알림. 'NONE' 이면 없음. 문장에서 따로 말한 알림이 기본 알림보다 우선한다.
// lockTitle: 잠금 화면에 일정 제목 표시. 서버가 푸시 문구를 만들기 때문에 서버에도 저장된다.
const mockSettings = { allOn: true, ownOn: true, ownDefault: 0, lockTitle: true, sendAlsoDefault: false };
let notifPermission = 'GRANTED'; // 기기 알림 권한: 'GRANTED' | 'BLOCKED' (꺼지면 일정 카드에 "알림 꺼짐")
const DEFAULT_REMINDER_CHOICES = ['NONE', 0, -10, -30, -60];
const defaultReminderLabel = value => (value === 'NONE' ? '없음' : reminderLabel(value));

// 한국어 조사: "어머니가"(받침 없음) · "민수가" · "아들이"(받침 있음). 한글로 끝나지 않으면(영문 닉네임 등) "님이"로 안전하게 쓴다.
function withIga(name) {
  const code = Array.from(name).pop().charCodeAt(0);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return hangul ? `${name}${(code - 0xac00) % 28 === 0 ? '가' : '이'}` : `${name}님이`;
}
const koDate = date => `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
function koTime(date) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}시${minute ? ` ${minute}분` : ''}`;
}

// 도착 · 수정 · 취소 알림 문구 (설계도 8.3). 이름은 내가 붙인 표시 이름이 먼저. 제목 표시를 끄면 제목 없이 보여 준다.
// item: { kind, title, startAt(Date), amount }
function pushText(type, person, item, routed) {
  const who = withIga(displayName(person));
  const info = KIND_INFO[item.kind];
  const showTitle = mockSettings.lockTitle;
  if (type === 'ARRIVAL') {
    const detail = item.kind === 'EVENT' ? `${item.title} ${koDate(item.startAt)} ${koTime(item.startAt)}` : `${item.title} ${item.amount.toLocaleString('ko-KR')}원`;
    const auto = routed === 'ALWAYS_ADD' && showTitle ? `(${info.addTo}에 자동으로 들어가요)` : '';
    return `${who} ${info.noun}을 보냈어요${auto}${showTitle ? ` · ${detail}` : ''}`;
  }
  if (type === 'EDITED') return `${who} 일정을 수정했어요${showTitle ? ` · ${item.title} → ${koTime(item.startAt)}` : ''}`;
  return `${who} 일정을 취소했어요${showTitle ? ` · ${item.title}` : ''}`;
}

// 푸시가 실제로 울리지 않는 이유 (없으면 빈 문자열). 전체 끔 > 친구별 > 기기 권한 순
function silentReason(person) {
  if (!mockSettings.allOn) return '모든 알림이 꺼져 있어요';
  if (!person.notifyArrival) return '이 친구의 도착 알림이 꺼져 있어요';
  if (notifPermission === 'BLOCKED') return '기기의 알림 권한이 꺼져 있어요';
  return '';
}

function buildNotifPreview() {
  const sample = alias => ({ alias, nickname: alias, withdrawn: false });
  const when = atTime(dayStart(1), 15, 0);
  const rows = [
    ['항상 넣기로 도착', pushText('ARRIVAL', sample('어머니'), { kind: 'EVENT', title: '병원 예약', startAt: when }, 'ALWAYS_ADD')],
    ['매번 묻기로 도착', pushText('ARRIVAL', sample('민수'), { kind: 'EVENT', title: '만나기', startAt: atTime(dayStart(1), 19, 0) }, 'ASK')],
    ['지출 도착', pushText('ARRIVAL', sample('아들'), { kind: 'EXPENSE', title: '병원비', amount: 30000 }, 'ASK')],
    ['수정', pushText('EDITED', sample('민수'), { kind: 'EVENT', title: '만나기', startAt: atTime(dayStart(1), 20, 0) })],
    ['취소', pushText('CANCELED', sample('민수'), { kind: 'EVENT', title: '만나기', startAt: when })],
    ['일정 시각', mockSettings.lockTitle ? '병원 예약 · 30분 후 (강남세브란스)' : '일정 알림 · 30분 후'],
  ];
  return rows.map(([label, text]) => makeDiv('previewRow', textElement('p', 'settingHint', label), textElement('p', 'text', text)));
}

function setSwitch(rowId, toggleId, on, disabled) {
  byId(toggleId).classList.toggle('toggleOn', on);
  byId(rowId).setAttribute('aria-checked', String(on));
  byId(rowId).classList.toggle('disabled', disabled);
}

function receiveSummary(field) {
  const people = connectedPeople();
  return RECEIVE_MODE_KEYS.map(key => `${RECEIVE_LABEL[key]} ${people.filter(person => person[field] === key).length}명`).join(' · ');
}

function renderNotifSettings() {
  const master = mockSettings.allOn;
  setSwitch('rowAll', 'allToggle', master, false);
  setSwitch('rowOwn', 'ownToggle', mockSettings.ownOn, !master);
  byId('ownReminderBlock').classList.toggle('disabled', !master || !mockSettings.ownOn);
  buildPills('ownReminderPills', DEFAULT_REMINDER_CHOICES, defaultReminderLabel, [mockSettings.ownDefault], value => {
    if (!master || !mockSettings.ownOn) return;
    mockSettings.ownDefault = value;
    renderAccountViews();
  });
  const off = connectedPeople().filter(person => !person.notifyArrival || !person.notifyEventTime).length;
  byId('friendNotifValue').textContent = off ? `${off}명 일부 꺼짐` : '모두 켜짐';
  setSwitch('rowLock', 'lockToggle', mockSettings.lockTitle, !master);
  byId('notifPreview').replaceChildren(...buildNotifPreview());
  const blocked = notifPermission === 'BLOCKED';
  byId('permValue').textContent = blocked ? '꺼짐' : '허용됨';
  show('permBlock', blocked);
  if (!blocked) show('permNote', false);
  // 보내기 · 받기 설정
  setSwitch('rowSendDefault', 'sendDefaultToggle', mockSettings.sendAlsoDefault, false);
  byId('receiveSummaryEvent').textContent = `일정: ${receiveSummary('receiveEvent')}`;
  byId('receiveSummaryExpense').textContent = `지출: ${receiveSummary('receiveExpense')}`;
}

// ---------- 요금제 화면 ----------
function renderPlanPage() {
  byId('planList').replaceChildren(...['FREE', 'BASIC', 'PLUS'].map(buildPlanCard));
  byId('planReason').textContent = pendingPlanReason ? PLAN_REASONS[pendingPlanReason] : '';
  show('planReasonBox', Boolean(pendingPlanReason));
  show('planExpiredBox', account.expired);
  byId('planNoticeText').textContent = planNotice;
  show('planNoticeBox', Boolean(planNotice));
  show('planManage', isPaid());
}

// ---------- 작은 부품 ----------
function makeButton(className, textClass, label, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.append(textElement('span', textClass, label));
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function makeDiv(className, ...children) {
  const element = document.createElement('div');
  element.className = className;
  element.append(...children);
  return element;
}

function makeAvatar(name, photo) {
  return photo ? buildPhotoAvatar(photo, 48) : makeDiv('avatar', textElement('p', 'avatarText', initialOf(name)));
}

// 알약 한 줄: values 중 selected 에 든 것이 눌린 모양. multi 이면 여러 개, 아니면 하나만.
function buildPills(containerId, values, labelOf, selected, onToggle) {
  byId(containerId).replaceChildren(...values.map(value => {
    const button = makeButton('pill', 'pillText', labelOf(value), () => onToggle(value));
    setActive(button, selected.includes(value), 'pillActive', 'pillTextActive');
    return button;
  }));
}

// ---------- 화면 전환 (앱에서는 Expo Router 의 화면 이동) ----------
const PAGES = {
  home: { id: 'homeScreen', title: 'Voice Life Manager' },
  settings: { id: 'settingsPage', title: '설정' },
  plan: { id: 'planPage', title: '요금제' },
  people: { id: 'peoplePage', title: '가족·친구' },
};
let currentPage = 'home';
const pageStack = [];

function showPage(name) {
  currentPage = name;
  if (name !== 'plan') {
    pendingPlanReason = '';
    planNotice = '';
  }
  Object.entries(PAGES).forEach(([key, page]) => show(page.id, key === name));
  byId('headerTitle').textContent = PAGES[name].title;
  show('backButton', name !== 'home' && !(TAB_PAGES.includes(name) && pageStack.length === 0));
  show('settingsOpen', TAB_PAGES.includes(name));
  highlight('[data-page]', button => button.dataset.page === name);
  renderTabBar(name);
  window.scrollTo(0, 0);
}

function openPage(name) {
  stopScenario();
  closeLayers();
  showSheet('settings', false);
  if (name === currentPage) return;
  pageStack.push(currentPage);
  showPage(name);
}

function goBack() {
  closeLayers();
  showPage(pageStack.pop() ?? 'home');
}

// 디자인 확인용 버튼: 어느 화면이든 바로 이동 (뒤로 가면 홈)
function jumpToPage(name) {
  stopScenario();
  closeLayers();
  showSheet('settings', false);
  pageStack.length = 0;
  if (name !== 'home') pageStack.push('home');
  pendingPlanReason = '';
  planNotice = '';
  showPage(name);
}

// ---------- 시트 ----------
const layerIds = ['addSheet', 'connectSheet', 'personSheet', 'sendSheet'];

function closeLayers() {
  stopLinkTimer();
  layerIds.forEach(id => show(id, false));
  show('layerBackdrop', false);
}

function openLayer(id) {
  closeLayers();
  show('layerBackdrop', true);
  show(id, true);
}

// ---------- 요금제 카드 ----------
function buildPlanCard(planKey) {
  const info = PLAN_INFO[planKey];
  const current = account.plan === planKey;
  const head = makeDiv('rowBetween', textElement('h2', 'planName', info.name));
  if (current) head.append(makeDiv('tag', textElement('p', 'tagText', '이용 중')));
  const features = makeDiv('featureList');
  PLAN_FEATURES[planKey].forEach(([kind, label]) => {
    const off = kind === 'off';
    features.append(makeDiv('featureLine', textElement('p', off ? 'featureMark featureOff' : 'featureMark', off ? '—' : '✓'), textElement('p', off ? 'featureText featureOff' : 'featureText', label)));
  });
  const card = makeDiv(current ? 'planCard planCardCurrent' : 'planCard', head, textElement('p', 'planPrice', info.price), features);
  if (planKey !== 'FREE') card.append(textElement('p', 'muted', '부가세 포함 · 스토어 인앱결제로만 결제해요.'));

  if (!current && planKey === 'FREE') {
    card.append(textElement('p', 'muted', '구독을 끝내면 무료로 돌아가요. 받은 항목 · 친구 · 백업은 그대로예요.'));
  } else if (!current) {
    const label = !isPaid() ? `${info.name} 구독하기` : planKey === 'PLUS' ? '플러스로 변경' : '기본으로 변경';
    card.append(makeButton('button', 'buttonText', label, () => subscribe(planKey)));
    if (isPaid() && planKey === 'PLUS') card.append(textElement('p', 'muted', '이번 달 사용량은 이어지고 한도만 커져요.'));
  }
  return card;
}

// ---------- 가족·친구 ----------
function buildRequestButtons(specs) {
  return makeDiv('buttonRow', ...specs.map(([label, primary, onClick]) => makeButton(primary ? 'smallButton' : 'smallSecondary', primary ? 'smallButtonText' : 'smallSecondaryText', label, onClick)));
}

const whenLine = date => `${dayLabel(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

function itemLine(item) {
  if (item.kind === 'EVENT') return whenLine(item.startAt);
  return `${item.amount.toLocaleString('ko-KR')}원${item.category ? ` · ${item.category}` : ''}`;
}

// 마지막에 화면 갱신: 사람 화면 · 설정의 요약 · 캘린더 · 홈의 지출 목록
function refreshAll() {
  renderAccountViews();
  renderCalendar();
  refreshHomeRecords();
}

function refreshHomeRecords() {
  const list = byId('recordList');
  const living = mockTransactions.filter(item => !item.deletedAt);
  list.replaceChildren(...living.map(renderRecord));
  list.hidden = living.length === 0;
  show('emptyCard', living.length === 0);
  renderSummary(todaySummary(mockTransactions), false);
}

// 받은 항목을 내 일정 · 지출에 넣는다. 항목에는 보낸 사람 id(fromId)만 붙이고, 이름은 보여 줄 때 찾는다 (별명을 바꾸면 바로 반영).
function addReceivedToMine(item) {
  if (item.kind === 'EVENT') {
    const event = makeEventAt(newId(3000), item.title, item.startAt, 60, null);
    event.fromId = item.fromId;
    event.reminders = [...(item.offsets ?? [])];
    mockEvents.push(event);
  } else {
    const now = new Date();
    const expense = makeTransaction(newId(3100), item.amount, item.category ?? null, item.title, 0, now.getHours(), now.getMinutes(), 'MANUAL', null);
    expense.fromId = item.fromId;
    const sender = personById(item.fromId);
    expense.includeInTotal = sender ? sender.includeExpenseInTotal !== false : true;
    mockTransactions.unshift(expense);
  }
}

// ---- 받은 카드 (설계도 6.3 매번 묻기) ----
function buildAlwaysRow(item) {
  const checked = alwaysChecked.has(item.id);
  const row = document.createElement('button');
  row.className = 'checkRow';
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', String(checked));
  const box = makeDiv(checked ? 'taskBox taskBoxDone' : 'taskBox');
  if (checked) box.append(textElement('p', 'taskCheck', '✓'));
  row.append(box, textElement('p', 'text', `${nameOfId(item.fromId)}님 ${KIND_INFO[item.kind].noun}은 항상 이렇게`));
  row.addEventListener('click', () => {
    if (checked) alwaysChecked.delete(item.id);
    else alwaysChecked.add(item.id);
    renderPeoplePage();
  });
  return row;
}

function resolveReceived(item, choice) {
  const person = personById(item.fromId);
  const info = KIND_INFO[item.kind];
  const always = alwaysChecked.has(item.id);
  mockReceived.splice(mockReceived.indexOf(item), 1);
  alwaysChecked.delete(item.id);
  if (choice === 'ADD') {
    addReceivedToMine(item);
    peopleNotice = `${info.addedNotice}: ${item.title}.`;
  } else {
    mockInbox.push({ ...item, daysLeft: INBOX_DAYS });
    peopleNotice = `수신함에 두었어요: ${item.title}. ${INBOX_DAYS}일 안에 넣을 수 있어요.`;
  }
  if (always) {
    person[info.modeField] = choice === 'ADD' ? 'ALWAYS_ADD' : 'ALWAYS_VIEW';
    peopleNotice += ` 앞으로 ${displayName(person)}님의 ${info.noun}은 ${choice === 'ADD' ? '항상 넣어요' : '항상 확인만 해요'}.`;
  }
  refreshAll();
}

function buildReceivedCard(item) {
  const info = KIND_INFO[item.kind];
  return makeDiv('requestCard',
    textElement('p', 'eyebrow', `받은 ${info.noun} · 보낸 사람 ${nameOfId(item.fromId)}`),
    textElement('p', 'heading', item.title),
    textElement('p', 'text', itemLine(item)),
    textElement('p', 'muted', item.kind === 'EVENT' ? `알림: ${reminderListLabel(item.offsets)}` : '내 지출 합계에 들어가요.'),
    buildRequestButtons([
      [info.addLabel, true, () => resolveReceived(item, 'ADD')],
      ['확인만', false, () => resolveReceived(item, 'VIEW')],
    ]),
    buildAlwaysRow(item),
    makeButton('linkButton', 'linkText', '이름 바꾸기', () => openPersonSheet(item.fromId)));
}

// ---- 첫 연결 · 친구 요청 ----
function buildFriendRequestCard(request) {
  return makeDiv('requestCard',
    textElement('p', 'eyebrow', '받은 친구 요청'),
    textElement('p', 'heading', `${request.nickname}님이 친구가 되고 싶어 해요`),
    buildRequestButtons([
      ['수락', true, () => {
        mockFriendRequests.splice(mockFriendRequests.indexOf(request), 1);
        const person = makePerson(request.nickname, 'CONNECTED');
        mockPeople.push(person);
        peopleNotice = '';
        renderAccountViews();
        openConnectSetup(person.id);
      }],
      ['거절', false, () => { mockFriendRequests.splice(mockFriendRequests.indexOf(request), 1); peopleNotice = ''; renderAccountViews(); }],
    ]));
}

function makePerson(nickname, status) {
  return { id: newId(4000), nickname, alias: '', relation: 'FRIEND', status, receiveEvent: 'ASK', receiveExpense: 'ASK', theirReceiveEvent: 'ASK', theirReceiveExpense: 'ASK', deliversNow: false, defaultReminders: [-30], withdrawn: false, notifyArrival: true, notifyEventTime: true, hiddenAll: false, inAudience: false };
}

function buildLinkNoticeCard(notice) {
  const person = personById(notice.personId);
  return makeDiv('requestCard',
    textElement('p', 'eyebrow', '내 링크로 연결됨'),
    textElement('p', 'heading', `${person ? displayName(person) : notice.name}님과 연결됐어요`),
    buildRequestButtons([
      ['확인', true, () => { mockLinkNotices.splice(mockLinkNotices.indexOf(notice), 1); renderPeoplePage(); }],
      ['연결 끊기', false, () => {
        mockLinkNotices.splice(mockLinkNotices.indexOf(notice), 1);
        if (person) detachPerson(person, '연결을 끊었어요');
        renderAccountViews();
      }],
    ]));
}

function detachPerson(person, message) {
  formerNames[person.id] = displayName(person);
  mockPeople.splice(mockPeople.indexOf(person), 1);
  peopleNotice = `${message}: ${displayName(person)}`;
}

function personHint(person) {
  return `일정 ${RECEIVE_LABEL[person.receiveEvent]} · 지출 ${RECEIVE_LABEL[person.receiveExpense]}`;
}

function buildPersonRow(person, last) {
  const lastClass = last ? ' personRowLast' : '';
  const name = displayName(person);
  // 표시 이름을 붙였으면 이름 아래에 실제 닉네임을 작게 보여 혼동을 막는다 (설계도 5.2)
  const nicknameLine = person.withdrawn ? '탈퇴한 사용자' : person.alias ? `닉네임 ${person.nickname}` : '';
  if (person.status === 'REQUEST_SENT') {
    const cancel = makeButton('linkButton', 'linkText', '취소', () => { mockPeople.splice(mockPeople.indexOf(person), 1); renderAccountViews(); });
    return makeDiv(`personRow personRowStatic${lastClass}`, makeAvatar(name),
      makeDiv('personMain', makeDiv('personTop', textElement('p', 'personName', name), makeDiv('tag', textElement('p', 'tagText', '요청 보냄'))), textElement('p', 'settingHint', '상대가 수락하면 연결돼요.')),
      cancel);
  }
  const main = makeDiv('personMain', makeDiv('personTop', textElement('p', 'personName', name), makeDiv('tag', textElement('p', 'tagText', RELATION_LABEL[person.relation]))));
  if (nicknameLine) main.append(textElement('p', 'nicknameLine', nicknameLine));
  main.append(textElement('p', 'settingHint', personHint(person)));
  const row = makeDiv(`personRow${lastClass}`, makeAvatar(name, person.withdrawn ? null : person.photo), main, textElement('p', 'chevron', '›'));
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `${name} 설정`);
  row.addEventListener('click', () => openPersonSheet(person.id));
  return row;
}

function buildInboxRow(item) {
  const info = KIND_INFO[item.kind];
  return makeDiv('inboxRow',
    makeDiv('resultMain',
      textElement('p', 'personName', item.title),
      textElement('p', 'settingHint', `${itemLine(item)} · 보낸 사람: ${nameOfId(item.fromId)}`),
      textElement('p', 'settingHint', `수신함에 ${item.daysLeft}일 남음`)),
    makeDiv('inboxButtons',
      makeButton('smallButton', 'smallButtonText', '넣기', () => {
        mockInbox.splice(mockInbox.indexOf(item), 1);
        addReceivedToMine(item);
        peopleNotice = `${info.addedNotice}: ${item.title}.`;
        refreshAll();
      }),
      makeButton('smallSecondary', 'smallSecondaryText', '삭제', () => {
        mockInbox.splice(mockInbox.indexOf(item), 1);
        peopleNotice = `수신함에서 삭제했어요: ${item.title}.`;
        renderAccountViews();
      })));
}

function buildSentRow(item) {
  const name = nameOfId(item.toId);
  return makeDiv('resultRow', makeAvatar(name),
    makeDiv('resultMain', textElement('p', 'personName', name), textElement('p', 'settingHint', `${KIND_INFO[item.kind].noun} · ${item.title}`)),
    makeDiv('tag', textElement('p', 'tagText', SEND_STATUS_LABEL[item.status])));
}

function renderPeoplePage() {
  const cards = [];
  if (peopleNotice) cards.push(makeDiv('notice', textElement('p', 'noticeText', peopleNotice)));
  mockLinkNotices.forEach(notice => cards.push(buildLinkNoticeCard(notice)));
  mockFriendRequests.forEach(request => cards.push(buildFriendRequestCard(request)));
  mockReceived.forEach(item => cards.push(buildReceivedCard(item)));
  byId('incomingBox').replaceChildren(...cards);
  byId('friendCount').textContent = `친구 ${friendCount()}/${FRIEND_LIMIT}명`;
  const list = mockPeople.length
    ? mockPeople.map((person, index) => buildPersonRow(person, index === mockPeople.length - 1))
    : [textElement('p', 'agendaEmpty', '아직 연결된 사람이 없어요. 위의 "친구 추가"로 시작해 보세요.')];
  byId('peopleList').replaceChildren(...list);
  const inboxRows = mockInbox.map(buildInboxRow);
  const sentRows = mockSent.map(buildSentRow);
  if (inboxRows.length) inboxRows[inboxRows.length - 1].classList.add('rowLast');
  if (sentRows.length) sentRows[sentRows.length - 1].classList.add('rowLast');
  byId('inboxList').replaceChildren(...(inboxRows.length ? inboxRows : [textElement('p', 'agendaEmpty', `"확인만"으로 둔 항목이 ${INBOX_DAYS}일 동안 여기에 머물러요.`)]));
  byId('sentList').replaceChildren(...(sentRows.length ? sentRows : [textElement('p', 'agendaEmpty', '아직 보낸 항목이 없어요.')]));
}

// ---------- 항목 도착 흉내 (디자인 확인용): 서버가 받기 방식으로 처리 방식을 정하는 규칙을 그대로 따른다 ----------
const ARRIVALS = {
  EVENT: [['치과 예약', 2, 15, 0], ['동창회', 6, 18, 30], ['돌잔치', 9, 12, 0]],
  EXPENSE: [['가족 외식', 45000, '식비'], ['생일 선물', 32000, null]],
};
const arrivalCounter = { EVENT: 0, EXPENSE: 0 }; // 종류별로 돌려 가며 다른 예시를 보여 준다

function makeArrival(person, kind) {
  const spec = ARRIVALS[kind][arrivalCounter[kind]++ % ARRIVALS[kind].length];
  return kind === 'EVENT'
    ? { id: newId(5000), kind, fromId: person.id, title: spec[0], startAt: atTime(dayStart(spec[1]), spec[2], spec[3]), offsets: [-60] }
    : { id: newId(5100), kind, fromId: person.id, title: spec[0], amount: spec[1], category: spec[2] };
}

function arrivalNotice(person, item, routed, over) {
  const info = KIND_INFO[item.kind];
  const route = routed === 'ASK' ? '아래 카드에서 정해 주세요.' : routed === 'ALWAYS_ADD' ? `${info.addedNotice}.` : '수신함에 있어요.';
  const silent = silentReason(person);
  if (silent) return `알림 없이 도착했어요(${silent}). ${route}`;
  if (over) return `알림: ${displayName(person)}님이 오늘 많은 ${info.noun}을 보냈어요. 수신함에서 확인하세요.`;
  return `알림: ${pushText('ARRIVAL', person, item, routed)} ${route}`;
}

function simulateArrival(personId, kind, forceOver) {
  const person = personById(personId);
  if (!person) return;
  const info = KIND_INFO[kind];
  const mode = person[info.modeField];
  if (mode === 'NOT_ALLOWED') return; // 실제로는 서버가 보내기 단계에서 막는다 (보내는 사람 화면에서 비활성)
  if (forceOver) dailyAddCount[personId] = DAILY_ADD_LIMIT;
  const item = makeArrival(person, kind);
  let routed = mode;
  let over = false;
  if (mode === 'ALWAYS_ADD') {
    if ((dailyAddCount[personId] ?? 0) >= DAILY_ADD_LIMIT) {
      // 하루 20건을 넘은 21번째부터는 그날 "확인만"으로 처리한다 (설계도 6.3)
      routed = 'ALWAYS_VIEW';
      over = true;
    } else {
      dailyAddCount[personId] = (dailyAddCount[personId] ?? 0) + 1;
    }
  }
  if (routed === 'ASK') mockReceived.push(item);
  else if (routed === 'ALWAYS_ADD') addReceivedToMine(item);
  else mockInbox.push({ ...item, daysLeft: INBOX_DAYS });
  peopleNotice = arrivalNotice(person, item, routed, over);
  refreshAll();
}

// ---------- 보낸 사람이 수정 · 취소했을 때 (설계도 6.5) ----------
// 받은 항목에는 "수정됨 · 10/2 15:30" 태그가 붙고, 취소되면 "보낸 사람이 취소했어요"가 보인다. 알림은 도착 알림 설정을 따른다.
const senderOf = id => personById(id) ?? { alias: nameOfId(id), nickname: '', withdrawn: false, notifyArrival: true };
const receivedEvents = () => mockEvents.filter(event => event.fromId && event.deletedAt === null && event.status !== 'CANCELED');
const editedStamp = iso => {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

function changeNotice(person, type, item) {
  const silent = silentReason(person);
  return silent ? `알림 없이 반영됐어요(${silent}).` : `알림: ${pushText(type, person, item)}`;
}

function simulateSenderEdit() {
  const event = receivedEvents().pop();
  const inboxEvent = mockInbox.find(item => item.kind === 'EVENT');
  const stamp = new Date().toISOString();
  if (event) {
    const start = new Date(Date.parse(event.startAt) + 3600000);
    Object.assign(event, { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString(), status: start.getTime() < Date.now() ? 'PAST' : 'UPCOMING', editedAt: stamp, updatedAt: stamp });
    peopleNotice = changeNotice(senderOf(event.fromId), 'EDITED', { kind: 'EVENT', title: event.title, startAt: start });
  } else if (inboxEvent) {
    inboxEvent.startAt = new Date(inboxEvent.startAt.getTime() + 3600000);
    inboxEvent.editedAt = stamp;
    peopleNotice = changeNotice(senderOf(inboxEvent.fromId), 'EDITED', inboxEvent);
  } else {
    peopleNotice = '수정할 받은 일정이 없어요. 먼저 일정을 받아 주세요.';
  }
  refreshAll();
}

function simulateSenderCancel(kind) {
  if (kind === 'EVENT') {
    const event = receivedEvents().pop();
    if (!event) {
      peopleNotice = '취소할 받은 일정이 없어요. 먼저 일정을 받아 캘린더에 넣어 주세요.';
    } else {
      event.status = 'CANCELED';
      peopleNotice = changeNotice(senderOf(event.fromId), 'CANCELED', { kind: 'EVENT', title: event.title, startAt: new Date(event.startAt) });
    }
  } else {
    // 지출은 취소되면 내 지출에서 삭제되고 합계에서도 빠진다
    const expense = mockTransactions.find(item => item.fromId && !item.deletedAt);
    if (!expense) {
      peopleNotice = '취소할 받은 지출이 없어요. 먼저 지출을 받아 넣어 주세요.';
    } else {
      mockTransactions.splice(mockTransactions.indexOf(expense), 1);
      peopleNotice = `${nameOfId(expense.fromId)}님이 보낸 지출이 취소돼 내 지출에서 빠졌어요.`;
    }
  }
  refreshAll();
}

// ---------- 사람 설정 시트 ----------
let personEditingId = null;
let removeArmed = null; // 'remove' | 'block': 한 번 눌러 확인을 받은 상태

function renderReceivePills(prefix, person, kind) {
  const info = KIND_INFO[kind];
  buildPills(`${prefix}Pills`, RECEIVE_MODE_KEYS, key => RECEIVE_LABEL[key], [person[info.modeField]], key => {
    person[info.modeField] = key;
    renderPersonSheet();
    renderPeoplePage();
  });
  byId(`${prefix}Hint`).textContent = receiveHint(kind, person[info.modeField]);
}

function renderPersonSheet() {
  const person = personById(personEditingId);
  if (!person) return;
  byId('personTitle').textContent = displayName(person);
  byId('personNickname').textContent = person.withdrawn ? '탈퇴한 사용자' : `닉네임 ${person.nickname}`;
  byId('personName').placeholder = person.nickname;
  setSwitch('rowNotifArrival', 'notifArrivalToggle', person.notifyArrival, false);
  setSwitch('rowNotifTime', 'notifTimeToggle', person.notifyEventTime, false);
  show('notifMasterHint', !mockSettings.allOn);
  document.querySelectorAll('[data-relation]').forEach(button => setActive(button, button.dataset.relation === person.relation, 'segmentButtonActive', 'segmentTextActive'));
  renderReceivePills('receiveEvent', person, 'EVENT');
  renderReceivePills('receiveExpense', person, 'EXPENSE');
  buildPills('personReminders', REMINDER_OFFSETS, reminderLabel, person.defaultReminders, value => {
    const has = person.defaultReminders.includes(value);
    person.defaultReminders = has ? person.defaultReminders.filter(item => item !== value) : [...person.defaultReminders, value];
    renderPersonSheet();
    renderPeoplePage();
  });
  byId('personRemoveText').textContent = removeArmed === 'remove' ? '정말 끊을까요? 한 번 더 누르세요' : '연결 끊기';
  byId('personBlockText').textContent = removeArmed === 'block' ? '정말 차단할까요? 한 번 더 누르세요' : '차단';
}

function openPersonSheet(id) {
  const person = personById(id);
  if (!person) return;
  personEditingId = id;
  removeArmed = null;
  byId('personName').value = person.alias;
  renderPersonSheet();
  openLayer('personSheet');
}

// 표시 이름: 1~20자, 아무 글자나 가능, 다른 친구와 같아도 된다. 비우면 닉네임으로 돌아간다 (설계도 5.2).
function saveAlias() {
  const person = personById(personEditingId);
  if (!person) return;
  person.alias = Array.from(byId('personName').value.trim()).slice(0, 20).join('');
  byId('personTitle').textContent = displayName(person);
  byId('personNickname').textContent = person.withdrawn ? '탈퇴한 사용자' : `닉네임 ${person.nickname}`;
  renderPeoplePage();
  renderCalendar();
  refreshHomeRecords();
}

function removePerson(kind) {
  if (removeArmed !== kind) {
    removeArmed = kind;
    renderPersonSheet();
    return;
  }
  const person = personById(personEditingId);
  detachPerson(person, kind === 'block' ? '차단했어요' : '연결을 끊었어요');
  closeLayers();
  refreshAll();
}

// ---------- 친구 추가 시트: 링크 · QR · 닉네임 (설계도 5.1) ----------
const LINK_SECONDS = 300; // 1명 1회용, 5분 뒤 만료
const TOKEN_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let addTab = 'link';
let linkToken = '';
let linkExpiresAt = 0; // 0 = 아직 만들지 않음
let linkTimer = null;
let foundNickname = null;

const linkSecondsLeft = () => Math.max(0, Math.ceil((linkExpiresAt - Date.now()) / 1000));

function stopLinkTimer() {
  if (linkTimer !== null) {
    clearInterval(linkTimer);
    linkTimer = null;
  }
}

function newToken() {
  return Array.from({ length: 12 }, () => TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)]).join('');
}

// 모양만 흉내 낸 QR (앱에서는 QR 라이브러리가 링크 주소로 만든다). 세 모서리의 큰 네모 + 토큰으로 정해지는 무늬.
const QR_SIZE = 21;
function buildQr(token) {
  let seed = 0;
  for (const char of token) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const corner = (row, col, row0, col0) => {
    const r = row - row0;
    const c = col - col0;
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    if (r === 7 || c === 7) return false; // 큰 네모 둘레의 빈 줄
    return r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  };
  const rows = [];
  for (let row = 0; row < QR_SIZE; row += 1) {
    const cells = [];
    for (let col = 0; col < QR_SIZE; col += 1) {
      const fixed = [corner(row, col, 0, 0), corner(row, col, 0, QR_SIZE - 7), corner(row, col, QR_SIZE - 7, 0)].find(value => value !== null);
      const on = fixed === undefined ? next() > 0.5 : fixed;
      cells.push(makeDiv(on ? 'qrCell qrCellOn' : 'qrCell'));
    }
    rows.push(makeDiv('qrRow', ...cells));
  }
  byId('qrGrid').replaceChildren(...rows);
}

function renderLinkViews() {
  const made = linkExpiresAt > 0;
  const left = linkSecondsLeft();
  const expired = made && left === 0;
  if (expired) stopLinkTimer();
  const clock = `${Math.floor(left / 60)}:${pad2(left % 60)}`;
  ['link', 'qr'].forEach(prefix => {
    show(`${prefix}Empty`, !made);
    show(`${prefix}Live`, made && !expired);
    show(`${prefix}Expired`, expired);
    byId(`${prefix}Time`).textContent = `남은 시간 ${clock} · 1명만 쓸 수 있어요`;
  });
  byId('linkUrl').textContent = made ? `example.com/i/${linkToken}` : '';
}

function createLink() {
  linkToken = newToken();
  linkExpiresAt = Date.now() + LINK_SECONDS * 1000;
  buildQr(linkToken);
  show('linkShareNote', false);
  stopLinkTimer();
  linkTimer = setInterval(renderLinkViews, 1000);
  renderLinkViews();
}

function setAddTab(tab) {
  addTab = tab;
  ['link', 'qr', 'nick'].forEach(name => show(`add${name[0].toUpperCase()}${name.slice(1)}`, name === tab));
  document.querySelectorAll('[data-addtab]').forEach(button => setActive(button, button.dataset.addtab === tab, 'segmentButtonActive', 'segmentTextActive'));
}

function openAddSheet(tab) {
  byId('nickInput').value = '';
  show('nickError', false);
  show('nickFound', false);
  foundNickname = null;
  show('linkShareNote', false);
  byId('addCount').textContent = `친구 ${friendCount()}/${FRIEND_LIMIT}명 · 보낸 요청도 포함돼요`;
  setAddTab(tab);
  openLayer('addSheet');
  renderLinkViews();
  if (linkExpiresAt > 0 && linkSecondsLeft() > 0) {
    linkTimer = setInterval(renderLinkViews, 1000);
  }
}

function findNickname() {
  const value = byId('nickInput').value.trim();
  const friend = mockPeople.find(person => person.nickname === value);
  const error = !value ? '닉네임을 입력해 주세요.'
    : value === MY_NICKNAME || value.toLowerCase() === session.nickname.toLowerCase() ? '내 닉네임이에요. 상대의 닉네임을 넣어 주세요.'
    : friend && friend.status === 'CONNECTED' ? `이미 ${displayName(friend)}님과 친구예요.`
    : friend ? '이미 요청을 보냈어요. 상대가 수락하면 연결돼요.'
    : !KNOWN_NICKNAMES.includes(value) ? '이 닉네임을 찾지 못했어요. 닉네임을 정확히 입력해 주세요. 검색을 허용하지 않은 사람은 나오지 않아요.'
    : friendCount() >= FRIEND_LIMIT ? `친구는 최대 ${FRIEND_LIMIT}명까지예요.` : '';
  show('nickError', false);
  show('nickFound', false);
  foundNickname = null;
  if (error) {
    byId('nickError').textContent = error;
    show('nickError', true);
    return;
  }
  foundNickname = value;
  byId('foundName').textContent = value;
  byId('foundInitial').textContent = initialOf(value);
  byId('nickSendText').textContent = '친구 요청 보내기';
  setDisabled('nickSend', false);
  show('nickFound', true);
}

function sendFriendRequest() {
  if (!foundNickname || mockPeople.some(person => person.nickname === foundNickname) || friendCount() >= FRIEND_LIMIT) return;
  mockPeople.push(makePerson(foundNickname, 'REQUEST_SENT'));
  byId('nickSendText').textContent = '요청을 보냈어요. 상대가 수락하면 연결돼요.';
  setDisabled('nickSend', true);
  byId('addCount').textContent = `친구 ${friendCount()}/${FRIEND_LIMIT}명 · 보낸 요청도 포함돼요`;
  renderAccountViews();
}

// ---------- 링크를 열었을 때 (설계도 5.1 결과 화면 · 5.3 첫 연결) ----------
const LINK_MESSAGES = {
  EXPIRED: '초대 링크가 만료됐어요. 새 링크를 요청해 주세요.',
  USED: '이미 사용된 링크예요.',
  OWN: '내가 만든 링크예요. 친구에게 보내 주세요.',
  BLOCKED: '연결할 수 없는 링크예요.', // 차단 사실은 밝히지 않는다
  MY_FULL: `친구는 최대 ${FRIEND_LIMIT}명까지예요.`,
  THEIR_FULL: '상대의 친구 수가 가득 찼어요.',
  OFFLINE: '인터넷 연결 후 다시 열어 주세요.', // 링크는 사용 처리하지 않는다
};
const setupDraft = { personId: null, event: 'ASK', expense: 'ASK' };

function showConnectPanel(panel) {
  show('connectResult', panel === 'result');
  show('connectSetup', panel === 'setup');
}

function openLinkResult(kind) {
  const inviter = 'seoyeon_lee';
  const existing = mockPeople.find(person => person.nickname === inviter);
  let result = kind;
  if (kind === 'OK' && existing) result = 'ALREADY_FRIEND';
  if (kind === 'OK' && friendCount() >= FRIEND_LIMIT) result = 'MY_FULL';
  if (result === 'OK') {
    const person = makePerson(inviter, 'CONNECTED');
    mockPeople.push(person);
    peopleNotice = '';
    renderAccountViews();
    openConnectSetup(person.id);
    return;
  }
  const friend = result === 'ALREADY_FRIEND' ? (existing ?? mockPeople[0]) : null;
  byId('connectTitle').textContent = '링크 열기';
  byId('connectMessage').textContent = friend ? `이미 ${displayName(friend)}님과 친구예요.` : LINK_MESSAGES[result];
  show('connectGoFriends', Boolean(friend));
  showConnectPanel('result');
  openLayer('connectSheet');
}

function openConnectSetup(personId) {
  const person = personById(personId);
  setupDraft.personId = personId;
  setupDraft.event = 'ASK';
  setupDraft.expense = 'ASK';
  byId('connectTitle').textContent = `${person.nickname}님과 친구가 됐어요`;
  byId('setupAlias').value = '';
  byId('setupAlias').placeholder = person.nickname;
  renderSetupPills();
  showConnectPanel('setup');
  openLayer('connectSheet');
}

function renderSetupPills() {
  const person = personById(setupDraft.personId);
  const name = byId('setupAlias').value.trim() || person.nickname;
  [['EVENT', 'setupEvent', 'event'], ['EXPENSE', 'setupExpense', 'expense']].forEach(([kind, prefix, key]) => {
    byId(`${prefix}Question`).textContent = `${name}님이 ${KIND_INFO[kind].noun}을 보내면 어떻게 할까요?`;
    buildPills(`${prefix}Pills`, FIRST_CONNECT_MODES, mode => firstConnectLabel(kind, mode), [setupDraft[key]], mode => {
      setupDraft[key] = mode;
      renderSetupPills();
    });
  });
}

// [완료]: 이름과 받기 방식을 저장한다. [건너뛰기]: 이름은 닉네임, 받기 방식은 매번 묻기 그대로 둔다.
function finishSetup(save) {
  const person = personById(setupDraft.personId);
  if (save && person) {
    person.alias = Array.from(byId('setupAlias').value.trim()).slice(0, 20).join('');
    person.receiveEvent = setupDraft.event;
    person.receiveExpense = setupDraft.expense;
  }
  if (person) peopleNotice = `${displayName(person)}님과 연결됐어요.`;
  closeLayers();
  refreshAll();
}

// 내가 만든 링크를 상대가 열었을 때 (내 화면): 알림 카드 + [연결 끊기] (설계도 5.1)
function simulateMyLinkOpened() {
  if (mockPeople.some(person => person.nickname === 'hanbit_k')) return;
  const person = makePerson('hanbit_k', 'CONNECTED');
  mockPeople.push(person);
  mockLinkNotices.push({ id: newId(4300), personId: person.id, name: person.nickname });
  refreshAll();
}

// 내가 보낸 친구 요청을 상대가 수락했을 때: 나도 이름과 받기 방식을 묻는다 (설계도 5.3)
function simulateRequestAccepted() {
  const person = mockPeople.find(item => item.status === 'REQUEST_SENT');
  if (!person) return;
  person.status = 'CONNECTED';
  renderAccountViews();
  openConnectSetup(person.id);
}

// ---------- 보내기 시트 (설계도 6.2) ----------
const SEND_CATEGORIES = ['식비', '카페', '교통', '생활'];
const sendState = { kind: 'EVENT', recipients: [], offsets: [], touched: false, alsoMine: false, category: null };
const isTrial = () => account.plan === 'FREE'; // 무료 회원: 공유 체험 1회 (일정만, 받는 사람 1명)
const canReceive = (person, kind) => person.status === 'CONNECTED' && person[KIND_INFO[kind].theirField] !== 'NOT_ALLOWED';

function syncSendOffsets() {
  if (sendState.touched) return;
  const set = new Set();
  sendState.recipients.forEach(id => personById(id).defaultReminders.forEach(value => set.add(value)));
  sendState.offsets = [...set];
}

function buildSendPeople() {
  const people = connectedPeople();
  byId('sendPeople').replaceChildren(...people.map(person => {
    const allowed = canReceive(person, sendState.kind);
    const button = makeButton('pill', 'pillText', displayName(person), () => {
      if (!allowed) return;
      const has = sendState.recipients.includes(person.id);
      sendState.recipients = isTrial() ? (has ? [] : [person.id]) : has ? sendState.recipients.filter(item => item !== person.id) : [...sendState.recipients, person.id];
      syncSendOffsets();
      renderSendForm();
    });
    setActive(button, sendState.recipients.includes(person.id), 'pillActive', 'pillTextActive');
    if (!allowed) {
      button.classList.add('pillDisabled');
      button.firstElementChild.classList.add('pillTextDisabled');
      button.setAttribute('aria-disabled', 'true');
    }
    return button;
  }));
  const blocked = people.filter(person => !canReceive(person, sendState.kind));
  show('sendBlockedNote', blocked.length > 0);
  byId('sendBlockedNote').textContent = blocked.map(person => `${displayName(person)}: 이 친구는 받기를 꺼 두었어요`).join(' · ');
}

function renderSendForm() {
  const event = sendState.kind === 'EVENT';
  ['EVENT', 'EXPENSE'].forEach(kind => {
    const button = document.querySelector(`[data-sendkind="${kind}"]`);
    setActive(button, sendState.kind === kind, 'segmentButtonActive', 'segmentTextActive');
    button.classList.toggle('disabled', isTrial() && kind === 'EXPENSE');
  });
  show('sendTrialNote', isTrial());
  show('sendEventFields', event);
  show('sendExpenseFields', !event);
  show('sendReminderBlock', event);
  byId('sendAlsoText').textContent = event ? '내 캘린더에도 넣기' : '내 지출에도 넣기';
  byId('sendAlsoToggle').classList.toggle('toggleOn', sendState.alsoMine);
  byId('sendAlso').setAttribute('aria-checked', String(sendState.alsoMine));
  buildSendPeople();
  buildPills('sendCategories', SEND_CATEGORIES, category => category, sendState.category ? [sendState.category] : [], category => {
    sendState.category = sendState.category === category ? null : category;
    renderSendForm();
  });
  buildPills('sendReminders', REMINDER_OFFSETS, reminderLabel, sendState.offsets, value => {
    sendState.touched = true;
    sendState.offsets = sendState.offsets.includes(value) ? sendState.offsets.filter(item => item !== value) : [...sendState.offsets, value];
    renderSendForm();
  });
}

function setSendKind(kind) {
  if (isTrial() && kind === 'EXPENSE') return;
  sendState.kind = kind;
  sendState.recipients = sendState.recipients.filter(id => canReceive(personById(id), kind));
  syncSendOffsets();
  renderSendForm();
}

function openSendSheet(personId) {
  sendState.kind = 'EVENT';
  sendState.recipients = personId && canReceive(personById(personId), 'EVENT') ? [personId] : [];
  sendState.touched = false;
  sendState.alsoMine = mockSettings.sendAlsoDefault;
  sendState.category = null;
  syncSendOffsets();
  byId('sendTitle').value = '';
  byId('sendAmount').value = '';
  byId('sendMemo').value = '';
  byId('sendDate').value = dateKey(focusDate);
  byId('sendTime').value = '10:00';
  byId('sendTrialNote').textContent = '공유 체험 1회 남음 · 일정만, 받는 사람 1명에게 보낼 수 있어요.';
  show('sendError', false);
  show('sendForm', true);
  show('sendResult', false);
  renderSendForm();
  openLayer('sendSheet');
}

// 보내기 진입: 무료 회원이 체험을 이미 썼으면 요금제 화면으로 안내한다 (설계도 6.1)
function startSend(personId) {
  if (isGuest()) {
    openLoginPrompt('SEND');
    return;
  }
  if (isTrial() && !account.shareTrial) {
    openPlan('send');
    return;
  }
  openSendSheet(personId);
}

function validateSend() {
  if (!sendState.recipients.length) return { error: '받는 사람을 골라 주세요' };
  const date = parseDateKey(byId('sendDate').value);
  const clock = parseClock(byId('sendTime').value);
  if (sendState.kind === 'EVENT') {
    const title = byId('sendTitle').value.trim();
    if (!title) return { error: '제목을 적어 주세요' };
    if (!date) return { error: '날짜를 2026-10-02 처럼 적어 주세요' };
    if (!clock) return { error: '시간을 15:00 처럼 적어 주세요' };
    const start = atTime(date, clock.hour, clock.minute);
    if (start.getTime() < Date.now()) return { error: '이미 지난 일정은 보낼 수 없어요' };
    return { title, start };
  }
  const amount = Number(byId('sendAmount').value.replace(/[,\s]/g, ''));
  if (!Number.isInteger(amount) || amount <= 0) return { error: '금액을 숫자로 적어 주세요' };
  if (!date) return { error: '날짜를 2026-10-02 처럼 적어 주세요' };
  if (!clock) return { error: '시간을 15:00 처럼 적어 주세요' };
  const memo = byId('sendMemo').value.trim();
  return { amount, memo, start: atTime(date, clock.hour, clock.minute) };
}

function submitSend() {
  const input = validateSend();
  show('sendError', false);
  if (input.error) {
    byId('sendError').textContent = input.error;
    show('sendError', true);
    return;
  }
  const event = sendState.kind === 'EVENT';
  const label = event ? input.title : `${input.amount.toLocaleString('ko-KR')}원${input.memo ? ` · ${input.memo}` : ''}`;
  const rows = sendState.recipients.map(id => {
    const person = personById(id);
    const status = person.deliversNow ? 'DELIVERED' : 'PENDING';
    mockSent.unshift({ id: newId(6000), toId: id, kind: sendState.kind, title: label, status });
    return makeDiv('resultRow', makeAvatar(displayName(person)),
      makeDiv('resultMain', textElement('p', 'personName', displayName(person)), textElement('p', 'settingHint', '보냈어요')),
      makeDiv('tag', textElement('p', 'tagText', SEND_STATUS_LABEL[status])));
  });
  if (sendState.alsoMine) {
    if (event) {
      mockEvents.push(makeEventAt(newId(2200), input.title, input.start, 60, null));
    } else {
      const daysAgo = Math.round((dayStart(0).getTime() - startOfDay(input.start).getTime()) / 86400000);
      mockTransactions.unshift(makeTransaction(newId(8), input.amount, sendState.category, input.memo || null, daysAgo, input.start.getHours(), input.start.getMinutes(), 'MANUAL', null));
    }
  }
  if (isTrial()) account.shareTrial = 0;
  byId('sendResultList').replaceChildren(...rows);
  show('sendForm', false);
  show('sendResult', true);
  refreshAll();
}

// ---------- 계정 상태를 모든 화면에 반영 ----------
function setAccount(key) {
  accountKey = key;
  account = { ...ACCOUNT_PRESETS[key] };
  renderAccountViews();
}

function renderAccountViews() {
  const usage = usageView();

  // 홈: AI 남은 횟수 한 줄
  byId('usageLine').textContent = usageLine();
  show('usageLink', account.plan === 'FREE' || aiBlock() !== null);

  // 홈: 보내기는 구독 기능. 무료 회원은 공유 체험 1회가 남아 있으면 체험 표시, 다 썼으면 구독 표시
  byId('sendButton').firstElementChild.textContent = isPaid() ? '보내기' : account.shareTrial ? '보내기 (체험 1회)' : '보내기 (구독)';

  // 설정: 상단 횟수 카드
  byId('usageLabel').textContent = usage.label;
  byId('usageNumber').textContent = usage.number;
  byId('usageUnit').textContent = usage.unit;
  byId('usageCaption').textContent = usage.caption;
  byId('usageExtra').textContent = usage.extra;
  byId('meterFill').style.flexGrow = String(usage.ratio * 100);
  byId('meterRest').style.flexGrow = String((1 - usage.ratio) * 100);
  byId('planValue').textContent = PLAN_INFO[account.plan].name;
  const waiting = mockFriendRequests.length + mockReceived.length;
  byId('peopleValue').textContent = `${connectedPeople().length}명${waiting ? ` · 확인할 것 ${waiting}건` : ''}`;

  renderNotifSettings();
  renderPlanPage();
  renderPeoplePage();

  highlight('[data-account]', button => button.dataset.account === accountKey);
}

// 디자인 확인용 시트 버튼. 보내기는 구독 상태로 바꿔서 보여 준다(체험을 쓴 무료 상태는 요금제 화면으로 가기 때문).
function openDesignLayer(name) {
  if (name === 'add') openAddSheet('link');
  else if (name === 'person') openPersonSheet(connectedPeople()[0].id);
  else {
    if (isTrial() && !account.shareTrial) setAccount('basic');
    openSendSheet(connectedPeople()[0].id);
  }
}

// 시나리오의 "처음으로"가 일정을 되돌릴 때 사람 · 받은 항목 · 보낸 항목도 처음 모습으로
function restoreSocial() {
  const base = structuredClone(baseState);
  mockPeople.splice(0, mockPeople.length, ...base.people);
  mockFriendRequests.splice(0, mockFriendRequests.length, ...base.requests);
  mockReceived.splice(0, mockReceived.length, ...base.received);
  mockInbox.splice(0, mockInbox.length, ...base.inbox);
  mockSent.splice(0, mockSent.length, ...base.sent);
  mockBlocked.splice(0, mockBlocked.length, ...base.blocked);
  mockLinkNotices.length = 0;
  alwaysChecked.clear();
  Object.keys(dailyAddCount).forEach(key => delete dailyAddCount[key]);
  Object.keys(formerNames).forEach(key => delete formerNames[key]);
  friendCountOverride = null;
  peopleNotice = '';
  stopLinkTimer();
  linkExpiresAt = 0;
}

const restoreTransactionsBase = restoreTransactions;
restoreTransactions = function restoreTransactionsAndPeople() {
  restoreTransactionsBase();
  restoreSocial();
};

// ======================================================================
// 3-1단계: 첫 실행 · 로그인 · 게스트 · 내 프로필 · 프로필 사진 · 차단 · 신고 (백엔드 연결 전 목업)
// session: 로그인 상태. 계정 · 닉네임 · 프로필 사진은 서버가 원본이다 (설계도 2장).
// 서버가 필요한 동작(로그인 · 닉네임 · 사진 · 검색 허용 · 차단 · 신고)은 오프라인이면 버튼이 비활성 + "인터넷 연결이 필요해요" (설계도 11.3).
// ======================================================================
const PROVIDER_LABEL = { APPLE: '애플', GOOGLE: '구글', KAKAO: '카카오' };
const NICK_MIN = 2;
const NICK_MAX = 12;
const NICK_CHANGE_DAYS = 30; // 변경은 30일에 1회, 놓은 닉네임은 30일 동안 다른 사람이 쓸 수 없다 (설계도 3.4)
const NICK_FORBIDDEN = ['관리자', '운영자', '운영팀', 'admin', 'voicelife']; // 운영자 사칭 · 앱 이름. 실제 목록은 서버에서 운영자가 관리한다
const NICK_TAKEN = ['민수', '봄날', 'sunny', 'hanbit']; // 목업: 이미 쓰고 있는 닉네임 (영문 대소문자는 같은 것으로 본다)
const nickHeld = ['지난닉네임']; // 변경 · 탈퇴로 놓여 30일 보류 중인 닉네임

// photo: null(이니셜 표시) 또는 { tone: 예시 사진 번호, zoom: 확대 배율, x · y: 크롭 화면에서 끈 거리(px) }
const SIGNED_IN = () => ({ signedIn: true, provider: 'APPLE', nickname: '보이스유저', searchable: true, photo: null, defaultPublic: true, nickChangedDaysAgo: null });
const GUEST = () => ({ signedIn: false, provider: null, nickname: '', searchable: true, photo: null, defaultPublic: false, nickChangedDaysAgo: null });
let session = SIGNED_IN();
const isGuest = () => !session.signedIn;
let online = true; // 디자인 확인용: false 이면 서버가 필요한 동작이 막힌다
let loginOutcome = 'NEW'; // 디자인 확인용: 다음 로그인 시도의 결과 'NEW' | 'EXISTING' | 'CANCELED' | 'FAILED'
let photoUploadFails = false; // 디자인 확인용: 사진 올리기 실패 흉내
let guestPromptVisible = false; // 게스트가 기록을 3건 이상 저장했을 때 한 번 띄우는 안내 (닫으면 다시 띄우지 않고 홈 배너는 남는다)
let profileNotice = '';
let blockedNotice = '';

const isOff = id => byId(id).classList.contains('disabled');

function setCheck(rowId, boxId, checked) {
  byId(rowId).setAttribute('aria-checked', String(checked));
  const box = byId(boxId);
  box.classList.toggle('taskBoxDone', checked);
  box.replaceChildren(...(checked ? [textElement('p', 'taskCheck', '✓')] : []));
}

// ---------- 닉네임 규칙 (설계도 3.4) ----------
// 2~12자, 한글 · 영문 · 숫자 · 밑줄(_)만(설계도 5.2 의 예시 sky_77 · mom_kim 에 맞춤), 중복 불가(영문 대소문자 같음), 금칙어 불가, 놓은 닉네임은 30일 보류.
// 중복 · 금칙어는 서버가 검사한다. 여기서는 목업 목록으로 흉내 낸다.
function validateNickname(value, current) {
  if (!value) return { ok: false, text: '' };
  if (!/^[가-힣A-Za-z0-9_]+$/.test(value)) return { ok: false, text: '한글, 영문, 숫자, 밑줄(_)만 쓸 수 있어요. 공백과 그 밖의 특수문자는 쓸 수 없어요.' };
  const length = Array.from(value).length;
  if (length < NICK_MIN) return { ok: false, text: `${NICK_MIN}자 이상 입력해 주세요.` };
  if (length > NICK_MAX) return { ok: false, text: `${NICK_MAX}자 이하로 입력해 주세요.` };
  const lower = value.toLowerCase();
  if (NICK_FORBIDDEN.some(word => lower.includes(word))) return { ok: false, text: '사용할 수 없는 닉네임이에요.' };
  if (current && lower === current.toLowerCase()) return { ok: false, text: '지금 쓰고 있는 닉네임이에요.' };
  if (!online) return { ok: false, text: '인터넷 연결이 필요해요. 연결되면 사용할 수 있는지 확인해요.' };
  if (nickHeld.some(item => item.toLowerCase() === lower)) return { ok: false, text: '최근에 놓은 닉네임이라 30일 동안 쓸 수 없어요.' };
  const takenByOthers = [...NICK_TAKEN, ...KNOWN_NICKNAMES, ...mockPeople.map(person => person.nickname)];
  if (takenByOthers.some(item => item.toLowerCase() === lower)) return { ok: false, text: '이미 사용 중인 닉네임이에요.' };
  return { ok: true, text: '사용할 수 있는 닉네임이에요.' };
}

function renderNickStatus(statusId, result) {
  const element = byId(statusId);
  element.className = result.text ? (result.ok ? 'text' : 'error') : 'muted';
  element.textContent = result.text || `${NICK_MIN}~${NICK_MAX}자 · 한글, 영문, 숫자, 밑줄(_)만 · 공백과 그 밖의 특수문자는 쓸 수 없어요`;
}

const nickCanChange = () => session.nickChangedDaysAgo === null || session.nickChangedDaysAgo >= NICK_CHANGE_DAYS;

function nextNickChangeLabel() {
  const date = addDays(startOfDay(new Date()), NICK_CHANGE_DAYS - (session.nickChangedDaysAgo ?? 0));
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// ---------- 프로필 사진 (설계도 5.4) ----------
// 실제 앱은 갤러리 · 카메라 사진을 512×512 정사각 JPEG 로 줄이고 EXIF(위치 정보)를 지운 뒤 올린다.
// 목업에는 사진 파일이 없어서 하늘 · 땅 · 해로 그린 예시 그림 4장을 쓴다.
const PHOTO_SAMPLES = [
  { name: '노을', sky: '#F5BC9A', ground: '#8E7CC3', sun: '#FFF3C4' },
  { name: '바다', sky: '#9CCBF2', ground: '#3F7CAC', sun: '#FFFFFF' },
  { name: '숲', sky: '#CFEAD3', ground: '#4E8A5F', sun: '#FFF3C4' },
  { name: '밤', sky: '#2D2A45', ground: '#5C4B8A', sun: '#E8E3FF' },
];
const PHOTO_W = 360; // 예시 그림의 크기(px). 크롭 창(CROP_SIZE)보다 커야 확대 없이도 창을 채운다
const PHOTO_H = 300;
const CROP_SIZE = 240;

function buildPhotoScene(sample) {
  const sun = makeDiv('photoSun');
  sun.style.backgroundColor = sample.sun;
  const sky = makeDiv('photoSky', makeDiv('photoSunRow', sun));
  sky.style.backgroundColor = sample.sky;
  const ground = makeDiv('photoGround');
  ground.style.backgroundColor = sample.ground;
  return makeDiv('photoScene', sky, ground);
}

// size px 짜리 원 안에 같은 크롭 결과를 보여 준다 (크롭 창 240px 기준으로 비례해 줄인다)
function placePhotoScene(scene, photo, size) {
  const ratio = size / CROP_SIZE;
  scene.style.transform = `translate(${photo.x * ratio}px, ${photo.y * ratio}px) scale(${photo.zoom * ratio})`;
}

function buildPhotoAvatar(photo, size) {
  const scene = buildPhotoScene(PHOTO_SAMPLES[photo.tone]);
  placePhotoScene(scene, photo, size);
  const frame = makeDiv('photoFrame', scene);
  frame.style.width = `${size}px`;
  frame.style.height = `${size}px`;
  frame.style.borderRadius = `${size / 2}px`;
  return frame;
}

// 사진이 있으면 사진, 없으면 이니셜 (설계도 5.4 기본 아바타)
function buildAvatar(name, photo, size) {
  if (photo) return buildPhotoAvatar(photo, size);
  if (size === 96) return makeDiv('avatar avatarBig', textElement('p', 'avatarText avatarTextBig', initialOf(name)));
  return makeAvatar(name);
}

function clampPhoto(photo) {
  const maxX = Math.max(0, (PHOTO_W * photo.zoom - CROP_SIZE) / 2);
  const maxY = Math.max(0, (PHOTO_H * photo.zoom - CROP_SIZE) / 2);
  photo.x = Math.min(maxX, Math.max(-maxX, photo.x));
  photo.y = Math.min(maxY, Math.max(-maxY, photo.y));
}

// ---------- 화면 이동 · 그리기 보조 (기존 함수를 감싼다) ----------
PAGES.onboard = { id: 'onboardPage', title: 'Voice Life Manager' };
PAGES.blocked = { id: 'blockedPage', title: '차단 목록' };
layerIds.push('loginSheet', 'nickSheet', 'photoSheet', 'reportSheet');

const showPageBase = showPage;
showPage = function showPageWithSession(name) {
  showPageBase(name);
  show('backButton', name !== 'home' && name !== 'onboard');
  if (name !== 'settings') profileNotice = '';
  if (name !== 'blocked') blockedNotice = '';
  renderSessionViews();
};

const renderAccountViewsBase = renderAccountViews;
renderAccountViews = function renderAccountViewsWithSession() {
  renderAccountViewsBase();
  renderSessionViews();
};

const usageViewBase = usageView;
usageView = function usageViewForSession() {
  if (isGuest()) return { label: 'AI 해석', number: '—', unit: '', ratio: 0, caption: '로그인하면 AI 체험 3회를 쓸 수 있어요', extra: '직접 입력은 로그인 없이 계속 쓸 수 있어요.' };
  return usageViewBase();
};
const usageLineBase = usageLine;
usageLine = function usageLineForSession() {
  return isGuest() ? '로그인하면 AI 체험 3회를 쓸 수 있어요. 직접 입력은 계속 쓸 수 있어요.' : usageLineBase();
};

const renderPlanPageBase = renderPlanPage;
renderPlanPage = function renderPlanPageForSession() {
  renderPlanPageBase();
  const guest = isGuest();
  show('planGate', guest);
  show('planRestore', !guest);
  if (guest) ['planList', 'planReasonBox', 'planExpiredBox', 'planNoticeBox', 'planManage'].forEach(id => show(id, false));
};

const renderPeoplePageBase = renderPeoplePage;
renderPeoplePage = function renderPeoplePageForSession() {
  renderPeoplePageBase();
  show('peopleBody', !isGuest());
  show('peopleGate', isGuest());
};

function renderSessionViews() {
  const guest = isGuest();
  // 홈: 게스트는 "백업 꺼짐" 배너를 계속 보여 준다 (설계도 3.2)
  show('guestBanner', guest);
  show('guestPrompt', guest && guestPromptVisible);
  byId('usageLink').firstElementChild.textContent = guest ? '로그인' : '요금제 보기';
  byId('usagePlanLink').firstElementChild.textContent = guest ? '로그인' : '요금제 보기';
  if (guest) {
    show('usageLink', true);
    byId('planValue').textContent = '로그인 필요';
    byId('peopleValue').textContent = '로그인 필요';
    byId('sendButton').firstElementChild.textContent = '보내기 (로그인)';
  }
  // 설정: 내 프로필 · 공개 범위 · 친구 · 차단은 로그인한 사람만
  show('profileSigned', !guest);
  show('profileGuest', guest);
  show('publicGroup', !guest);
  show('blockGroup', !guest);
  show('shareGroup', !guest);
  show('rowFriendNotif', !guest);
  byId('profileNoticeText').textContent = profileNotice;
  show('profileNoticeBox', Boolean(profileNotice));
  if (!guest) {
    byId('profileAvatar').replaceChildren(buildAvatar(session.nickname, session.photo, 48));
    byId('profileNick').textContent = session.nickname;
    byId('nickChangeHint').textContent = nickCanChange() ? '30일에 한 번 바꿀 수 있어요' : `다음 변경 가능일: ${nextNickChangeLabel()}`;
    byId('providerValue').textContent = PROVIDER_LABEL[session.provider];
    setSwitch('rowSearch', 'searchToggle', session.searchable, !online);
    byId('searchHint').textContent = online ? '끄면 닉네임 검색 결과에 나오지 않아요.' : '인터넷 연결이 필요해요.';
    setSwitch('rowPublic', 'publicToggle', session.defaultPublic, false);
    byId('blockedValue').textContent = `${mockBlocked.length}명`;
  }
  if (currentPage === 'blocked') renderBlockedPage();
  if (currentPage === 'onboard') renderOnboard();
}

// 디자인 확인용: 서버 연결 상태나 열린 시트가 바뀌었을 때 지금 열려 있는 시트까지 다시 그린다
function rerenderSession() {
  renderAccountViews();
  if (!byId('personSheet').hidden) renderPersonSheet();
  if (!byId('nickSheet').hidden) renderNickSheet();
  if (!byId('photoSheet').hidden) renderPhotoSheet();
  if (!byId('reportSheet').hidden) renderReportSheet();
}

// ---------- 첫 실행 흐름 (설계도 3.2 · 11.2 O1~O5) ----------
// 환영 → 알림 권한 설명 → 로그인 선택 → (처음 가입이면) 닉네임 → 기본 공개 설정 → 홈. 게스트는 바로 홈.
const OB_IDS = { WELCOME: 'obWelcome', NOTIF: 'obNotif', LOGIN: 'obLogin', NICK: 'obNick', PUBLIC: 'obPublic' };
const onboard = { step: 'WELCOME', first: true, popup: false, agreed: false, note: '', reason: '', provider: null, nickname: '', publicChoice: null };

function renderOnboard() {
  Object.entries(OB_IDS).forEach(([step, id]) => show(id, onboard.step === step));
  show('obNotifButtons', !onboard.popup);
  show('obNotifPopup', onboard.popup);
  setCheck('obAgree', 'obAgreeBox', onboard.agreed);
  const loginBlocked = !onboard.agreed || !online;
  ['obApple', 'obGoogle', 'obKakao'].forEach(id => setDisabled(id, loginBlocked));
  byId('obLoginHint').textContent = !online ? '인터넷 연결이 필요해요.' : !onboard.agreed ? '약관에 동의하면 로그인할 수 있어요.' : '';
  show('obLoginHint', Boolean(byId('obLoginHint').textContent));
  byId('obLoginNote').textContent = onboard.note;
  show('obLoginNoteBox', Boolean(onboard.note));
  byId('obReason').textContent = onboard.reason;
  show('obReasonBox', Boolean(onboard.reason));
  byId('obLoginBackText').textContent = onboard.first ? '이전' : '나중에';
  const result = validateNickname(byId('obNickInput').value, null);
  renderNickStatus('obNickStatus', result);
  setDisabled('obNickNext', !result.ok);
  [['obPublicOn', 'PUBLIC'], ['obPublicOff', 'PRIVATE']].forEach(([id, value]) => {
    const active = onboard.publicChoice === value;
    byId(id).classList.toggle('choiceCardActive', active);
    byId(id).setAttribute('aria-checked', String(active));
  });
  setDisabled('obPublicDone', onboard.publicChoice === null);
}

function goOnboard(step) {
  onboard.step = step;
  renderOnboard();
  window.scrollTo(0, 0);
}

function openOnboard(step, first, reason) {
  onboard.first = first;
  onboard.reason = reason ?? '';
  onboard.note = '';
  onboard.popup = false;
  onboard.agreed = false;
  onboard.nickname = '';
  onboard.provider = null;
  onboard.publicChoice = null;
  byId('obNickInput').value = '';
  jumpToPage('onboard');
  goOnboard(step);
}

function finishOnboard() {
  guestPromptVisible = false;
  jumpToPage('home');
  renderAccountViews();
}

// 로그인 시도. 결과는 디자인 확인용 버튼(loginOutcome)이 정한다. 실제로는 애플 · 구글 · 카카오 로그인 창이 열린다.
function doLogin(provider) {
  onboard.note = '';
  if (loginOutcome === 'CANCELED') {
    onboard.note = '로그인을 취소했어요.';
    renderOnboard();
    return;
  }
  if (loginOutcome === 'FAILED') {
    onboard.note = '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    renderOnboard();
    return;
  }
  onboard.provider = provider;
  if (loginOutcome === 'EXISTING') {
    // 이미 프로필이 있는 계정(재설치 · 기기 변경): 닉네임 · 공개 설정을 건너뛰고, 서버 백업과 이 폰의 기록에 따라 갈린다 (설계도 3.2 · 3.3 · 3.6)
    afterExistingLogin(provider);
    return;
  }
  goOnboard('NICK');
}

function finishNewAccount() {
  session = { ...SIGNED_IN(), provider: onboard.provider ?? 'APPLE', nickname: onboard.nickname || '보이스유저', defaultPublic: onboard.publicChoice === 'PUBLIC' };
  setAccount('free'); // 새 계정은 체험 AI 3회 · 공유 1회 (설계도 9.1)
  finishWithUpload(!onboard.first && phoneRecordCount() > 0); // 게스트였다면 이 폰의 기록이 계정 데이터가 되고 전체 백업이 올라간다 (설계도 3.3)
}

function startAsGuest() {
  session = GUEST();
  finishOnboard();
}

// ---------- 게스트 → 로그인 안내 (설계도 3.3 · 11.2 H3) ----------
const LOGIN_PROMPTS = {
  BACKUP: { title: '로그인하면 백업돼요', body: '로그인하면 기록이 서버에 백업돼서 앱을 지워도 기록이 안전해요.', later: '나중에' },
  AI: { title: '로그인하면 AI 체험 3회를 쓸 수 있어요', body: '말한 문장을 AI가 해석하려면 로그인이 필요해요. 직접 입력은 로그인 없이 계속 쓸 수 있어요.', later: '직접 입력' },
  FRIEND: { title: '친구 기능은 로그인이 필요해요', body: '로그인하면 친구를 추가하고 일정과 지출을 받을 수 있어요.', later: '나중에' },
  SEND: { title: '보내기는 로그인이 필요해요', body: '로그인하면 공유 체험 1회를 쓸 수 있어요. 계속 보내려면 구독이 필요해요.', later: '나중에' },
  PLAN: { title: '구독은 로그인 후에 할 수 있어요', body: '로그인한 뒤에 요금제를 고를 수 있어요.', later: '나중에' },
};
let loginPromptReason = 'BACKUP';

function openLoginPrompt(reason) {
  loginPromptReason = reason;
  const prompt = LOGIN_PROMPTS[reason];
  byId('loginPromptTitle').textContent = prompt.title;
  byId('loginPromptBody').textContent = prompt.body;
  byId('loginPromptLaterText').textContent = prompt.later;
  openLayer('loginSheet');
}

// ---------- 내 프로필: 닉네임 변경 (설계도 3.4) ----------
let nickChangeArmed = false; // 한 번 눌러 확인을 받은 상태

function openNickSheet() {
  nickChangeArmed = false;
  byId('nickChangeInput').value = '';
  renderNickSheet();
  openLayer('nickSheet');
}

function renderNickSheet() {
  const can = nickCanChange();
  byId('nickCurrent').textContent = `지금 닉네임: ${session.nickname}`;
  byId('nickLockedText').textContent = `닉네임은 30일에 한 번만 바꿀 수 있어요. ${nextNickChangeLabel()}부터 바꿀 수 있어요.`;
  show('nickLockedBox', !can);
  show('nickChangeForm', can);
  if (!can) return;
  const result = validateNickname(byId('nickChangeInput').value, session.nickname);
  renderNickStatus('nickChangeStatus', result);
  setDisabled('nickChangeGo', !result.ok);
  byId('nickChangeGoText').textContent = nickChangeArmed ? '정말 바꿀까요? 한 번 더 누르세요' : '닉네임 바꾸기';
}

function changeNickname() {
  if (isOff('nickChangeGo') || !nickCanChange()) return;
  if (!nickChangeArmed) {
    nickChangeArmed = true;
    renderNickSheet();
    return;
  }
  const next = byId('nickChangeInput').value;
  const previous = session.nickname;
  nickHeld.push(previous);
  session.nickname = next;
  session.nickChangedDaysAgo = 0;
  profileNotice = `닉네임을 바꿨어요: ${next}. 이전 닉네임(${previous})은 30일 동안 다른 사람이 쓸 수 없어요.`;
  closeLayers();
  renderAccountViews();
}

// ---------- 내 프로필: 사진 고르기 · 크롭 (설계도 5.4) ----------
const PHOTO_VIEWS = { MENU: 'photoMenu', PICK: 'photoPick', CROP: 'photoCrop', FAIL: 'photoFail' };
const photoState = { view: 'MENU', draft: null, drag: null, scene: null };

function renderPhotoSheet() {
  Object.entries(PHOTO_VIEWS).forEach(([view, id]) => show(id, photoState.view === view));
  byId('photoCurrent').replaceChildren(buildAvatar(session.nickname, session.photo, 96));
  show('photoRemove', Boolean(session.photo));
  setDisabled('photoRemove', !online);
  if (photoState.view === 'CROP') {
    show('cropOffline', !online);
    setDisabled('cropDone', !online);
    updateCrop();
  }
}

function openPhotoSheet() {
  photoState.view = 'MENU';
  photoState.draft = null;
  photoState.drag = null;
  renderPhotoSheet();
  openLayer('photoSheet');
}

function openPhotoPick() {
  byId('photoSamples').replaceChildren(...PHOTO_SAMPLES.map((sample, index) => {
    const tile = document.createElement('button');
    tile.className = 'photoTile';
    tile.setAttribute('aria-label', `${sample.name} 사진`);
    tile.append(buildPhotoAvatar({ tone: index, zoom: 1, x: 0, y: 0 }, 64), textElement('p', 'muted', sample.name));
    tile.addEventListener('click', () => startCrop(index));
    return tile;
  }));
  photoState.view = 'PICK';
  renderPhotoSheet();
}

function startCrop(index) {
  photoState.draft = { tone: index, zoom: 1, x: 0, y: 0 };
  photoState.scene = buildPhotoScene(PHOTO_SAMPLES[index]);
  byId('cropStage').replaceChildren(photoState.scene);
  photoState.view = 'CROP';
  renderPhotoSheet();
}

function updateCrop() {
  const draft = photoState.draft;
  if (!draft) return;
  clampPhoto(draft);
  placePhotoScene(photoState.scene, draft, CROP_SIZE);
  byId('cropZoomLabel').textContent = `${Math.round(draft.zoom * 100)}%`;
}

function zoomCrop(step) {
  const draft = photoState.draft;
  if (!draft) return;
  draft.zoom = Math.min(3, Math.max(1, Math.round((draft.zoom + step) * 100) / 100));
  updateCrop();
}

// [완료]: 실제로는 512×512 JPEG 로 줄이고 EXIF 를 지운 뒤 올린다. 실패하면 이전 사진을 그대로 둔다 (설계도 15장).
function savePhoto() {
  if (!online || !photoState.draft) return;
  if (photoUploadFails) {
    photoState.view = 'FAIL';
    renderPhotoSheet();
    return;
  }
  session.photo = { ...photoState.draft };
  profileNotice = '프로필 사진을 바꿨어요.';
  closeLayers();
  renderAccountViews();
}

function removePhoto() {
  if (!online || !session.photo) return;
  session.photo = null;
  profileNotice = '프로필 사진을 지웠어요. 이니셜로 보여요.';
  closeLayers();
  renderAccountViews();
}

// ---------- 차단 · 차단 목록 (설계도 5.2) ----------
let blockPanelOpen = false;
let blockDelete = false; // "이 사람에게서 받은 항목도 삭제" (기본 꺼짐)

function openBlockPanel() {
  if (!online) return;
  blockPanelOpen = true;
  blockDelete = false;
  renderPersonSheet();
}

// 차단: 연결이 끊기고 상대는 나를 검색 · 초대 · 전송할 수 없다. 상대에게 알리지 않는다.
// 아직 전달 대기 중이던 항목은 끝나고, 내 "보낸 항목"에는 "만료됨"으로 보인다(그 밖의 종료, 설계도 6.4 — 확인 필요).
function blockPerson(person, deleteReceived) {
  const name = displayName(person);
  let removed = 0;
  if (deleteReceived) {
    const before = mockReceived.length + mockInbox.length;
    mockReceived.splice(0, mockReceived.length, ...mockReceived.filter(item => item.fromId !== person.id));
    mockInbox.splice(0, mockInbox.length, ...mockInbox.filter(item => item.fromId !== person.id));
    removed += before - mockReceived.length - mockInbox.length;
    const now = new Date().toISOString();
    mockEvents.forEach(event => {
      if (event.fromId === person.id && event.deletedAt === null) {
        event.deletedAt = now;
        event.updatedAt = now;
        removed += 1;
      }
    });
    for (let index = mockTransactions.length - 1; index >= 0; index -= 1) {
      if (mockTransactions[index].fromId === person.id) {
        mockTransactions.splice(index, 1);
        removed += 1;
      }
    }
  }
  mockBlocked.unshift({ id: person.id, nickname: person.nickname, shownName: name, daysAgo: 0 });
  mockSent.forEach(item => {
    if (item.toId === person.id && item.status === 'PENDING') item.status = 'EXPIRED';
  });
  mockLinkNotices.splice(0, mockLinkNotices.length, ...mockLinkNotices.filter(notice => notice.personId !== person.id));
  detachPerson(person, '차단했어요');
  peopleNotice = `차단했어요: ${name}.${removed ? ` 받은 항목 ${removed}건을 삭제했어요.` : ''} 차단 목록은 설정에서 볼 수 있어요.`;
  return removed;
}

function confirmBlock() {
  if (!online) return;
  const person = personById(personEditingId);
  if (!person) return;
  blockPerson(person, blockDelete);
  blockPanelOpen = false;
  closeLayers();
  refreshAll();
}

const blockedWhen = entry => `${entry.daysAgo === 0 ? '오늘' : `${entry.daysAgo}일 전`} 차단 · 닉네임 ${entry.nickname}`;

function renderBlockedPage() {
  byId('blockedNoticeText').textContent = blockedNotice;
  show('blockedNoticeBox', Boolean(blockedNotice));
  show('blockedOffline', !online);
  const rows = mockBlocked.map((entry, index) => {
    const unblock = makeButton('smallSecondary', 'smallSecondaryText', '차단 해제', () => unblockUser(entry));
    unblock.classList.toggle('disabled', !online);
    const row = makeDiv('resultRow', buildAvatar(entry.shownName, null, 48),
      makeDiv('resultMain', textElement('p', 'personName', entry.shownName), textElement('p', 'settingHint', blockedWhen(entry))),
      makeDiv('blockedAction', unblock));
    if (index === mockBlocked.length - 1) row.classList.add('rowLast');
    return row;
  });
  byId('blockedList').replaceChildren(...(rows.length ? rows : [textElement('p', 'agendaEmpty', '차단한 사람이 없어요.')]));
}

// 차단을 풀어도 친구로 자동 연결되지는 않는다(연결이 끊긴 상태 그대로 — 확인 필요).
function unblockUser(entry) {
  if (!online) return;
  mockBlocked.splice(mockBlocked.indexOf(entry), 1);
  blockedNotice = `차단을 풀었어요: ${entry.shownName}. 친구로 자동 연결되지는 않아요.`;
  renderAccountViews();
}

// 사진은 친구에게만 보이므로 차단 목록에서는 이니셜만 쓴다 (설계도 5.4: 차단한 상대의 사진은 숨긴다)

// ---------- 신고 (설계도 5.2) ----------
const REPORT_REASONS = [['PHOTO', '부적절한 프로필 사진'], ['NICKNAME', '부적절한 닉네임'], ['SPAM', '스팸 · 원치 않는 전송'], ['OTHER', '기타']];
const reportDraft = { reason: null, alsoBlock: false, done: false, doneText: '', targetName: '' };
const mockReports = []; // 서버 reports 테이블로 접수된다. 운영자가 사진 삭제 · 닉네임 초기화 · 계정 정지를 할 수 있다.

function openReportSheet(personId) {
  if (personId) personEditingId = personId;
  const person = personById(personEditingId);
  reportDraft.reason = null;
  reportDraft.alsoBlock = false;
  reportDraft.done = false;
  reportDraft.doneText = '';
  reportDraft.targetName = person ? `${displayName(person)}${person.alias ? ` · 닉네임 ${person.nickname}` : ''}` : '';
  byId('reportDetail').value = '';
  show('reportError', false);
  renderReportSheet();
  openLayer('reportSheet');
}

function renderReportSheet() {
  byId('reportTarget').textContent = `신고할 사람: ${reportDraft.targetName}`;
  show('reportForm', !reportDraft.done);
  show('reportDone', reportDraft.done);
  byId('reportDoneText').textContent = reportDraft.doneText;
  byId('reportReasons').replaceChildren(...REPORT_REASONS.map(([key, label]) => {
    const row = document.createElement('button');
    row.className = 'checkRow';
    row.setAttribute('role', 'radio');
    const active = reportDraft.reason === key;
    row.setAttribute('aria-checked', String(active));
    const box = makeDiv(active ? 'taskBox taskBoxDone' : 'taskBox');
    if (active) box.append(textElement('p', 'taskCheck', '✓'));
    row.append(box, textElement('p', 'text', label));
    row.addEventListener('click', () => {
      reportDraft.reason = key;
      show('reportError', false);
      renderReportSheet();
    });
    return row;
  }));
  setCheck('reportBlockRow', 'reportBlockBox', reportDraft.alsoBlock);
  show('reportOffline', !online);
  setDisabled('reportGo', !online);
}

function submitReport() {
  if (!online) return;
  const person = personById(personEditingId);
  const detail = byId('reportDetail').value.trim();
  const error = !reportDraft.reason ? '신고 사유를 골라 주세요.' : reportDraft.reason === 'OTHER' && !detail ? '기타는 설명을 적어 주세요.' : '';
  if (error) {
    byId('reportError').textContent = error;
    show('reportError', true);
    return;
  }
  mockReports.push({ nickname: person ? person.nickname : '', reason: reportDraft.reason, detail });
  reportDraft.doneText = '운영자가 확인한 뒤 필요한 조치를 해요.';
  if (reportDraft.alsoBlock && person) {
    blockPerson(person, false);
    reportDraft.doneText += ' 이 사람은 차단했어요.';
  }
  reportDraft.done = true;
  show('reportError', false);
  renderReportSheet();
}

// ---------- 친구 상세 시트에 사진 · 차단 확인 · 오프라인 표시를 더한다 ----------
const renderPersonSheetBase = renderPersonSheet;
renderPersonSheet = function renderPersonSheetWithBlock() {
  renderPersonSheetBase();
  const person = personById(personEditingId);
  if (!person) return;
  byId('personAvatar').replaceChildren(buildAvatar(displayName(person), person.withdrawn ? null : person.photo, 48));
  show('blockPanel', blockPanelOpen);
  setCheck('blockDeleteRow', 'blockDeleteBox', blockDelete);
  setDisabled('personRemove', !online);
  setDisabled('personBlock', !online);
  show('personOffline', !online);
};

const openPersonSheetBase = openPersonSheet;
openPersonSheet = function openPersonSheetWithBlock(id) {
  blockPanelOpen = false;
  blockDelete = false;
  openPersonSheetBase(id);
};

const removePersonBase = removePerson;
removePerson = function removePersonOnline(kind) {
  if (!online) return;
  removePersonBase(kind);
};

// 디자인 확인용 시트 버튼에 3-1단계 시트를 더한다. 로그인이 필요한 시트는 로그인 상태로 바꿔서 보여 준다.
function ensureSignedIn() {
  if (isGuest()) {
    session = SIGNED_IN();
    renderAccountViews();
  }
}

const openDesignLayerBase = openDesignLayer;
openDesignLayer = function openDesignLayerWithSession(name) {
  if (name === 'photo') {
    ensureSignedIn();
    jumpToPage('settings');
    openPhotoSheet();
  } else if (name === 'nick') {
    ensureSignedIn();
    jumpToPage('settings');
    openNickSheet();
  } else if (name === 'report') {
    ensureSignedIn();
    jumpToPage('people');
    openReportSheet(connectedPeople()[0].id);
  } else {
    ensureSignedIn();
    openDesignLayerBase(name);
  }
};

// ---------- 이벤트 연결 (3-1단계) ----------
byId('obStart').addEventListener('click', () => goOnboard('NOTIF'));
byId('obNotifContinue').addEventListener('click', () => { onboard.popup = true; renderOnboard(); });
byId('obNotifLater').addEventListener('click', () => afterNotifStep());
byId('obPopupAllow').addEventListener('click', () => { notifPermission = 'GRANTED'; onboard.popup = false; afterNotifStep(); });
byId('obPopupDeny').addEventListener('click', () => { notifPermission = 'BLOCKED'; onboard.popup = false; afterNotifStep(); });
byId('obAgree').addEventListener('click', () => { onboard.agreed = !onboard.agreed; renderOnboard(); });
byId('obTerms').addEventListener('click', () => { onboard.note = '이용약관 문서는 구현 단계에서 연결돼요.'; renderOnboard(); });
byId('obPrivacy').addEventListener('click', () => { onboard.note = '개인정보 처리방침 문서는 구현 단계에서 연결돼요.'; renderOnboard(); });
[['obApple', 'APPLE'], ['obGoogle', 'GOOGLE'], ['obKakao', 'KAKAO']].forEach(([id, provider]) => byId(id).addEventListener('click', () => { if (!isOff(id)) doLogin(provider); }));
byId('obGuest').addEventListener('click', startAsGuest);
byId('obLoginBack').addEventListener('click', () => { if (onboard.first) goOnboard('NOTIF'); else jumpToPage('home'); });
byId('obNickInput').addEventListener('input', renderOnboard);
byId('obNickNext').addEventListener('click', () => {
  if (isOff('obNickNext')) return;
  onboard.nickname = byId('obNickInput').value;
  goOnboard('PUBLIC');
});
byId('obPublicOn').addEventListener('click', () => { onboard.publicChoice = 'PUBLIC'; renderOnboard(); });
byId('obPublicOff').addEventListener('click', () => { onboard.publicChoice = 'PRIVATE'; renderOnboard(); });
byId('obPublicDone').addEventListener('click', () => { if (!isOff('obPublicDone')) finishNewAccount(); });

byId('guestLogin').addEventListener('click', () => openOnboard('LOGIN', false, ''));
byId('guestPromptLogin').addEventListener('click', () => openOnboard('LOGIN', false, LOGIN_PROMPTS.BACKUP.title));
byId('guestPromptClose').addEventListener('click', () => { guestPromptVisible = false; renderSessionViews(); });
byId('profileLogin').addEventListener('click', () => openOnboard('LOGIN', false, ''));
byId('peopleGateLogin').addEventListener('click', () => openOnboard('LOGIN', false, LOGIN_PROMPTS.FRIEND.title));
byId('planGateLogin').addEventListener('click', () => openOnboard('LOGIN', false, LOGIN_PROMPTS.PLAN.title));
byId('loginPromptGo').addEventListener('click', () => openOnboard('LOGIN', false, LOGIN_PROMPTS[loginPromptReason].title));
byId('loginPromptLater').addEventListener('click', () => {
  closeLayers();
  if (loginPromptReason === 'AI') byId('captureInput').focus();
});

byId('rowPhoto').addEventListener('click', openPhotoSheet);
byId('rowNick').addEventListener('click', openNickSheet);
byId('rowSearch').addEventListener('click', () => { if (!online) return; session.searchable = !session.searchable; renderAccountViews(); });
byId('rowPublic').addEventListener('click', () => { session.defaultPublic = !session.defaultPublic; renderAccountViews(); });
byId('rowBlocked').addEventListener('click', () => openPage('blocked'));

byId('nickChangeInput').addEventListener('input', () => { nickChangeArmed = false; renderNickSheet(); });
byId('nickChangeGo').addEventListener('click', changeNickname);

byId('photoGallery').addEventListener('click', openPhotoPick);
byId('photoCamera').addEventListener('click', () => startCrop(2));
byId('photoRemove').addEventListener('click', removePhoto);
byId('photoPickBack').addEventListener('click', () => { photoState.view = 'MENU'; renderPhotoSheet(); });
byId('cropOut').addEventListener('click', () => zoomCrop(-0.25));
byId('cropIn').addEventListener('click', () => zoomCrop(0.25));
byId('cropDone').addEventListener('click', savePhoto);
byId('cropCancel').addEventListener('click', () => { photoState.view = 'MENU'; photoState.draft = null; renderPhotoSheet(); });
byId('photoRetry').addEventListener('click', savePhoto);
byId('cropStage').addEventListener('pointerdown', event => {
  if (!photoState.draft) return;
  photoState.drag = { sx: event.clientX, sy: event.clientY, ox: photoState.draft.x, oy: photoState.draft.y };
});
window.addEventListener('pointermove', event => {
  const drag = photoState.drag;
  if (!drag || !photoState.draft) return;
  photoState.draft.x = drag.ox + event.clientX - drag.sx;
  photoState.draft.y = drag.oy + event.clientY - drag.sy;
  updateCrop();
});
window.addEventListener('pointerup', () => { photoState.drag = null; });
window.addEventListener('pointercancel', () => { photoState.drag = null; });

byId('personBlock').addEventListener('click', openBlockPanel);
byId('blockCancel').addEventListener('click', () => { blockPanelOpen = false; renderPersonSheet(); });
byId('blockDeleteRow').addEventListener('click', () => { blockDelete = !blockDelete; renderPersonSheet(); });
byId('blockConfirm').addEventListener('click', confirmBlock);
byId('personReport').addEventListener('click', () => openReportSheet(personEditingId));
byId('reportDetail').addEventListener('input', () => show('reportError', false));
byId('reportBlockRow').addEventListener('click', () => { reportDraft.alsoBlock = !reportDraft.alsoBlock; renderReportSheet(); });
byId('reportGo').addEventListener('click', submitReport);
byId('reportDoneOk').addEventListener('click', () => { closeLayers(); refreshAll(); });

// 디자인 확인용 버튼
document.querySelectorAll('[data-onboard]').forEach(button => button.addEventListener('click', () => openOnboard(button.dataset.onboard, true, '')));
document.querySelectorAll('[data-loginresult]').forEach(button => button.addEventListener('click', () => {
  loginOutcome = button.dataset.loginresult;
  highlight('[data-loginresult]', item => item.dataset.loginresult === loginOutcome);
}));
document.querySelectorAll('[data-session]').forEach(button => button.addEventListener('click', () => {
  session = button.dataset.session === 'guest' ? GUEST() : SIGNED_IN();
  guestPromptVisible = false;
  jumpToPage('home');
  renderAccountViews();
}));
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  if (!isGuest()) session = GUEST();
  jumpToPage('home');
  renderAccountViews();
  openLoginPrompt(button.dataset.prompt);
}));
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.tool;
  if (tool === 'offline') {
    online = !online;
    highlight('[data-tool="offline"]', () => !online);
    rerenderSession();
  } else if (tool === 'photoFail') {
    photoUploadFails = !photoUploadFails;
    highlight('[data-tool="photoFail"]', () => photoUploadFails);
  } else if (tool === 'nickRecent') {
    ensureSignedIn();
    session.nickChangedDaysAgo = session.nickChangedDaysAgo === null ? 10 : null;
    highlight('[data-tool="nickRecent"]', () => session.nickChangedDaysAgo !== null);
    jumpToPage('settings');
    renderAccountViews();
  } else if (tool === 'guestPrompt') {
    session = GUEST();
    guestPromptVisible = true;
    jumpToPage('home');
    renderAccountViews();
  }
}));

// ======================================================================
// 3-2단계: 글자 크기 · 내 데이터(백업 · 엑셀 · 초기화) · 백업 선택 · 복원 · 계정(로그아웃 · 탈퇴) · 정보 (백엔드 연결 전 목업)
// 로컬이 원본이다. 서버 백업은 로그인한 사람만 (설계도 3.6). 서버가 필요한 동작은 오프라인이면 막고 "인터넷 연결이 필요해요" (설계도 3.7 · 11.3).
// ======================================================================
PAGES.font = { id: 'fontPage', title: '글자 크기' };
PAGES.data = { id: 'dataPage', title: '내 데이터' };
PAGES.account = { id: 'accountPage', title: '계정' };
PAGES.restoreChoice = { id: 'choicePage', title: '백업 선택' };
PAGES.restore = { id: 'restorePage', title: '복원 중' };
layerIds.push('exportSheet', 'dangerSheet', 'logoutSheet', 'deviceSheet');

const formatBackupTime = date => `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const ymd = date => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const hm = date => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const APP_VERSION = '1.0.0 (목업 값)';

// 백업 상태 (설계도 3.6 · 10.1 T6): 마지막 백업 시각 · 대기 건수 · 실패 표시. 게스트는 백업이 꺼져 있다.
const backup = { lastAt: new Date(Date.now() - 3 * 3600000), pending: 0, failed: false };
// 서버에 있는 이 계정의 백업 (목업). exists=false 이면 서버에 백업이 없다.
const serverBackup = { exists: true, expenses: 42, events: 18, tasks: 7, reminders: 6, lastAt: atTime(dayStart(-1), 15, 30) };
let backupFails = false; // 디자인 확인용: [지금 백업]이 실패한다
let restoreFails = false; // 디자인 확인용: 복원이 중간에 실패한다
let homeNotice = '';
let dataNotice = '';
let infoNotice = '';

const livingTransactions = () => mockTransactions.filter(item => !item.deletedAt);
const livingEvents = () => mockEvents.filter(item => !item.deletedAt);
const livingTasks = () => mockTasks.filter(item => !item.deletedAt);
// 이 폰의 내 기록 건수 (받은 항목을 넣은 것도 기록에 들어 있다)
const phoneCounts = () => ({ expenses: livingTransactions().length, events: livingEvents().length, tasks: livingTasks().length });
const phoneRecordCount = () => {
  const counts = phoneCounts();
  return counts.expenses + counts.events + counts.tasks;
};
const countsText = counts => `지출 ${counts.expenses}건 · 일정 ${counts.events}건 · 할 일 ${counts.tasks}건`;

function backupLabel() {
  if (isGuest()) return '꺼짐';
  if (backup.failed) return '실패';
  if (backup.pending > 0) return `대기 ${backup.pending}건`;
  return backup.lastAt ? '백업됨' : '백업 없음';
}

// 로그아웃 · 탈퇴 · 다른 기기 로그인으로 이 폰의 데이터를 지운다 (설계도 3.5 · 3.7). 앱 설정(글자 크기 등)은 건드리지 않는다.
function wipeLocalData() {
  [mockTransactions, mockEvents, mockTasks, mockReceived, mockInbox, mockSent, mockPeople, mockFriendRequests, mockBlocked, mockLinkNotices].forEach(list => list.splice(0, list.length));
  Object.keys(formerNames).forEach(key => delete formerNames[key]);
  Object.keys(dailyAddCount).forEach(key => delete dailyAddCount[key]);
  alwaysChecked.clear();
  friendCountOverride = null;
  peopleNotice = '';
  stopLinkTimer();
  linkExpiresAt = 0;
  backup.lastAt = null;
  backup.pending = 0;
  backup.failed = false;
}

// ---------- 화면 이동 보조 ----------
const showPageBase2 = showPage;
showPage = function showPageWithData(name) {
  showPageBase2(name);
  show('backButton', !['home', 'onboard', 'restoreChoice', 'restore'].includes(name));
  if (name !== 'home') homeNotice = '';
  if (name !== 'data') dataNotice = '';
  if (name !== 'settings') infoNotice = '';
  renderSessionViews();
};

const renderSessionViewsBase = renderSessionViews;
renderSessionViews = function renderSessionViewsWithData() {
  renderSessionViewsBase();
  renderDataViews();
};

function renderDataViews() {
  const guest = isGuest();
  byId('homeNoticeText').textContent = homeNotice;
  show('homeNoticeBox', Boolean(homeNotice));
  byId('dataValue').textContent = backupLabel();
  show('rowAccount', !guest);
  byId('rowPeople').classList.toggle('settingRowLast', guest);
  byId('infoNoticeText').textContent = infoNotice;
  show('infoNoticeBox', Boolean(infoNotice));
  byId('appVersion').textContent = APP_VERSION;
  renderFontPage();
  if (currentPage === 'data') renderDataPage();
  if (currentPage === 'account') renderAccountPage();
  if (currentPage === 'restoreChoice') renderChoicePage();
  if (currentPage === 'restore') renderRestorePage();
  if (!byId('exportSheet').hidden) renderExportSheet();
  if (!byId('dangerSheet').hidden) renderDanger();
  if (!byId('logoutSheet').hidden) renderLogoutSheet();
}

// 서버 연결 상태가 바뀌면 열려 있는 시트까지 다시 그린다 (3-1 의 rerenderSession 에 더한다)
const rerenderSessionBase = rerenderSession;
rerenderSession = function rerenderSessionWithData() {
  rerenderSessionBase();
  renderDataViews();
};

// ---------- 내 데이터 (설계도 10.1 · 11.2 T6) ----------
function renderDataPage() {
  const guest = isGuest();
  byId('dataNoticeText').textContent = dataNotice;
  show('dataNoticeBox', Boolean(dataNotice));
  show('backupGuestCard', guest);
  show('backupPanel', !guest);
  show('backupNow', !guest);
  show('backupFailBox', !guest && backup.failed);
  byId('backupStatus').textContent = backupLabel();
  byId('backupLast').textContent = backup.lastAt ? formatBackupTime(backup.lastAt) : '없음';
  byId('backupPending').textContent = `${backup.pending}건`;
  byId('backupFailText').textContent = `백업하지 못한 변경이 있어요(${backup.pending}건). 인터넷 연결을 확인하고 [지금 백업]을 눌러 다시 시도해 주세요. 그때까지 기록은 이 폰에 안전하게 있어요.`;
  show('backupOffline', !guest && !online);
  setDisabled('backupNow', !online);
  // 초기화: 게스트는 폰의 데이터만 지우는 (c) 하나뿐이다 (설계도 3.7)
  show('rowResetFriend', !guest);
  show('rowResetShared', !guest);
  setDisabled('rowResetFriend', !online);
  setDisabled('rowResetShared', !online);
  setDisabled('rowResetAll', !guest && !online);
  show('resetOffline', !guest && !online);
  byId('resetAllHint').textContent = guest ? '이 폰의 지출 · 일정 · 할 일을 모두 지워요. 서버 백업이 없어서 되돌릴 수 없어요.' : '내 지출 · 일정 · 할 일과 서버 백업을 모두 지워요. 계정과 친구는 그대로예요.';
}

function backupNow() {
  if (isGuest() || !online) return;
  if (backupFails) {
    backup.failed = true;
    backup.pending = Math.max(1, backup.pending);
    dataNotice = '백업하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  } else {
    backup.failed = false;
    backup.pending = 0;
    backup.lastAt = new Date();
    dataNotice = '백업했어요.';
  }
  renderAccountViews();
}

// ---------- 엑셀로 내보내기 (설계도 10.3) ----------
// 실제 앱은 이 폰에서 .xlsx 파일을 만든다(서버 없음, 게스트도 가능). 미리보기에서는 만들어질 내용을 보여 준다.
const EXPORT_RANGES = ['ALL', 'MONTH', 'CUSTOM'];
const EXPORT_RANGE_LABEL = { ALL: '전체', MONTH: '이번 달', CUSTOM: '직접 선택' };
const EXPORT_KINDS = ['EXPENSE', 'EVENT', 'BOTH'];
const EXPORT_KIND_LABEL = { EXPENSE: '지출', EVENT: '일정', BOTH: '둘 다' };
const EXPENSE_COLUMNS = ['날짜', '시간', '구분', '금액', '카테고리', '메모', '입력 방식', '출처', '합계 포함'];
const EVENT_COLUMNS = ['시작 날짜', '시작 시간', '종료', '제목', '장소', '상태', '알림', '출처', '공개', '수정됨'];
const INPUT_LABEL = { MANUAL: '직접', TEXT: '텍스트', VOICE: '음성' };
const EVENT_STATUS_LABEL = { UPCOMING: '예정', PAST: '지남', COMPLETED: '완료', CANCELED: '취소' };
const exportState = { range: 'ALL', kind: 'BOTH', from: '', to: '', done: false };

// 엑셀에서 =, +, -, @ 로 시작하는 글자는 수식으로 실행될 수 있다. 이런 칸은 글자 형식으로 고정해서 저장한다 (설계도 10.3).
function safeCell(value) {
  const forceText = typeof value === 'string' && /^[=+\-@\t\r]/.test(value);
  return { value, forceText };
}

function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// 기간 → { from, to(이 날 0시 전까지), error }. 시간은 이 기기의 시간대 기준이다.
function exportBounds() {
  if (exportState.range === 'ALL') return { from: null, to: null, error: '' };
  if (exportState.range === 'MONTH') {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), error: '' };
  }
  const from = parseDateInput(exportState.from);
  const to = parseDateInput(exportState.to);
  if (!from || !to) return { from: null, to: null, error: '시작일과 종료일을 모두 골라 주세요.' };
  if (from.getTime() > to.getTime()) return { from: null, to: null, error: '시작일이 종료일보다 늦어요. 날짜를 다시 골라 주세요.' };
  return { from, to: addDays(to, 1), error: '' };
}

const sourceOf = item => (item.copiedFromId ? `${nameOfId(item.copiedFromId)}님 일정에서 복사` : item.fromId ? `${nameOfId(item.fromId)}님이 입력` : '내가 입력');

function exportSheets() {
  const bounds = exportBounds();
  const within = date => (!bounds.from || date.getTime() >= bounds.from.getTime()) && (!bounds.to || date.getTime() < bounds.to.getTime());
  const sheets = [];
  if (exportState.kind !== 'EVENT') {
    const rows = livingTransactions()
      .map(item => ({ date: new Date(item.occurredAt), item }))
      .filter(entry => within(entry.date))
      .sort((a, b) => a.date - b.date)
      .map(({ date, item }) => [ymd(date), hm(date), item.type === 'EXPENSE' ? '지출' : '수입', item.amount, item.category ?? '', item.memo ?? '', INPUT_LABEL[item.inputMethod] ?? '직접', sourceOf(item), item.includeInTotal === false ? '아니오' : '예'].map(safeCell));
    sheets.push({ name: '지출', columns: EXPENSE_COLUMNS, rows });
  }
  if (exportState.kind !== 'EXPENSE') {
    const rows = livingEvents()
      .filter(item => (item.kind === 'EXACT' || item.kind === 'FUZZY' || item.kind === 'ALL_DAY') && item.startAt)
      .map(item => ({ start: new Date(item.startAt), item }))
      .filter(entry => within(entry.start))
      .sort((a, b) => a.start - b.start)
      .map(({ start, item }) => {
        const offsets = item.offsets ?? (mockSettings.ownDefault === 'NONE' ? [] : [mockSettings.ownDefault]);
        const end = item.endAt ? `${ymd(new Date(item.endAt))} ${hm(new Date(item.endAt))}` : '';
        return [ymd(start), item.kind === 'ALL_DAY' ? '종일' : item.kind === 'FUZZY' ? item.fuzzyTime : hm(start), end, item.title, item.location ?? '', EVENT_STATUS_LABEL[item.status] ?? '', reminderListLabel(offsets), sourceOf(item), itemIsPublic(item) ? '공개' : '비공개', item.editedAt ? '예' : '아니오'].map(safeCell);
      });
    sheets.push({ name: '일정', columns: EVENT_COLUMNS, rows });
  }
  return sheets;
}

const exportFileName = () => `VoiceLife_${ymd(new Date())}.xlsx`;
const shortCell = cell => {
  const text = typeof cell.value === 'number' ? cell.value.toLocaleString('ko-KR') : String(cell.value);
  return Array.from(text).length > 18 ? `${Array.from(text).slice(0, 18).join('')}…` : text;
};

function renderExportSheet() {
  buildPills('exportRangePills', EXPORT_RANGES, value => EXPORT_RANGE_LABEL[value], [exportState.range], value => { exportState.range = value; exportState.done = false; renderExportSheet(); });
  buildPills('exportKindPills', EXPORT_KINDS, value => EXPORT_KIND_LABEL[value], [exportState.kind], value => { exportState.kind = value; exportState.done = false; renderExportSheet(); });
  const custom = exportState.range === 'CUSTOM';
  show('exportDates', custom);
  const bounds = exportBounds();
  byId('exportRangeError').textContent = bounds.error;
  show('exportRangeError', Boolean(bounds.error));
  const sheets = bounds.error ? [] : exportSheets();
  const total = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  byId('exportFileName').textContent = `파일 이름: ${exportFileName()}`;
  byId('exportCounts').textContent = sheets.map(sheet => `${sheet.name} ${sheet.rows.length}건`).join(' · ') || '—';
  const lines = [];
  sheets.forEach(sheet => {
    lines.push(textElement('p', 'fieldLabel', `시트 "${sheet.name}" · ${sheet.rows.length}건`));
    lines.push(textElement('p', 'muted', `열: ${sheet.columns.join(' · ')}`));
    sheet.rows.slice(0, 3).forEach(row => lines.push(textElement('p', 'text', row.map(shortCell).join(' · '))));
    if (sheet.rows.length > 3) lines.push(textElement('p', 'muted', `외 ${sheet.rows.length - 3}건`));
  });
  byId('exportPreview').replaceChildren(...lines);
  const empty = !bounds.error && total === 0;
  byId('exportEmpty').textContent = empty ? '이 기간에는 내보낼 기록이 없어요. 기간이나 종류를 바꿔 보세요.' : '';
  show('exportEmpty', empty);
  setDisabled('exportGo', Boolean(bounds.error) || total === 0);
  show('exportForm', !exportState.done);
  show('exportDone', exportState.done);
}

function openExportSheet() {
  exportState.range = 'ALL';
  exportState.kind = 'BOTH';
  const now = new Date();
  exportState.from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  exportState.to = ymd(now);
  exportState.done = false;
  byId('exportFrom').value = exportState.from;
  byId('exportTo').value = exportState.to;
  renderExportSheet();
  openLayer('exportSheet');
}

function runExport() {
  if (isOff('exportGo')) return;
  const sheets = exportSheets();
  byId('exportDoneText').textContent = `${exportFileName()} · ${sheets.map(sheet => `${sheet.name} ${sheet.rows.length}건`).join(', ')}. 앱에서는 파일을 만든 뒤 공유 · 저장 창이 열려요. 미리보기에서는 파일이 만들어지지 않아요.`;
  exportState.done = true;
  renderExportSheet();
}

// ---------- 초기화 · 탈퇴: 2단계 확인 (설계도 3.7) ----------
// 1단계: 무엇이 지워지는지 목록. 2단계: 단어를 직접 입력하거나 버튼을 길게 눌러야 실행된다.
const DANGER = {
  RESET_A: { title: '친구와의 공유 기록 초기화', word: '초기화', goText: '초기화하기', online: () => true },
  RESET_B: { title: '공유 데이터 전체 초기화', word: '초기화', goText: '초기화하기', online: () => true },
  RESET_C: { title: '앱 데이터 전체 초기화', word: '초기화', goText: '초기화하기', online: () => !isGuest() },
  WITHDRAW: { title: '탈퇴', word: '탈퇴', goText: '탈퇴하기', online: () => true },
};
const DANGER_VIEWS = { PICK: 'dangerPick', STEP1: 'dangerStep1', STEP2: 'dangerStep2' };
const danger = { kind: 'RESET_C', step: 'STEP1', personId: null, error: '', holding: false, timer: null, subNote: false };
const HOLD_MS = 1500;

function receivedCountFrom(personId) {
  const own = list => list.filter(item => item.fromId === personId && !item.deletedAt).length;
  return own(mockReceived) + own(mockInbox) + own(mockEvents) + own(mockTransactions);
}

// 내가 받은 항목 전체: 받은 카드 · 수신함 · 일정 · 지출에 넣은 것 (보낸 사람 id 가 붙은 것)
const allReceivedCount = () => [mockReceived, mockInbox, mockEvents, mockTransactions].reduce((sum, list) => sum + list.filter(item => item.fromId && !item.deletedAt).length, 0);
// 내 기록: 받은 항목을 넣은 것을 뺀 것
const personalCounts = () => ({
  expenses: livingTransactions().filter(item => !item.fromId).length,
  events: livingEvents().filter(item => !item.fromId).length,
  tasks: livingTasks().length,
});

function dangerLines(kind) {
  const person = personById(danger.personId);
  if (kind === 'RESET_A' && person) {
    return [
      `${displayName(person)}님과의 연결이 끊겨요.`,
      `나와 ${displayName(person)}님 사이에 주고받은 전달 기록이 지워져요. 전달 대기 중인 것은 먼저 취소돼요.`,
      `${displayName(person)}님에게서 받은 항목 ${receivedCountFrom(person.id)}건이 이 폰과 서버 백업에서 지워져요. 일정 · 지출에 넣은 것도 포함이에요.`,
      '상대 폰에 있는 내용은 그대로예요.',
      '내 지출 · 일정 · 할 일과 다른 친구는 그대로예요.',
    ];
  }
  if (kind === 'RESET_B') {
    const friends = connectedPeople().length;
    const received = allReceivedCount();
    return [
      `친구 ${friends}명과의 연결이 모두 끊겨요. 친구 목록이 비어요.`,
      '보낸 항목 기록과 받은 전달 기록, 만들어 둔 초대 링크, 서버의 공개 일정 사본이 지워져요. 내 일정 · 할 일은 모두 비공개로 바뀌어요.',
      `받은 항목 ${received}건이 이 폰과 서버 백업(받은 항목 사본 · 수신함 · 삭제 기록)에서 지워져요. 일정 · 지출에 넣은 것도 포함이에요.`,
      '상대 폰에 있는 내용은 그대로예요.',
      '계정, 내 개인 기록의 백업, 구독은 그대로예요.',
    ];
  }
  if (kind === 'RESET_C' && isGuest()) {
    return [
      `이 폰의 ${countsText(personalCounts())}이 모두 지워져요.`,
      '로그인하지 않아서 서버 백업이 없어요. 지운 기록은 복구할 수 없어요.',
    ];
  }
  if (kind === 'RESET_C') {
    return [
      `이 폰의 내 지출 · 일정 · 할 일이 모두 지워져요. 지금 ${countsText(personalCounts())}이에요.`,
      '서버의 내 백업과 공개 일정 사본도 지워져요.',
      '계정과 친구 연결, 받은 항목은 그대로예요.',
      '지운 기록은 복구할 수 없어요.',
    ];
  }
  return [
    '계정과 친구 연결이 바로 삭제돼요.',
    '내가 보낸 항목의 원본이 서버에서 지워져요. 아직 전달되지 않은 것은 취소돼요.',
    '서버 백업과 프로필 사진, 닉네임이 지워져요. 닉네임은 30일 동안 다른 사람이 쓸 수 없어요.',
    '이 폰의 앱 데이터가 지워지고 처음 화면으로 돌아가요.',
    '친구 폰에 이미 있는 항목은 남고, 보낸 사람은 "탈퇴한 사용자"로 보여요.',
    '지운 계정은 되돌릴 수 없어요.',
  ];
}

function openDanger(kind) {
  danger.kind = kind;
  danger.personId = null;
  danger.error = '';
  danger.subNote = false;
  danger.step = kind === 'RESET_A' ? 'PICK' : 'STEP1';
  cancelHold();
  byId('dangerWordInput').value = '';
  renderDanger();
  openLayer('dangerSheet');
}

function renderDanger() {
  const meta = DANGER[danger.kind];
  const needsNet = meta.online();
  byId('dangerTitle').textContent = meta.title;
  Object.entries(DANGER_VIEWS).forEach(([step, id]) => show(id, danger.step === step));
  if (danger.step === 'PICK') {
    const people = connectedPeople();
    byId('dangerPeople').replaceChildren(...(people.length
      ? people.map(person => {
        const button = makeButton('settingRow', 'settingTitle', displayName(person), () => { danger.personId = person.id; danger.step = 'STEP1'; renderDanger(); });
        button.prepend(makeAvatar(displayName(person), person.photo));
        return button;
      })
      : [textElement('p', 'agendaEmpty', '연결된 친구가 없어요.')]));
  }
  if (danger.step === 'STEP1') {
    byId('dangerLead').textContent = danger.kind === 'WITHDRAW' ? '탈퇴하면 아래 내용이 바로 적용돼요.' : '초기화하면 아래 내용이 지워져요.';
    byId('dangerList').replaceChildren(...dangerLines(danger.kind).map(line => makeDiv('featureLine', textElement('p', 'featureMark', '•'), textElement('p', 'featureText', line))));
    show('dangerSub', danger.kind === 'WITHDRAW');
    show('dangerSubNote', danger.kind === 'WITHDRAW' && danger.subNote);
    show('dangerOffline', needsNet && !online);
    setDisabled('dangerNext', needsNet && !online);
  }
  if (danger.step === 'STEP2') {
    byId('dangerWordHelp').textContent = `계속하려면 "${meta.word}"을(를) 입력하거나, 아래 버튼을 길게 눌러 주세요.`;
    byId('dangerGoText').textContent = meta.goText;
    byId('dangerHoldText').textContent = danger.holding ? '계속 누르고 있어요…' : `길게 눌러서 ${meta.goText.replace('하기', '')}`;
    const typed = byId('dangerWordInput').value.trim() === meta.word;
    setDisabled('dangerGo', !typed || (needsNet && !online));
    setDisabled('dangerHold', needsNet && !online);
    show('dangerOffline2', needsNet && !online);
    byId('dangerError').textContent = danger.error;
    show('dangerError', Boolean(danger.error));
  }
}

function cancelHold() {
  if (danger.timer !== null) clearTimeout(danger.timer);
  danger.timer = null;
  danger.holding = false;
}

function startHold() {
  const meta = DANGER[danger.kind];
  if (isOff('dangerHold') || danger.holding) return;
  danger.holding = true;
  renderDanger();
  danger.timer = setTimeout(() => {
    danger.timer = null;
    danger.holding = false;
    if (!byId('dangerSheet').hidden && danger.step === 'STEP2' && DANGER[danger.kind] === meta) runDanger();
  }, HOLD_MS);
}

function endHold() {
  if (!danger.holding) return;
  cancelHold();
  renderDanger();
}

// 받은 항목 삭제: 받은 카드 · 수신함 · 일정 · 지출에 넣은 것까지 (보낸 사람 id 기준)
function deleteReceivedFrom(personId) {
  const count = receivedCountFrom(personId);
  mockReceived.splice(0, mockReceived.length, ...mockReceived.filter(item => item.fromId !== personId));
  mockInbox.splice(0, mockInbox.length, ...mockInbox.filter(item => item.fromId !== personId));
  mockEvents.splice(0, mockEvents.length, ...mockEvents.filter(item => item.fromId !== personId));
  mockTransactions.splice(0, mockTransactions.length, ...mockTransactions.filter(item => item.fromId !== personId));
  return count;
}

function resetFriend(person) {
  const name = displayName(person);
  const removed = deleteReceivedFrom(person.id);
  mockSent.splice(0, mockSent.length, ...mockSent.filter(item => item.toId !== person.id));
  mockLinkNotices.splice(0, mockLinkNotices.length, ...mockLinkNotices.filter(notice => notice.personId !== person.id));
  detachPerson(person, '초기화했어요');
  dataNotice = `${name}님과의 공유 기록을 초기화했어요. 연결이 끊기고 받은 항목 ${removed}건이 지워졌어요.`;
}

function resetShared() {
  const people = [...mockPeople];
  // 연결이 이미 끊긴 사람에게서 받은 항목도 포함해서 받은 항목을 모두 지운다
  const removed = allReceivedCount();
  [mockReceived, mockInbox, mockEvents, mockTransactions].forEach(list => list.splice(0, list.length, ...list.filter(item => !item.fromId)));
  people.forEach(person => { formerNames[person.id] = displayName(person); });
  mockPeople.splice(0, mockPeople.length);
  [mockSent, mockFriendRequests, mockLinkNotices].forEach(list => list.splice(0, list.length));
  stopLinkTimer();
  linkExpiresAt = 0;
  friendCountOverride = null;
  peopleNotice = '';
  dataNotice = `공유 데이터를 모두 초기화했어요. 친구 ${people.length}명과의 연결이 끊기고 받은 항목 ${removed}건이 지워졌어요. 계정과 내 기록은 그대로예요.`;
}

function resetAll() {
  const before = Object.values(personalCounts()).reduce((sum, value) => sum + value, 0);
  [mockTransactions, mockEvents].forEach(list => list.splice(0, list.length, ...list.filter(item => item.fromId)));
  mockTasks.splice(0, mockTasks.length);
  if (!isGuest()) {
    backup.lastAt = null;
    backup.pending = 0;
    backup.failed = false;
    serverBackup.exists = false;
  }
  dataNotice = `앱 데이터를 초기화했어요. 내 기록 ${before}건${isGuest() ? '' : '과 서버 백업'}이 지워졌어요.`;
}

function doWithdraw() {
  const nickname = session.nickname;
  nickHeld.push(nickname);
  wipeLocalData();
  session = GUEST();
  serverBackup.exists = false;
  closeLayers();
  jumpToPage('home');
  homeNotice = `탈퇴했어요. 계정과 서버 백업이 삭제되고 이 폰의 기록도 지워졌어요. 닉네임(${nickname})은 30일 동안 다른 사람이 쓸 수 없어요.`;
  refreshAll();
}

function runDanger() {
  const meta = DANGER[danger.kind];
  if (meta.online() && !online) {
    danger.error = '인터넷 연결이 필요해요.';
    renderDanger();
    return;
  }
  if (danger.kind === 'WITHDRAW') {
    doWithdraw();
    return;
  }
  if (danger.kind === 'RESET_A') {
    const person = personById(danger.personId);
    if (!person) return;
    resetFriend(person);
  } else if (danger.kind === 'RESET_B') {
    resetShared();
  } else {
    resetAll();
  }
  closeLayers();
  refreshAll();
  renderAccountViews();
}

// ---------- 계정: 로그인 수단 · 로그아웃 · 탈퇴 (설계도 3.7 · 10.1 T7) ----------
function renderAccountPage() {
  const guest = isGuest();
  show('accountGate', guest);
  show('accountBody', !guest);
  if (guest) return;
  byId('accountProvider').textContent = PROVIDER_LABEL[session.provider];
  byId('accountNick').textContent = session.nickname;
  setDisabled('rowWithdraw', !online);
  show('withdrawOffline', !online);
}

const logoutState = { failed: false };

function renderLogoutSheet() {
  const dirty = backup.pending > 0 || backup.failed;
  let lead;
  let go;
  if (logoutState.failed) {
    lead = `${backup.pending}건이 아직 백업되지 않았어요. 그래도 로그아웃할까요? 백업하지 못해서, 지금 로그아웃하면 이 변경은 사라지고 이 폰의 기록도 지워져요.`;
    go = '다시 시도';
  } else if (!dirty) {
    lead = '로그아웃하면 이 폰의 기록이 지워져요. 서버 백업은 그대로예요. 같은 계정으로 다시 로그인하면 복원할 수 있어요.';
    go = '로그아웃';
  } else if (online) {
    lead = `${backup.pending}건이 아직 백업되지 않았어요. 로그아웃하기 전에 먼저 백업을 시도해요. 로그아웃하면 이 폰의 기록은 지워져요.`;
    go = '백업하고 로그아웃';
  } else {
    lead = `${backup.pending}건이 아직 백업되지 않았어요. 그래도 로그아웃할까요? 인터넷에 연결되어 있지 않아 백업할 수 없어요. 지금 로그아웃하면 이 변경은 사라지고, 이 폰의 기록도 지워져요.`;
    go = '그래도 로그아웃';
  }
  byId('logoutLead').textContent = lead;
  byId('logoutGoText').textContent = go;
  show('logoutForce', logoutState.failed);
  setDisabled('logoutGo', logoutState.failed && !online);
}

function openLogoutSheet() {
  logoutState.failed = false;
  renderLogoutSheet();
  openLayer('logoutSheet');
}

function doLogout() {
  wipeLocalData();
  session = GUEST();
  closeLayers();
  jumpToPage('home');
  homeNotice = '로그아웃했어요. 이 폰의 기록이 지워졌어요. 같은 계정으로 다시 로그인하면 서버 백업에서 복원할 수 있어요.';
  refreshAll();
}

function logoutGo() {
  if (isOff('logoutGo')) return;
  const dirty = backup.pending > 0 || backup.failed;
  if (dirty && online) {
    // 로그아웃 전에 먼저 올려 본다. 실패하면 사용자에게 고르게 한다.
    if (backupFails) {
      backup.failed = true;
      logoutState.failed = true;
      renderLogoutSheet();
      return;
    }
    backup.pending = 0;
    backup.failed = false;
    backup.lastAt = new Date();
  }
  doLogout();
}

// 다른 기기에서 로그인해서 이 기기가 밀려났다 (설계도 3.5: DEVICE_REPLACED). 이 폰의 데이터를 지우고 게스트 첫 화면으로.
function deviceReplaced() {
  wipeLocalData();
  session = GUEST();
  closeLayers();
  jumpToPage('home');
  refreshAll();
  openLayer('deviceSheet');
}

// ---------- 로그인 후 백업 · 복원 (설계도 3.3 · 3.5 · 3.6 · 11.2 O6 O7) ----------
const choice = { pick: null, confirming: false };
const restoreState = { phase: 'RUNNING', done: 0, total: 0, failed: 0, timer: null };
const RESTORE_TICK_MS = 250;

function finishWithUpload(hasPhoneRecords) {
  if (hasPhoneRecords) {
    // 서버에 백업이 없으면 이 폰의 기록이 계정 데이터가 되고 전체 백업이 올라간다 (설계도 3.3)
    const counts = phoneCounts();
    Object.assign(serverBackup, { exists: true, ...counts, reminders: livingEvents().length, lastAt: new Date() });
    backup.lastAt = new Date();
    backup.pending = 0;
    backup.failed = false;
  } else {
    backup.lastAt = null;
    backup.pending = 0;
    backup.failed = false;
  }
  finishOnboard();
  homeNotice = hasPhoneRecords ? `이 폰의 기록 ${phoneRecordCount()}건을 계정에 백업했어요. 앞으로도 자동으로 백업돼요.` : '';
  renderSessionViews();
}

// 기존 계정으로 로그인했을 때: 서버 백업과 이 폰의 기록에 따라 갈린다
function afterExistingLogin(provider) {
  session = { ...SIGNED_IN(), provider };
  const phoneHas = !onboard.first && phoneRecordCount() > 0;
  if (serverBackup.exists && phoneHas) openRestoreChoice();
  else if (serverBackup.exists) startRestore();
  else finishWithUpload(phoneHas);
}

function openRestoreChoice() {
  choice.pick = null;
  choice.confirming = false;
  jumpToPage('restoreChoice');
}

function renderChoicePage() {
  byId('choiceServerCounts').textContent = countsText(serverBackup);
  byId('choiceServerWhen').textContent = `마지막 백업: ${formatBackupTime(serverBackup.lastAt)}`;
  byId('choicePhoneCounts').textContent = countsText(phoneCounts());
  [['choiceServer', 'SERVER'], ['choicePhone', 'PHONE']].forEach(([id, value]) => {
    const active = choice.pick === value;
    byId(id).classList.toggle('choiceCardActive', active);
    byId(id).setAttribute('aria-checked', String(active));
  });
  show('choiceActions', !choice.confirming);
  show('choiceConfirm', choice.confirming);
  setDisabled('choiceNext', choice.pick === null || !online);
  show('choiceOffline', !online);
  setDisabled('choiceYes', !online);
  if (choice.confirming) {
    const server = choice.pick === 'SERVER';
    byId('choiceConfirmTitle').textContent = server ? '서버 백업을 불러올까요?' : '이 폰 기록으로 덮어쓸까요?';
    byId('choiceConfirmBody').textContent = server
      ? `이 폰의 기록(${countsText(phoneCounts())})이 지워지고 서버 백업(${countsText(serverBackup)})으로 바뀌어요. 되돌릴 수 없어요.`
      : `서버 백업(${countsText(serverBackup)})이 지워지고 이 폰의 기록(${countsText(phoneCounts())})으로 바뀌어요. 되돌릴 수 없어요.`;
    byId('choiceYesText').textContent = server ? '서버 백업 불러오기' : '이 폰 기록으로 덮어쓰기';
  }
}

function confirmChoice() {
  if (!online || choice.pick === null) return;
  if (choice.pick === 'SERVER') {
    startRestore();
    return;
  }
  finishWithUpload(true);
  homeNotice = `서버 백업을 지우고 이 폰의 기록 ${phoneRecordCount()}건으로 덮어썼어요.`;
  renderSessionViews();
}

function startRestore() {
  if (restoreState.timer !== null) clearInterval(restoreState.timer);
  Object.assign(restoreState, { phase: 'RUNNING', done: 0, total: serverBackup.expenses + serverBackup.events + serverBackup.tasks, failed: 0 });
  jumpToPage('restore');
  runRestoreTimer();
}

function runRestoreTimer() {
  if (restoreState.timer !== null) clearInterval(restoreState.timer);
  restoreState.phase = 'RUNNING';
  restoreState.failed = 0;
  restoreState.timer = setInterval(tickRestore, RESTORE_TICK_MS);
  renderRestorePage();
}

function stopRestoreTimer() {
  if (restoreState.timer !== null) clearInterval(restoreState.timer);
  restoreState.timer = null;
}

function failRestore() {
  stopRestoreTimer();
  restoreState.phase = 'FAILED';
  restoreState.failed = restoreState.total - restoreState.done;
  renderRestorePage();
}

function tickRestore() {
  if (currentPage !== 'restore') {
    stopRestoreTimer();
    return;
  }
  if (!online) {
    failRestore();
    return;
  }
  restoreState.done = Math.min(restoreState.total, restoreState.done + Math.ceil(restoreState.total / 8));
  if (restoreFails && restoreState.done >= Math.ceil(restoreState.total * 0.6)) {
    failRestore();
    return;
  }
  if (restoreState.done >= restoreState.total) {
    stopRestoreTimer();
    restoreState.phase = 'DONE';
    backup.lastAt = serverBackup.lastAt;
    backup.pending = 0;
    backup.failed = false;
  }
  renderRestorePage();
}

function renderRestorePage() {
  const { phase, done, total, failed } = restoreState;
  const percent = total ? Math.round((done / total) * 100) : 0;
  byId('restoreLastBackup').textContent = `이전 기기의 마지막 백업: ${formatBackupTime(serverBackup.lastAt)}. 그 이후 이전 기기에서 바꾼 내용은 옮겨지지 않을 수 있어요.`;
  show('restoreRunning', phase !== 'DONE');
  show('restoreDone', phase === 'DONE');
  show('restoreFailed', phase === 'FAILED');
  byId('restoreLabel').textContent = phase === 'FAILED' ? `복원이 멈췄어요 · ${percent}%` : `복원 중 · ${percent}%`;
  byId('restoreCount').textContent = `${done} / ${total}건`;
  byId('restoreFill').style.flexGrow = String(percent);
  byId('restoreRest').style.flexGrow = String(100 - percent);
  byId('restoreFailedText').textContent = `복원하지 못한 기록이 ${failed}건 있어요.${online ? ' 잠시 뒤 다시 시도해 주세요.' : ' 인터넷 연결이 필요해요. 연결된 뒤에 다시 시도해 주세요.'}`;
  setDisabled('restoreRetry', !online);
  byId('restoreDoneText').textContent = `${countsText(serverBackup)}을 복원했어요. 앞으로의 일정 알림 ${serverBackup.reminders}건을 다시 예약했어요.`;
}

function continueAfterRestore() {
  openOnboard('NOTIF', false, '');
  onboard.afterRestore = true;
}

// 알림 설명(O2) 뒤: 복원 직후이면 홈으로, 첫 실행이면 로그인 선택으로
function afterNotifStep() {
  if (onboard.afterRestore) {
    onboard.afterRestore = false;
    finishOnboard();
    homeNotice = `백업을 복원했어요. ${countsText(serverBackup)}. 되돌리기 기록은 백업되지 않아서 복원 뒤에는 이전 변경을 되돌릴 수 없어요.`;
    renderSessionViews();
    return;
  }
  goOnboard('LOGIN');
}

const openOnboardBase = openOnboard;
openOnboard = function openOnboardAfterReset(step, first, reason) {
  onboard.afterRestore = false;
  openOnboardBase(step, first, reason);
};

// 디자인 확인용 시트 버튼에 3-2단계 시트를 더한다
const openDesignLayerBase2 = openDesignLayer;
openDesignLayer = function openDesignLayerWithData(name) {
  if (['export', 'reset', 'logout', 'withdraw', 'device'].includes(name)) {
    if (!connectedPeople().length && !mockTransactions.length) restoreTransactions();
    if (name !== 'reset') ensureSignedIn();
    if (name === 'export') { jumpToPage('data'); openExportSheet(); }
    else if (name === 'reset') { jumpToPage('data'); openDanger('RESET_C'); }
    else if (name === 'logout') { jumpToPage('account'); openLogoutSheet(); }
    else if (name === 'withdraw') { jumpToPage('account'); openDanger('WITHDRAW'); }
    else deviceReplaced();
    return;
  }
  if (!connectedPeople().length) restoreTransactions();
  openDesignLayerBase2(name);
};

// ---------- 이벤트 연결 (3-2단계) ----------
byId('rowFontSize').addEventListener('click', () => openPage('font'));
byId('rowData').addEventListener('click', () => openPage('data'));
byId('rowAccount').addEventListener('click', () => openPage('account'));
[['rowTerms', 'terms'], ['rowPrivacy', 'privacy'], ['rowContact', 'contact'], ['rowOss', 'oss']].forEach(([id, key]) => byId(id).addEventListener('click', () => {
  infoNotice = { terms: '이용약관 문서는 구현 단계에서 연결돼요.', privacy: '개인정보 처리방침 문서는 구현 단계에서 연결돼요.', contact: '문의하기는 구현 단계에서 문의 방법과 연결돼요.', oss: '오픈소스 라이선스 목록은 구현 단계에서 연결돼요.' }[key];
  renderSessionViews();
}));
byId('homeNoticeClose').addEventListener('click', () => { homeNotice = ''; renderSessionViews(); });

// 글자 크기
const fontIndex = () => FONT_STEPS.indexOf(fontState.percent);
byId('fontMinus').addEventListener('click', () => { if (!isOff('fontMinus')) setFontPercent(FONT_STEPS[Math.max(0, fontIndex() - 1)]); });
byId('fontPlus').addEventListener('click', () => { if (!isOff('fontPlus')) setFontPercent(FONT_STEPS[Math.min(FONT_STEPS.length - 1, fontIndex() + 1)]); });
byId('fontReset').addEventListener('click', () => { if (!isOff('fontReset')) setFontPercent(100); });
byId('rowFontFollow').addEventListener('click', () => setFontFollow(!fontState.follow));
const sliderDrag = { active: false };
const THUMB = 28;
function fontFromPointer(event) {
  const rect = byId('fontSliderBar').getBoundingClientRect();
  const ratio = (event.clientX - rect.left - THUMB / 2) / Math.max(1, rect.width - THUMB);
  const index = Math.round(Math.min(1, Math.max(0, ratio)) * (FONT_STEPS.length - 1));
  if (FONT_STEPS[index] !== fontState.percent) setFontPercent(FONT_STEPS[index]);
}
byId('fontSlider').addEventListener('pointerdown', event => {
  if (fontState.follow) return;
  sliderDrag.active = true;
  fontFromPointer(event);
});
window.addEventListener('pointermove', event => { if (sliderDrag.active) fontFromPointer(event); });
window.addEventListener('pointerup', () => { sliderDrag.active = false; });
window.addEventListener('pointercancel', () => { sliderDrag.active = false; });
byId('fontSlider').addEventListener('keydown', event => {
  if (fontState.follow) return;
  const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
  if (event.key in moves) setFontPercent(FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, fontIndex() + moves[event.key]))]);
  else if (event.key === 'Home') setFontPercent(FONT_MIN);
  else if (event.key === 'End') setFontPercent(FONT_MAX);
  else return;
  event.preventDefault();
});

// 내 데이터
byId('backupLogin').addEventListener('click', () => openOnboard('LOGIN', false, LOGIN_PROMPTS.BACKUP.title));
byId('backupNow').addEventListener('click', backupNow);
byId('rowExport').addEventListener('click', openExportSheet);
byId('exportFrom').addEventListener('input', event => { exportState.from = event.target.value; renderExportSheet(); });
byId('exportTo').addEventListener('input', event => { exportState.to = event.target.value; renderExportSheet(); });
byId('exportGo').addEventListener('click', () => runExport());
byId('rowResetFriend').addEventListener('click', () => { if (!isOff('rowResetFriend')) openDanger('RESET_A'); });
byId('rowResetShared').addEventListener('click', () => { if (!isOff('rowResetShared')) openDanger('RESET_B'); });
byId('rowResetAll').addEventListener('click', () => { if (!isOff('rowResetAll')) openDanger('RESET_C'); });
byId('dangerNext').addEventListener('click', () => { if (isOff('dangerNext')) return; danger.step = 'STEP2'; danger.error = ''; byId('dangerWordInput').value = ''; renderDanger(); });
byId('dangerBack').addEventListener('click', () => { cancelHold(); danger.step = 'STEP1'; renderDanger(); });
byId('dangerWordInput').addEventListener('input', () => { danger.error = ''; renderDanger(); });
byId('dangerGo').addEventListener('click', () => { if (!isOff('dangerGo')) runDanger(); });
byId('dangerSubManage').addEventListener('click', () => { danger.subNote = true; renderDanger(); });
byId('dangerHold').addEventListener('pointerdown', startHold);
['pointerup', 'pointerleave', 'pointercancel'].forEach(type => byId('dangerHold').addEventListener(type, endHold));

// 계정
byId('rowLogout').addEventListener('click', openLogoutSheet);
byId('rowWithdraw').addEventListener('click', () => { if (!isOff('rowWithdraw')) openDanger('WITHDRAW'); });
byId('logoutGo').addEventListener('click', logoutGo);
byId('logoutForce').addEventListener('click', doLogout);
byId('accountGateLogin').addEventListener('click', () => openOnboard('LOGIN', false, ''));
byId('deviceOk').addEventListener('click', closeLayers);
byId('accountSubManage').addEventListener('click', () => show('accountSubNote', true));

// 백업 선택 · 복원
byId('choiceServer').addEventListener('click', () => { choice.pick = 'SERVER'; choice.confirming = false; renderChoicePage(); });
byId('choicePhone').addEventListener('click', () => { choice.pick = 'PHONE'; choice.confirming = false; renderChoicePage(); });
byId('choiceNext').addEventListener('click', () => { if (isOff('choiceNext')) return; choice.confirming = true; renderChoicePage(); });
byId('choiceAgain').addEventListener('click', () => { choice.confirming = false; renderChoicePage(); });
byId('choiceYes').addEventListener('click', confirmChoice);
byId('restoreRetry').addEventListener('click', () => { if (!isOff('restoreRetry')) runRestoreTimer(); });
byId('restoreContinue').addEventListener('click', continueAfterRestore);

// 디자인 확인용 버튼
document.querySelectorAll('[data-fontset]').forEach(button => button.addEventListener('click', () => {
  fontState.follow = false;
  setFontPercent(Number(button.dataset.fontset));
}));
document.querySelectorAll('[data-fontsys]').forEach(button => button.addEventListener('click', () => setSystemFont(Number(button.dataset.fontsys))));
document.querySelectorAll('[data-serverbackup]').forEach(button => button.addEventListener('click', () => {
  serverBackup.exists = button.dataset.serverbackup === 'HAS';
  highlight('[data-serverbackup]', item => item.dataset.serverbackup === (serverBackup.exists ? 'HAS' : 'NONE'));
}));
document.querySelectorAll('[data-restorepage]').forEach(button => button.addEventListener('click', () => {
  ensureSignedIn();
  if (!connectedPeople().length && !mockTransactions.length) restoreTransactions();
  serverBackup.exists = true;
  if (button.dataset.restorepage === 'CHOICE') openRestoreChoice();
  else startRestore();
}));
document.querySelectorAll('[data-backup]').forEach(button => button.addEventListener('click', () => {
  ensureSignedIn();
  const mode = button.dataset.backup;
  if (mode === 'pending') {
    backup.pending = backup.pending ? 0 : 3;
    backup.failed = false;
  } else if (mode === 'failed') {
    backup.failed = !backup.failed;
    backup.pending = backup.failed ? Math.max(2, backup.pending) : 0;
  } else if (mode === 'fails') {
    backupFails = !backupFails;
  } else if (mode === 'restoreFails') {
    restoreFails = !restoreFails;
  }
  highlight('[data-backup="pending"]', () => backup.pending > 0 && !backup.failed);
  highlight('[data-backup="failed"]', () => backup.failed);
  highlight('[data-backup="fails"]', () => backupFails);
  highlight('[data-backup="restoreFails"]', () => restoreFails);
  renderAccountViews();
}));
renderDataViews();

// ======================================================================
// 4단계: 7장 공개 범위 · 친구 일정 보기 (백엔드 연결 전 목업)
// 공개는 일정 · 할 일에만 있다(지출은 항상 비공개). 서버에는 공개 항목만 별도 사본(public_events)으로 올라가고,
// 친구 조회는 7.1 조건을 검사하는 서버 함수로만 허용된다 (설계도 7.3 · 13.5). 여기서는 같은 규칙을 화면에서 흉내 낸다.
// ======================================================================
const AUDIENCE_LABEL = { ALL: '모든 친구에게 공개', SELECTED: '선택한 친구에게만 공개' };
const visibility = { audienceMode: 'ALL' }; // profiles.audience_mode (설계도 13.5 update_profile_settings)
const OVERLAY_MAX = 3; // 친구 일정 겹쳐 보기: 최대 3명 (설계도 7.2)
const overlay = { on: false, ids: [], notice: '' };
const friendCal = { personId: null, month: startOfDay(new Date()), day: dayStart(0) };
const friendEventView = { personId: null, itemId: null, notice: '', copiedEventId: null };
const vizPreview = { personId: null };
let friendCalFails = false; // 디자인 확인용: 친구 일정 불러오기 실패 흉내

// ---------- 7.1 공개 규칙 ----------
// 로그인하지 않은(게스트) 상태에서는 아무것도 공개되지 않는다. 게스트 때 만든 항목은 모두 비공개로 저장돼 있다 (설계도 3.3).
function itemIsPublic(item) {
  return !isGuest() && item.isPublic === true && !item.deletedAt;
}

// 친구 F 가 나를 볼 수 있는 조건 (항목 조건 제외): 서로 친구 관계가 유효 AND "전부 비공개" 아님 AND (모든 친구 방식 OR 공개 대상에 포함)
function friendAllowed(person) {
  return person.status === 'CONNECTED' && !person.withdrawn && !person.hiddenAll
    && (visibility.audienceMode === 'ALL' || person.inAudience === true);
}

// 친구 F 가 항목 X 를 볼 수 있는 조건: X 가 PUBLIC AND friendAllowed(F). 가장 제한적인 설정이 이긴다.
const canFriendView = (person, item) => itemIsPublic(item) && friendAllowed(person);
const visibleFriends = () => mockPeople.filter(friendAllowed);

// 친구가 지금 보는 내 일정 · 할 일 (제목 · 시간 · 장소만. 메모 · 알림 · 출처는 서버에 올라가지 않는다)
function friendViewOfMine(person) {
  const events = mockEvents.filter(item => (item.kind === 'EXACT' || item.kind === 'FUZZY' || item.kind === 'ALL_DAY') && canFriendView(person, item)).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const tasks = mockTasks.filter(item => canFriendView(person, item)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return { events, tasks };
}

function hiddenReason(person) {
  if (person.withdrawn) return '탈퇴한 사용자예요. 일정이 보이지 않아요.';
  if (person.hiddenAll) return '이 친구에게 전부 비공개로 설정했어요. 아무것도 보이지 않아요.';
  if (visibility.audienceMode === 'SELECTED' && !person.inAudience) return '공개 대상에 넣지 않아서 아무것도 보이지 않아요.';
  return '';
}

const vizStatusText = person => hiddenReason(person) || '공개로 정한 일정과 할 일이 보여요.';

function visibilityHint() {
  const people = connectedPeople();
  const parts = [AUDIENCE_LABEL[visibility.audienceMode]];
  const hidden = people.filter(person => person.hiddenAll).length;
  if (hidden > 0) parts.push(`전부 비공개 ${hidden}명`);
  if (visibility.audienceMode === 'SELECTED') parts.push(`공개 대상 ${people.filter(person => person.inAudience).length}명`);
  return parts.join(' · ');
}

// 게스트 때 만든 항목은 모두 비공개로 남는다. 로그인해도 과거 항목을 한꺼번에 공개하지 않는다 (설계도 3.3).
function makeAllPrivate() {
  [...mockEvents, ...mockTasks].forEach(item => { item.isPublic = false; });
}

function defaultPublicNow() {
  return !isGuest() && session.defaultPublic;
}

// ---------- 친구가 공개한 일정 (목업: 서버의 public_events 를 7.1 조건으로 걸러 돌려준 결과) ----------
// 필드는 설계도 13.5 public_events: kind · title · time_kind · start_at · end_at · date · fuzzy_time · location · due_at · done · updated_at
const friendStamp = () => new Date().toISOString();
const friendEvent = (id, title, offset, hour, minute, minutes, location) => {
  const start = atTime(dayStart(offset), hour, minute);
  return { id, kind: 'EVENT', timeKind: 'EXACT', title, startAt: start.toISOString(), endAt: new Date(start.getTime() + minutes * 60000).toISOString(), date: null, fuzzyTime: null, location: location ?? null, dueAt: null, done: null, updatedAt: friendStamp() };
};
const friendAllDay = (id, title, offset) => ({ id, kind: 'EVENT', timeKind: 'ALL_DAY', title, startAt: null, endAt: null, date: dateKey(dayStart(offset)), fuzzyTime: null, location: null, dueAt: null, done: null, updatedAt: friendStamp() });
const friendFuzzy = (id, title, offset, fuzzy, location) => ({ id, kind: 'EVENT', timeKind: 'FUZZY', title, startAt: null, endAt: null, date: dateKey(dayStart(offset)), fuzzyTime: fuzzy, location: location ?? null, dueAt: null, done: null, updatedAt: friendStamp() });
const friendTask = (id, title, offset, done) => ({ id, kind: 'TASK', timeKind: null, title, startAt: null, endAt: null, date: null, fuzzyTime: null, location: null, dueAt: atTime(dayStart(offset), 23, 59).toISOString(), done, updatedAt: friendStamp() });

// hiddenFromMe: 그 친구가 나를 "전부 비공개"로 해 둔 경우. 서버는 일정이 없을 때와 똑같이 빈 결과만 돌려주므로 화면에서도 둘을 구별할 수 없다.
const mockFriendCalendar = {
  'p-mom': { hiddenFromMe: false, items: [
    friendEvent('fe-m1', '성당 모임', -2, 10, 0, 90, '성당'),
    friendEvent('fe-m2', '동네 식당 점심', 1, 11, 0, 120, '동네 식당'),
    friendEvent('fe-m3', '정형외과 진료', 2, 10, 30, 30, '정형외과'),
    friendTask('ft-m1', '반찬 사기', 3, false),
    friendEvent('fe-m4', '친구 모임', 4, 19, 0, 90, '시내 식당'),
    friendFuzzy('fe-m5', '산책', 5, '오후', '공원'),
    friendAllDay('fe-m6', '외할머니 생신', 6),
  ] },
  'p-dad': { hiddenFromMe: false, items: [
    friendTask('ft-d1', '세금 내기', 1, true),
    friendEvent('fe-d1', '등산', 3, 7, 0, 300, '북한산'),
  ] },
  'p-minsu': { hiddenFromMe: false, items: [
    friendEvent('fe-s1', '팀 회식', 0, 14, 30, 90, '강남'),
    friendEvent('fe-s2', '축구', 2, 18, 0, 120, '체육관'),
  ] },
  'p-jieun': { hiddenFromMe: false, items: [] },
};

function friendVisibleItems(person) {
  const data = mockFriendCalendar[person.id];
  return data && !data.hiddenFromMe ? data.items : [];
}

const friendItemDay = item => (item.kind === 'TASK' ? startOfDay(new Date(item.dueAt)) : item.timeKind === 'EXACT' ? startOfDay(new Date(item.startAt)) : parseDateKey(item.date));
const friendItemAt = item => (item.kind === 'TASK' ? Date.parse(item.dueAt) : item.timeKind === 'EXACT' ? Date.parse(item.startAt) : friendItemDay(item).getTime() + (item.timeKind === 'FUZZY' ? 1 : 0));

function friendItemsForDate(person, date) {
  return friendVisibleItems(person).filter(item => sameDay(friendItemDay(item), date)).sort((a, b) => friendItemAt(a) - friendItemAt(b));
}

function friendTimeLabel(item) {
  if (item.kind === 'TASK') {
    const due = new Date(item.dueAt);
    return due.getHours() === 23 && due.getMinutes() === 59 ? '마감' : `마감 ${formatClock(item.dueAt)}`;
  }
  if (item.timeKind === 'ALL_DAY') return '종일';
  if (item.timeKind === 'FUZZY') return item.fuzzyTime;
  return `${formatClock(item.startAt)} – ${formatClock(item.endAt)}`;
}

// 친구 일정을 내 캘린더에 복사한 일정인지 (구독 없이 한 번 복사. 출처는 "OO님 일정에서 복사", 설계도 7.2)
const copiedKeyOf = (person, item) => `${person.id}:${item.id}`;
const copiedEventOf = (person, item) => mockEvents.find(event => event.copiedKey === copiedKeyOf(person, item) && !event.deletedAt) ?? null;

function copyFriendEvent(person, item) {
  if (copiedEventOf(person, item)) return null;
  let start;
  let minutes = 60;
  if (item.timeKind === 'EXACT') {
    start = new Date(item.startAt);
    minutes = Math.max(1, Math.round((Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000));
  } else {
    start = atTime(parseDateKey(item.date), 9, 0); // 종일 · 대략적 시간 일정은 내 캘린더에 시간이 필요해서 오전 9시로 넣는다 (확인 필요)
  }
  const event = makeEventAt(newId(5000), item.title, start, minutes, item.location);
  event.copiedFromId = person.id;
  event.copiedKey = copiedKeyOf(person, item);
  event.isPublic = false; // 남에게서 온 일정은 기본 비공개 (설계도 7.1)
  mockEvents.push(event);
  return event;
}

// ---------- 일정 편집 시트: 항목별 공개 토글 (설계도 11.2 K2 · 직접 입력 폼 일정 "공개") ----------
function renderEditPublic() {
  const guest = isGuest();
  show('editPublicBlock', !guest);
  if (guest || !editing) return;
  const isEvent = editing.type === 'EVENT';
  const on = editing.isPublic === true;
  setSwitch('rowEditPublic', 'editPublicToggle', on, false);
  let hint;
  if (!on) {
    hint = `${isEvent ? '일정' : '할 일'}은 나만 봐요.`;
  } else {
    const count = visibleFriends().length;
    hint = count > 0
      ? `지금 설정으로 친구 ${count}명에게 보여요. ${isEvent ? '제목과 시간(장소 포함)' : '제목과 마감'}만 보이고, 메모와 알림은 보이지 않아요.`
      : '공개로 해 두어도 지금은 보이는 친구가 없어요. 설정 > 공개 범위에서 확인해 보세요.';
  }
  if (editing.derived) hint += ' 받은 · 복사한 일정은 기본 비공개예요.';
  byId('editPublicHint').textContent = hint;
  show('editPublicOffline', !online);
}

const openEditSheetBase = openEditSheet;
openEditSheet = function openEditSheetWithPublic(mode, type, title, date, time, id) {
  openEditSheetBase(mode, type, title, date, time, id);
  const existing = mode === 'edit' ? (type === 'EVENT' ? mockEvents : mockTasks).find(item => item.id === id) : null;
  editing.isPublic = existing ? existing.isPublic === true : defaultPublicNow();
  editing.derived = Boolean(existing && (existing.fromId || existing.copiedFromId));
  renderEditPublic();
};

const applyEditTypeBase = applyEditType;
applyEditType = function applyEditTypeWithPublic(type) {
  applyEditTypeBase(type);
  if (editing) renderEditPublic();
};

// ---------- 설정 > 공개 범위 (T4) ----------
function buildCheckRow(label, checked, disabled, ariaLabel, onClick) {
  const row = document.createElement('button');
  row.className = disabled ? 'checkRow disabled' : 'checkRow';
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', String(checked));
  row.setAttribute('aria-label', ariaLabel);
  row.append(makeDiv(checked ? 'taskBox taskBoxDone' : 'taskBox', ...(checked ? [textElement('p', 'taskCheck', '✓')] : [])), textElement('p', 'text', label));
  row.addEventListener('click', () => { if (!disabled) onClick(); });
  return row;
}

function buildVizFriend(person, last) {
  const name = displayName(person);
  const selected = visibility.audienceMode === 'SELECTED';
  const block = makeDiv(last ? 'vizFriend vizFriendLast' : 'vizFriend',
    makeDiv('row rowNoWrap vizFriendHead', makeAvatar(name, person.photo), makeDiv('personMain', textElement('p', 'personName', name), textElement('p', 'settingHint', vizStatusText(person)))),
    buildCheckRow('이 친구에게 전부 비공개', person.hiddenAll === true, false, `${name} 전부 비공개`, () => { person.hiddenAll = !person.hiddenAll; afterVisibilityChange(); }),
  );
  if (selected) {
    block.append(buildCheckRow('공개 대상에 포함', person.inAudience === true, person.hiddenAll === true, `${name} 공개 대상에 포함`, () => { person.inAudience = !person.inAudience; afterVisibilityChange(); }));
  }
  return block;
}

function previewLine(item, isEvent) {
  if (isEvent) return `${koDate(new Date(item.startAt))} ${eventTimeLabel(item)} · ${item.title}${item.location ? ` · ${item.location}` : ''}`;
  return `${koDate(new Date(item.dueAt))} 마감 · ${item.title}`;
}

function renderVizPreview(people) {
  show('vizPreviewBox', people.length > 0);
  if (people.length === 0) return;
  if (!people.some(person => person.id === vizPreview.personId)) vizPreview.personId = people[0].id;
  const person = personById(vizPreview.personId);
  buildPills('vizPreviewPills', people.map(item => item.id), id => displayName(personById(id)), [vizPreview.personId], id => { vizPreview.personId = id; renderVisibilityPage(); });
  const reason = hiddenReason(person);
  const view = reason ? { events: [], tasks: [] } : friendViewOfMine(person);
  const total = view.events.length + view.tasks.length;
  byId('vizPreviewHead').textContent = reason ? `${displayName(person)}님에게 보이는 것: 없음` : `${displayName(person)}님에게 보이는 것: 일정 ${view.events.length}건 · 할 일 ${view.tasks.length}건`;
  byId('vizPreviewReason').textContent = reason || (total === 0 ? '공개로 정한 일정이나 할 일이 아직 없어요.' : '');
  show('vizPreviewReason', Boolean(byId('vizPreviewReason').textContent));
  byId('vizPreviewList').replaceChildren(...[...view.events.map(item => previewLine(item, true)), ...view.tasks.map(item => previewLine(item, false))].slice(0, 8).map(line => textElement('p', 'text', line)));
}

function renderVisibilityPage() {
  const guest = isGuest();
  show('vizGate', guest);
  show('vizBody', !guest);
  if (guest) return;
  setSwitch('rowVizDefault', 'vizDefaultToggle', session.defaultPublic, false);
  [['vizAll', 'ALL'], ['vizSelected', 'SELECTED']].forEach(([id, value]) => {
    const active = visibility.audienceMode === value;
    byId(id).classList.toggle('choiceCardActive', active);
    byId(id).setAttribute('aria-checked', String(active));
  });
  show('vizOffline', !online);
  const people = connectedPeople();
  show('vizNoFriends', people.length === 0);
  show('vizFriendList', people.length > 0);
  byId('vizFriendList').replaceChildren(...people.map((person, index) => buildVizFriend(person, index === people.length - 1)));
  show('vizEmptyAudience', visibility.audienceMode === 'SELECTED' && people.length > 0 && !people.some(person => person.inAudience && !person.hiddenAll));
  renderVizPreview(people);
}

// 공개 설정이 바뀌면 보이는 곳을 모두 다시 그린다
function afterVisibilityChange() {
  renderAccountViews();
  if (!byId('personSheet').hidden) renderPersonSheet();
  if (!byId('editSheet').hidden) renderEditPublic();
  renderCalendar();
}

// ---------- 친구 상세 시트: 공개 범위 (설계도 5.2 · 7.1) ----------
function renderPersonVisibility(person) {
  const selected = visibility.audienceMode === 'SELECTED';
  setSwitch('rowVizHide', 'vizHideToggle', person.hiddenAll === true, false);
  setSwitch('rowVizAudience', 'vizAudienceToggle', person.inAudience === true, !selected || person.hiddenAll === true);
  byId('personVizStatus').textContent = vizStatusText(person);
  byId('vizAudienceHint').textContent = !selected
    ? '지금은 공개 대상 방식이 "모든 친구에게 공개"라서 적용되지 않아요. 설정 > 공개 범위에서 바꿀 수 있어요.'
    : person.hiddenAll ? '"전부 비공개"가 우선이라 지금은 적용되지 않아요.' : '"선택한 친구에게만 공개"일 때 켠 친구에게만 보여요.';
}

const renderPersonSheetBase2 = renderPersonSheet;
renderPersonSheet = function renderPersonSheetWithVisibility() {
  renderPersonSheetBase2();
  const person = personById(personEditingId);
  if (!person) return;
  renderPersonVisibility(person);
  setDisabled('personCalendar', !online);
};

// ---------- 친구 일정 보기 (P6, 설계도 7.2) ----------
function friendCalState(person) {
  if (!person) return 'NONE';
  if (!online) return 'OFFLINE';
  if (person.withdrawn) return 'WITHDRAWN';
  if (person.status !== 'CONNECTED') return 'NOT_CONNECTED';
  if (friendCalFails) return 'FAILED';
  return 'OK';
}

const FRIEND_CAL_NOTICE = {
  NONE: '일정을 볼 친구를 고르지 않았어요. 가족·친구에서 친구를 눌러 [일정 보기]를 눌러 주세요.',
  OFFLINE: '인터넷 연결이 필요해요. 친구 일정은 연결된 뒤에 볼 수 있어요.',
  WITHDRAWN: '탈퇴한 사용자예요. 일정을 볼 수 없어요.',
  NOT_CONNECTED: '연결이 끊긴 사용자예요. 일정을 볼 수 없어요.',
  FAILED: '일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
};

function eventSpan(item) {
  const start = Date.parse(item.startAt);
  return [start, item.endAt ? Date.parse(item.endAt) : start + 3600000];
}

// 친구 일정과 시간이 겹치는 내 일정 (시간이 정해진 일정끼리만 비교한다)
function myEventsOverlapping(date, item) {
  if (item.kind !== 'EVENT' || item.timeKind !== 'EXACT') return [];
  const start = Date.parse(item.startAt);
  const end = Date.parse(item.endAt);
  return itemsForDate(date)
    .filter(entry => entry.type === 'EVENT' && entry.item.status !== 'CANCELED')
    .filter(entry => { const [mineStart, mineEnd] = eventSpan(entry.item); return mineStart < end && start < mineEnd; })
    .map(entry => entry.item);
}

function buildFriendRow(person, item, options) {
  const done = item.kind === 'TASK' && item.done === true;
  const text = makeDiv('agendaText', textElement('p', 'agendaTime', friendTimeLabel(item)), textElement('p', done ? 'agendaTitle agendaTitleDone' : 'agendaTitle', item.title));
  if (item.location) text.append(textElement('p', 'agendaSource', `장소: ${item.location}`));
  if (options.who) text.append(makeDiv('whoLine', makeDiv(`dayDot friendDot friendDot${options.colorIndex + 1}`), textElement('p', 'agendaSource', `${displayName(person)}님`)));
  if (done) text.append(makeDiv('tag', textElement('p', 'tagText', '완료')));
  if (item.kind === 'EVENT' && copiedEventOf(person, item)) text.append(makeDiv('tag tagPublic', textElement('p', 'tagText', '내 캘린더에 있어요')));
  const overlaps = myEventsOverlapping(options.date, item);
  if (overlaps.length > 0) {
    text.append(makeDiv('tag tagOverlap', textElement('p', 'tagText', '겹침')));
    text.append(textElement('p', 'agendaSource', `겹치는 내 일정: ${overlaps.map(mine => mine.title).join(', ')}`));
  }
  if (item.kind === 'TASK') return makeDiv('agendaItem', makeDiv('agendaMain agendaMainStatic', text));
  const main = document.createElement('button');
  main.className = 'agendaMain';
  main.setAttribute('aria-label', `${friendTimeLabel(item)} ${item.title}, ${displayName(person)}님 일정, 자세히 보기`);
  main.append(text);
  main.addEventListener('click', () => openFriendEvent(person.id, item.id));
  return makeDiv('agendaItem', main);
}

function buildFriendMonthCell(person, date) {
  const active = sameDay(date, friendCal.day);
  const today = sameDay(date, dayStart(0));
  const inMonth = date.getMonth() === friendCal.month.getMonth();
  const has = friendItemsForDate(person, date).length > 0;
  const cell = document.createElement('button');
  cell.className = active ? 'monthCell monthCellActive' : 'monthCell';
  cell.setAttribute('aria-label', `${dayLabel(date)}${has ? ', 공개된 일정 있음' : ''}`);
  cell.setAttribute('aria-pressed', String(active));
  const numClass = active ? 'monthNum monthNumActive' : today ? 'monthNum monthNumToday' : inMonth ? 'monthNum' : 'monthNum monthNumOut';
  cell.append(textElement('p', numClass, String(date.getDate())), makeDiv(has ? (active ? 'dayDot dayDotOnActive' : 'dayDot dayDotOn') : 'dayDot'));
  cell.addEventListener('click', () => { friendCal.day = startOfDay(date); renderFriendCalendar(); });
  return cell;
}

function buildFriendGrid(person) {
  const head = makeDiv('monthHead', ...WEEKDAYS.map(name => textElement('p', 'monthHeadText', name)));
  const gridStart = startOfWeek(new Date(friendCal.month.getFullYear(), friendCal.month.getMonth(), 1));
  const rows = Array.from({ length: 6 }, (_, week) => makeDiv('monthRow', ...Array.from({ length: 7 }, (_, index) => buildFriendMonthCell(person, addDays(gridStart, week * 7 + index)))));
  return [head, ...rows];
}

function shiftFriendMonth(direction) {
  friendCal.month = addMonths(new Date(friendCal.month.getFullYear(), friendCal.month.getMonth(), 1), direction);
  const sameMonthAsToday = friendCal.month.getFullYear() === dayStart(0).getFullYear() && friendCal.month.getMonth() === dayStart(0).getMonth();
  friendCal.day = sameMonthAsToday ? dayStart(0) : new Date(friendCal.month.getFullYear(), friendCal.month.getMonth(), 1);
  renderFriendCalendar();
}

function renderFriendCalendar() {
  let person = personById(friendCal.personId);
  if (!person) {
    person = connectedPeople()[0] ?? null;
    friendCal.personId = person ? person.id : null;
  }
  const state = friendCalState(person);
  byId('fcalTitle').textContent = person ? `${displayName(person)}${person.withdrawn ? '' : '님'}의 일정` : '친구 일정';
  const total = person && state === 'OK' ? friendVisibleItems(person).length : 0;
  const notice = state !== 'OK' ? FRIEND_CAL_NOTICE[state] : total === 0 ? '공개된 일정이 없어요. 친구가 공개한 일정과 할 일만 보여요.' : '';
  byId('fcalNoticeText').textContent = notice;
  show('fcalNoticeBox', Boolean(notice));
  show('fcalRetry', state === 'FAILED');
  show('fcalBody', state === 'OK');
  if (state !== 'OK') return;
  byId('fcalLabel').textContent = `${friendCal.month.getFullYear()}년 ${friendCal.month.getMonth() + 1}월`;
  byId('fcalGrid').replaceChildren(...buildFriendGrid(person));
  byId('fcalDate').textContent = dayLabel(friendCal.day);
  const entries = friendItemsForDate(person, friendCal.day);
  const events = entries.filter(item => item.kind === 'EVENT');
  const tasks = entries.filter(item => item.kind === 'TASK');
  const rows = events.map(item => buildFriendRow(person, item, { date: friendCal.day }));
  if (tasks.length > 0) rows.push(textElement('p', 'agendaDate fcalTaskHead', '할 일'), ...tasks.map(item => buildFriendRow(person, item, { date: friendCal.day })));
  byId('fcalAgenda').replaceChildren(...(rows.length > 0 ? rows : [textElement('p', 'agendaEmpty', '공개된 일정이 없어요')]));
}

function openFriendCalendar(personId) {
  friendCal.personId = personId;
  friendCal.month = startOfDay(new Date());
  friendCal.day = dayStart(0);
  openPage('friendCal');
  renderFriendCalendar();
}

// ---------- 친구 일정 상세 시트 · 내 캘린더에 복사 ----------
function findFriendItem(person, itemId) {
  return friendVisibleItems(person).find(item => item.id === itemId) ?? null;
}

function renderFriendEventSheet() {
  const person = personById(friendEventView.personId);
  const item = person ? findFriendItem(person, friendEventView.itemId) : null;
  if (!person || !item) return;
  const copied = copiedEventOf(person, item);
  byId('feTitle').textContent = item.title;
  byId('feWho').textContent = `${displayName(person)}님의 일정`;
  byId('feWhen').textContent = `${dayLabel(friendItemDay(item))} ${friendTimeLabel(item)}`;
  byId('feWhere').textContent = item.location ? `장소: ${item.location}` : '';
  show('feWhere', Boolean(item.location));
  show('feFuzzyNote', item.timeKind !== 'EXACT');
  byId('feNotice').textContent = friendEventView.notice;
  show('feNoticeBox', Boolean(friendEventView.notice));
  byId('feCopyText').textContent = copied ? '복사했어요' : '내 캘린더에 복사';
  setDisabled('feCopy', Boolean(copied));
  show('feShow', Boolean(copied));
}

function openFriendEvent(personId, itemId) {
  friendEventView.personId = personId;
  friendEventView.itemId = itemId;
  friendEventView.notice = '';
  renderFriendEventSheet();
  openLayer('friendEventSheet');
}

function doCopyFriendEvent() {
  if (isOff('feCopy')) return;
  const person = personById(friendEventView.personId);
  const item = person ? findFriendItem(person, friendEventView.itemId) : null;
  if (!person || !item) return;
  const event = copyFriendEvent(person, item);
  if (event) friendEventView.notice = `내 캘린더에 복사했어요. 출처는 "${nameOfId(person.id)}님 일정에서 복사"로 보여요. 복사한 일정은 나만 봐요.`;
  renderFriendEventSheet();
  renderCalendar();
  if (currentPage === 'friendCal') renderFriendCalendar();
}

function showCopiedInCalendar() {
  const person = personById(friendEventView.personId);
  const item = person ? findFriendItem(person, friendEventView.itemId) : null;
  const event = person && item ? copiedEventOf(person, item) : null;
  if (!event) return;
  closeLayers();
  jumpToPage('home');
  focusDate = startOfDay(new Date(event.startAt));
  renderCalendar();
}

// ---------- 캘린더: 친구 일정 겹쳐 보기 (K1, 설계도 7.2) ----------
const overlayPeople = () => overlay.ids.map(personById).filter(person => person && person.status === 'CONNECTED' && !person.withdrawn);
const overlayActive = () => overlay.on && !isGuest() && online && !friendCalFails && overlay.ids.length > 0;

// 한 날짜 칸의 점: 내 일정 점 + 고른 친구마다 다른 색 점. 겹쳐 보기가 꺼져 있으면 전과 똑같다.
function buildDots(date, active) {
  const mine = document.createElement('div');
  mine.className = dotClass(date, active);
  if (!overlayActive()) return mine;
  const dots = overlayPeople()
    .filter(person => friendItemsForDate(person, date).length > 0)
    .map(person => makeDiv(`dayDot friendDot friendDot${overlay.ids.indexOf(person.id) + 1}`));
  return makeDiv('dotRow', mine, ...dots);
}

function toggleOverlayFriend(id) {
  if (overlay.ids.includes(id)) {
    overlay.ids = overlay.ids.filter(item => item !== id);
    overlay.notice = '';
  } else if (overlay.ids.length >= OVERLAY_MAX) {
    overlay.notice = `친구는 최대 ${OVERLAY_MAX}명까지 고를 수 있어요.`;
  } else {
    overlay.ids = [...overlay.ids, id];
    overlay.notice = '';
  }
  renderCalendar();
}

function renderOverlayControls() {
  const people = connectedPeople();
  const available = !isGuest() && people.length > 0;
  show('overlayPanel', available);
  const on = available && overlay.on;
  setSwitch('rowOverlay', 'overlayToggle', on, false);
  show('overlayPick', on);
  if (!on) return;
  const full = overlay.ids.length >= OVERLAY_MAX;
  buildPills('overlayPills', people.map(person => person.id), id => displayName(personById(id)), overlay.ids, toggleOverlayFriend);
  [...byId('overlayPills').children].forEach((button, index) => {
    if (full && !overlay.ids.includes(people[index].id)) {
      button.classList.add('pillDisabled');
      button.firstElementChild.classList.add('pillTextDisabled');
    }
  });
  byId('overlayLegend').replaceChildren(...overlay.ids.map(id => personById(id)).filter(Boolean).map(person => makeDiv('overlayLegendItem', makeDiv(`dayDot friendDot friendDot${overlay.ids.indexOf(person.id) + 1} legendDot`), textElement('p', 'text', displayName(person)))));
  const note = !online ? '인터넷 연결이 필요해요. 연결되면 친구 일정이 보여요.'
    : friendCalFails ? '친구 일정을 불러오지 못했어요.'
      : overlay.notice || (overlay.ids.length === 0 ? '보고 싶은 친구를 골라 주세요.' : '');
  byId('overlayNote').textContent = note;
  show('overlayNote', Boolean(note));
}

function renderOverlayAgenda() {
  if (!overlayActive()) return;
  const people = overlayPeople();
  const rows = [];
  const overlapped = new Set();
  people.forEach(person => {
    friendItemsForDate(person, focusDate).forEach(item => {
      rows.push({ person, item, at: friendItemAt(item), colorIndex: overlay.ids.indexOf(person.id) });
      myEventsOverlapping(focusDate, item).forEach(mine => overlapped.add(mine.id));
    });
  });
  rows.sort((a, b) => a.at - b.at);
  // 내 일정 줄에도 "겹침"을 표시한다
  overlapped.forEach(id => {
    const record = agendaRows.get(id);
    const text = record ? record.querySelector('.agendaText') : null;
    if (text) text.append(makeDiv('tag tagOverlap', textElement('p', 'tagText', '겹침')));
  });
  const children = [textElement('p', 'agendaDate overlayHead', '친구 일정')];
  if (rows.length === 0) children.push(textElement('p', 'agendaEmpty', '고른 친구의 공개 일정이 없어요'));
  rows.forEach(row => children.push(buildFriendRow(row.person, row.item, { date: focusDate, who: true, colorIndex: row.colorIndex })));
  byId('agenda').append(...children);
}

const renderCalendarBase = renderCalendar;
renderCalendar = function renderCalendarWithOverlay() {
  overlay.ids = overlay.ids.filter(id => { const person = personById(id); return person && person.status === 'CONNECTED' && !person.withdrawn; });
  renderCalendarBase();
  renderOverlayControls();
  renderOverlayAgenda();
};

// ---------- 다른 화면에 끼워 넣기 ----------
PAGES.visibility = { id: 'visibilityPage', title: '공개 범위' };
PAGES.friendCal = { id: 'friendCalPage', title: '친구 일정' };
layerIds.push('friendEventSheet');

const renderSessionViewsBase2 = renderSessionViews;
renderSessionViews = function renderSessionViewsWithVisibility() {
  renderSessionViewsBase2();
  const hint = byId('visibilityHint');
  if (hint) hint.textContent = visibilityHint();
  if (currentPage === 'visibility') renderVisibilityPage();
  if (currentPage === 'friendCal') renderFriendCalendar();
  if (!byId('editSheet').hidden && editing) renderEditPublic();
  if (!byId('friendEventSheet').hidden) renderFriendEventSheet();
  if (overlay.on) renderCalendar();
};

const detachPersonBase = detachPerson;
detachPerson = function detachPersonWithVisibility(person, message) {
  detachPersonBase(person, message);
  overlay.ids = overlay.ids.filter(id => id !== person.id);
  if (friendCal.personId === person.id) friendCal.personId = null;
};

const wipeLocalDataBase = wipeLocalData;
wipeLocalData = function wipeLocalDataWithVisibility() {
  wipeLocalDataBase();
  overlay.on = false;
  overlay.ids = [];
  overlay.notice = '';
  friendCal.personId = null;
};

// 탈퇴하면 계정과 함께 공개 설정도 사라진다
const doWithdrawBase = doWithdraw;
doWithdraw = function doWithdrawWithVisibility() {
  doWithdrawBase();
  visibility.audienceMode = 'ALL';
};

// 초기화 (b) 공유 데이터 전체: 서버의 공개 일정 사본이 지워진다. 사본이 없는데 항목만 "공개"로 남지 않도록 내 일정 · 할 일은 모두 비공개로 바꾼다 (설계도 3.7은 사본 삭제만 적었다 · 확인 필요).
const resetSharedBase = resetShared;
resetShared = function resetSharedWithVisibility() {
  resetSharedBase();
  makeAllPrivate();
  overlay.on = false;
  overlay.ids = [];
  friendCal.personId = null;
};

const restoreSocialBase = restoreSocial;
restoreSocial = function restoreSocialWithVisibility() {
  restoreSocialBase();
  visibility.audienceMode = 'ALL';
  overlay.on = false;
  overlay.ids = [];
  overlay.notice = '';
  friendCal.personId = null;
  friendCalFails = false;
  Object.values(mockFriendCalendar).forEach(data => { data.hiddenFromMe = false; });
};

// 게스트 때 만든 항목은 로그인해도 비공개로 남는다 (설계도 3.3)
const doLoginBase = doLogin;
doLogin = function doLoginKeepingPrivate(provider) {
  if (isGuest()) makeAllPrivate();
  doLoginBase(provider);
};

// ---------- 이벤트 연결 (4단계) ----------
byId('rowVisibility').addEventListener('click', () => openPage('visibility'));
byId('vizGateLogin').addEventListener('click', () => openOnboard('LOGIN', false, ''));
byId('rowVizDefault').addEventListener('click', () => { session.defaultPublic = !session.defaultPublic; afterVisibilityChange(); });
byId('vizAll').addEventListener('click', () => { visibility.audienceMode = 'ALL'; afterVisibilityChange(); });
byId('vizSelected').addEventListener('click', () => { visibility.audienceMode = 'SELECTED'; afterVisibilityChange(); });
byId('rowVizHide').addEventListener('click', () => { const person = personById(personEditingId); if (!person) return; person.hiddenAll = !person.hiddenAll; afterVisibilityChange(); });
byId('rowVizAudience').addEventListener('click', () => {
  const person = personById(personEditingId);
  if (!person || isOff('rowVizAudience')) return;
  person.inAudience = !person.inAudience;
  afterVisibilityChange();
});
byId('personCalendar').addEventListener('click', () => { if (isOff('personCalendar')) return; openFriendCalendar(personEditingId); });
byId('fcalPrev').addEventListener('click', () => shiftFriendMonth(-1));
byId('fcalNext').addEventListener('click', () => shiftFriendMonth(1));
byId('fcalRetry').addEventListener('click', renderFriendCalendar);
byId('feCopy').addEventListener('click', doCopyFriendEvent);
byId('feShow').addEventListener('click', showCopiedInCalendar);
byId('rowEditPublic').addEventListener('click', () => { if (!editing) return; editing.isPublic = !editing.isPublic; renderEditPublic(); });
byId('rowOverlay').addEventListener('click', () => { overlay.on = !overlay.on; overlay.notice = ''; renderCalendar(); });

// 디자인 확인용 버튼
const firstFriendId = () => (connectedPeople()[0] ? connectedPeople()[0].id : null);
document.querySelectorAll('[data-w]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.w;
  if (tool === 'cal' || tool === 'calEmpty' || tool === 'eventSheet' || tool === 'withdrawnCal') {
    if (tool === 'withdrawnCal') {
      const target = personById('p-minsu');
      if (target) target.withdrawn = true;
    }
    const id = tool === 'calEmpty' ? (personById('p-jieun') ? 'p-jieun' : firstFriendId()) : tool === 'withdrawnCal' ? 'p-minsu' : (personById('p-mom') ? 'p-mom' : firstFriendId());
    jumpToPage('people');
    refreshAll();
    openFriendCalendar(id);
    if (tool === 'eventSheet') {
      const person = personById(id);
      const first = person ? friendVisibleItems(person).find(item => item.kind === 'EVENT' && item.timeKind === 'EXACT' && Date.parse(item.startAt) > Date.now()) : null;
      if (first) {
        friendCal.day = friendItemDay(first);
        friendCal.month = friendCal.day;
        renderFriendCalendar();
        openFriendEvent(id, first.id);
      }
    }
  } else if (tool === 'overlay') {
    jumpToPage('home');
    const ids = ['p-minsu', 'p-mom'].filter(id => personById(id));
    overlay.on = true;
    overlay.ids = ids.length > 0 ? ids : connectedPeople().slice(0, 2).map(person => person.id);
    overlay.notice = '';
    focusDate = dayStart(0);
    renderCalendar();
  } else if (tool === 'hiddenFromMe') {
    const data = mockFriendCalendar['p-mom'];
    data.hiddenFromMe = !data.hiddenFromMe;
    highlight('[data-w="hiddenFromMe"]', () => data.hiddenFromMe);
    renderSessionViews();
    renderCalendar();
  } else if (tool === 'fails') {
    friendCalFails = !friendCalFails;
    highlight('[data-w="fails"]', () => friendCalFails);
    renderSessionViews();
    renderCalendar();
  }
}));

// ======================================================================
// 5단계: 지출 화면(E1) · 지출 상세(E2) · 직접 입력 폼(지출 탭) · 받은 지출 "합계 포함" (설계도 6.3 · 11.2)
// 받은 지출은 기본으로 내 합계에 들어간다. 항목마다 끄거나, 친구마다 "받는 지출의 기본값"을 정할 수 있다.
// ======================================================================
const expState = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), detailId: null, deleteArmed: false, notice: '', editId: null, editCategory: null };
sheets.expEdit = ['expenseEditSheet', 'expenseEditBackdrop'];
PAGES.expenses = { id: 'expensesPage', title: '지출' };
layerIds.push('expenseSheet');

const monthKey = date => date.getFullYear() * 12 + date.getMonth();
const inTotal = item => item.type === 'EXPENSE' && item.currencyCode === 'KRW' && !item.deletedAt && item.includeInTotal !== false;
const expenseById = id => mockTransactions.find(item => item.id === id && !item.deletedAt) ?? null;

function monthExpenses() {
  return livingTransactions()
    .filter(item => item.type === 'EXPENSE' && monthKey(new Date(item.occurredAt)) === monthKey(expState.month))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

function monthSummary() {
  const all = monthExpenses();
  const counted = all.filter(inTotal);
  const total = counted.reduce((sum, item) => sum + item.amount, 0);
  const groups = new Map();
  counted.forEach(item => { const name = item.category ?? '미분류'; groups.set(name, (groups.get(name) ?? 0) + item.amount); });
  const categories = [...groups.entries()].map(([name, amount]) => ({ name, amount, ratio: total > 0 ? amount / total : 0 })).sort((a, b) => b.amount - a.amount);
  const received = all.filter(item => item.fromId);
  return { all, total, count: counted.length, categories, receivedIncluded: received.filter(inTotal).length, excluded: all.length - counted.length };
}

function renderExpensesPage() {
  const summary = monthSummary();
  byId('expMonthLabel').textContent = `${expState.month.getFullYear()}년 ${expState.month.getMonth() + 1}월`;
  byId('expTotal').textContent = summary.total.toLocaleString('ko-KR');
  const parts = [`${summary.count}건`];
  if (summary.receivedIncluded > 0) parts.push(`받은 지출 ${summary.receivedIncluded}건 포함`);
  if (summary.excluded > 0) parts.push(`합계 제외 ${summary.excluded}건`);
  byId('expCaption').textContent = parts.join(' · ');
  show('expBody', summary.all.length > 0);
  show('expEmpty', summary.all.length === 0);
  byId('expCategories').replaceChildren(...(summary.categories.length
    ? summary.categories.map(entry => makeDiv('catRow',
      makeDiv('rowBetween', textElement('p', 'text', entry.name), textElement('p', 'text', `${entry.amount.toLocaleString('ko-KR')}원 · ${Math.round(entry.ratio * 100)}%`)),
      makeDiv('catMeter', Object.assign(makeDiv('catFill'), { style: `flex-grow: ${Math.max(1, Math.round(entry.ratio * 100))}` }), Object.assign(makeDiv('catRest'), { style: `flex-grow: ${100 - Math.max(1, Math.round(entry.ratio * 100))}` }))))
    : [textElement('p', 'agendaEmpty', '합계에 들어가는 지출이 없어요')]));
  byId('expList').replaceChildren(...summary.all.map(renderRecord));
}

function shiftExpenseMonth(direction) {
  expState.month = new Date(expState.month.getFullYear(), expState.month.getMonth() + direction, 1);
  renderExpensesPage();
}

// ---------- 지출 상세 (E2) ----------
function renderExpenseSheet() {
  const item = expenseById(expState.detailId);
  if (!item) return;
  const received = Boolean(item.fromId);
  byId('exAmount').textContent = formatAmount(item);
  byId('exCategory').textContent = item.category ?? '미분류';
  byId('exMemo').textContent = item.memo ?? '메모 없음';
  byId('exWhen').textContent = new Date(item.occurredAt).toLocaleString('ko-KR');
  byId('exSource').textContent = received ? `보낸 사람: ${nameOfId(item.fromId)}` : `내가 입력 · ${formatInputMethod(item.inputMethod)}`;
  byId('exRaw').textContent = item.rawInput ? `말한 문장: ${item.rawInput}` : '';
  show('exRaw', Boolean(item.rawInput));
  show('exIncludeBlock', received);
  setSwitch('rowExInclude', 'exIncludeToggle', item.includeInTotal !== false, false);
  byId('exIncludeHint').textContent = item.includeInTotal !== false ? '이 지출은 오늘 합계 · 월 합계 · 카테고리별 금액에 들어가요.' : '이 지출은 합계에서 빠져 있어요. 목록에는 그대로 보여요.';
  byId('exNotice').textContent = expState.notice;
  show('exNoticeBox', Boolean(expState.notice));
  show('exSend', !received);
  show('exEdit', !received);
  byId('exDeleteText').textContent = expState.deleteArmed ? '정말 지울까요? 한 번 더 누르세요' : '삭제';
}

function openExpenseDetail(id) {
  if (!expenseById(id)) return;
  expState.detailId = id;
  expState.deleteArmed = false;
  expState.notice = '';
  renderExpenseSheet();
  openLayer('expenseSheet');
}

function refreshExpenseViews() {
  refreshHomeRecords();
  if (currentPage === 'expenses') renderExpensesPage();
  if (!byId('expenseSheet').hidden) renderExpenseSheet();
}

function toggleInclude() {
  const item = expenseById(expState.detailId);
  if (!item || !item.fromId) return;
  item.includeInTotal = item.includeInTotal === false;
  item.updatedAt = new Date().toISOString();
  expState.notice = '';
  refreshExpenseViews();
}

function deleteExpense() {
  if (!expState.deleteArmed) {
    expState.deleteArmed = true;
    renderExpenseSheet();
    return;
  }
  const item = expenseById(expState.detailId);
  if (!item) return;
  const now = new Date().toISOString();
  item.deletedAt = now;
  item.updatedAt = now;
  closeLayers();
  refreshExpenseViews();
}

function sendExpenseFromDetail() {
  const item = expenseById(expState.detailId);
  if (!item || item.fromId) return;
  closeLayers();
  if (isGuest()) { openLoginPrompt('SEND'); return; }
  if (isTrial()) { openPlan('send'); return; } // 무료 체험은 일정만 보낼 수 있다 (설계도 6.1)
  openSendSheet(null);
  setSendKind('EXPENSE');
  byId('sendAmount').value = String(item.amount);
  byId('sendMemo').value = item.memo ?? '';
  sendState.category = SEND_CATEGORIES.includes(item.category) ? item.category : null;
  renderSendForm();
}

// ---------- 지출 입력 · 수정 폼 (H4 지출 탭 · E2 [수정]) ----------
function renderExpenseEdit() {
  buildPills('expCategories2', SEND_CATEGORIES, name => name, expState.editCategory ? [expState.editCategory] : [], name => {
    expState.editCategory = expState.editCategory === name ? null : name;
    renderExpenseEdit();
  });
}

function openExpenseEdit(id) {
  closeLayers();
  const item = id ? expenseById(id) : null;
  expState.editId = item ? item.id : null;
  const when = item ? new Date(item.occurredAt) : new Date();
  byId('expenseEditHeading').textContent = item ? '지출 수정' : '새 지출';
  byId('expAmount').value = item ? String(item.amount) : '';
  byId('expMemo').value = item ? (item.memo ?? '') : '';
  byId('expDate').value = dateKey(when);
  byId('expTime').value = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  expState.editCategory = item ? item.category : null;
  show('expError', false);
  renderExpenseEdit();
  showSheet('expEdit', true);
}

function closeExpenseEdit() {
  showSheet('expEdit', false);
}

function saveExpense() {
  const amount = Number(byId('expAmount').value.replace(/[,\s]/g, ''));
  const date = parseDateKey(byId('expDate').value);
  const clock = parseClock(byId('expTime').value);
  const error = !Number.isInteger(amount) || amount <= 0 ? '금액을 숫자로 적어 주세요' : !date ? '날짜를 2026-10-02 처럼 적어 주세요' : !clock ? '시간을 15:00 처럼 적어 주세요' : '';
  if (error) {
    byId('expError').textContent = error;
    show('expError', true);
    return;
  }
  const memo = byId('expMemo').value.trim();
  const when = atTime(date, clock.hour, clock.minute);
  const existing = expState.editId ? expenseById(expState.editId) : null;
  if (existing) {
    Object.assign(existing, { amount, category: expState.editCategory, memo: memo || null, occurredAt: when.toISOString(), updatedAt: new Date().toISOString() });
  } else {
    const created = makeTransaction(newId(7), amount, expState.editCategory, memo || null, 0, clock.hour, clock.minute, 'MANUAL', null);
    const iso = when.toISOString();
    Object.assign(created, { occurredAt: iso, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    mockTransactions.unshift(created);
  }
  closeExpenseEdit();
  expState.month = new Date(when.getFullYear(), when.getMonth(), 1);
  refreshExpenseViews();
}

// ---------- 친구별 기본값: "이 친구가 보낸 지출을 합계에 포함" ----------
const renderPersonSheetBase3 = renderPersonSheet;
renderPersonSheet = function renderPersonSheetWithInclude() {
  renderPersonSheetBase3();
  const person = personById(personEditingId);
  if (person) setSwitch('rowIncludeExpense', 'includeExpenseToggle', person.includeExpenseInTotal !== false, false);
};

const renderSessionViewsBase3 = renderSessionViews;
renderSessionViews = function renderSessionViewsWithExpenses() {
  renderSessionViewsBase3();
  if (currentPage === 'expenses') renderExpensesPage();
  if (!byId('expenseSheet').hidden) renderExpenseSheet();
};

// 보낸 사람이 지운 지출 등으로 목록이 바뀌었을 때도 지출 화면이 따라가도록
const refreshAllBase = refreshAll;
refreshAll = function refreshAllWithExpenses() {
  refreshAllBase();
  if (currentPage === 'expenses') renderExpensesPage();
};

// ---------- 이벤트 연결 (5단계) ----------
byId('expensesOpen').addEventListener('click', () => openPage('expenses'));
byId('expPrev').addEventListener('click', () => shiftExpenseMonth(-1));
byId('expNext').addEventListener('click', () => shiftExpenseMonth(1));
byId('expNew').addEventListener('click', () => openExpenseEdit(null));
byId('expEmptyNew').addEventListener('click', () => openExpenseEdit(null));
byId('manualButton').addEventListener('click', () => { if (!isOff('manualButton')) openManualForm('EXPENSE', byId('captureInput').value.trim()); });
byId('rowExInclude').addEventListener('click', toggleInclude);
byId('exSend').addEventListener('click', sendExpenseFromDetail);
byId('exEdit').addEventListener('click', () => { const id = expState.detailId; if (id && !expenseById(id).fromId) openExpenseEdit(id); });
byId('exDelete').addEventListener('click', deleteExpense);
byId('expenseEditClose').addEventListener('click', closeExpenseEdit);
byId('expenseEditBackdrop').addEventListener('click', closeExpenseEdit);
byId('expSave').addEventListener('click', saveExpense);
byId('rowIncludeExpense').addEventListener('click', () => {
  const person = personById(personEditingId);
  if (!person) return;
  person.includeExpenseInTotal = person.includeExpenseInTotal === false;
  renderPersonSheet();
});

document.querySelectorAll('[data-x]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.x;
  closeExpenseEdit();
  if (tool === 'detail') {
    jumpToPage('expenses');
    openExpenseDetail(livingTransactions().find(item => !item.fromId).id);
  } else if (tool === 'received') {
    const person = connectedPeople()[0];
    addReceivedToMine({ kind: 'EXPENSE', fromId: person.id, title: '가족 외식', amount: 45000, category: '식비' });
    jumpToPage('expenses');
    openExpenseDetail(mockTransactions[0].id);
    refreshAll();
  } else if (tool === 'new') {
    jumpToPage('expenses');
    openExpenseEdit(null);
  } else if (tool === 'empty') {
    jumpToPage('expenses');
    expState.month = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    renderExpensesPage();
  }
}));

// ======================================================================
// 6단계: 일정 상세(K2) · 받은 일정의 보낸 사람 아바타 · 취소됨 표시 (설계도 11.2 K1 · K2 · 11.3)
// 캘린더에서 항목을 누르면 먼저 상세가 열린다. [수정]을 누르면 기존 편집 시트가 열린다.
// ======================================================================
const kdState = { type: 'EVENT', id: null, deleteArmed: false };
layerIds.push('itemSheet');

// 알림: 항목에 저장된 값이 있으면 그것, 없으면 내가 만든 일정은 "새 일정 기본 알림"(설정), 받은 · 복사한 일정은 없음
const eventReminders = item => item.reminders ?? (item.fromId || item.copiedFromId ? [] : mockSettings.ownDefault === 'NONE' ? [] : [mockSettings.ownDefault]);

function itemByKd() {
  const list = kdState.type === 'EVENT' ? mockEvents : mockTasks;
  return list.find(item => item.id === kdState.id && item.deletedAt === null) ?? null;
}

// 작은 보낸 사람 아바타 (캘린더 줄용): 사진이 있으면 사진, 없으면 이니셜
function senderAvatar(fromId) {
  const person = personById(fromId);
  if (person && person.photo) return buildPhotoAvatar(person.photo, 28);
  return makeDiv('avatar avatarMini', textElement('p', 'avatarText avatarTextMini', initialOf(nameOfId(fromId))));
}

function buildSenderLine(fromId) {
  return makeDiv('senderLine', senderAvatar(fromId), textElement('p', 'agendaSource', `보낸 사람: ${nameOfId(fromId)}`));
}

function renderItemSheet() {
  const item = itemByKd();
  if (!item) return;
  const isEvent = kdState.type === 'EVENT';
  const canceled = isEvent && item.status === 'CANCELED';
  const received = Boolean(item.fromId);
  const copied = Boolean(item.copiedFromId);
  byId('kdHeading').textContent = isEvent ? '일정 상세' : '할 일 상세';
  byId('kdTitle').textContent = item.title;
  byId('kdTitle').classList.toggle('agendaTitleDone', canceled || (!isEvent && item.status === 'COMPLETED'));

  // 시간
  if (isEvent) {
    const start = new Date(item.startAt);
    byId('kdWhen').textContent = isAllDay(item) ? `${dayLabel(start)} 종일` : isFuzzy(item) ? `${dayLabel(start)} ${item.fuzzyTime}` : `${dayLabel(start)} ${formatClock(item.startAt)}${item.endAt ? ` – ${formatClock(item.endAt)}` : ''}`;
  } else {
    byId('kdWhen').textContent = `마감 ${dayLabel(new Date(item.dueAt))} ${agendaLabel({ type: 'TASK', item }) === '마감' ? '' : formatClock(item.dueAt)}`.trim();
  }
  byId('kdStatus').textContent = isEvent ? ({ UPCOMING: '예정', PAST: '지난 일정' }[item.status] ?? '') : (item.status === 'COMPLETED' ? '완료했어요' : '아직 안 했어요');
  show('kdStatus', !canceled); // 취소된 일정은 아래 "취소됨" 태그가 대신한다

  // 장소 · 알림 (일정만)
  show('kdPlace', isEvent);
  show('kdReminder', isEvent);
  if (isEvent) {
    byId('kdPlace').textContent = item.location ? `장소: ${item.location}` : '장소 없음';
    byId('kdReminder').textContent = `알림: ${reminderListLabel(eventReminders(item))}`;
  }
  const silent = isEvent && item.status === 'UPCOMING' && eventReminders(item).length > 0 && (notifPermission === 'BLOCKED' || !mockSettings.allOn);
  byId('kdSilent').textContent = notifPermission === 'BLOCKED' ? '기기 알림이 꺼져 있어 알림이 울리지 않아요.' : '모든 알림이 꺼져 있어 알림이 울리지 않아요.';
  show('kdSilent', silent);

  // 출처 · 수정됨 · 취소됨
  byId('kdSender').replaceChildren(...(received ? [senderAvatar(item.fromId), textElement('p', 'text', `보낸 사람: ${nameOfId(item.fromId)}`)] : [textElement('p', 'text', copied ? `${nameOfId(item.copiedFromId)}님 일정에서 복사` : '내가 입력')]));
  const tags = [];
  if (isEvent && item.editedAt && !canceled) tags.push(makeDiv('tag tagEdited', textElement('p', 'tagText', `수정됨 · ${editedStamp(item.editedAt)}`)));
  if (canceled) tags.push(makeDiv('tag tagCanceled', textElement('p', 'tagText', '취소됨')));
  byId('kdTags').replaceChildren(...tags);
  show('kdTags', tags.length > 0);
  show('kdCanceledNote', canceled);

  // 공개 토글: 게스트 기록은 항상 비공개라 숨긴다
  show('kdPublicBlock', !isGuest());
  if (!isGuest()) {
    const on = item.isPublic === true;
    setSwitch('rowKdPublic', 'kdPublicToggle', on, false);
    const count = visibleFriends().length;
    let hint = !on ? `${isEvent ? '일정' : '할 일'}은 나만 봐요.` : count > 0
      ? `지금 설정으로 친구 ${count}명에게 보여요. ${isEvent ? '제목과 시간(장소 포함)' : '제목과 마감'}만 보이고, 메모와 알림은 보이지 않아요.`
      : '공개로 해 두어도 지금은 보이는 친구가 없어요. 설정 > 공개 범위에서 확인해 보세요.';
    if (received || copied) hint += ' 받은 · 복사한 일정은 기본 비공개예요.';
    byId('kdPublicHint').textContent = hint;
    show('kdPublicOffline', !online);
  }

  // 버튼: 보내기는 내가 만든(또는 복사한) 예정 일정만, 수정은 취소된 일정이 아닐 때
  show('kdSend', isEvent && !received && item.status === 'UPCOMING');
  show('kdEdit', !canceled);
  byId('kdDeleteText').textContent = kdState.deleteArmed ? '정말 지울까요? 한 번 더 누르세요' : '삭제';
}

function openItemDetail(type, id) {
  kdState.type = type;
  kdState.id = id;
  kdState.deleteArmed = false;
  if (!itemByKd()) return;
  renderItemSheet();
  openLayer('itemSheet');
}

function kdToggleOwnPublic() {
  const item = itemByKd();
  if (!item) return;
  item.isPublic = item.isPublic !== true;
  item.updatedAt = new Date().toISOString();
  renderCalendar();
}

function kdDelete() {
  if (!kdState.deleteArmed) {
    kdState.deleteArmed = true;
    renderItemSheet();
    return;
  }
  const item = itemByKd();
  if (!item) return;
  const now = new Date().toISOString();
  item.deletedAt = now;
  item.updatedAt = now;
  closeLayers();
  renderCalendar();
}

function kdEdit() {
  const item = itemByKd();
  if (!item) return;
  const entry = { type: kdState.type, date: startOfDay(new Date(kdState.type === 'EVENT' ? item.startAt : item.dueAt)), at: 0, item };
  closeLayers();
  openEdit(entry);
}

function kdSend() {
  const item = itemByKd();
  if (!item || kdState.type !== 'EVENT' || isFuzzy(item)) return;
  closeLayers();
  if (isGuest()) { openLoginPrompt('SEND'); return; }
  if (isTrial() && !account.shareTrial) { openPlan('send'); return; }
  const start = new Date(item.startAt);
  openSendSheet(null);
  byId('sendTitle').value = item.title;
  byId('sendDate').value = dateKey(start);
  byId('sendTime').value = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  byId('sendLocation').value = item.location ?? '';
  byId('sendEnd').value = !isAllDay(item) && item.endAt ? `${pad2(new Date(item.endAt).getHours())}:${pad2(new Date(item.endAt).getMinutes())}` : '';
  sendState.timeMode = isAllDay(item) ? 'ALL_DAY' : 'EXACT';
  sendState.offsets = isAllDay(item) ? [] : eventReminders(item).filter(value => REMINDER_OFFSETS.includes(value));
  sendState.touched = true;
  renderSendForm();
}

// 항목을 고치거나 지우면 열려 있는 상세도 따라간다
const renderCalendarBaseDetail = renderCalendar;
renderCalendar = function renderCalendarWithDetail() {
  renderCalendarBaseDetail();
  if (!byId('itemSheet').hidden) {
    if (itemByKd()) renderItemSheet();
    else closeLayers();
  }
};

const renderSessionViewsBase4 = renderSessionViews;
renderSessionViews = function renderSessionViewsWithDetail() {
  renderSessionViewsBase4();
  if (!byId('itemSheet').hidden && itemByKd()) renderItemSheet();
};

// ---------- 이벤트 연결 (6단계) ----------
byId('rowKdPublic').addEventListener('click', kdToggleOwnPublic);
byId('kdSend').addEventListener('click', kdSend);
byId('kdEdit').addEventListener('click', kdEdit);
byId('kdDelete').addEventListener('click', kdDelete);

document.querySelectorAll('[data-k]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.k;
  jumpToPage('home');
  const receive = (title, dayOffset, hour, extra) => {
    addReceivedToMine({ kind: 'EVENT', fromId: 'p-mom', title, startAt: atTime(dayStart(dayOffset), hour, 0), offsets: [-60, -1440] });
    const event = mockEvents[mockEvents.length - 1];
    Object.assign(event, extra);
    return event;
  };
  let type = 'EVENT';
  let target;
  if (tool === 'own') {
    target = mockEvents[0];
    focusDate = dayStart(0);
  } else if (tool === 'task') {
    type = 'TASK';
    target = mockTasks[0];
    focusDate = dayStart(0);
  } else if (tool === 'received') {
    target = receive('어머니 생신 식사', 1, 18, {});
    focusDate = dayStart(1);
  } else if (tool === 'edited') {
    target = receive('어머니 생신 식사', 1, 19, { editedAt: new Date().toISOString() });
    focusDate = dayStart(1);
  } else if (tool === 'canceled') {
    target = receive('어머니 생신 식사', 1, 18, { status: 'CANCELED' });
    focusDate = dayStart(1);
  }
  renderCalendar();
  openItemDetail(type, target.id);
}));

// ======================================================================
// 7단계: 입력 라우터 · 결과 카드 · AI 필요 안내 · 직접 입력 폼 (설계도 4.2 ~ 4.7 · 11.2 H2 H3 H4)
// 문장을 입력하면 ① 로컬 파서(단일 지출) → 자동 저장 + [되돌리기]  ② 아니면 AI 필요 → 계정 상태에 따라 안내
// 이 파일의 "AI 해석"은 디자인 확인용 흉내(규칙 기반 목업)다. 실제 해석은 서버 게이트웨이가 한다.
// ======================================================================
const capture = { cards: [], route: null, drafts: [], lastText: '', aiFails: false, cardCounter: 0 };
const UNDO_MS = 60000; // 저장 직후 [되돌리기]를 보여 주는 시간
const FOLLOWUP_FREE = 2; // 질문에 답해 다시 해석하는 호출은 원래 요청당 2회까지 차감하지 않는다 (설계도 4.7)

// ---------- 문장 읽기 도우미 ----------
const AMOUNT_RE = /(\d[\d,]*)\s*(만|천)?\s*원/g;
function findAmounts(text) {
  return [...text.matchAll(AMOUNT_RE)].map(match => ({ value: Number(match[1].replace(/,/g, '')) * (match[2] === '만' ? 10000 : match[2] === '천' ? 1000 : 1), raw: match[0], index: match.index }));
}

const CATEGORY_WORDS = [
  ['식비', /(점심|저녁밥|아침밥|밥|식당|국밥|김밥|치킨|라면|햄버거|피자|아이스크림|간식|생수)/],
  ['카페', /(커피|아메리카노|라떼|카페|스타벅스)/],
  ['교통', /(버스|지하철|택시|기차|주유|주차)/],
  ['생활', /(세제|휴지|마트|생필품|약국)/],
];
const categoryOf = text => (CATEGORY_WORDS.find(([, pattern]) => pattern.test(text)) ?? [null])[0];

const VERB_TAIL = /(짜리)?\s*(썼어요|썼어|썼다|썼음|샀어요|샀어|샀다|먹었어요|먹었어|먹었다|먹었고|썼고|샀고|냈어요|냈어|냈다|결제했어|결제했다|씀|함)\s*$/;
function memoOfClause(clause, amounts) {
  let memo = clause;
  amounts.forEach(amount => { memo = memo.replace(amount.raw, ' '); });
  memo = memo.replace(/짜리/g, ' ').replace(VERB_TAIL, '').replace(/\s+/g, ' ').trim();
  return memo || null;
}

// 로컬 파서(설계도 4.2): 금액 "원" 1개, 수입 · 부정 · 계획 · 질문 표현이나 날짜 · 시간 · 동행어가 있으면 처리하지 않고 AI로 넘긴다
const LOCAL_REJECT = /(오늘|어제|내일|모레|그저께|\d+\s*시|오전|오후|새벽|자정|친구|랑|같이|함께|하고|받았|월급|입금|벌었|안\s*(썼|샀|먹|마셨|냈|산)|않|못|없|할\s*거|할게|예정|쓸게|사야|\?|얼마|(에게|한테)\s*(줘|보내|전해))/;
function localParse(text) {
  const amounts = findAmounts(text);
  if (amounts.length !== 1 || LOCAL_REJECT.test(text)) return null;
  return { amount: amounts[0].value, category: categoryOf(text), memo: memoOfClause(text, amounts) };
}

// ---------- 시간 읽기 (설계도 4.4) ----------
const MEETING_RE = /(약속|만나|미팅|회의|예약|모임|면접|진료|병원|수업|행사|파티)/;
const TIME_RE = /(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(반|\d{1,2}\s*분)?|(\d{1,2}):(\d{2})/;
function readTime(text) {
  const match = text.match(TIME_RE);
  if (!match) return null;
  if (match[4] !== undefined) return { hour: Number(match[4]), minute: Number(match[5]), cue: null, raw: match[0], twentyFour: true };
  const hour = Number(match[2]);
  const minute = match[3] === '반' ? 30 : match[3] ? Number(match[3].replace(/\D/g, '')) : 0;
  return { hour, minute, cue: match[1] ?? null, raw: match[0], twentyFour: hour >= 13 || hour === 0 };
}
const clockLabel = (hour, minute) => `${hour < 12 ? '오전' : '오후'} ${hour % 12 === 0 ? 12 : hour % 12}시${minute ? ` ${minute}분` : ''}`;
const dateWord = text => (/모레/.test(text) ? 2 : /내일/.test(text) ? 1 : 0);

// 일정 시각 결정. 돌려주는 값: { start, note } | { ask: 'MERIDIEM' | 'TOMORROW', ... }
function resolveEventTime(dayOffset, time) {
  const { hour, minute, cue, twentyFour } = time;
  const at = h => atTime(dayStart(dayOffset), h, minute);
  if (cue || twentyFour) {
    const h = twentyFour ? (hour === 0 ? 24 : hour) : cue === '오전' || cue === '아침' || cue === '새벽' ? hour % 12 : cue === '점심' ? (hour <= 3 ? hour + 12 : hour) : (hour % 12) + 12;
    return { start: h === 24 ? atTime(dayStart(dayOffset + 1), 0, minute) : at(h), note: '' };
  }
  if (hour === 12) {
    const start = at(12);
    return start.getTime() < Date.now() && dayOffset === 0 ? { ask: 'TOMORROW', hour, minute } : { start, note: '' };
  }
  if (dayOffset === 0) {
    const candidates = [at(hour % 12), at((hour % 12) + 12)].filter(date => date.getTime() > Date.now());
    return candidates.length ? { start: candidates[0], note: `${clockLabel(candidates[0].getHours(), minute)}로 저장했어요` } : { ask: 'TOMORROW', hour, minute };
  }
  if (hour >= 7 && hour <= 11) return { ask: 'MERIDIEM', hour, minute, dayOffset };
  return { start: at((hour % 12) + 12), note: `${clockLabel((hour % 12) + 12, minute)}로 저장했어요` };
}

function readReminder(text) {
  if (!/(알려|알림)/.test(text)) return null;
  if (/하루\s*전/.test(text)) return -1440;
  if (/한\s*시간\s*전/.test(text)) return -60;
  const minutes = text.match(/(\d+)\s*분\s*전/);
  if (minutes) return -Number(minutes[1]);
  return 0;
}

// 문장에서 제목 · 장소를 뽑는다. "강남역에서 만나기" → 장소 "강남역", 제목 "만나기" (설계도 4.6)
function eventPartsOf(clause, time) {
  let title = clause.replace(/(오늘|내일|모레)/g, ' ').replace(/(하루|한\s*시간|\d+\s*분)\s*전에?\s*(알려\s*줘|알림(\s*해\s*줘|\s*줘)?)?/g, ' ').replace(/(알려\s*줘|알림)\s*$/g, ' ').replace(/(만나는데|만나서|만나고)/g, '만나').replace(/이걸.*$/, ' ').replace(/\S+\s*(에게|한테)\s*(줘|보내줘|보내|전해줘)\s*$/, ' ');
  if (time) title = title.replace(`${time.raw}에`, ' ').replace(time.raw, ' ');
  let location = null;
  const place = title.match(/(\S+?)에서/);
  if (place) { location = place[1]; title = title.replace(place[0], ' '); }
  title = title.replace(/(아침|점심|오후|저녁|밤|새벽)\s*(쯤|무렵)\s*(에)?|하루\s*종일|종일/g, ' ').replace(/(있다|있어요|있어|있음|잡혔어|잡혔다|이야|이다|해야\s*해|해야돼)\s*$/, '').replace(/만나\s*$/, '만나기').replace(/\s+/g, ' ').trim();
  return { title: title || '일정', location };
}

// ---------- 해석 흉내 (서버 AI 게이트웨이 자리) ----------
function mockInterpret(rawText) {
  const text = rawText.replace(/(\d),(?=\d{3})/g, '$1'); // 12,000 의 쉼표는 구분 기호가 아니다
  const amounts = findAmounts(text);
  const meeting = MEETING_RE.test(text);
  if (!amounts.length && !meeting) return { ok: false, reason: 'UNSUPPORTED' };
  const actions = [];
  const sendMatch = text.match(/(에게|한테)\s*(줘|보내|전해)/);

  // 묶음 지출(설계도 4.5): 총액이 있으면 항상 1건
  if (/(총|합쳐서|다\s*해서|전부\s*해서|모두)/.test(text) && amounts.length >= 1 && !meeting) {
    const total = amounts[amounts.length - 1];
    const parts = amounts.slice(0, -1);
    const sum = parts.reduce((acc, item) => acc + item.value, 0);
    let rest = text;
    amounts.forEach(amount => { rest = rest.replace(amount.raw, ' '); });
    const memo = rest.replace(/(총|합쳐서|다\s*해서|전부\s*해서|모두|먹었고|샀고|썼고|먹었어요|먹었어|샀어요|샀어|썼어요|썼어|썼다|먹었다|이고|이며|해서)/g, ' ').split(/\s+/).filter(Boolean).join(', ') || null;
    if (parts.length >= 2 && sum !== total.value) actions.push({ kind: 'EXPENSE', ask: 'TOTAL', amount: total.value, sum, category: categoryOf(text), memo });
    else actions.push({ kind: 'EXPENSE', amount: total.value, category: categoryOf(text), memo });
    return { ok: true, actions };
  }

  const clauses = text.split(/(?<=고)\s+|[.,，]\s*/).map(item => item.trim()).filter(Boolean);
  let lastEvent = null;
  const reminders = [];
  clauses.forEach(clause => {
    const found = findAmounts(clause);
    const reminder = readReminder(clause);
    if (reminder !== null && !found.length && !MEETING_RE.test(clause)) { reminders.push(reminder); return; }
    if (found.length) {
      const time = readTime(clause);
      let when = null;
      let note = '';
      if (time) {
        const { hour, minute, cue, twentyFour } = time;
        const options = cue || twentyFour ? [resolveEventTime(0, time).start] : [atTime(dayStart(0), hour % 12, minute), atTime(dayStart(0), (hour % 12) + 12, minute), atTime(dayStart(-1), (hour % 12) + 12, minute)];
        const past = options.filter(date => date && date.getTime() <= Date.now()).sort((a, b) => b - a);
        when = past[0] ?? options[options.length - 1];
        note = cue || twentyFour ? '' : `${clockLabel(when.getHours(), minute)}로 저장했어요`;
      }
      const base = time ? clause.replace(`${time.raw}에`, ' ').replace(time.raw, ' ') : clause;
      const baseAmounts = findAmounts(base);
      baseAmounts.forEach((amount, index) => {
        const from = index ? baseAmounts[index - 1].index + baseAmounts[index - 1].raw.length : 0;
        const piece = baseAmounts.length > 1 ? base.slice(from, amount.index) : base;
        actions.push({ kind: 'EXPENSE', amount: amount.value, category: categoryOf(piece), memo: baseAmounts.length > 1 ? (piece.replace(VERB_TAIL, '').trim() || null) : memoOfClause(base, baseAmounts), when, note });
      });
      return;
    }
    if (MEETING_RE.test(clause)) {
      const time = readTime(clause);
      const dayOffset = dateWord(clause);
      const parts = eventPartsOf(clause, time);
      const action = { kind: 'EVENT', title: parts.title, location: parts.location, dayOffset, reminder: readReminder(clause) };
      const fuzzy = time ? null : (clause.match(/(아침|점심|오후|저녁|밤)\s*(쯤|무렵)/) ?? [])[1];
      if (fuzzy) Object.assign(action, { fuzzy: `${fuzzy}쯤`, note: `${fuzzy}쯤으로 저장했어요` }); // 설계도 4.4: 정확하지 않은 시간은 대략적 시간으로
      else if (!time && /(하루\s*종일|종일)/.test(clause)) Object.assign(action, { allDay: true, note: '종일 일정으로 저장했어요' }); // 설계도 4.4 · 6.2: 시간은 정확한 시각 또는 종일
      else if (!time) action.ask = 'TIME';
      else Object.assign(action, resolveEventTime(dayOffset, time), { hour: time.hour, minute: time.minute });
      actions.push(action);
      lastEvent = action;
    }
  });
  if (reminders.length && lastEvent) lastEvent.reminder = reminders[0];
  else if (reminders.length) actions.push({ kind: 'REMINDER', failed: true });
  // 음성으로 보내기(설계도 4.6): 남에게 보내는 동작은 항상 확인 화면을 거친다
  if (sendMatch && lastEvent) {
    const names = connectedPeople().filter(person => [...(person.alias || '').split(/\s+/), person.nickname].some(token => token && text.includes(token)));
    lastEvent.send = { recipients: names.map(person => person.id) };
  }
  // 정확한 시각이 필요한 알림 · 보내기를 요청했다면 대략적 시간으로 저장하지 않고 시각을 묻는다 (설계도 4.4 · 6.2)
  if (lastEvent && lastEvent.fuzzy && ((lastEvent.reminder !== null && lastEvent.reminder !== undefined) || lastEvent.send)) {
    lastEvent.needExact = lastEvent.send ? 'SEND' : 'REMINDER';
    delete lastEvent.fuzzy;
    delete lastEvent.note;
    lastEvent.ask = 'TIME';
  }
  // 종일 일정도 알림은 맞출 수 없다: 알림을 부탁했다면 시각을 묻는다 (설계도 4.4)
  if (lastEvent && lastEvent.allDay && lastEvent.reminder !== null && lastEvent.reminder !== undefined) {
    lastEvent.needExact = 'REMINDER';
    delete lastEvent.allDay;
    delete lastEvent.note;
    lastEvent.ask = 'TIME';
  }
  return actions.length ? { ok: true, actions } : { ok: false, reason: 'UNSUPPORTED' };
}

// ---------- 저장 · 카드 ----------
function nextCardId() {
  capture.cardCounter += 1;
  return capture.cardCounter;
}

function saveExpenseFromCapture(action, text, method) {
  const now = new Date();
  const when = action.when ?? now;
  const item = makeTransaction(newId(9), action.amount, action.category, action.memo, 0, when.getHours(), when.getMinutes(), method, text);
  item.occurredAt = when.toISOString();
  item.createdAt = now.toISOString();
  item.updatedAt = item.createdAt;
  mockTransactions.unshift(item);
  return item;
}

function saveEventFromCapture(action) {
  const event = action.allDay ? makeAllDayEvent(newId(2300), action.title, dayStart(action.dayOffset), action.location ?? null) : action.fuzzy ? makeFuzzyEvent(newId(2300), action.title, dayStart(action.dayOffset), action.fuzzy, action.location ?? null) : makeEventAt(newId(2300), action.title, action.start, 60, action.location ?? null);
  event.isPublic = defaultPublicNow();
  event.reminders = action.fuzzy || action.allDay ? [] : action.reminder !== null && action.reminder !== undefined ? [action.reminder] : (mockSettings.ownDefault === 'NONE' ? [] : [mockSettings.ownDefault]);
  mockEvents.push(event);
  focusDate = startOfDay(action.fuzzy || action.allDay ? dayStart(action.dayOffset) : action.start);
  return event;
}

function chargeAi() {
  account.aiUsed += 1;
  if (account.dayLimit !== null) account.dayUsed += 1;
  renderAccountViews();
}

// 액션 하나를 카드로: 질문이 없으면 바로 저장한다
function makeCard(action, text, ai, ctx) {
  const card = { id: nextCardId(), kind: action.kind, status: 'SAVED', ai, text, ctx, note: action.note ?? '', itemId: null, savedAt: Date.now(), question: null, action, error: '' };
  if (action.kind === 'REMINDER') {
    card.status = 'FAILED';
    card.note = '알림을 붙일 일정이 없어요. 일정부터 말해 주세요.';
    return card;
  }
  if (action.ask) {
    card.status = 'ASKING';
    card.question = action.ask;
    return card;
  }
  if (action.send) {
    card.status = 'CONFIRM'; // 남에게 보내는 동작은 저장하지 않고 확인 화면으로 넘긴다 (설계도 4.2 · 4.6)
    return card;
  }
  commitCard(card);
  return card;
}

function commitCard(card) {
  const action = card.action;
  if (card.kind === 'EXPENSE') {
    card.itemId = saveExpenseFromCapture(action, card.text, 'TEXT').id;
  } else if (card.kind === 'EVENT') {
    card.itemId = saveEventFromCapture(action).id;
  }
  card.status = 'SAVED';
  card.question = null;
  card.note = action.note ?? '';
  card.savedAt = Date.now();
  setTimeout(renderCaptureResults, UNDO_MS + 100); // 시간이 지나면 [되돌리기]를 감춘다
}

function cardItem(card) {
  const list = card.kind === 'EXPENSE' ? mockTransactions : mockEvents;
  return list.find(item => item.id === card.itemId) ?? null;
}

function cardSummary(card) {
  if (card.kind === 'FAIL') return '해석하지 못했어요';
  if (card.kind === 'REMINDER') return '알림';
  const item = cardItem(card);
  if (card.kind === 'EXPENSE') {
    const source = item ?? { amount: card.action.amount, category: card.action.category, memo: card.action.memo, currencyCode: 'KRW' };
    return `지출 ${formatAmount(source)} · ${source.category ?? '미분류'}${source.memo ? ` · 메모 "${source.memo}"` : ''}`;
  }
  if (card.kind === 'EVENT') {
    if (item) return `일정 "${item.title}" · ${dayLabel(new Date(item.startAt))} ${eventTimeLabel(item)}${item.location ? ` · ${item.location}` : ''}`;
    const { title, start, location } = card.action;
    return `일정 "${title}"${start ? ` · ${dayLabel(start)} ${formatClock(start.toISOString())}` : ''}${location ? ` · ${location}` : ''}`;
  }
  return '알림';
}

function cardWhen(card) {
  const item = cardItem(card);
  if (item && isFuzzy(item)) return `${new Date(item.startAt).toLocaleDateString('ko-KR')} ${item.fuzzyTime}`;
  return item ? new Date(item.occurredAt ?? item.startAt).toLocaleString('ko-KR') : '';
}

// ---------- 질문 답하기 (설계도 4.3 · 4.4) ----------
function finishAsk(card, resolved) {
  Object.assign(card.action, resolved);
  delete card.action.ask;
  delete card.action.needExact;
  if (card.action.send) { card.status = 'CONFIRM'; card.question = null; return; }
  commitCard(card);
  // 일정이 확정되면 기다리던 알림 카드도 이어서 처리한다 (설계도 4.3)
  capture.cards.filter(other => other.ctx === card.ctx && other.kind === 'REMINDER' && other.waiting).forEach(other => {
    other.waiting = false;
    other.status = 'SAVED';
    other.note = '일정 시간이 정해져 알림도 설정했어요.';
  });
}

// 질문에 답해 다시 해석: 원래 요청당 2회까지는 차감하지 않고, 넘으면 새 요청으로 1회 차감 (설계도 4.7)
function followUpCharge(card) {
  card.ctx.followUps += 1;
  if (card.ctx.followUps > FOLLOWUP_FREE) {
    if (aiBlock() !== null) return false;
    chargeAi();
  }
  return true;
}

function answerCard(card, answer) {
  if (!card || card.status !== 'ASKING') return;
  card.error = '';
  const action = card.action;
  if (card.question === 'TIME') {
    const time = readTime(answer);
    if (!time) { card.error = '시간을 7시, 오후 7시, 19:00 처럼 적어 주세요'; renderCaptureResults(); return; }
    if (!followUpCharge(card)) { card.status = 'FAILED'; card.note = 'AI 해석 한도를 다 써서 다시 해석할 수 없어요. 직접 입력해 주세요.'; card.question = null; renderCaptureResults(); return; }
    const resolved = resolveEventTime(action.dayOffset, time);
    if (resolved.ask) { card.question = resolved.ask; Object.assign(action, resolved); }
    else finishAsk(card, resolved);
  } else if (card.question === 'MERIDIEM') {
    const hour = answer === 'AM' ? action.hour % 12 : (action.hour % 12) + 12;
    const start = atTime(dayStart(action.dayOffset), hour, action.minute);
    finishAsk(card, { start, note: '' });
  } else if (card.question === 'TOMORROW') {
    if (answer === 'NO') { card.status = 'CANCELED'; card.question = null; card.note = '저장하지 않았어요.'; }
    else {
      // "내일로" 를 고르면 7~11시는 오후로 확정한다 (설계도 4.4)
      const hour = action.hour === 12 ? 12 : (action.hour % 12) + 12;
      finishAsk(card, { start: atTime(dayStart(1), hour, action.minute), note: `내일 ${clockLabel(hour, action.minute)}로 저장했어요` });
    }
  } else if (card.question === 'TOTAL') {
    if (answer === 'NO') { card.status = 'CANCELED'; card.question = null; card.note = '저장하지 않았어요. 금액은 직접 입력해 주세요.'; }
    else finishAsk(card, {});
  }
  refreshCapture();
}

function undoCard(card) {
  const item = cardItem(card);
  if (item) { item.deletedAt = new Date().toISOString(); item.updatedAt = item.deletedAt; }
  card.status = 'UNDONE';
  refreshCapture();
}

function editCard(card) {
  const item = cardItem(card);
  if (!item) return;
  if (card.kind === 'EXPENSE') { openExpenseEdit(item.id); return; }
  openEdit({ type: 'EVENT', date: startOfDay(new Date(item.startAt)), at: 0, item });
}

// ---------- 화면 ----------
const CARD_TAG = { SAVED: '저장됨', ASKING: '질문 대기', CONFIRM: '확인 필요', FAILED: '실패', UNDONE: '되돌렸어요', CANCELED: '저장 안 함' };

function buildCard(card) {
  if (card.kind === 'REMINDER') {
    const tag = card.waiting ? '질문 대기' : CARD_TAG[card.status];
    const reminder = makeDiv('requestCard resultCard', makeDiv('rowBetween', textElement('p', 'text', '알림'), makeDiv('tag', textElement('p', 'tagText', tag))), textElement('p', 'settingHint', card.note));
    reminder.dataset.status = card.waiting ? 'ASKING' : card.status;
    return reminder;
  }
  const item = card.status === 'SAVED' ? cardItem(card) : null;
  const gone = card.status === 'SAVED' && (!item || item.deletedAt);
  const status = gone ? 'UNDONE' : card.status;
  const body = [makeDiv('rowBetween', textElement('p', 'text', cardSummary(card)), makeDiv('tag', textElement('p', 'tagText', CARD_TAG[status])))];
  if (status === 'SAVED' && cardWhen(card)) body.push(textElement('p', 'muted', cardWhen(card)));
  if (card.note && status !== 'UNDONE') body.push(textElement('p', 'settingHint', card.note));
  if (status === 'UNDONE') body.push(textElement('p', 'settingHint', card.ai ? '되돌렸어요. AI 해석 횟수는 그대로 차감돼요.' : '되돌렸어요.'));

  if (status === 'ASKING') {
    const action = card.action;
    const prompts = {
      TIME: () => `${action.needExact === 'REMINDER' ? '알림은 정확한 시각이 필요해요. ' : action.needExact === 'SEND' ? '보내려면 정확한 시각이 필요해요. ' : ''}${action.title.endsWith('만나기') ? '몇 시에 만나요?' : `"${action.title}"은 몇 시예요?`}`,
      MERIDIEM: () => `${action.hour}시는 오전이에요, 오후예요?`,
      TOMORROW: () => `오늘 ${action.hour}시는 이미 지났어요. 내일로 할까요?`,
      TOTAL: () => `총액이 ${action.amount.toLocaleString('ko-KR')}원이 맞나요? 항목을 더하면 ${action.sum.toLocaleString('ko-KR')}원이에요.`,
    };
    body.push(textElement('p', 'text', prompts[card.question]()));
    if (card.question === 'TIME') {
      const input = document.createElement('input');
      input.className = 'input';
      input.placeholder = '오후 7시';
      input.maxLength = 20;
      input.setAttribute('aria-label', '시간 답하기');
      input.id = `cardAnswer${card.id}`;
      body.push(input, makeButton('smallButton', 'smallButtonText', '답하기', () => answerCard(card, input.value)));
    } else {
      const choices = card.question === 'MERIDIEM' ? [['오전', 'AM'], ['오후', 'PM']] : card.question === 'TOMORROW' ? [['예', 'YES'], ['아니오', 'NO']] : [['맞아요', 'YES'], ['아니에요', 'NO']];
      body.push(makeDiv('buttonRow', ...choices.map(([label, value], index) => makeButton(index === 0 ? 'smallButton' : 'smallSecondary', index === 0 ? 'smallButtonText' : 'smallSecondaryText', label, () => answerCard(card, value)))));
    }
    if (card.error) body.push(textElement('p', 'error', card.error));
  }
  if (status === 'CONFIRM') {
    const names = (card.action.send.recipients ?? []).map(nameOfId);
    body.push(textElement('p', 'settingHint', `${names.length ? `${names.join(', ')}님에게 보내요. ` : '받는 사람은 확인 화면에서 골라요. '}남에게 보내는 동작은 확인 화면을 거쳐요. 내 캘린더에는 아직 넣지 않았어요.`));
    body.push(makeDiv('buttonRow', makeButton('smallButton', 'smallButtonText', '보내기 확인 열기', () => openCaptureSend(card)), makeButton('smallSecondary', 'smallSecondaryText', '그만두기', () => { card.status = 'CANCELED'; card.note = '보내지 않았어요.'; renderCaptureResults(); })));
  }
  if (status === 'SAVED' && Date.now() - card.savedAt < UNDO_MS) {
    body.push(makeDiv('buttonRow', makeButton('smallSecondary', 'smallSecondaryText', '되돌리기', () => undoCard(card)), makeButton('smallSecondary', 'smallSecondaryText', '수정', () => editCard(card))));
  }
  if (status === 'FAILED' || status === 'CANCELED') {
    body.push(makeButton('smallSecondary', 'smallSecondaryText', '직접 입력', () => openManualForm(manualKindOf(card.text), card.text)));
  }
  const element = makeDiv('requestCard resultCard', ...body);
  element.dataset.status = status;
  return element;
}

function renderCaptureResults() {
  const box = byId('resultBox');
  box.replaceChildren(...capture.cards.map(buildCard));
  show('resultBox', capture.cards.length > 0);
  if (capture.cards.length) {
    box.append(makeButton('linkButton', 'linkText', '결과 닫기', () => { capture.cards = []; renderCaptureResults(); }));
  }
  renderRoute();
  renderDrafts();
}

function renderRoute() {
  const route = capture.route;
  show('routeBox', Boolean(route));
  if (!route) return;
  byId('routeTitle').textContent = route.title;
  byId('routeBody').textContent = route.body;
  byId('routeButtons').replaceChildren(...route.buttons.map((button, index) => makeButton(index === 0 ? 'smallButton' : 'smallSecondary', index === 0 ? 'smallButtonText' : 'smallSecondaryText', button.label, button.onClick)));
}

function renderDrafts() {
  show('draftBox', capture.drafts.length > 0);
  byId('draftList').replaceChildren(...capture.drafts.map(draft => {
    const retry = makeButton('smallButton', 'smallButtonText', '다시 처리', () => { if (!online) return; capture.drafts.splice(capture.drafts.indexOf(draft), 1); submitCapture(draft.text); });
    retry.classList.toggle('disabled', !online);
    retry.setAttribute('aria-disabled', String(!online));
    return makeDiv('draftRow', textElement('p', 'text', draft.text), textElement('p', 'settingHint', online ? '연결됐어요. 다시 처리해 볼까요?' : '인터넷 연결이 필요해요. 연결된 뒤에 직접 눌러 처리해요.'), makeDiv('buttonRow', retry, makeButton('smallSecondary', 'smallSecondaryText', '지우기', () => { capture.drafts.splice(capture.drafts.indexOf(draft), 1); renderCaptureResults(); })));
  }));
}

function refreshCapture() {
  refreshHomeRecords();
  renderCalendar();
  renderCaptureResults();
  if (currentPage === 'expenses') renderExpensesPage();
}

// ---------- 제출 · 라우팅 (설계도 4.2) ----------
function setRoute(title, body, buttons) {
  capture.route = { title, body, buttons };
  renderRoute();
}

const manualKindOf = text => (MEETING_RE.test(text) && !findAmounts(text).length ? 'EVENT' : 'EXPENSE');
function manualButtonFor(text) {
  return { label: '직접 입력', onClick: () => openManualForm(manualKindOf(text), text) };
}

function submitCapture(rawText) {
  const text = (rawText ?? byId('captureInput').value).trim();
  capture.route = null;
  show('captureError', false);
  if (!text) {
    byId('captureError').textContent = '문장을 입력해 주세요';
    show('captureError', true);
    renderCaptureResults();
    return;
  }
  capture.lastText = text;
  const local = localParse(text);
  if (local) {
    if (recentSameExpense(local) && !capture.dupConfirmed) {
      setRoute('같은 기록이 방금 있어요', `${local.amount.toLocaleString('ko-KR')}원${local.memo ? ` · ${local.memo}` : ''}을(를) 방금 저장했어요. 또 저장할까요?`, [
        { label: '또 저장', onClick: () => { capture.dupConfirmed = true; submitCapture(text); capture.dupConfirmed = false; } },
        { label: '저장 안 함', onClick: () => { capture.route = null; byId('captureInput').value = ''; renderCaptureResults(); } },
      ]);
      renderCaptureResults();
      return;
    }
    const card = makeCard({ kind: 'EXPENSE', ...local }, text, false, { followUps: 0 });
    capture.cards.unshift(card);
    byId('captureInput').value = '';
    refreshCapture();
    return;
  }
  // AI 필요
  if (!online) {
    capture.drafts.unshift({ id: nextCardId(), text, createdAt: Date.now() });
    byId('captureInput').value = '';
    setRoute('인터넷에 연결되지 않았어요', 'AI가 필요한 문장이라 처리하지 못했어요. 처리 대기 초안으로 보관했어요. 연결된 뒤 [다시 처리]를 직접 눌러 주세요. 자동으로 실행하지 않아요.', [manualButtonFor(text)]);
    renderCaptureResults();
    return;
  }
  if (isGuest()) {
    setRoute('AI 해석이 필요한 문장이에요', '로그인하면 AI 체험 3회를 쓸 수 있어요. 직접 입력은 로그인 없이 계속 쓸 수 있어요.', [
      { label: '로그인', onClick: () => openOnboard('LOGIN', false, LOGIN_PROMPTS.AI.title) },
      manualButtonFor(text),
    ]);
    renderCaptureResults();
    return;
  }
  const block = aiBlock();
  if (block === 'TRIAL') {
    setRoute('AI가 필요해요', '무료 체험 3회를 모두 썼어요. 구독하면 매달 AI 해석을 쓸 수 있어요. 직접 입력은 계속 쓸 수 있어요.', [
      { label: '구독 보기', onClick: () => openPlan('ai') },
      manualButtonFor(text),
    ]);
    renderCaptureResults();
    return;
  }
  if (block === 'MONTH' || block === 'DAY') {
    const body = block === 'MONTH' ? `이번 달 AI 해석을 모두 썼어요. ${resetLabel()}에 다시 채워져요.` : '오늘 AI 해석을 모두 썼어요. 내일 0시에 다시 채워져요.';
    setRoute(block === 'MONTH' ? '이번 달 한도를 다 썼어요' : '오늘 한도를 다 썼어요', `${body} 직접 입력은 계속 쓸 수 있어요.`, [
      manualButtonFor(text),
      ...(account.plan === 'BASIC' ? [{ label: '요금제 보기', onClick: () => openPlan('ai') }] : []),
    ]);
    renderCaptureResults();
    return;
  }
  if (account.limitKind === 'LIFETIME') {
    setRoute(`AI 체험 ${monthRemaining()}회 남음`, '이 문장은 AI가 해석해야 해요. 체험 1회를 사용할까요?', [
      { label: '사용하기', onClick: () => { capture.route = null; runAi(text); } },
      manualButtonFor(text),
    ]);
    renderCaptureResults();
    return;
  }
  runAi(text);
}

function runAi(text) {
  const ctx = { followUps: 0, startedAt: Date.now() };
  byId('captureInput').value = '';
  if (capture.aiFails) {
    capture.cards.unshift({ id: nextCardId(), kind: 'FAIL', status: 'FAILED', ai: true, text, ctx, note: '잠시 후 다시 시도해 주세요. 서버에서 해석하지 못했어요. 횟수는 차감되지 않아요.', retry: true, action: {}, itemId: null, savedAt: 0 });
    renderCaptureResults();
    return;
  }
  const result = mockInterpret(text);
  if (!result.ok) {
    capture.cards.unshift({ id: nextCardId(), kind: 'FAIL', status: 'FAILED', ai: true, text, ctx, note: result.reason === 'NOT_EXPENSE' ? '안 쓴 돈 · 받은 돈(수입) · 계획이나 질문은 기록하지 않아요. 횟수는 차감되지 않아요. 기록하려면 직접 입력해 주세요.' : '문장을 이해하지 못했어요. 횟수는 차감되지 않아요. 직접 입력해 주세요.', action: {}, itemId: null, savedAt: 0 });
    renderCaptureResults();
    return;
  }
  if (capture.invalid) {
    // 서버 검증은 통과했지만 앱 검증에서 걸림: 저장하지 않고, 차감은 유지하고, 오류 번호를 남긴다 (설계도 4.7 · 15)
    chargeAi();
    invalidCounter += 1;
    capture.cards.unshift({ id: nextCardId(), kind: 'FAIL', status: 'FAILED', ai: true, text, ctx, note: `AI 응답을 앱에서 확인하지 못해 저장하지 않았어요. AI 해석 횟수는 사용된 것으로 세요. 오류 번호 E-${4800 + invalidCounter}를 기록했어요. 직접 입력해 주세요.`, action: {}, itemId: null, savedAt: 0 });
    renderCaptureResults();
    return;
  }
  chargeAi();
  const cards = result.actions.map(action => makeCard(action, text, true, ctx));
  // 일정을 기다리는 알림은 따로 카드로 보인다
  cards.forEach(card => { if (card.kind === 'EVENT' && card.status === 'ASKING' && card.action.reminder !== null && card.action.reminder !== undefined) cards.push({ id: nextCardId(), kind: 'REMINDER', status: 'ASKING', waiting: true, ai: true, text, ctx, note: '일정 시간이 정해지면 알림을 설정해요.', action: {}, itemId: null, savedAt: 0, question: 'WAIT' }); });
  capture.cards.unshift(...cards);
  refreshCapture();
}

// 음성으로 보내기 확인: 보내기 시트를 미리 채워 연다 (설계도 4.6)
function openCaptureSend(card) {
  const action = card.action;
  if (card.status !== 'CONFIRM' || !(action.start || action.allDay)) return;
  if (isGuest()) { openLoginPrompt('SEND'); return; }
  if (isTrial() && !account.shareTrial) { openPlan('send'); return; }
  openSendSheet(null);
  byId('sendTitle').value = action.title;
  byId('sendDate').value = dateKey(action.allDay ? dayStart(action.dayOffset) : action.start);
  byId('sendTime').value = action.allDay ? '10:00' : `${pad2(action.start.getHours())}:${pad2(action.start.getMinutes())}`;
  sendState.timeMode = action.allDay ? 'ALL_DAY' : 'EXACT';
  byId('sendLocation').value = action.location ?? '';
  const ids = (action.send.recipients ?? []).filter(id => canReceive(personById(id), 'EVENT'));
  sendState.recipients = isTrial() ? ids.slice(0, 1) : ids;
  sendState.offsets = action.reminder === null || action.reminder === undefined ? [] : [action.reminder];
  sendState.touched = true;
  // 문장에 "내 캘린더에도"가 있으면 켠 채로 연다 (설계도 4.6)
  if (/(나도\s*넣|내\s*캘린더에도|같이\s*넣)/.test(card.text)) sendState.alsoMine = true;
  renderSendForm();
}

// ---------- 직접 입력 폼 (설계도 11.2 H4): 지출 · 약속 · 할 일, 말한 문장을 미리 채운다 ----------
function openManualForm(kind, text) {
  const prefill = (text ?? '').slice(0, 100);
  closeLayers();
  if (kind === 'EXPENSE') {
    showSheet('edit', false);
    openExpenseEdit(null);
    byId('expMemo').value = prefill;
    return;
  }
  closeExpenseEdit();
  openEditSheet('new', kind, prefill, focusDate, '09:00', null);
}

function switchManualKind(kind) {
  const expenseOpen = !byId('expenseEditSheet').hidden;
  const text = expenseOpen ? byId('expMemo').value : byId('editTitle').value;
  if (expenseOpen && kind === 'EXPENSE') return;
  openManualForm(kind, text);
}

// ---------- 일정 폼: 장소 · 알림 (설계도 4.1) ----------
const editExtra = { reminders: [] };
function renderEditExtra() {
  const isEvent = Boolean(editing) && editing.type === 'EVENT';
  show('editEventExtra', isEvent);
  if (!isEvent) return;
  buildPills('editReminders', REMINDER_OFFSETS, reminderLabel, editExtra.reminders, value => {
    editExtra.reminders = editExtra.reminders.includes(value) ? editExtra.reminders.filter(item => item !== value) : [...editExtra.reminders, value];
    renderEditExtra();
  });
}

const openEditSheetBase2 = openEditSheet;
openEditSheet = function openEditSheetWithExtra(mode, type, title, date, time, id) {
  openEditSheetBase2(mode, type, title, date, time, id);
  const existing = mode === 'edit' && type === 'EVENT' ? mockEvents.find(item => item.id === id) : null;
  byId('editLocation').value = existing?.location ?? '';
  editExtra.reminders = existing ? [...eventReminders(existing)] : (mockSettings.ownDefault === 'NONE' ? [] : [mockSettings.ownDefault]);
  show('editToExpense', mode === 'new');
  renderEditExtra();
};

const applyEditTypeBase2 = applyEditType;
applyEditType = function applyEditTypeWithExtra(type) {
  applyEditTypeBase2(type);
  renderEditExtra();
};

const saveEditBase = saveEdit;
saveEdit = function saveEditWithExtra() {
  const context = editing ? { ...editing } : null;
  const location = byId('editLocation').value.trim();
  const reminders = [...editExtra.reminders];
  saveEditBase();
  if (!context || editing || context.type !== 'EVENT') return; // 오류로 시트가 그대로면 저장하지 않은 것
  const item = context.mode === 'edit' ? mockEvents.find(entry => entry.id === context.id) : mockEvents[mockEvents.length - 1];
  if (!item) return;
  item.location = location || null;
  item.reminders = reminders;
  renderCalendar();
};

// 지출 폼 맨 위: 지출 · 약속 · 할 일 (새로 만들 때만)
const openExpenseEditBase = openExpenseEdit;
openExpenseEdit = function openExpenseEditWithKinds(id) {
  openExpenseEditBase(id);
  show('expKindRow', !id);
};

// ---------- 화면 갱신 연결 ----------
const refreshHomeRecordsBase = refreshHomeRecords;
refreshHomeRecords = function refreshHomeRecordsWithCards() {
  refreshHomeRecordsBase();
  renderCaptureResults();
};

const renderSessionViewsBase5 = renderSessionViews;
renderSessionViews = function renderSessionViewsWithCapture() {
  renderSessionViewsBase5();
  renderCaptureResults();
};

// ---------- 이벤트 연결 (7단계) ----------
byId('analyzeButton').addEventListener('click', () => { if (!isOff('analyzeButton')) submitCapture(); });
byId('captureInput').addEventListener('keydown', event => { if (event.key === 'Enter') submitCapture(); });
byId('editToExpense').addEventListener('click', () => switchManualKind('EXPENSE'));
document.querySelectorAll('[data-xkind]').forEach(button => button.addEventListener('click', () => switchManualKind(button.dataset.xkind)));

document.querySelectorAll('[data-r]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.r;
  jumpToPage('home');
  if (tool === 'aiFail') {
    capture.aiFails = !capture.aiFails;
    highlight('[data-r="aiFail"]', () => capture.aiFails);
    return;
  }
  const samples = {
    local: '점심 7000원 썼어',
    combo: '밥 7000원짜리 먹었고 오늘 친구랑 오후7시 약속있다',
    notime: '점심 8천원 썼고 내일 민수 만나. 한 시간 전에 알려줘',
    bundle: '아이스크림 2천원 생수 1천원 밥 9천원 총 15000원',
    send: '내일 오후 7시에 강남역에서 만나기 이걸 민수에게 줘',
    unknown: '음 그냥 그런 말이야',
  };
  byId('captureInput').value = samples[tool];
  submitCapture();
}));

// ======================================================================
// 8단계: 대략적 시간 · 월/주 칸의 보낸 사람 표시 · 목록 상태(로딩·오류·오프라인) · 처리 대기 초안 저장
// (설계도 4.2 · 4.4 · 11.2 K1 · 11.3 · 13)
// ======================================================================

// ---------- 대략적 시간 (설계도 4.4 · 4.1 · 6.2 · 13) ----------
// 내 약속에 "저녁쯤"처럼 정확하지 않은 시간을 저장한다. kind = 'FUZZY', fuzzyTime = 표현, startAt = 그날 23:59(만료 계산용 약속, 설계도 13.2).
// 시각이 없으므로 알림은 맞출 수 없고, 보내기는 정확한 시각 또는 종일만 받는다(설계도 6.2).
const FUZZY_CHOICES = ['아침쯤', '점심쯤', '오후쯤', '저녁쯤', '밤쯤'];
function fuzzyHour(name) { return ({ 아침쯤: 8, 점심쯤: 12, 오후쯤: 15, 저녁쯤: 18, 밤쯤: 21 })[name] ?? 12; } // 하루 안에서 줄 세울 때만 쓰는 대략의 순서
function isFuzzy(item) { return item.kind === 'FUZZY'; }
function fuzzyAt(item) { return atTime(startOfDay(new Date(item.startAt)), fuzzyHour(item.fuzzyTime), 0).getTime(); }
function eventTimeLabel(item) { return isFuzzy(item) ? item.fuzzyTime : formatClock(item.startAt); }

function applyFuzzy(item, fuzzy) {
  const day = startOfDay(new Date(item.startAt));
  item.kind = 'FUZZY';
  item.fuzzyTime = fuzzy;
  item.date = dateKey(day);
  item.startAt = atTime(day, 23, 59).toISOString();
  item.endAt = null;
  item.status = day.getTime() < dayStart(0).getTime() ? 'PAST' : 'UPCOMING';
  item.reminders = [];
}

function applyExact(item) {
  item.kind = 'EXACT';
  item.fuzzyTime = null;
  delete item.date;
}

function makeFuzzyEvent(id, title, date, fuzzy, location) {
  const event = makeEventAt(id, title, atTime(startOfDay(date), 9, 0), 60, location);
  applyFuzzy(event, fuzzy);
  return event;
}

// ---------- 일정 폼: 시각 정하기 · 대략적 시간 ----------
function renderFuzzyExtra() {
  const isEvent = Boolean(editing) && editing.type === 'EVENT';
  show('editTimeModeBlock', isEvent);
  if (!isEvent) return;
  const fuzzy = editExtra.timeMode === 'FUZZY';
  document.querySelectorAll('[data-tmode]').forEach(button => setActive(button, button.dataset.tmode === editExtra.timeMode, 'segmentButtonActive', 'segmentTextActive'));
  show('editTimeField', !fuzzy);
  show('fuzzyPills', fuzzy);
  show('fuzzyHint', fuzzy);
  buildPills('fuzzyPills', FUZZY_CHOICES, value => value, [editExtra.fuzzy], value => { editExtra.fuzzy = value; renderFuzzyExtra(); });
  byId('editReminders').parentElement.hidden = fuzzy; // 시각이 없으면 알림을 맞출 수 없다
}

const openEditSheetBase3 = openEditSheet;
openEditSheet = function openEditSheetWithFuzzy(mode, type, title, date, time, id) {
  openEditSheetBase3(mode, type, title, date, time, id);
  const existing = mode === 'edit' && type === 'EVENT' ? mockEvents.find(item => item.id === id) : null;
  editExtra.timeMode = existing && isFuzzy(existing) ? 'FUZZY' : 'EXACT';
  editExtra.fuzzy = existing && isFuzzy(existing) ? existing.fuzzyTime : '저녁쯤';
  if (editExtra.timeMode === 'FUZZY') byId('editTime').value = '09:00';
  renderFuzzyExtra();
};

const applyEditTypeBase3 = applyEditType;
applyEditType = function applyEditTypeWithFuzzy(type) {
  applyEditTypeBase3(type);
  renderFuzzyExtra();
};

const saveEditBase3 = saveEdit;
saveEdit = function saveEditWithFuzzy() {
  const context = editing ? { ...editing } : null;
  const fuzzyMode = Boolean(context) && context.type === 'EVENT' && editExtra.timeMode === 'FUZZY';
  const fuzzy = editExtra.fuzzy;
  const typedTime = byId('editTime').value;
  if (fuzzyMode) byId('editTime').value = '09:00'; // 기본 저장 흐름의 시간 검사를 지나가게 하는 자리 값. 저장된 항목은 아래에서 대략적 시간으로 바꾼다
  saveEditBase3();
  if (editing) { byId('editTime').value = typedTime; return; } // 오류로 시트가 그대로면 저장하지 않은 것
  if (!context || context.type !== 'EVENT') return;
  const item = context.mode === 'edit' ? mockEvents.find(entry => entry.id === context.id) : mockEvents[mockEvents.length - 1];
  if (!item) return;
  if (fuzzyMode) applyFuzzy(item, fuzzy);
  else if (isFuzzy(item)) applyExact(item);
  renderCalendar();
};

// 상세 화면: 대략적 시간 일정은 보내기를 막고 이유를 보여 준다 (설계도 6.2)
const renderItemSheetBase2 = renderItemSheet;
renderItemSheet = function renderItemSheetWithFuzzy() {
  renderItemSheetBase2();
  const item = itemByKd();
  const fuzzy = Boolean(item) && kdState.type === 'EVENT' && isFuzzy(item);
  show('kdFuzzyNote', fuzzy);
  byId('kdSend').classList.toggle('disabled', fuzzy);
  byId('kdSend').setAttribute('aria-disabled', String(fuzzy));
  if (fuzzy) byId('kdReminder').textContent = '알림: 없음 (대략적 시간이라 맞출 수 없어요)';
};

// ---------- 월 · 주 칸의 보낸 사람 표시 (설계도 11.2 K1) ----------
function receivedSendersOn(date) {
  const ids = [];
  itemsForDate(date).forEach(entry => {
    if (entry.type === 'EVENT' && entry.item.fromId && entry.item.status !== 'CANCELED' && !ids.includes(entry.item.fromId)) ids.push(entry.item.fromId);
  });
  return ids;
}

function buildSenderMarks(ids) {
  const shown = ids.length > 2 ? ids.slice(0, 1) : ids;
  const marks = shown.map(id => {
    const person = personById(id);
    return person && person.photo ? buildPhotoAvatar(person.photo, 16) : makeDiv('avatar avatarTiny', textElement('p', 'avatarTextTiny', initialOf(nameOfId(id))));
  });
  if (ids.length > 2) marks.push(textElement('p', 'markMore', `+${ids.length - 1}`));
  const row = makeDiv('senderMarks', ...marks);
  row.setAttribute('aria-hidden', 'true');
  return row;
}

const buildDotsBase3 = buildDots;
buildDots = function buildDotsWithSenders(date, active) {
  const base = buildDotsBase3(date, active);
  const ids = receivedSendersOn(date);
  return ids.length ? makeDiv('dotStack', base, buildSenderMarks(ids)) : base;
};

function describeDay(cell, date) {
  const ids = receivedSendersOn(date);
  if (ids.length) cell.setAttribute('aria-label', `${dayLabel(date)}, 보낸 사람 ${ids.map(nameOfId).join(', ')}`);
  return cell;
}
const buildWeekCellBase3 = buildWeekCell;
buildWeekCell = date => describeDay(buildWeekCellBase3(date), date);
const buildMonthCellBase3 = buildMonthCell;
buildMonthCell = date => describeDay(buildMonthCellBase3(date), date);

// ---------- 목록 상태: 로딩 · 오류(다시 시도) · 오프라인 (설계도 11.3) ----------
// 디자인 확인용 값. 실제 앱에서는 각 목록의 불러오기 결과가 정한다.
const listView = { state: 'ready' }; // 'ready' | 'loading' | 'error'

function buildListSkeleton() {
  const rows = [0, 1, 2].map(() => makeDiv('skelRow', makeDiv('skelBar skelBarWide'), makeDiv('skelBar')));
  return makeDiv('skeleton', textElement('p', 'settingHint', '불러오는 중이에요'), ...rows);
}

function buildListError() {
  return makeDiv('notice noticeError', textElement('p', 'noticeText', '목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'), makeButton('smallButton', 'smallButtonText', '다시 시도', retryList));
}

function buildOfflineNote(scope) {
  const text = scope === 'SERVER' ? '인터넷 연결이 필요해요. 마지막으로 본 목록이에요.' : '오프라인이에요. 이 폰에 저장된 기록은 그대로 보여요.';
  return makeDiv('notice noticeOffline', textElement('p', 'noticeText', text));
}

// scope: 'LOCAL'(이 폰이 원본) | 'SERVER'(서버가 필요) | null(오프라인 안내를 따로 둔 곳)
function applyListState(containerId, scope) {
  const box = byId(containerId);
  if (listView.state === 'loading') box.replaceChildren(buildListSkeleton());
  else if (listView.state === 'error') box.replaceChildren(buildListError());
  else if (!online && scope) box.prepend(buildOfflineNote(scope));
}

function rerenderLists() {
  renderCalendar();
  renderExpensesPage();
  renderPeoplePage();
  renderBlockedPage();
}

// 다시 시도: 잠깐 불러오는 중을 보여 준 뒤 정상으로 돌아온다 (목업)
let listRetryTimer = null;
function retryList() {
  listView.state = 'loading';
  highlight('[data-l]', item => item.dataset.l === listView.state);
  rerenderLists();
  clearTimeout(listRetryTimer);
  listRetryTimer = setTimeout(() => {
    listView.state = 'ready';
    highlight('[data-l]', item => item.dataset.l === listView.state);
    rerenderLists();
  }, 600);
}

const renderCalendarBase9 = renderCalendar;
renderCalendar = function renderCalendarWithState() {
  renderCalendarBase9();
  applyListState('agenda', 'LOCAL');
};

const renderExpensesPageBase9 = renderExpensesPage;
renderExpensesPage = function renderExpensesPageWithState() {
  renderExpensesPageBase9();
  const state = listView.state;
  byId('expCategories').parentElement.hidden = state !== 'ready';
  if (state === 'ready') {
    if (!online) byId('expList').prepend(buildOfflineNote('LOCAL'));
    return;
  }
  byId('expTotal').textContent = '—';
  byId('expCaption').textContent = state === 'loading' ? '불러오는 중이에요' : '불러오지 못했어요';
  show('expBody', true);
  show('expEmpty', false);
  byId('expList').replaceChildren(state === 'loading' ? buildListSkeleton() : buildListError());
};

const renderPeoplePageBase9 = renderPeoplePage;
renderPeoplePage = function renderPeoplePageWithState() {
  renderPeoplePageBase9();
  applyListState('peopleList', 'SERVER');
  if (listView.state !== 'ready') { applyListState('inboxList', null); applyListState('sentList', null); }
};

const renderBlockedPageBase9 = renderBlockedPage;
renderBlockedPage = function renderBlockedPageWithState() {
  renderBlockedPageBase9();
  applyListState('blockedList', null); // 오프라인 안내는 차단 목록 화면에 이미 있다
};

// ---------- 처리 대기 초안 저장 (설계도 4.2 · 12 pending_drafts) ----------
// 폰 안에만 두고 백업에는 넣지 않는다(설계도 3.6). 앱을 다시 열어도 남아 있어야 [다시 처리]를 누를 수 있다.
const DRAFT_KEY = 'voiceLife.pendingDrafts';
function loadDrafts() {
  try {
    const list = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && typeof item.text === 'string' && item.text.trim()).map((item, index) => ({ id: `draft-${index}`, text: item.text.slice(0, 300), createdAt: Number(item.createdAt) || Date.now() }));
  } catch { return []; }
}
function saveDrafts() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(capture.drafts.map(({ text, createdAt }) => ({ text, createdAt })))); } catch { /* 미리보기에서 저장이 안 돼도 동작에는 영향 없음 */ }
}
const draftStamp = ms => { const date = new Date(ms); return `${sameDay(date, dayStart(0)) ? '오늘' : koDate(date)} ${formatClock(date.toISOString())}`; };

renderDrafts = function renderDraftsPersisted() {
  saveDrafts();
  show('draftBox', capture.drafts.length > 0);
  byId('draftList').replaceChildren(...capture.drafts.map(draft => {
    const retry = makeButton('smallButton', 'smallButtonText', '다시 처리', () => { if (!online) return; capture.drafts.splice(capture.drafts.indexOf(draft), 1); submitCapture(draft.text); });
    retry.classList.toggle('disabled', !online);
    retry.setAttribute('aria-disabled', String(!online));
    return makeDiv('draftRow',
      textElement('p', 'text', draft.text),
      textElement('p', 'settingHint', `${draftStamp(draft.createdAt)}에 적어 둔 문장 · ${online ? '연결됐어요. 다시 처리해 볼까요?' : '인터넷 연결이 필요해요. 연결된 뒤에 직접 눌러 처리해요.'}`),
      makeDiv('buttonRow', retry, makeButton('smallSecondary', 'smallSecondaryText', '지우기', () => { capture.drafts.splice(capture.drafts.indexOf(draft), 1); renderCaptureResults(); })));
  }));
};

function clearDrafts() {
  capture.drafts = [];
  renderDrafts();
}
const resetAllBase9 = resetAll;
resetAll = function resetAllWithDrafts() { resetAllBase9(); clearDrafts(); };
const wipeLocalDataBase9 = wipeLocalData;
wipeLocalData = function wipeLocalDataWithDrafts() { wipeLocalDataBase9(); clearDrafts(); };

capture.drafts = loadDrafts();
renderDrafts();

// 오프라인 · 온라인이 바뀌면 목록의 안내도 바로 바뀐다
const rerenderSessionBase9 = rerenderSession;
rerenderSession = function rerenderSessionWithLists() {
  rerenderSessionBase9();
  rerenderLists();
  renderDrafts();
};

// ---------- 이벤트 연결 (8단계) ----------
document.querySelectorAll('[data-tmode]').forEach(button => button.addEventListener('click', () => {
  editExtra.timeMode = button.dataset.tmode;
  renderFuzzyExtra();
}));
document.querySelectorAll('[data-l]').forEach(button => button.addEventListener('click', () => {
  clearTimeout(listRetryTimer);
  listView.state = button.dataset.l;
  highlight('[data-l]', item => item.dataset.l === listView.state);
  rerenderLists();
}));
highlight('[data-l]', item => item.dataset.l === listView.state);

// ======================================================================
// 9단계: 종일 일정 · 보내기 시트 보강(종일·종료·장소) · 하루 50건 · 오프라인 보낼 목록 · 보낸 항목 수정·취소 · 수신함 수정됨 태그
// (설계도 4.4 · 6.2 · 6.3 · 6.4 · 6.5 · 6.6 · 15)
// ======================================================================

// ---------- 종일 일정 (설계도 4.4 · 6.2 · 13.4) ----------
// kind = 'ALL_DAY', startAt = 그날 23:59(만료 계산용 약속, 설계도 6.4 · 13.2). 시각이 없으므로 알림은 맞출 수 없다.
const isAllDay = item => item.kind === 'ALL_DAY';
eventTimeLabel = function eventTimeLabelAllDay(item) {
  return isAllDay(item) ? '종일' : isFuzzy(item) ? item.fuzzyTime : formatClock(item.startAt);
};

function applyAllDay(item) {
  const day = startOfDay(new Date(item.startAt));
  item.kind = 'ALL_DAY';
  item.fuzzyTime = null;
  item.date = dateKey(day);
  item.startAt = atTime(day, 23, 59).toISOString();
  item.endAt = null;
  item.status = day.getTime() < dayStart(0).getTime() ? 'PAST' : 'UPCOMING';
  item.reminders = [];
}

function makeAllDayEvent(id, title, date, location) {
  const event = makeEventAt(id, title, atTime(startOfDay(date), 9, 0), 60, location);
  applyAllDay(event);
  return event;
}

renderFuzzyExtra = function renderTimeModeExtra() {
  const isEvent = Boolean(editing) && editing.type === 'EVENT';
  show('editTimeModeBlock', isEvent);
  if (!isEvent) return;
  const mode = editExtra.timeMode;
  document.querySelectorAll('[data-tmode]').forEach(button => setActive(button, button.dataset.tmode === mode, 'segmentButtonActive', 'segmentTextActive'));
  show('editTimeField', mode === 'EXACT');
  show('fuzzyPills', mode === 'FUZZY');
  show('fuzzyHint', mode === 'FUZZY');
  show('allDayHint', mode === 'ALL_DAY');
  buildPills('fuzzyPills', FUZZY_CHOICES, value => value, [editExtra.fuzzy], value => { editExtra.fuzzy = value; renderFuzzyExtra(); });
  byId('editReminders').parentElement.hidden = mode !== 'EXACT'; // 시각이 없으면 알림을 맞출 수 없다
};

const openEditSheetBase4 = openEditSheet;
openEditSheet = function openEditSheetWithAllDay(mode, type, title, date, time, id) {
  openEditSheetBase4(mode, type, title, date, time, id);
  const existing = mode === 'edit' && type === 'EVENT' ? mockEvents.find(item => item.id === id) : null;
  if (existing && isAllDay(existing)) {
    editExtra.timeMode = 'ALL_DAY';
    byId('editTime').value = '09:00';
    renderFuzzyExtra();
  }
};

const saveEditBase4 = saveEdit;
saveEdit = function saveEditWithAllDay() {
  const context = editing ? { ...editing } : null;
  const isEvent = Boolean(context) && context.type === 'EVENT';
  const mode = editExtra.timeMode;
  if (isEvent && mode === 'ALL_DAY') editExtra.timeMode = 'FUZZY'; // 대략적 시간과 같은 흐름(시각 없음)으로 저장한 뒤 종일로 바꾼다
  saveEditBase4();
  if (isEvent && mode === 'ALL_DAY') editExtra.timeMode = 'ALL_DAY';
  if (editing || !isEvent) return; // 오류로 시트가 그대로면 저장하지 않은 것
  const item = context.mode === 'edit' ? mockEvents.find(entry => entry.id === context.id) : mockEvents[mockEvents.length - 1];
  if (!item) return;
  if (mode === 'ALL_DAY') applyAllDay(item);
  else if (isAllDay(item)) applyExact(item);
  renderCalendar();
};

const renderItemSheetBase3 = renderItemSheet;
renderItemSheet = function renderItemSheetWithAllDay() {
  renderItemSheetBase3();
  const item = itemByKd();
  if (item && kdState.type === 'EVENT' && isAllDay(item)) byId('kdReminder').textContent = '알림: 없음 (종일 일정은 시각이 없어 맞출 수 없어요)';
};

const cardWhenBase5 = cardWhen;
cardWhen = function cardWhenWithAllDay(card) {
  const item = cardItem(card);
  if (item && isAllDay(item)) return `${new Date(item.startAt).toLocaleDateString('ko-KR')} 종일`;
  return cardWhenBase5(card);
};

// ---------- 보내기 시트: 종일 · 종료 시각 · 장소 · 남은 건수 (설계도 6.2 · 6.6) ----------
sendState.timeMode = 'EXACT'; // 'EXACT' | 'ALL_DAY'
const SEND_DAILY_LIMIT = 50; // 구독자 하루 전송 한도, 받는 사람 1명당 1건 (KST 자정 초기화)
const SEND_QUOTA_SHOW_FROM = 40; // 한도의 80% 이상일 때만 남은 건수를 보여 준다
const sendUsed = () => account.sendUsed ?? 0;
const sendRemaining = () => Math.max(0, SEND_DAILY_LIMIT - sendUsed());

const SEND_FAIL_REASON = {
  PAST_EVENT: '이미 지난 일정이에요',
  DAILY_LIMIT: '오늘 보낼 수 있는 건수를 넘었어요',
  NOT_AVAILABLE: '받을 수 없는 상태예요(친구가 아니거나 받기를 꺼 뒀어요)',
};
SEND_STATUS_LABEL.SENDING = '보내는 중';
SEND_STATUS_LABEL.FAILED = '보내지 못했어요';

const renderSendFormBase5 = renderSendForm;
renderSendForm = function renderSendFormFull() {
  renderSendFormBase5();
  const event = sendState.kind === 'EVENT';
  const allDay = event && sendState.timeMode === 'ALL_DAY';
  document.querySelectorAll('[data-sendtime]').forEach(button => setActive(button, button.dataset.sendtime === sendState.timeMode, 'segmentButtonActive', 'segmentTextActive'));
  show('sendTimeField', !allDay);
  show('sendEndField', event && !allDay);
  show('sendReminderBlock', event && !allDay);
  show('sendAllDayHint', allDay);
  const quotaShown = isPaid() && sendUsed() >= SEND_QUOTA_SHOW_FROM;
  show('sendQuotaNote', quotaShown);
  byId('sendQuotaNote').textContent = quotaShown ? `오늘 보낼 수 있는 건수 ${sendRemaining()}건 · 받는 사람 1명당 1건으로 세요.` : '';
  show('sendOfflineNote', !online);
};

const openSendSheetBase5 = openSendSheet;
openSendSheet = function openSendSheetFull(personId) {
  sendState.timeMode = 'EXACT';
  openSendSheetBase5(personId);
  byId('sendLocation').value = '';
  byId('sendEnd').value = '';
  renderSendForm();
};

validateSend = function validateSendFull() {
  if (!sendState.recipients.length) return { error: '받는 사람을 골라 주세요' };
  const date = parseDateKey(byId('sendDate').value);
  const event = sendState.kind === 'EVENT';
  const allDay = event && sendState.timeMode === 'ALL_DAY';
  const clock = allDay ? { hour: 23, minute: 59 } : parseClock(byId('sendTime').value);
  let result;
  if (event) {
    const title = byId('sendTitle').value.trim();
    if (!title) return { error: '제목을 적어 주세요' };
    if (!date) return { error: '날짜를 2026-10-02 처럼 적어 주세요' };
    if (!clock) return { error: '시간을 15:00 처럼 적어 주세요' };
    const start = atTime(date, clock.hour, clock.minute);
    if (start.getTime() < Date.now()) return { error: '이미 지난 일정은 보낼 수 없어요' };
    let end = null;
    const endText = byId('sendEnd').value.trim();
    if (!allDay && endText) {
      const endClock = parseClock(endText);
      if (!endClock) return { error: '종료 시각을 16:00 처럼 적어 주세요' };
      end = atTime(date, endClock.hour, endClock.minute);
      if (end.getTime() <= start.getTime()) return { error: '종료 시각은 시작보다 늦어야 해요' };
    }
    result = { title, start, end, allDay, location: byId('sendLocation').value.trim() || null };
  } else {
    const amount = Number(byId('sendAmount').value.replace(/[,\s]/g, ''));
    if (!Number.isInteger(amount) || amount <= 0) return { error: '금액을 숫자로 적어 주세요' };
    if (amount > 100000000) return { error: '금액은 1억 원까지 보낼 수 있어요' };
    if (!date) return { error: '날짜를 2026-10-02 처럼 적어 주세요' };
    if (!clock) return { error: '시간을 15:00 처럼 적어 주세요' };
    result = { amount, memo: byId('sendMemo').value.trim(), start: atTime(date, clock.hour, clock.minute) };
  }
  // 하루 50건: 받는 사람 수만큼 한꺼번에 차감하고, 모자라면 전체를 보내지 않는다 (설계도 6.6 · 13.4)
  if (isPaid() && sendState.recipients.length > sendRemaining()) {
    return { error: `오늘 보낼 수 있는 건수가 부족해요. 남은 건수 ${sendRemaining()}건 · 받는 사람 ${sendState.recipients.length}명(1명당 1건)` };
  }
  return result;
};

submitSend = function submitSendFull() {
  const input = validateSend();
  show('sendError', false);
  if (input.error) {
    byId('sendError').textContent = input.error;
    show('sendError', true);
    return;
  }
  const event = sendState.kind === 'EVENT';
  const offline = !online;
  const label = event ? input.title : `${input.amount.toLocaleString('ko-KR')}원${input.memo ? ` · ${input.memo}` : ''}`;
  const rows = sendState.recipients.map(id => {
    const person = personById(id);
    const status = offline ? 'SENDING' : person.deliversNow ? 'DELIVERED' : 'PENDING';
    const record = { id: newId(6000), toId: id, kind: sendState.kind, title: label, status, clientRequestId: newId(6900), trial: isTrial(), startAt: input.start.toISOString() };
    if (event) Object.assign(record, { timeKind: input.allDay ? 'ALL_DAY' : 'EXACT', endAt: input.end ? input.end.toISOString() : null, location: input.location, offsets: input.allDay ? [] : [...sendState.offsets] });
    else Object.assign(record, { amount: input.amount, memo: input.memo || null, category: sendState.category });
    mockSent.unshift(record);
    return makeDiv('resultRow', makeAvatar(displayName(person)),
      makeDiv('resultMain', textElement('p', 'personName', displayName(person)), textElement('p', 'settingHint', offline ? '보내는 중 · 연결되면 보낼게요' : '보냈어요')),
      makeDiv('tag', textElement('p', 'tagText', SEND_STATUS_LABEL[status])));
  });
  if (!offline && isPaid()) account.sendUsed = sendUsed() + sendState.recipients.length;
  if (sendState.alsoMine) {
    if (event) {
      const mine = input.allDay
        ? makeAllDayEvent(newId(2200), input.title, input.start, input.location)
        : makeEventAt(newId(2200), input.title, input.start, input.end ? Math.round((input.end.getTime() - input.start.getTime()) / 60000) : 60, input.location);
      mockEvents.push(mine);
    } else {
      const daysAgo = Math.round((dayStart(0).getTime() - startOfDay(input.start).getTime()) / 86400000);
      mockTransactions.unshift(makeTransaction(newId(8), input.amount, sendState.category, input.memo || null, daysAgo, input.start.getHours(), input.start.getMinutes(), 'MANUAL', null));
    }
  }
  if (isTrial()) account.shareTrial = 0;
  byId('sendResultList').replaceChildren(...rows);
  show('sendOutboxNote', offline);
  show('sendForm', false);
  show('sendResult', true);
  refreshAll();
};

// ---------- 오프라인 보내기: 보낼 목록 → 연결되면 전송, 실패하면 "보내지 못했어요(사유)" (설계도 15) ----------
let sendFailNext = false; // 디자인 확인용: 다음 연결 때 서버가 한도 초과로 거절하는 모습을 본다
let lastOnlineSeen = true;

function flushOutbox() {
  const waiting = mockSent.filter(item => item.status === 'SENDING').reverse(); // 쌓은 순서대로
  let failed = 0;
  waiting.forEach(item => {
    const person = personById(item.toId);
    let reason = null;
    if (sendFailNext) reason = 'DAILY_LIMIT';
    else if (!person || !canReceive(person, item.kind)) reason = 'NOT_AVAILABLE';
    else if (item.kind === 'EVENT' && Date.parse(item.startAt) < Date.now()) reason = 'PAST_EVENT';
    else if (isPaid() && sendUsed() >= SEND_DAILY_LIMIT) reason = 'DAILY_LIMIT';
    if (reason) {
      item.status = 'FAILED';
      item.reason = reason;
      failed += 1;
      if (item.trial) account.shareTrial = 1; // 서버가 거절한 체험은 쓰지 않은 것으로 되돌린다
    } else {
      item.status = person.deliversNow ? 'DELIVERED' : 'PENDING';
      if (isPaid()) account.sendUsed = sendUsed() + 1;
    }
  });
  sendFailNext = false;
  if (!waiting.length) return;
  peopleNotice = failed
    ? `알림: 보내지 못한 항목이 ${failed}건 있어요. 보낸 항목에서 사유를 확인하세요.`
    : `연결돼서 보낼 목록의 ${waiting.length}건을 보냈어요.`;
}

// ---------- 보낸 항목: 눌러서 수정 · 취소 (설계도 6.5) ----------
layerIds.push('sentSheet');
let sentEditingId = null;
let sentCancelArmed = false;

const sentWhenLabel = item => `${koDate(new Date(item.startAt))} ${item.timeKind === 'ALL_DAY' ? '종일' : formatClock(item.startAt)}${item.location ? ` · ${item.location}` : ''}`;
const sentEditable = item => item.status === 'PENDING' || item.status === 'DELIVERED';

const SENT_NOTES = {
  PENDING: '받는 사람 앱이 아직 가져가지 않았어요. 수정하면 가져갈 때 바뀐 내용이 전달돼요.',
  DELIVERED: '수정하면 받는 사람 폰의 사본에 "수정됨"으로 바로 반영돼요. 받는 사람이 직접 고친 내용도 덮어써요.',
  SENDING: '연결되면 보낼게요. 그때까지는 수정하거나 취소할 수 없어요.',
  EXPIRED: '만료돼서 더 이상 전달하지 않아요.',
  CANCELED: '취소한 항목이에요.',
  FAILED: '보내지 못했어요.',
};

function renderSentSheet() {
  const item = mockSent.find(entry => entry.id === sentEditingId);
  if (!item) return;
  const event = item.kind === 'EVENT';
  const editable = sentEditable(item);
  byId('sentAvatar').replaceChildren(makeAvatar(nameOfId(item.toId)));
  byId('sentWho').textContent = `${nameOfId(item.toId)}님에게 보낸 ${KIND_INFO[item.kind].noun}`;
  byId('sentSummary').textContent = event && item.startAt ? `${item.title} · ${sentWhenLabel(item)}` : item.title;
  byId('sentStatus').textContent = SEND_STATUS_LABEL[item.status];
  byId('sentNote').textContent = item.status === 'FAILED' ? `보내지 못했어요 · 사유: ${SEND_FAIL_REASON[item.reason] ?? ''}` : SENT_NOTES[item.status];
  show('sentEditedTag', Boolean(item.editedAt));
  byId('sentEditedText').textContent = item.editedAt ? `수정됨 · ${editedStamp(item.editedAt)}` : '';
  show('sentEditBlock', editable);
  show('sentTitleField', event);
  show('sentAmountFields', !event);
  show('sentDateRow', event);
  show('sentTimeField', event && item.timeKind !== 'ALL_DAY');
  show('sentCancel', editable);
  show('sentRemove', !editable && item.status !== 'SENDING');
  byId('sentCancelText').textContent = sentCancelArmed ? '정말 취소할까요? 한 번 더 누르세요' : '보내기 취소';
  setDisabled('sentSave', !online);
  setDisabled('sentCancel', !online);
  show('sentOffline', editable && !online);
}

function openSentSheet(id) {
  const item = mockSent.find(entry => entry.id === id);
  if (!item) return;
  sentEditingId = id;
  sentCancelArmed = false;
  show('sentError', false);
  if (item.kind === 'EVENT') {
    byId('sentEditTitle').value = item.title;
    const start = new Date(item.startAt);
    byId('sentEditDate').value = dateKey(start);
    byId('sentEditTime').value = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  } else {
    byId('sentEditAmount').value = String(item.amount ?? '');
    byId('sentEditMemo').value = item.memo ?? '';
    byId('sentEditDate').value = '';
    byId('sentEditTime').value = '';
  }
  renderSentSheet();
  openLayer('sentSheet');
}

function saveSentEdit() {
  const item = mockSent.find(entry => entry.id === sentEditingId);
  if (!item || !online || !sentEditable(item)) return;
  show('sentError', false);
  const fail = text => { byId('sentError').textContent = text; show('sentError', true); };
  if (item.kind === 'EVENT') {
    const title = byId('sentEditTitle').value.trim();
    const date = parseDateKey(byId('sentEditDate').value);
    const allDay = item.timeKind === 'ALL_DAY';
    const clock = allDay ? { hour: 23, minute: 59 } : parseClock(byId('sentEditTime').value);
    if (!title) return fail('제목을 적어 주세요');
    if (!date) return fail('날짜를 2026-10-02 처럼 적어 주세요');
    if (!clock) return fail('시간을 15:00 처럼 적어 주세요');
    const start = atTime(date, clock.hour, clock.minute);
    if (start.getTime() < Date.now()) return fail('이미 지난 시각으로는 고칠 수 없어요');
    const length = item.endAt ? Date.parse(item.endAt) - Date.parse(item.startAt) : 0;
    item.title = title;
    item.startAt = start.toISOString();
    item.endAt = length > 0 ? new Date(start.getTime() + length).toISOString() : null;
  } else {
    const amount = Number(byId('sentEditAmount').value.replace(/[,\s]/g, ''));
    if (!Number.isInteger(amount) || amount <= 0) return fail('금액을 숫자로 적어 주세요');
    item.amount = amount;
    item.memo = byId('sentEditMemo').value.trim() || null;
    item.title = `${amount.toLocaleString('ko-KR')}원${item.memo ? ` · ${item.memo}` : ''}`;
  }
  item.editedAt = new Date().toISOString();
  peopleNotice = `수정했어요. 받는 사람에게 "수정됨"으로 반영돼요: ${item.title}.`;
  closeLayers();
  refreshAll();
}

function cancelSent() {
  const item = mockSent.find(entry => entry.id === sentEditingId);
  if (!item || !online || !sentEditable(item)) return;
  if (!sentCancelArmed) {
    sentCancelArmed = true;
    renderSentSheet();
    return;
  }
  item.status = 'CANCELED';
  peopleNotice = `보낸 ${KIND_INFO[item.kind].noun}을 취소했어요: ${item.title}.`;
  closeLayers();
  refreshAll();
}

function removeSentRow() {
  const index = mockSent.findIndex(entry => entry.id === sentEditingId);
  if (index < 0) return;
  mockSent.splice(index, 1);
  closeLayers();
  refreshAll();
}

buildSentRow = function buildSentRowFull(item) {
  const name = nameOfId(item.toId);
  const main = makeDiv('resultMain', textElement('p', 'personName', name), textElement('p', 'settingHint', `${KIND_INFO[item.kind].noun} · ${item.title}`));
  if (item.status === 'FAILED') main.append(textElement('p', 'settingHint', `사유: ${SEND_FAIL_REASON[item.reason] ?? ''}`));
  if (item.editedAt) main.append(makeDiv('tag tagEdited', textElement('p', 'tagText', `수정됨 · ${editedStamp(item.editedAt)}`)));
  const row = makeDiv('resultRow resultTap', makeAvatar(name), main, makeDiv('tag', textElement('p', 'tagText', SEND_STATUS_LABEL[item.status])));
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `${name}에게 보낸 ${KIND_INFO[item.kind].noun} ${item.title}, ${SEND_STATUS_LABEL[item.status]}`);
  row.addEventListener('click', () => openSentSheet(item.id));
  return row;
};

// 보낸 항목 예시에 시각 · 금액을 채운다 (수정 화면 확인용)
Object.assign(mockSent.find(item => item.id === 'sn-1'), { timeKind: 'EXACT', startAt: atTime(dayStart(3), 10, 0).toISOString(), endAt: null, location: '서울대병원' });
Object.assign(mockSent.find(item => item.id === 'sn-2'), { timeKind: 'EXACT', startAt: atTime(dayStart(2), 19, 0).toISOString(), endAt: null, location: null });
Object.assign(mockSent.find(item => item.id === 'sn-3'), { amount: 12000, memo: '점심' });
Object.assign(mockSent.find(item => item.id === 'sn-4'), { timeKind: 'EXACT', startAt: atTime(dayStart(4), 15, 0).toISOString(), endAt: null, location: null });

// ---------- 수신함 · 받은 항목 ----------
const buildInboxRowBase5 = buildInboxRow;
buildInboxRow = function buildInboxRowWithEdited(item) {
  const row = buildInboxRowBase5(item);
  if (item.editedAt) {
    const main = row.firstElementChild;
    main.insertBefore(makeDiv('tag tagEdited', textElement('p', 'tagText', `수정됨 · ${editedStamp(item.editedAt)}`)), main.children[1] ?? null);
  }
  return row;
};

// 가져갈 때 이미 시작 시각이 지났으면 캘린더에는 넣되 알림은 예약하지 않고 "지남"으로 둔다 (설계도 6.3)
const addReceivedToMineBase5 = addReceivedToMine;
addReceivedToMine = function addReceivedToMineWithPast(item) {
  addReceivedToMineBase5(item);
  if (item.kind !== 'EVENT') return;
  const event = mockEvents[mockEvents.length - 1];
  if (event && event.fromId === item.fromId && Date.parse(event.startAt) < Date.now()) {
    event.reminders = [];
    event.status = 'PAST';
  }
};

// ---------- 이벤트 연결 (9단계) ----------
document.querySelectorAll('[data-sendtime]').forEach(button => button.addEventListener('click', () => {
  sendState.timeMode = button.dataset.sendtime;
  renderSendForm();
}));
byId('sentSave').addEventListener('click', saveSentEdit);
byId('sentCancel').addEventListener('click', cancelSent);
byId('sentRemove').addEventListener('click', removeSentRow);
document.querySelectorAll('[data-tool="offline"]').forEach(button => button.addEventListener('click', () => {
  // 기존 연결 핸들러가 online 을 바꾼 뒤에 실행된다: 오프라인 → 온라인으로 돌아오면 보낼 목록을 보낸다
  if (online && !lastOnlineSeen) flushOutbox();
  lastOnlineSeen = online;
  if (!byId('sendSheet').hidden) renderSendForm();
  if (!byId('sentSheet').hidden) renderSentSheet();
  renderPeoplePage();
}));
document.querySelectorAll('[data-t]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.t === 'quota') {
    if (isTrial()) setAccount('basic');
    account.sendUsed = sendUsed() >= SEND_QUOTA_SHOW_FROM ? 0 : 42;
    highlight('[data-t="quota"]', () => sendUsed() >= SEND_QUOTA_SHOW_FROM);
  } else if (button.dataset.t === 'sendFail') {
    sendFailNext = !sendFailNext;
    highlight('[data-t="sendFail"]', () => sendFailNext);
  }
  if (!byId('sendSheet').hidden) renderSendForm();
}));
// ======================================================================
// 10단계: 입력 · AI 예외 — 부정 · 수입 문장 거부 / AI 오류 [다시 시도] / 앱 검증 실패 / 10분 후속 창 / 중복 지출 확인 /
//         알림 예약 실패 / 음성 버튼 · 오류 / 지출 보내기 · 같은 이름 수신자 선택 (설계도 4.1 · 4.2 · 4.6 · 4.7 · 15)
// ======================================================================

PLAN_REASONS.ai = 'AI 해석이 필요한 문장이에요. 체험 3회를 모두 썼어요. 구독하면 매달 계속 쓸 수 있어요.';
PLAN_REASONS.sendExpense = '지출 보내기는 구독 기능이에요. 공유 체험은 일정만 보낼 수 있어요.';

// ---------- 안 쓴 돈 · 수입 · 계획 · 질문은 기록하지 않는다 (설계도 4.2 · 14.6 "커피 안 샀어 5000원") ----------
const NOT_EXPENSE_RE = /(안\s*(썼|샀|먹|마셨|냈|산)|않았|못\s*(썼|샀|먹)|받았|월급|입금|벌었|환불|용돈|할\s*거|할게|예정|쓸게|사야|\?|얼마)/;
const mockInterpretBase6 = mockInterpret;
mockInterpret = function mockInterpretChecked(rawText) {
  const text = rawText.replace(/(\d),(?=\d{3})/g, '$1');
  if (findAmounts(text).length && !MEETING_RE.test(text) && NOT_EXPENSE_RE.test(text)) return { ok: false, reason: 'NOT_EXPENSE' };
  const result = mockInterpretBase6(rawText);
  if (result.ok) {
    // 지출도 "이걸 OO에게 줘"로 보낼 수 있다 (설계도 4.6): 마지막 지출 액션에 보내기를 붙인다
    if (/(에게|한테)\s*(줘|보내|전해)/.test(text) && !result.actions.some(action => action.send)) {
      const lastExpense = [...result.actions].reverse().find(action => action.kind === 'EXPENSE');
      if (lastExpense) {
        lastExpense.send = { recipients: [] };
        lastExpense.memo = (lastExpense.memo ?? '').replace(/\s*(이걸|이거).*$/, '').replace(VERB_TAIL, '').trim() || null; // 보내는 말은 메모에 넣지 않는다
      }
    }
    attachRecipientChoices(result.actions, text);
  }
  return result;
};

// 수신자 매칭은 폰에서 친구의 별명 · 닉네임과 비교한다. 같은 이름이 여러 명이면 고르게 한다 (설계도 4.6)
function attachRecipientChoices(actions, text) {
  actions.filter(action => action.send).forEach(action => {
    const hits = {};
    connectedPeople().forEach(person => {
      new Set([...(person.alias || '').split(/\s+/), person.nickname]).forEach(token => {
        if (token && token.length >= 2 && text.includes(token)) (hits[token] = hits[token] ?? new Set()).add(person.id);
      });
    });
    const unique = new Set();
    const picks = [];
    Object.entries(hits).forEach(([token, ids]) => {
      if (ids.size === 1) unique.add([...ids][0]);
      else picks.push({ token, candidates: [...ids], chosen: null });
    });
    action.send = { recipients: [...unique], picks: picks.filter(pick => !pick.candidates.some(id => unique.has(id))) };
  });
}

const unresolvedPicks = card => (card.action.send?.picks ?? []).filter(pick => !pick.chosen);

function choosePick(card, pick, id) {
  const send = card.action.send;
  if (pick.chosen) send.recipients = send.recipients.filter(item => item !== pick.chosen);
  pick.chosen = id;
  if (!send.recipients.includes(id)) send.recipients.push(id);
  renderCaptureResults();
}

// ---------- 카드: [다시 시도] · [알림 다시 시도] · 같은 이름 고르기 ----------
function retryCard(card) {
  capture.cards = capture.cards.filter(item => item !== card);
  submitCapture(card.text);
}

function retryReminder(card) {
  const event = cardItem(card);
  if (capture.reminderFails) {
    card.note = '다시 시도했지만 알림을 예약하지 못했어요. 잠시 뒤 다시 시도해 주세요. 일정은 저장돼 있어요.';
  } else {
    card.reminderFailed = false;
    card.note = '알림을 예약했어요.';
    if (event) event.reminderFailed = false;
  }
  renderCaptureResults();
  renderCalendar();
}

const buildCardBase6 = buildCard;
buildCard = function buildCardWithRetry(card) {
  const element = buildCardBase6(card);
  if (card.kind === 'REMINDER') return element;
  if (card.status === 'FAILED' && card.retry) {
    element.insertBefore(makeButton('smallButton', 'smallButtonText', '다시 시도', () => retryCard(card)), element.lastElementChild);
  }
  if (card.status === 'SAVED' && card.reminderFailed && cardItem(card)) {
    element.append(makeButton('smallSecondary', 'smallSecondaryText', '알림 다시 시도', () => retryReminder(card)));
  }
  if (card.status === 'CONFIRM' && card.action.send?.picks?.length) {
    const blocks = card.action.send.picks.map(pick => makeDiv('sheetBlock',
      textElement('p', 'text', `“${pick.token}”(이)라는 친구가 여러 명이에요. 누구에게 보낼까요?`),
      makeDiv('pillRow', ...pick.candidates.map(id => {
        const person = personById(id);
        const button = makeButton('pill', 'pillText', `${displayName(person)} · ${person.nickname}`, () => choosePick(card, pick, id));
        setActive(button, pick.chosen === id, 'pillActive', 'pillTextActive');
        return button;
      }))));
    const row = element.lastElementChild;
    blocks.forEach(block => element.insertBefore(block, row));
    if (unresolvedPicks(card).length) {
      const open = [...row.querySelectorAll('button')].find(button => button.textContent.trim() === '보내기 확인 열기');
      if (open) { open.classList.add('disabled'); open.setAttribute('aria-disabled', 'true'); }
    }
  }
  return element;
};

// ---------- 지출 보내기 확인 (설계도 4.6) ----------
const openCaptureSendBase6 = openCaptureSend;
openCaptureSend = function openCaptureSendWithExpense(card) {
  if (card.status !== 'CONFIRM' || unresolvedPicks(card).length) return;
  if (card.kind !== 'EXPENSE') { openCaptureSendBase6(card); return; }
  const action = card.action;
  if (isGuest()) { openLoginPrompt('SEND'); return; }
  if (isTrial()) { openPlan('sendExpense'); return; } // 공유 체험은 일정만 (설계도 6.6)
  openSendSheet(null);
  setSendKind('EXPENSE');
  byId('sendAmount').value = String(action.amount);
  byId('sendMemo').value = action.memo ?? '';
  const ids = (action.send.recipients ?? []).filter(id => canReceive(personById(id), 'EXPENSE'));
  sendState.recipients = ids;
  sendState.category = SEND_CATEGORIES.includes(action.category) ? action.category : null;
  if (/(나도\s*넣|내\s*지출에도|같이\s*넣)/.test(card.text)) sendState.alsoMine = true;
  renderSendForm();
};

// ---------- AI 오류 · 앱 검증 실패 · 후속 질문 10분 창 (설계도 4.7 · 15) ----------
const FOLLOWUP_WINDOW_MS = 10 * 60 * 1000;
followUpCharge = function followUpChargeWithWindow(card) {
  card.ctx.followUps += 1;
  const late = Date.now() - (card.ctx.startedAt ?? Date.now()) > FOLLOWUP_WINDOW_MS;
  if (card.ctx.followUps > FOLLOWUP_FREE || late) {
    if (aiBlock() !== null) return false;
    chargeAi();
  }
  return true;
};

capture.invalid = false; // 디자인 확인용: 서버 검증은 통과했지만 앱 검증에서 걸리는 응답
capture.reminderFails = false; // 디자인 확인용: 로컬 알림 예약 실패
capture.recentSaves = [];
let invalidCounter = 0;

// 같은 지출을 빠르게 두 번 입력하면 자동으로 버리지 않고 묻는다 (설계도 15)
const DUP_WINDOW_MS = 3 * 60 * 1000;
const commitCardBase6 = commitCard;
commitCard = function commitCardTracked(card) {
  commitCardBase6(card);
  if (card.kind === 'EXPENSE') capture.recentSaves.push({ id: card.itemId, amount: card.action.amount, memo: card.action.memo ?? null, at: Date.now() });
  if (card.kind === 'EVENT' && capture.reminderFails) {
    const event = cardItem(card);
    if (event && eventReminders(event).length > 0) {
      event.reminderFailed = true;
      card.reminderFailed = true;
      card.note = `${card.note ? `${card.note} · ` : ''}일정은 저장했어요. 알림은 예약하지 못했어요.`;
    }
  }
};

function recentSameExpense(local) {
  return capture.recentSaves.find(save => save.amount === local.amount && save.memo === (local.memo ?? null) && Date.now() - save.at < DUP_WINDOW_MS
    && mockTransactions.some(item => item.id === save.id && !item.deletedAt));
}

// ---------- 음성 버튼 · 오류 (설계도 4.1 · 15) ----------
const voiceView = { support: true, permission: 'GRANTED', silent: false, note: '' };
const voiceListening = () => !byId('voiceCancel').hidden;

function renderVoiceState() {
  const note = !voiceView.support ? '이 기기에서는 글자로 입력해 주세요.' : voiceView.permission === 'DENIED' ? '마이크 권한이 꺼져 있어요. 설정에서 마이크를 허용하면 말로 기록할 수 있어요.' : voiceView.note;
  setDisabled('voiceButton', !voiceView.support);
  byId('voiceButton').setAttribute('aria-disabled', String(!voiceView.support));
  show('voiceNote', Boolean(note));
  byId('voiceNote').textContent = note;
  show('voiceSettings', voiceView.support && voiceView.permission === 'DENIED');
  highlight('[data-v="silent"]', () => voiceView.silent);
  highlight('[data-v="denied"]', () => voiceView.permission === 'DENIED');
  highlight('[data-v="unsupported"]', () => !voiceView.support);
}

const renderBase6 = render;
render = function renderWithVoice(state) {
  renderBase6(state);
  renderVoiceState();
};

function onVoiceButton() {
  if (!voiceView.support || voiceView.permission === 'DENIED') { renderVoiceState(); return; }
  if (!voiceListening()) {
    voiceView.note = '';
    render('listening');
    return;
  }
  // 말하기 마치기: 말소리가 없으면 "다시 말해 주세요", 있으면 문장으로 이어 간다
  render('default');
  if (voiceView.silent) {
    voiceView.note = '말소리가 들리지 않았어요. 다시 말해 주세요.';
    renderVoiceState();
    return;
  }
  byId('captureInput').value = '점심 7000원 썼어';
  submitCapture();
}

// ---------- 이벤트 연결 (10단계) ----------
byId('voiceButton').addEventListener('click', onVoiceButton);
byId('voiceCancel').addEventListener('click', () => { voiceView.note = ''; render('default'); }); // 취소는 조용히 닫는다
byId('voiceSettings').addEventListener('click', () => { voiceView.note = '기기 설정의 마이크 항목으로 이동해요. (앱에서만 동작해요)'; byId('voiceNote').textContent = voiceView.note; });
document.querySelectorAll('[data-v]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.v;
  if (tool === 'silent') voiceView.silent = !voiceView.silent;
  else if (tool === 'denied') voiceView.permission = voiceView.permission === 'DENIED' ? 'GRANTED' : 'DENIED';
  else if (tool === 'unsupported') voiceView.support = !voiceView.support;
  voiceView.note = '';
  renderVoiceState();
}));
document.querySelectorAll('[data-q]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.q;
  if (tool === 'invalid') { capture.invalid = !capture.invalid; highlight('[data-q="invalid"]', () => capture.invalid); return; }
  if (tool === 'remFail') { capture.reminderFails = !capture.reminderFails; highlight('[data-q="remFail"]', () => capture.reminderFails); return; }
  jumpToPage('home');
  if (tool === 'sameName' && !mockPeople.some(person => person.id === 'p-minsu2')) {
    mockPeople.push({ ...makePerson('minsu_two', 'CONNECTED'), id: 'p-minsu2', alias: '작은아들 민수' });
    renderAccountViews();
  }
  const samples = {
    negation: '커피 안 샀어 5000원',
    income: '월급 3000000원 받았어',
    expSend: '점심 12000원 썼어 이걸 민수에게 줘',
    sameName: '내일 저녁 7시 강남역에서 만나기 이걸 민수에게 줘',
  };
  byId('captureInput').value = samples[tool];
  submitCapture();
}));
// ======================================================================
// 11단계: 하단 탭(홈·캘린더·지출·사람) · 홈 오늘 일정 · 받은 항목 배지 · 게스트 3건 안내 · 알림 우선순위 ·
//         구독 구역(구매 복원 · 구매 확인 중 · 유예) · 엑셀 실패 (설계도 3.3 · 8 · 9.4 · 10.3 · 11.1 · 15)
// ======================================================================

// ---------- 하단 탭 (설계도 11.1): 홈 · 캘린더 · 지출 · 사람, 설정은 우측 상단 버튼 ----------
const TAB_PAGES = ['home', 'calendar', 'expenses', 'people'];
const TAB_LABEL = { home: '홈', calendar: '캘린더', expenses: '지출', people: '사람' };
PAGES.calendar = { id: 'calendarPage', title: '캘린더' };

const receivedWaiting = () => mockReceived.length;
const peopleBadgeCount = () => mockReceived.length + mockFriendRequests.length;

function renderTabBar(name) {
  show('tabBar', TAB_PAGES.includes(name));
  const tabs = TAB_PAGES.map(key => {
    const active = key === name;
    const badge = key === 'people' && peopleBadgeCount() > 0 && !isGuest() ? textElement('p', 'tabBadge', String(peopleBadgeCount())) : null;
    const button = document.createElement('button');
    button.className = active ? 'tabButton tabButtonActive' : 'tabButton';
    button.dataset.tab = key;
    button.setAttribute('aria-label', `${TAB_LABEL[key]}${badge ? `, 새 항목 ${peopleBadgeCount()}건` : ''}`);
    if (active) button.setAttribute('aria-current', 'page');
    button.append(makeDiv('tabLabelRow', textElement('p', active ? 'tabLabel tabLabelActive' : 'tabLabel', TAB_LABEL[key]), ...(badge ? [badge] : [])));
    button.addEventListener('click', () => selectTab(key));
    return button;
  });
  byId('tabBar').replaceChildren(...tabs);
}

function selectTab(name) {
  if (name === 'people' && isGuest()) { openLoginPrompt('FRIEND'); return; }
  stopScenario();
  closeLayers();
  showSheet('settings', false);
  pageStack.length = 0;
  showPage(name);
}

// ---------- 홈: 오늘 일정 · 받은 항목 알림 배지 (설계도 11.2 H1) ----------
function renderHomeExtras() {
  const entries = itemsForDate(dayStart(0));
  const rows = entries.slice(0, 4).map(entry => {
    const row = makeDiv('resultRow resultTap',
      makeDiv('resultMain', textElement('p', 'personName', entry.item.title), textElement('p', 'settingHint', `${agendaLabel(entry)}${entry.type === 'TASK' ? '' : entry.item.location ? ` · ${entry.item.location}` : ''}`)));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `${agendaLabel(entry)} ${entry.item.title}, 캘린더에서 보기`);
    row.addEventListener('click', () => { focusDate = dayStart(0); renderCalendar(); selectTab('calendar'); });
    return row;
  });
  if (rows.length) rows[rows.length - 1].classList.add('rowLast');
  byId('todayList').replaceChildren(...(rows.length ? rows : [textElement('p', 'agendaEmpty', '오늘 일정이 없어요.')]));
  byId('todayMore').textContent = entries.length > 4 ? `외 ${entries.length - 4}건 더 있어요` : '';
  show('todayMore', entries.length > 4);
  const waiting = receivedWaiting();
  show('homeReceived', !isGuest() && waiting > 0);
  byId('homeReceivedText').textContent = `받은 항목 ${waiting}건이 기다려요`;
  renderTabBar(currentPage);
}

const renderCalendarBase7 = renderCalendar;
renderCalendar = function renderCalendarWithHome() {
  renderCalendarBase7();
  renderHomeExtras();
};
const renderPeoplePageBase7 = renderPeoplePage;
renderPeoplePage = function renderPeoplePageWithBadge() {
  renderPeoplePageBase7();
  renderHomeExtras();
};

// ---------- 게스트가 기록을 3건 저장하면 "로그인하면 백업돼요" 한 번 (설계도 3.3) ----------
const GUEST_PROMPT_AFTER = 3;
let guestSaves = 0;
let guestPromptDismissed = false;

function noteGuestSave(count) {
  if (!isGuest() || count <= 0) return;
  guestSaves += count;
  if (!guestPromptDismissed && guestSaves >= GUEST_PROMPT_AFTER) {
    guestPromptVisible = true;
    renderSessionViews();
  }
}

const commitCardBase7 = commitCard;
commitCard = function commitCardGuestCount(card) {
  commitCardBase7(card);
  noteGuestSave(1);
};
const saveEditBase7 = saveEdit;
saveEdit = function saveEditGuestCount() {
  const before = mockEvents.length + mockTasks.length;
  saveEditBase7();
  noteGuestSave(mockEvents.length + mockTasks.length - before);
};
const saveExpenseBase7 = saveExpense;
saveExpense = function saveExpenseGuestCount() {
  const before = mockTransactions.length;
  saveExpenseBase7();
  noteGuestSave(mockTransactions.length - before);
};

// ---------- 알림 우선순위: 전체 끔 > 친구별 설정 > 항목별 알림, 더 제한적인 설정이 적용 (설계도 8.2) ----------
function itemSilentReason(item) {
  if (item.status !== 'UPCOMING' || !eventReminders(item).length) return '';
  if (!mockSettings.allOn) return '모든 알림이 꺼져 있어 알림이 울리지 않아요.';
  if (notifPermission === 'BLOCKED') return '기기 알림이 꺼져 있어 알림이 울리지 않아요.';
  if (!mockSettings.ownOn) return '내 일정 알림이 꺼져 있어 알림이 울리지 않아요.';
  if (item.fromId) {
    const person = personById(item.fromId);
    if (person && person.notifyEventTime === false) return `${displayName(person)}님 일정의 시각 알림을 꺼 두어 알림이 울리지 않아요.`;
  }
  return '';
}

const renderItemSheetBase7 = renderItemSheet;
renderItemSheet = function renderItemSheetWithPriority() {
  renderItemSheetBase7();
  const item = itemByKd();
  const reason = item && kdState.type === 'EVENT' ? itemSilentReason(item) : '';
  show('kdSilent', Boolean(reason));
  if (reason) byId('kdSilent').textContent = reason;
};

// ---------- 구독 구역: 구매 복원 · 구매 확인 중 · 결제 유예 (설계도 9.4 · 15) ----------
const purchaseView = { verifying: false, grace: false };
let subNotice = '';

const restorePurchaseBase7 = restorePurchase;
restorePurchase = function restorePurchaseWithVerify(outcome) {
  restorePurchaseBase7(outcome);
  if (restoreOutcome === 'FOUND') purchaseView.verifying = false; // 복원으로 서버가 구매를 확인했다
};

function renderSubscriptionBits() {
  show('subGroup', !isGuest());
  show('subNoticeBox', Boolean(subNotice));
  byId('subNoticeText').textContent = subNotice;
  show('subVerifying', purchaseView.verifying);
  show('subGrace', purchaseView.grace);
  if (purchaseView.verifying) byId('planValue').textContent = '구매 확인 중';
  else if (purchaseView.grace) byId('planValue').textContent = `${byId('planValue').textContent} · 결제 확인 필요`;
}

const renderAccountViewsBase7 = renderAccountViews;
renderAccountViews = function renderAccountViewsWithSub() {
  renderAccountViewsBase7();
  renderSubscriptionBits();
};

const renderPlanPageBase7 = renderPlanPage;
renderPlanPage = function renderPlanPageWithPurchase() {
  renderPlanPageBase7();
  show('planVerifyingBox', purchaseView.verifying);
  show('planGraceBox', purchaseView.grace);
};

// ---------- 엑셀 내보내기 실패: 오류 표시 + 기간을 줄여 다시 시도 (설계도 10.3 · 15) ----------
let exportFails = false; // 디자인 확인용: 용량 · 권한 문제
exportState.failed = false;

const renderExportSheetBase7 = renderExportSheet;
renderExportSheet = function renderExportSheetWithFail() {
  renderExportSheetBase7();
  show('exportFailBox', exportState.failed);
  show('exportShrink', exportState.failed && exportState.range !== 'MONTH');
};

const openExportSheetBase7 = openExportSheet;
openExportSheet = function openExportSheetFresh() {
  exportState.failed = false;
  openExportSheetBase7();
};

const runExportBase7 = runExport;
runExport = function runExportWithFail() {
  if (isOff('exportGo')) return;
  if (exportFails) {
    exportState.failed = true;
    exportState.done = false;
    renderExportSheet();
    return;
  }
  exportState.failed = false;
  runExportBase7();
};

// 앞선 단계의 showPage 덧씌움이 뒤로 버튼을 다시 켜므로, 탭 첫 화면(스택이 비어 있음)에서는 마지막에 다시 숨긴다.
const showPageBase12 = showPage;
showPage = function showPageWithTabs(name) {
  showPageBase12(name);
  const hiddenBack = ['home', 'onboard', 'restoreChoice', 'restore'].includes(name) || (TAB_PAGES.includes(name) && pageStack.length === 0);
  show('backButton', !hiddenBack);
};

// ---------- 이벤트 연결 (11단계) ----------
byId('todayOpenCal').addEventListener('click', () => selectTab('calendar'));
byId('homeReceived').addEventListener('click', () => selectTab('people'));
byId('guestPromptClose').addEventListener('click', () => { guestPromptDismissed = true; });
byId('guestPromptLogin').addEventListener('click', () => { guestPromptDismissed = true; });
document.querySelectorAll('[data-tool="guestPrompt"]').forEach(button => button.addEventListener('click', () => { guestSaves = GUEST_PROMPT_AFTER; guestPromptDismissed = false; }));
byId('rowRestore').addEventListener('click', () => {
  restorePurchase();
  subNotice = planNotice;
  planNotice = '';
  renderAccountViews();
});
byId('rowSubManage').addEventListener('click', () => { subNotice = '앱에서는 스토어의 구독 관리 화면이 열려요.'; renderAccountViews(); });
byId('exportShrink').addEventListener('click', () => { exportState.range = 'MONTH'; exportState.done = false; renderExportSheet(); });
document.querySelectorAll('[data-p]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.p;
  ensureSignedIn();
  if (tool === 'verifying') { setAccount('free'); purchaseView.verifying = true; purchaseView.grace = false; }
  else if (tool === 'verified') { purchaseView.verifying = false; subscribe('BASIC'); }
  else if (tool === 'grace') { setAccount('basic'); purchaseView.grace = true; purchaseView.verifying = false; }
  else { purchaseView.verifying = false; purchaseView.grace = false; }
  subNotice = '';
  highlight('[data-p="verifying"]', () => purchaseView.verifying);
  highlight('[data-p="grace"]', () => purchaseView.grace);
  jumpToPage('plan');
  renderAccountViews();
  renderPlanPage();
}));
document.querySelectorAll('[data-x="exportFail"]').forEach(button => button.addEventListener('click', () => {
  exportFails = !exportFails;
  highlight('[data-x="exportFail"]', () => exportFails);
}));
renderHomeExtras();
// ---------- 첫 AI 사용 전 동의 (설계도 16.1 · 처리 위탁 · 국외 이전 고지) ----------
// 미리보기는 기본이 "동의함"이다. 디자인 바의 버튼으로 "동의 전" 상태를 만들어 화면을 확인한다.
let aiConsent = true;
const runAiBase13 = runAi;
runAi = function runAiWithConsent(text) {
  if (!aiConsent && !isGuest()) {
    setRoute('AI 해석 전에 확인해 주세요', '입력한 문장은 AI가 해석하도록 OpenAI(미국)로 전송돼요. 이름 · 친구 목록 · 기록은 보내지 않고, 음성 녹음은 저장하지 않아요. 동의하지 않아도 직접 입력은 계속 쓸 수 있어요. 횟수는 동의한 뒤 AI가 해석에 성공했을 때만 차감돼요.', [
      { label: '동의하고 계속', onClick: () => { aiConsent = true; capture.route = null; runAi(text); } },
      manualButtonFor(text),
    ]);
    renderCaptureResults();
    return;
  }
  runAiBase13(text);
};
document.querySelectorAll('[data-tool="aiConsent"]').forEach(button => button.addEventListener('click', () => {
  ensureSignedIn();
  aiConsent = !aiConsent;
  highlight('[data-tool="aiConsent"]', () => !aiConsent);
  jumpToPage('home');
}));

// ---------- 이벤트 연결 ----------
function loadView() {
  try {
    const saved = localStorage.getItem('calendarView');
    return VIEWS.includes(saved) ? saved : 'week';
  } catch {
    return 'week';
  }
}

document.querySelectorAll('[data-state]').forEach(button => {
  button.addEventListener('click', () => render(button.dataset.state));
});
document.querySelectorAll('[data-motion]').forEach(button => {
  button.addEventListener('click', () => { reducedMotion = !reducedMotion; applyMotion(); });
});
document.querySelectorAll('[data-scenario]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.dataset.scenario === 'reset') {
      restoreTransactions();
      render('default');
    } else {
      runScenario(button.dataset.scenario).catch(error => console.error(error));
    }
  });
});
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => changeView(button.dataset.view));
});
document.querySelectorAll('[data-type]').forEach(button => {
  button.addEventListener('click', () => { if (editing && editing.mode === 'new') applyEditType(button.dataset.type); });
});
byId('designToggle').addEventListener('click', () => setBarOpen(byId('designPanel').hidden));
byId('designTop').addEventListener('click', () => window.scrollTo(0, 0));
// 캘린더: 이전/다음, 오늘로, 추가
byId('calPrev').addEventListener('click', () => shiftCalendar(-1));
byId('calNext').addEventListener('click', () => shiftCalendar(1));
byId('todayButton').addEventListener('click', () => pickDate(dayStart(0)));
byId('addButton').addEventListener('click', openNew);
// 시트: 화면 설정 / 일정 편집
byId('settingsOpen').addEventListener('click', () => openPage('settings'));
byId('backButton').addEventListener('click', goBack);
byId('settingsClose').addEventListener('click', () => showSheet('settings', false));
byId('settingsBackdrop').addEventListener('click', () => showSheet('settings', false));
byId('colorReset').addEventListener('click', () => applyColors(DEFAULT_COLORS, true));
byId('editClose').addEventListener('click', closeEdit);
byId('editBackdrop').addEventListener('click', closeEdit);
byId('editSave').addEventListener('click', saveEdit);
byId('editDelete').addEventListener('click', deleteEdit);
// 앱 동작 재현: 버튼을 누르면 녹음을 멈추고 오버레이가 사라져 홈이 보인다.
byId('overlayButton').addEventListener('click', () => render('default'));
byId('bubbleYes').addEventListener('click', () => answer('yes'));
byId('bubbleNo').addEventListener('click', () => answer('no'));
window.addEventListener('scroll', onPageScroll);
window.addEventListener('resize', () => {
  fitOverlay();
  settlePet();
});

// 새 화면 연결: 설정 · 요금제 · 가족·친구 · 시트
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => jumpToPage(button.dataset.page)));
document.querySelectorAll('[data-account]').forEach(button => button.addEventListener('click', () => setAccount(button.dataset.account)));
document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => openDesignLayer(button.dataset.layer)));
document.querySelectorAll('[data-close-layer]').forEach(button => button.addEventListener('click', closeLayers));
document.querySelectorAll('[data-addtab]').forEach(button => button.addEventListener('click', () => setAddTab(button.dataset.addtab)));
document.querySelectorAll('[data-relation]').forEach(button => button.addEventListener('click', () => { personById(personEditingId).relation = button.dataset.relation; renderPersonSheet(); renderPeoplePage(); }));
document.querySelectorAll('[data-sendkind]').forEach(button => button.addEventListener('click', () => setSendKind(button.dataset.sendkind)));
// 디자인 확인용: 링크 결과 · 도착 흉내 · 상태 바꾸기
document.querySelectorAll('[data-linkresult]').forEach(button => button.addEventListener('click', () => { jumpToPage('people'); openLinkResult(button.dataset.linkresult); }));
document.querySelectorAll('[data-arrive]').forEach(button => button.addEventListener('click', () => {
  const [personId, kind, over] = button.dataset.arrive.split(':');
  jumpToPage('people');
  simulateArrival(personId, kind, over === 'over');
}));
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.tool;
  if (tool === 'expire') {
    if (linkExpiresAt === 0) createLink();
    linkExpiresAt = Date.now() - 1;
    renderLinkViews();
    openAddSheet('link');
  } else if (tool === 'full') {
    friendCountOverride = friendCountOverride === null ? FRIEND_LIMIT : null;
    jumpToPage('people');
    renderAccountViews();
  } else if (tool === 'myLinkOpened') {
    jumpToPage('people');
    simulateMyLinkOpened();
  } else if (tool === 'accepted') {
    jumpToPage('people');
    simulateRequestAccepted();
  } else if (tool === 'perm') {
    notifPermission = notifPermission === 'GRANTED' ? 'BLOCKED' : 'GRANTED';
    jumpToPage('settings');
    refreshAll();
  } else if (tool === 'senderEdit') {
    jumpToPage('people');
    simulateSenderEdit();
  } else if (tool === 'senderCancelEvent') {
    jumpToPage('people');
    simulateSenderCancel('EVENT');
  } else if (tool === 'senderCancelExpense') {
    jumpToPage('people');
    simulateSenderCancel('EXPENSE');
  } else if (tool === 'withdrawn') {
    const person = personById('p-minsu');
    if (person) person.withdrawn = !person.withdrawn;
    jumpToPage('people');
    refreshAll();
  }
}));
byId('layerBackdrop').addEventListener('click', closeLayers);
const planReasonNow = () => ({ TRIAL: 'trial', MONTH: 'month', DAY: 'day' }[aiBlock()] ?? '');
byId('usageLink').addEventListener('click', () => (isGuest() ? openLoginPrompt('AI') : openPlan(planReasonNow())));
byId('usagePlanLink').addEventListener('click', () => (isGuest() ? openLoginPrompt('AI') : openPlan('')));
byId('rowPlan').addEventListener('click', () => (isGuest() ? openLoginPrompt('PLAN') : openPlan('')));
byId('rowPeople').addEventListener('click', () => (isGuest() ? openLoginPrompt('FRIEND') : openPage('people')));
byId('rowDisplay').addEventListener('click', () => showSheet('settings', true));
// 알림 설정: 전체 끔이 가장 우선이라 전체가 꺼지면 아래 항목은 흐리게 보이고 눌러도 바뀌지 않는다
byId('rowAll').addEventListener('click', () => { mockSettings.allOn = !mockSettings.allOn; refreshAll(); });
byId('rowOwn').addEventListener('click', () => { if (!mockSettings.allOn) return; mockSettings.ownOn = !mockSettings.ownOn; renderAccountViews(); });
byId('rowLock').addEventListener('click', () => { if (!mockSettings.allOn) return; mockSettings.lockTitle = !mockSettings.lockTitle; renderAccountViews(); });
byId('rowFriendNotif').addEventListener('click', () => openPage('people'));
byId('rowReceive').addEventListener('click', () => openPage('people'));
byId('rowSendDefault').addEventListener('click', () => { mockSettings.sendAlsoDefault = !mockSettings.sendAlsoDefault; renderAccountViews(); });
byId('permOpen').addEventListener('click', () => show('permNote', true));
byId('rowNotifArrival').addEventListener('click', () => { const person = personById(personEditingId); person.notifyArrival = !person.notifyArrival; renderPersonSheet(); renderAccountViews(); });
byId('rowNotifTime').addEventListener('click', () => { const person = personById(personEditingId); person.notifyEventTime = !person.notifyEventTime; renderPersonSheet(); renderAccountViews(); });
// 요금제 화면
byId('planRestore').addEventListener('click', () => restorePurchase());
byId('planManage').addEventListener('click', () => { planNotice = '앱에서는 스토어의 구독 관리 화면이 열려요.'; renderPlanPage(); });
byId('planTerms').addEventListener('click', () => { planNotice = '이용약관 문서는 구현 단계에서 연결돼요.'; renderPlanPage(); });
byId('planPrivacy').addEventListener('click', () => { planNotice = '개인정보 처리방침 문서는 구현 단계에서 연결돼요.'; renderPlanPage(); });
document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => { jumpToPage('plan'); restorePurchase(button.dataset.restore); }));
byId('addPersonOpen').addEventListener('click', () => openAddSheet('link'));
byId('sendButton').addEventListener('click', () => startSend(null));
byId('linkCreate').addEventListener('click', createLink);
byId('linkRenew').addEventListener('click', createLink);
byId('linkExpiredRenew').addEventListener('click', createLink);
byId('qrCreate').addEventListener('click', createLink);
byId('qrScan').addEventListener('click', () => openLinkResult('OK'));
byId('qrRenew').addEventListener('click', createLink);
byId('qrExpiredRenew').addEventListener('click', createLink);
byId('linkShare').addEventListener('click', () => {
  try { navigator.clipboard.writeText(`https://example.com/i/${linkToken}`); } catch { /* 미리보기에서 복사가 막혀도 모양만 확인하면 된다 */ }
  show('linkShareNote', true);
});
byId('nickFind').addEventListener('click', findNickname);
byId('nickInput').addEventListener('keydown', event => { if (event.key === 'Enter') findNickname(); });
byId('nickSend').addEventListener('click', sendFriendRequest);
byId('connectOk').addEventListener('click', closeLayers);
byId('connectGoFriends').addEventListener('click', () => { jumpToPage('people'); });
byId('setupAlias').addEventListener('input', renderSetupPills);
byId('setupDone').addEventListener('click', () => finishSetup(true));
byId('setupSkip').addEventListener('click', () => finishSetup(false));
byId('personName').addEventListener('input', saveAlias);
byId('personSend').addEventListener('click', () => startSend(personEditingId));
byId('personRemove').addEventListener('click', () => removePerson('remove'));
byId('sendAlso').addEventListener('click', () => { sendState.alsoMine = !sendState.alsoMine; renderSendForm(); });
byId('sendGo').addEventListener('click', () => submitSend());

calView = loadView();
buildSwatchRow('accentSwatches', 'accent', '포인트 색', ACCENT_PRESETS);
buildSwatchRow('baseSwatches', 'base', '바탕색', BASE_PRESETS);
applyColors(loadColors(), false);
applyFontScale(loadFontScale(), false);
render('default');
renderAccountViews();
showPage('home');
applyMotion();
setBarOpen(false);
// 이 컴퓨터가 '동작 줄이기'를 켜 두면 움직임이 멈춰 보이므로 이유를 알려 준다 (디자인 확인용)
show('motionNote', Boolean(motionQuery && motionQuery.matches));

// ======================================================================
// 14단계: 점검 보정 (설계도 4.4 · 4.5 · 4.6 · 5.1 · 5.2 · 6.2 · 6.5 · 8.2 · 11.3 · 15)
//   - 받은 항목 모두 삭제 · 오프라인 잠금 · 친구 30명 · 링크 열기 분기 · 수신자별 실패와 [다시 보내기] · 50건 문구
//   - 받은 항목의 보낸 사람 아바타 · 수정됨 · 취소됨 · 빨간 위험 버튼 · 2단계 확인 · 되돌리기 바
//   - 금액 없는 묶음 지출 질문 · 어제로 보지 않는 지출 시각 질문 · 자정 · 묶음 카테고리 · 알림 꺼짐 안내
// ======================================================================

const NEED_NET = '인터넷 연결이 필요해요';
const UNDO_TOAST_MS = 8000;

// 서버가 필요한 버튼 잠그기: 잠글 때만 disabled 를 붙이고, 풀 때는 우리가 붙인 것만 뗀다. 잠긴 버튼은 눌러도 아무 일도 없다.
function gate(element, off) {
  if (!element) return;
  element.dataset.net = '1';
  if (off) {
    if (!element.classList.contains('disabled')) { element.classList.add('disabled'); element.dataset.gated = '1'; }
  } else if (element.dataset.gated) {
    element.classList.remove('disabled');
    delete element.dataset.gated;
  }
  element.setAttribute('aria-disabled', String(element.classList.contains('disabled')));
}
document.addEventListener('click', event => {
  const target = event.target && event.target.closest ? event.target.closest('[data-net]') : null;
  if (target && target.classList.contains('disabled')) { event.stopPropagation(); event.preventDefault(); }
}, true);

const isFriendsFull = () => friendCount() >= FRIEND_LIMIT;

function applyNetGates() {
  // 요금제 · 구매 복원 (설계도 9.4 · 11.3)
  ['planRestore', 'rowRestore'].forEach(id => gate(byId(id), !online));
  document.querySelectorAll('#planList button').forEach(button => gate(button, !online));
  show('planOfflineNote', !online);
  // 친구 추가 시트 (설계도 5.1 · 5.2 · 15)
  ['linkCreate', 'qrCreate'].forEach(id => gate(byId(id), !online || isFriendsFull()));
  gate(byId('qrScan'), !online);
  gate(byId('nickFind'), !online);
  gate(byId('nickSend'), !online);
  const addNote = !online ? `${NEED_NET}. 링크 · QR · 닉네임으로 친구를 추가하는 일은 연결된 뒤에 할 수 있어요.`
    : isFriendsFull() ? `친구는 최대 ${FRIEND_LIMIT}명까지예요. 한 명을 정리한 뒤 추가할 수 있어요.` : '';
  byId('addGateNote').textContent = addNote;
  show('addGateNote', Boolean(addNote));
  // 사람 화면: 30명이면 [친구 추가] 비활성 + 안내
  gate(byId('addPersonOpen'), isFriendsFull());
  show('addFullNote', isFriendsFull());
  let needsNet = false;
  document.querySelectorAll('#incomingBox .requestCard').forEach(card => {
    const eyebrow = card.querySelector('.eyebrow');
    const label = eyebrow ? eyebrow.textContent : '';
    if (label !== '받은 친구 요청' && label !== '내 링크로 연결됨') return;
    needsNet = true;
    const buttons = [...card.querySelectorAll('button')];
    buttons.forEach(button => gate(button, !online));
    if (label === '받은 친구 요청' && buttons[0]) {
      gate(buttons[0], !online || isFriendsFull());
      if (isFriendsFull() && !card.querySelector('.gateNote')) card.append(textElement('p', 'muted gateNote', `친구가 가득 차서 수락할 수 없어요(최대 ${FRIEND_LIMIT}명).`));
    }
  });
  document.querySelectorAll('#peopleList .personRowStatic .linkButton').forEach(button => { needsNet = true; gate(button, !online); });
  show('peopleOfflineNote', !online && needsNet);
  // 보낸 항목: 실패한 항목 [다시 보내기]
  gate(byId('sentRetry'), !online);
}

[
  ['renderPeoplePage', () => renderPeoplePage, fn => { renderPeoplePage = fn; }],
  ['renderPlanPage', () => renderPlanPage, fn => { renderPlanPage = fn; }],
  ['renderLinkViews', () => renderLinkViews, fn => { renderLinkViews = fn; }],
  ['openAddSheet', () => openAddSheet, fn => { openAddSheet = fn; }],
  ['renderAccountViews', () => renderAccountViews, fn => { renderAccountViews = fn; }],
  ['renderSentSheet', () => renderSentSheet, fn => { renderSentSheet = fn; }],
].forEach(([name, get, set]) => {
  const base = get();
  set(function gatedRender(...args) { const result = base.apply(this, args); applyNetGates(); return result; });
});
document.querySelectorAll('[data-tool="offline"]').forEach(button => button.addEventListener('click', applyNetGates));

// ---------- 친구 상세 시트: 이 친구에게서 받은 항목 모두 삭제 (설계도 5.2 · 6.5) ----------
let deleteReceivedArmed = false;
const renderPersonSheetBase14 = renderPersonSheet;
renderPersonSheet = function renderPersonSheetWithDeleteReceived() {
  renderPersonSheetBase14();
  const person = personById(personEditingId);
  if (!person) return;
  const count = receivedCountFrom(person.id);
  byId('personDeleteReceivedText').textContent = deleteReceivedArmed ? `정말 ${count}건을 지울까요? 한 번 더 누르세요` : `이 친구에게서 받은 항목 모두 삭제 (${count}건)`;
  setDisabled('personDeleteReceived', count === 0);
};
const openPersonSheetBase14 = openPersonSheet;
openPersonSheet = function openPersonSheetFresh(id) {
  deleteReceivedArmed = false;
  show('personDeleteNote', false);
  openPersonSheetBase14(id);
};
byId('personDeleteReceived').addEventListener('click', () => {
  if (isOff('personDeleteReceived')) return;
  const person = personById(personEditingId);
  if (!person) return;
  if (!deleteReceivedArmed) { deleteReceivedArmed = true; renderPersonSheet(); return; }
  deleteReceivedArmed = false;
  const removed = deleteReceivedFrom(person.id);
  byId('personDeleteNote').textContent = `${displayName(person)}님에게서 받은 항목 ${removed}건을 지웠어요. 삭제 기록이 남아 백업을 복원해도 되살아나지 않아요. 친구 관계는 그대로예요.`;
  show('personDeleteNote', true);
  refreshAll();
  renderPersonSheet();
});

// ---------- 링크 열기: 오프라인 · 게스트 (설계도 5.1) ----------
const LINK_LOGIN_WINDOW_MS = 5 * 60 * 1000;
let pendingLinkAt = 0;
const openLinkResultBase14 = openLinkResult;
openLinkResult = function openLinkResultChecked(kind) {
  show('connectLogin', false);
  if (!online) { openLinkResultBase14('OFFLINE'); return; }
  if (isGuest() && kind === 'OK') {
    pendingLinkAt = Date.now();
    byId('connectTitle').textContent = '링크 열기';
    byId('connectMessage').textContent = '로그인하면 친구가 될 수 있어요. 로그인과 닉네임 설정을 마치면 자동으로 연결돼요. 링크를 연 뒤 5분 안에 마쳐야 해요.';
    show('connectGoFriends', false);
    show('connectLogin', true);
    showConnectPanel('result');
    openLayer('connectSheet');
    return;
  }
  openLinkResultBase14(kind);
};
byId('connectLogin').addEventListener('click', () => { closeLayers(); openOnboard('LOGIN', false, '로그인하면 친구가 될 수 있어요'); });
const finishOnboardBase14 = finishOnboard;
finishOnboard = function finishOnboardWithLink() {
  finishOnboardBase14();
  if (pendingLinkAt && !isGuest()) {
    const within = Date.now() - pendingLinkAt <= LINK_LOGIN_WINDOW_MS;
    pendingLinkAt = 0;
    jumpToPage('people');
    openLinkResult(within ? 'OK' : 'EXPIRED');
  }
};

// ---------- 보내기 결과: 수신자별 성공 · 실패와 [다시 보내기] (설계도 6.2 · 15) ----------
let partialFailNext = false;
let lastSendRecords = [];

function sendResultRow(record) {
  const name = nameOfId(record.toId);
  const failed = record.status === 'FAILED';
  const line = failed ? `보내지 못했어요 · 사유: ${SEND_FAIL_REASON[record.reason] ?? ''}` : record.status === 'SENDING' ? '보내는 중 · 연결되면 보낼게요' : '보냈어요';
  const main = makeDiv('resultMain', textElement('p', 'personName', name), textElement('p', 'settingHint', line));
  if (failed) {
    const retry = makeButton('smallButton', 'smallButtonText', '다시 보내기', () => retrySend(record));
    retry.dataset.retry = record.id;
    gate(retry, !online);
    main.append(retry);
  }
  return makeDiv('resultRow', makeAvatar(name), main, makeDiv('tag', textElement('p', 'tagText', SEND_STATUS_LABEL[record.status])));
}

function renderSendResultRows() {
  byId('sendResultList').replaceChildren(...lastSendRecords.map(sendResultRow));
}

function retrySend(record) {
  if (!online || record.status !== 'FAILED') return;
  const person = personById(record.toId);
  let reason = null;
  if (!person || !canReceive(person, record.kind)) reason = 'NOT_AVAILABLE';
  else if (record.kind === 'EVENT' && Date.parse(record.startAt) < Date.now()) reason = 'PAST_EVENT';
  else if (isPaid() && sendUsed() >= SEND_DAILY_LIMIT) reason = 'DAILY_LIMIT';
  if (reason) {
    record.reason = reason;
  } else {
    record.status = person.deliversNow ? 'DELIVERED' : 'PENDING';
    delete record.reason;
    if (isPaid()) account.sendUsed = sendUsed() + 1;
    if (record.trial) account.shareTrial = 0;
  }
  if (!byId('sendResult').hidden) renderSendResultRows();
  if (!byId('sentSheet').hidden) renderSentSheet();
  refreshAll();
}

const submitSendBase14 = submitSend;
submitSend = function submitSendWithResults() {
  const before = mockSent.length;
  submitSendBase14();
  const added = mockSent.length - before;
  if (added <= 0) return;
  lastSendRecords = mockSent.slice(0, added).reverse();
  if (partialFailNext && online) {
    // 디자인 확인용: 마지막 받는 사람에게만 실패 — 한도에서 빼지 않고, 체험은 쓰지 않은 것으로 되돌린다
    const target = lastSendRecords[lastSendRecords.length - 1];
    target.status = 'FAILED';
    target.reason = 'NOT_AVAILABLE';
    if (isPaid()) account.sendUsed = Math.max(0, sendUsed() - 1);
    if (target.trial) account.shareTrial = 1;
    partialFailNext = false;
    highlight('[data-t14="partialFail"]', () => partialFailNext);
    renderSendResultRows();
    refreshAll();
    return;
  }
  if (lastSendRecords.some(record => record.status === 'FAILED')) renderSendResultRows();
};
document.querySelectorAll('[data-t14="partialFail"]').forEach(button => button.addEventListener('click', () => {
  partialFailNext = !partialFailNext;
  highlight('[data-t14="partialFail"]', () => partialFailNext);
}));

const renderSentSheetBase14 = renderSentSheet;
renderSentSheet = function renderSentSheetWithRetry() {
  renderSentSheetBase14();
  const item = mockSent.find(entry => entry.id === sentEditingId);
  show('sentRetry', Boolean(item) && item.status === 'FAILED');
  applyNetGates();
};
byId('sentRetry').addEventListener('click', () => {
  const item = mockSent.find(entry => entry.id === sentEditingId);
  if (!item || isOff('sentRetry')) return;
  retrySend(item);
  renderSentSheet();
});

// ---------- 하루 50건 도달 문구 · 독립 복사본 안내 (설계도 4.6 · 15) ----------
const LIMIT_REACHED_TEXT = '오늘은 더 보낼 수 없어요(자정에 초기화)';
const validateSendBase14 = validateSend;
validateSend = function validateSendLimitText() {
  const result = validateSendBase14();
  if (result.error && isPaid() && sendRemaining() === 0 && result.error.startsWith('오늘 보낼 수 있는 건수가 부족해요')) return { error: LIMIT_REACHED_TEXT };
  return result;
};
const renderSendFormBase14 = renderSendForm;
renderSendForm = function renderSendFormWithNotes() {
  renderSendFormBase14();
  const spent = isPaid() && sendRemaining() === 0;
  if (spent) { show('sendQuotaNote', true); byId('sendQuotaNote').textContent = LIMIT_REACHED_TEXT; }
  const event = sendState.kind === 'EVENT';
  byId('sendAlsoNote').textContent = `내 ${event ? '캘린더' : '지출'}에 따로 복사본이 생겨요. 한쪽을 고쳐도 다른 쪽은 바뀌지 않아요.`;
  show('sendAlsoNote', sendState.alsoMine);
};

// ---------- 받는 사람 고르기: 연결된 친구가 없을 때 (설계도 4.6 · 11.3) ----------
const buildSendPeopleBase14 = buildSendPeople;
buildSendPeople = function buildSendPeopleWithEmpty() {
  buildSendPeopleBase14();
  if (connectedPeople().length === 0) {
    byId('sendPeople').replaceChildren(
      textElement('p', 'muted', '아직 연결된 친구가 없어요. 친구를 추가한 뒤 보낼 수 있어요.'),
      makeButton('smallSecondary', 'smallSecondaryText', '친구 추가', () => { closeLayers(); jumpToPage('people'); if (!isGuest()) openAddSheet('link'); }));
  }
};

// ---------- 받은 항목: 아바타 · 수정됨 · 취소됨 (설계도 6.5 · 11.3) ----------
const editedTag = item => makeDiv('tag tagEdited', textElement('p', 'tagText', `수정됨 · ${editedStamp(item.editedAt)}`));
const canceledTag = () => makeDiv('tag tagCanceled', textElement('p', 'tagText', '취소됨'));

const buildReceivedCardBase14 = buildReceivedCard;
buildReceivedCard = function buildReceivedCardFull(item) {
  const card = buildReceivedCardBase14(item);
  const info = KIND_INFO[item.kind];
  const canceled = item.status === 'CANCELED';
  card.querySelector('.eyebrow').textContent = `받은 ${info.noun}`;
  const extras = [buildSenderLine(item.fromId)];
  if (item.editedAt) extras.push(editedTag(item));
  if (canceled) {
    // children: eyebrow, heading, text, muted, buttonRow, alwaysRow, 이름 바꾸기
    [card.children[5], card.children[4]].forEach(child => child && child.remove());
    card.querySelector('.heading').classList.add('agendaTitleDone');
    extras.push(canceledTag(), textElement('p', 'muted', '보낸 사람이 취소했어요. 더 이상 넣을 수 없어요.'));
    card.insertBefore(makeButton('smallSecondary', 'smallSecondaryText', '지우기', () => {
      mockReceived.splice(mockReceived.indexOf(item), 1);
      peopleNotice = `취소된 ${info.noun}을 지웠어요: ${item.title}.`;
      renderAccountViews();
    }), card.lastElementChild);
  }
  card.querySelector('.eyebrow').after(...extras);
  return card;
};

let armedInboxId = null;
const buildInboxRowBase14 = buildInboxRow;
buildInboxRow = function buildInboxRowFull(item) {
  const row = buildInboxRowBase14(item);
  const main = row.firstElementChild;
  const hint = [...main.querySelectorAll('p')].find(p => p.textContent.includes(' · 보낸 사람: '));
  if (hint) {
    hint.textContent = itemLine(item);
    hint.after(buildSenderLine(item.fromId));
  }
  const buttons = [...row.querySelectorAll('.inboxButtons button')];
  const addButton = buttons[0];
  const deleteButton = buttons[1];
  if (item.status === 'CANCELED') {
    main.firstElementChild.classList.add('agendaTitleDone');
    main.firstElementChild.after(canceledTag());
    if (addButton) addButton.remove();
  }
  if (deleteButton) {
    const armed = armedInboxId === item.id;
    const replacement = makeButton('smallSecondary secondaryDanger', 'smallSecondaryText secondaryTextDanger', armed ? '정말 삭제할까요? 한 번 더' : '삭제', () => {
      if (armedInboxId !== item.id) { armedInboxId = item.id; renderPeoplePage(); return; }
      armedInboxId = null;
      mockInbox.splice(mockInbox.indexOf(item), 1);
      peopleNotice = `수신함에서 삭제했어요: ${item.title}.`;
      renderAccountViews();
    });
    deleteButton.replaceWith(replacement);
  }
  return row;
};

let armedLinkNoticeId = null;
const buildLinkNoticeCardBase14 = buildLinkNoticeCard;
buildLinkNoticeCard = function buildLinkNoticeCardTwoStep(notice) {
  const card = buildLinkNoticeCardBase14(notice);
  const button = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '연결 끊기');
  if (button) {
    const armed = armedLinkNoticeId === notice.id;
    const person = personById(notice.personId);
    button.replaceWith(makeButton('smallSecondary secondaryDanger', 'smallSecondaryText secondaryTextDanger', armed ? '정말 끊을까요? 한 번 더' : '연결 끊기', () => {
      if (armedLinkNoticeId !== notice.id) { armedLinkNoticeId = notice.id; renderPeoplePage(); return; }
      armedLinkNoticeId = null;
      mockLinkNotices.splice(mockLinkNotices.indexOf(notice), 1);
      if (person) detachPerson(person, '연결을 끊었어요');
      renderAccountViews();
    }));
  }
  return card;
};

// 받은 지출 목록 줄(E1) · 상세(E2)
const renderRecordBase14 = renderRecord;
renderRecord = function renderRecordFull(item) {
  const record = renderRecordBase14(item);
  if (item.fromId) {
    const meta = record.children[2];
    if (meta) meta.replaceWith(makeDiv('senderLine', senderAvatar(item.fromId), textElement('p', 'muted', formatMeta(item))));
    if (item.editedAt) record.append(editedTag(item));
  }
  return record;
};
const renderExpenseSheetBase14 = renderExpenseSheet;
renderExpenseSheet = function renderExpenseSheetFull() {
  renderExpenseSheetBase14();
  const item = expenseById(expState.detailId);
  if (!item) return;
  const old = document.getElementById('exReceivedInfo');
  if (old) old.remove();
  const received = Boolean(item.fromId);
  show('exSource', !received);
  show('exEdit', true);
  if (received) {
    const info = makeDiv('field stack12', buildSenderLine(item.fromId));
    info.id = 'exReceivedInfo';
    if (item.editedAt) info.append(editedTag(item));
    info.append(textElement('p', 'muted', '내가 고친 내용은 보낸 사람이 다시 수정하면 덮어써져요.'));
    byId('exSource').after(info);
  }
};
const addReceivedToMineBase14 = addReceivedToMine;
addReceivedToMine = function addReceivedToMineKeepEdited(item) {
  addReceivedToMineBase14(item);
  if (!item.editedAt) return;
  const added = item.kind === 'EVENT' ? mockEvents[mockEvents.length - 1] : mockTransactions[0];
  if (added && added.fromId === item.fromId) added.editedAt = item.editedAt;
};

// 보낸 사람의 수정 · 취소가 받은 카드 · 수신함 · 넣은 지출에도 닿는다 (설계도 6.5)
const NO_EVENT_EDIT = '수정할 받은 일정이 없어요. 먼저 일정을 받아 주세요.';
const NO_EVENT_CANCEL = '취소할 받은 일정이 없어요. 먼저 일정을 받아 캘린더에 넣어 주세요.';
const pendingItems = () => [...mockReceived, ...mockInbox];
const simulateSenderEditBase14 = simulateSenderEdit;
simulateSenderEdit = function simulateSenderEditAll() {
  simulateSenderEditBase14();
  const stamp = new Date().toISOString();
  let touched = null;
  pendingItems().forEach(item => {
    if (item.editedAt || item.status === 'CANCELED') return;
    if (item.kind === 'EVENT') item.startAt = new Date(new Date(item.startAt).getTime() + 3600000);
    else item.amount += 1000;
    item.editedAt = stamp;
    touched = touched ?? item;
  });
  const expense = mockTransactions.find(entry => entry.fromId && !entry.deletedAt && !entry.editedAt);
  if (expense) {
    expense.amount += 1000;
    expense.editedAt = stamp;
    expense.updatedAt = stamp;
    touched = touched ?? { kind: 'EXPENSE', fromId: expense.fromId, title: expense.memo ?? expense.category ?? '지출', amount: expense.amount };
  }
  if (touched && peopleNotice === NO_EVENT_EDIT) {
    peopleNotice = changeNotice(senderOf(touched.fromId), 'EDITED', touched.kind === 'EVENT' ? { kind: 'EVENT', title: touched.title, startAt: new Date(touched.startAt) } : { kind: 'EXPENSE', title: touched.title, amount: touched.amount });
  }
  refreshAll();
};
const simulateSenderCancelBase14 = simulateSenderCancel;
simulateSenderCancel = function simulateSenderCancelAll(kind) {
  const expenseBefore = kind === 'EVENT' ? null : mockTransactions.find(item => item.fromId && !item.deletedAt);
  simulateSenderCancelBase14(kind);
  if (kind === 'EVENT') {
    const target = pendingItems().find(item => item.kind === 'EVENT' && item.status !== 'CANCELED');
    if (target) {
      target.status = 'CANCELED';
      if (peopleNotice === NO_EVENT_CANCEL) peopleNotice = changeNotice(senderOf(target.fromId), 'CANCELED', { kind: 'EVENT', title: target.title, startAt: new Date(target.startAt) });
    }
  } else {
    // 지출은 받는 사람 폰에서 삭제된다: 아직 넣지 않은 받은 카드 · 수신함의 지출도 사라진다
    const pending = pendingItems().find(item => item.kind === 'EXPENSE');
    if (pending) {
      [mockReceived, mockInbox].forEach(list => { const index = list.indexOf(pending); if (index >= 0) list.splice(index, 1); });
      if (!expenseBefore) peopleNotice = changeNotice(senderOf(pending.fromId), 'CANCELED', { kind: 'EXPENSE', title: pending.title, amount: pending.amount });
    } else if (expenseBefore) {
      peopleNotice = `${changeNotice(senderOf(expenseBefore.fromId), 'CANCELED', { kind: 'EXPENSE', title: expenseBefore.memo ?? expenseBefore.category ?? '지출', amount: expenseBefore.amount })} 내 지출에서 빠졌어요.`;
    }
  }
  refreshAll();
};
const pushTextBase14 = pushText;
pushText = function pushTextWithExpense(type, person, item, routed) {
  if (type !== 'ARRIVAL' && item && item.kind === 'EXPENSE') {
    const who = withIga(displayName(person));
    const detail = mockSettings.lockTitle ? ` · ${item.title} ${Number(item.amount ?? 0).toLocaleString('ko-KR')}원` : '';
    return `${who} 지출을 ${type === 'EDITED' ? '수정' : '취소'}했어요${detail}`;
  }
  return pushTextBase14(type, person, item, routed);
};

// ---------- 빨간 위험 버튼 (설계도 11.3): 되돌릴 수 없는 최종 실행은 빨간색 ----------
// (index.html 의 #dangerNext · #dangerGo · #dangerHold 에 클래스를 붙였다)

// ---------- 되돌리기 바: 저장 직후 화면 아래에 몇 초 동안 (설계도 11.3) ----------
let undoToastTimer = null;
let undoToastAction = null;
function hideUndoToast() {
  clearTimeout(undoToastTimer);
  undoToastAction = null;
  show('undoToast', false);
}
function showUndoToast(text, onUndo) {
  clearTimeout(undoToastTimer);
  byId('undoToastText').textContent = text;
  undoToastAction = onUndo;
  show('undoToast', true);
  undoToastTimer = setTimeout(hideUndoToast, UNDO_TOAST_MS);
}
byId('undoToastButton').addEventListener('click', () => {
  const action = undoToastAction;
  hideUndoToast();
  if (action) action();
});
const commitCardBase14 = commitCard;
commitCard = function commitCardWithNotes(card) {
  commitCardBase14(card);
  if (card.note) card.note = card.note.replace(/분로 /g, '분으로 ');
  if (card.status !== 'SAVED' || (card.kind !== 'EVENT' && card.kind !== 'EXPENSE')) return;
  const item = cardItem(card);
  // 알림 권한이 꺼져 있으면 카드에 알려 준다 (설계도 15: 알림 권한 거부)
  if (card.kind === 'EVENT' && item && (item.reminders ?? []).length > 0 && notifPermission === 'BLOCKED') {
    card.note = `${card.note ? `${card.note} · ` : ''}알림 꺼짐 · 기기 설정에서 알림을 켜 주세요`;
  }
  const label = cardSummary(card);
  showUndoToast(`저장했어요 · ${label}`, () => undoCard(card));
};
const simulateArrivalBase14 = simulateArrival;
simulateArrival = function simulateArrivalWithUndo(personId, kind, forceOver) {
  const eventIds = new Set(mockEvents.map(entry => entry.id));
  const expenseIds = new Set(mockTransactions.map(entry => entry.id));
  simulateArrivalBase14(personId, kind, forceOver);
  const added = [...mockEvents.filter(entry => !eventIds.has(entry.id)), ...mockTransactions.filter(entry => !expenseIds.has(entry.id))][0];
  if (added && added.fromId === personId) {
    const info = KIND_INFO[kind];
    showUndoToast(`${nameOfId(personId)}님이 보낸 ${info.noun}을 ${info.addTo}에 넣었어요`, () => {
      added.deletedAt = new Date().toISOString();
      added.updatedAt = added.deletedAt;
      peopleNotice = '되돌렸어요. 받은 항목을 내 기록에서 뺐어요.';
      refreshAll();
    });
  }
};

// ---------- 친구 일정 보기(P6): 목록 상태 버튼을 따른다 (설계도 11.3) ----------
FRIEND_CAL_NOTICE.LOADING = '불러오는 중이에요…';
const friendCalStateBase14 = friendCalState;
friendCalState = function friendCalStateWithList(person) {
  const state = friendCalStateBase14(person);
  if (state !== 'OK') return state;
  if (listView.state === 'loading') return 'LOADING';
  if (listView.state === 'error') return 'FAILED';
  return state;
};
document.querySelectorAll('[data-l]').forEach(button => button.addEventListener('click', () => { if (currentPage === 'friendCal') renderFriendCalendar(); }));

// ---------- 설정 > 알림 > 친구별 (설계도 8.2) ----------
const renderNotifSettingsBase14 = renderNotifSettings;
renderNotifSettings = function renderNotifSettingsWithFriends() {
  renderNotifSettingsBase14();
  const people = connectedPeople();
  const master = mockSettings.allOn;
  byId('friendNotifList').replaceChildren(...people.map(person => {
    const toggle = (label, field) => {
      const button = makeButton('pill', 'pillText', label, () => {
        if (!mockSettings.allOn) return;
        person[field] = !person[field];
        renderNotifSettings();
        renderPeoplePage();
        if (!byId('personSheet').hidden) renderPersonSheet();
      });
      setActive(button, person[field], 'pillActive', 'pillTextActive');
      return button;
    };
    const row = makeDiv('friendNotifRow', textElement('p', 'settingTitle', displayName(person)), makeDiv('pillRow', toggle('도착 알림', 'notifyArrival'), toggle('일정 시각 알림', 'notifyEventTime')));
    row.classList.toggle('disabled', !master);
    return row;
  }));
  show('friendNotifList', people.length > 0);
};

// ---------- AI 해석: 금액 없는 묶음 지출 · 어제로 보지 않는 지출 시각 · 자정 · 묶음 카테고리 (설계도 4.4 · 4.5) ----------
if (!SEND_CATEGORIES.includes('기타')) SEND_CATEGORIES.push('기타');
const TOTAL_WORD_RE = /(총|합쳐서|다\s*해서|전부\s*해서|모두)/;
const FOOD_VERB_RE = /(먹었|마셨|샀|썼|시켰|결제)/;
const koRo = label => (label.endsWith('분') ? `${label}으로` : `${label}로`);

// "아이스크림 2천원이고 생수랑 밥 해서 총 12000원" → 메모 "아이스크림 2,000원, 생수, 밥", 카테고리는 모두 같으면 그것, 섞이면 "기타"
function bundleParts(rawText) {
  const text = rawText.replace(/(\d),(?=\d{3})/g, '$1');
  const amounts = findAmounts(text);
  const hasTotal = TOTAL_WORD_RE.test(text);
  let rest = text;
  amounts.forEach((amount, index) => { rest = rest.replace(amount.raw, hasTotal && index === amounts.length - 1 ? ' ' : ` @@${amount.value}@@ `); });
  const tokens = rest.replace(TOTAL_WORD_RE, ' ').replace(/(해서|먹었[가-힣]*|마셨[가-힣]*|샀[가-힣]*|썼[가-힣]*|탔[가-힣]*|시켰[가-힣]*|결제했[가-힣]*)/g, ' ').split(/\s+/).filter(Boolean)
    .map(token => (/^@@\d+@@$/.test(token) ? token : token.replace(/(이랑|랑|하고|이고|이며|고)$/, ''))).filter(Boolean);
  const items = [];
  tokens.forEach(token => {
    const match = token.match(/^@@(\d+)@@$/);
    if (!match) items.push(token);
    else if (items.length) items[items.length - 1] += ` ${Number(match[1]).toLocaleString('ko-KR')}원`;
  });
  const categories = items.map(item => categoryOf(item));
  const category = !items.length ? categoryOf(text) : categories.every(name => name && name === categories[0]) ? categories[0] : '기타';
  return { memo: items.join(', ') || null, category, count: items.length };
}

// 묶음 지출("총 …원")은 로컬 파서가 아니라 AI 쪽에서 항목별로 읽는다 (설계도 4.2 · 4.5)
const localParseBase14 = localParse;
localParse = function localParseNoBundle(text) { return TOTAL_WORD_RE.test(text) ? null : localParseBase14(text); };

const mockInterpretBase14 = mockInterpret;
mockInterpret = function mockInterpretBundled(rawText) {
  const text = rawText.replace(/(\d),(?=\d{3})/g, '$1');
  const amounts = findAmounts(text);
  if (!amounts.length && !MEETING_RE.test(text) && FOOD_VERB_RE.test(text) && !NOT_EXPENSE_RE.test(text) && categoryOf(text)) {
    const parts = bundleParts(text);
    if (parts.count >= 2) return { ok: true, actions: [{ kind: 'EXPENSE', ask: 'AMOUNT', amount: null, category: parts.category, memo: parts.memo }] };
  }
  const result = mockInterpretBase14(rawText);
  if (!result.ok) return result;
  if (TOTAL_WORD_RE.test(text) && amounts.length >= 1 && !MEETING_RE.test(text) && result.actions.length === 1 && result.actions[0].kind === 'EXPENSE') {
    const parts = bundleParts(text);
    if (parts.count) Object.assign(result.actions[0], { memo: parts.memo, category: parts.category });
  }
  result.actions.forEach(action => {
    if (action.note) action.note = action.note.replace(/분로 /g, '분으로 ');
    // 지출 시각: 오늘 오전 N시도 아직 안 왔으면 어제로 보지 않고 묻는다 (설계도 4.4)
    if (action.kind === 'EXPENSE' && !action.ask && action.when && action.note && action.when.getTime() < dayStart(0).getTime()) {
      action.ask = 'YESTERDAY';
      action.askLabel = clockLabel(action.when.getHours(), action.when.getMinutes());
    }
  });
  return result;
};

// "자정": 그날 밤 24:00 (설계도 4.4). TIME_RE 는 const 라서 읽기 함수에서 먼저 잡는다.
const readTimeBase14 = readTime;
readTime = function readTimeWithMidnight(text) {
  const direct = readTimeBase14(text);
  if (direct) return direct;
  const match = text.match(/자정/);
  return match ? { hour: 0, minute: 0, cue: null, raw: match[0], twentyFour: true } : null;
};

const buildCardBase14 = buildCard;
buildCard = function buildCardWithExpenseAsk(card) {
  if (card.kind === 'EXPENSE' && card.status === 'ASKING' && (card.question === 'AMOUNT' || card.question === 'YESTERDAY')) {
    const action = card.action;
    const category = action.category ?? '미분류';
    const memo = action.memo ? ` · 메모 "${action.memo}"` : '';
    const summary = card.question === 'AMOUNT' ? `지출 · ${category}${memo}` : `지출 ${action.amount.toLocaleString('ko-KR')}원 · ${category}${memo}`;
    const body = [makeDiv('rowBetween', textElement('p', 'text', summary), makeDiv('tag', textElement('p', 'tagText', CARD_TAG.ASKING)))];
    if (card.question === 'AMOUNT') {
      body.push(textElement('p', 'text', '총 얼마였어요?'));
      const input = document.createElement('input');
      input.className = 'input';
      input.placeholder = '12000원';
      input.maxLength = 12;
      input.id = `cardAnswer${card.id}`;
      input.setAttribute('aria-label', '총 금액 답하기');
      body.push(input, makeButton('smallButton', 'smallButtonText', '답하기', () => answerCard(card, input.value)));
    } else {
      body.push(textElement('p', 'text', `오늘은 아직 그 시각이 되지 않았어요. 어제 ${koRo(action.askLabel)} 저장할까요?`));
      body.push(makeDiv('buttonRow', makeButton('smallButton', 'smallButtonText', '예', () => answerCard(card, 'YES')), makeButton('smallSecondary', 'smallSecondaryText', '아니오', () => answerCard(card, 'NO'))));
    }
    if (card.error) body.push(textElement('p', 'error', card.error));
    const element = makeDiv('requestCard resultCard', ...body);
    element.dataset.status = 'ASKING';
    return element;
  }
  return buildCardBase14(card);
};
const answerCardBase14 = answerCard;
answerCard = function answerCardWithExpenseAsk(card, answer) {
  if (card && card.status === 'ASKING' && card.question === 'AMOUNT') {
    card.error = '';
    const cleaned = String(answer).replace(/(\d),(?=\d{3})/g, '$1');
    const found = findAmounts(cleaned)[0];
    const value = found ? found.value : Number(cleaned.replace(/[\s원]/g, ''));
    if (!Number.isInteger(value) || value <= 0 || value > 100000000) { card.error = '금액을 12000 또는 12,000원 처럼 적어 주세요'; renderCaptureResults(); return; }
    if (!followUpCharge(card)) { card.status = 'FAILED'; card.note = 'AI 해석 한도를 다 써서 다시 해석할 수 없어요. 직접 입력해 주세요.'; card.question = null; renderCaptureResults(); return; }
    finishAsk(card, { amount: value });
    refreshCapture();
    return;
  }
  if (card && card.status === 'ASKING' && card.question === 'YESTERDAY') {
    if (answer === 'NO') { card.status = 'CANCELED'; card.question = null; card.note = '저장하지 않았어요. 시각을 직접 입력해 주세요.'; }
    else finishAsk(card, { note: `어제 ${koRo(card.action.askLabel)} 저장했어요` });
    refreshCapture();
    return;
  }
  answerCardBase14(card, answer);
};

// ---------- 디자인 바 연결 (14단계) ----------
document.querySelectorAll('[data-t14="guestLink"]').forEach(button => button.addEventListener('click', () => {
  session = GUEST();
  renderAccountViews();
  jumpToPage('people');
  openLinkResult('OK');
}));
document.querySelectorAll('[data-t14="guestLinkLate"]').forEach(button => button.addEventListener('click', () => {
  if (pendingLinkAt) pendingLinkAt -= LINK_LOGIN_WINDOW_MS + 60000;
}));
document.querySelectorAll('[data-t14="editExpense"]').forEach(button => button.addEventListener('click', () => simulateSenderEdit()));
applyNetGates();
