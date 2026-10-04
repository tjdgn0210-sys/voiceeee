// Development-only: node --test scripts/verify-capture-flow.cjs
// M1-11: local results are saved at once with an undo offer, probable double entries wait for the user, bundled and unsafe
// sentences are never saved locally, and an unreachable AI keeps the sentence without running it later by itself.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase, root } = require('./test-support.cjs');

const { load } = createLoader();
const { createCaptureParserInput, routeCaptureInput, TOTAL_WORD_RE } = load('src/application/proposals/capture-parser-router.ts');
const { createCaptureInterpretationService } = load('src/application/proposals/interpret-capture-input.ts');
const { createCaptureFlow, findRecentDuplicate, DUPLICATE_WINDOW_MS } = load('src/application/capture/capture-flow.ts');
const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
const { createUndoBar } = load('src/application/undo/undo-bar.ts');
const { createSqliteTransactionRepository } = load('src/database/repositories/sqlite-transaction-repository.ts');
const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');

const NOW = '2026-10-04T05:00:00.000Z';

async function setup() {
  const db = await openMigratedDatabase(load);
  let clock = Date.parse(NOW);
  let counter = 0;
  const transactions = createSqliteTransactionRepository(db);
  const expenses = createManualExpenses({
    transactions, unitOfWork: createSqliteTransactionCreationUnitOfWork(db),
    nextActionId: () => `action-${++counter}`, nextLogId: () => `log-${++counter}`,
    idsForAction: id => ({ transactionId: id, undoId: id }), now: () => new Date(clock).toISOString(), undoWindowMilliseconds: 60_000,
  });
  const undoBar = createUndoBar({ setTimer: () => 1, clearTimer: () => {} });
  const flow = createCaptureFlow({
    save: proposal => expenses.save(proposal), recentExpenses: limit => transactions.listRecent(limit),
    undo: undoId => expenses.undo(undoId), undoBar, now: () => new Date(clock).toISOString(),
  });
  const parse = text => {
    const routed = routeCaptureInput(createCaptureParserInput(text, `action-${++counter}`, 'TEXT', new Date(clock).toISOString()));
    return routed;
  };
  return { db, flow, expenses, undoBar, parse, advance: ms => { clock += ms; }, count: () => db.raw.prepare('SELECT count(*) n FROM transactions WHERE deleted_at IS NULL').get().n };
}

test('a local result is saved at once, shown with an undo offer, and the offer reverses it', async () => {
  const { flow, parse, undoBar, count } = await setup();
  const routed = parse('점심 7000원 썼어');
  assert.equal(routed.status, 'PARSED');
  const outcome = await flow.handleParsed(routed.proposal, 'LOCAL');
  assert.equal(outcome.status, 'SAVED');
  assert.equal(count(), 1);
  const bar = undoBar.getState();
  assert.equal(bar.status, 'SHOWN');
  assert.match(bar.entry.label, /식비 7,000원을 저장했어요/);
  await undoBar.run();
  assert.equal(undoBar.getState().status, 'DONE');
  assert.equal(count(), 0);
});

test('the same amount and memo again within 3 minutes asks first; saving anyway is the user\'s choice', async () => {
  const { flow, parse, count, advance } = await setup();
  assert.equal((await flow.handleParsed(parse('점심 7000원').proposal, 'LOCAL')).status, 'SAVED');
  advance(60_000);
  const second = await flow.handleParsed(parse('점심 7000원').proposal, 'LOCAL');
  assert.equal(second.status, 'DUPLICATE');
  assert.equal(count(), 1, 'nothing is written or discarded silently');
  assert.equal((await flow.saveConfirmed(second.proposal)).status, 'SAVED');
  assert.equal(count(), 2, 'a legitimate repeat is kept');
});

test('no duplicate warning after the window, for another amount, or for another memo', async () => {
  const { flow, parse, count, advance } = await setup();
  await flow.handleParsed(parse('점심 7000원').proposal, 'LOCAL');
  assert.equal((await flow.handleParsed(parse('점심 8000원').proposal, 'LOCAL')).status, 'SAVED');
  assert.equal((await flow.handleParsed(parse('커피 7000원').proposal, 'LOCAL')).status, 'SAVED');
  advance(DUPLICATE_WINDOW_MS + 1000);
  assert.equal((await flow.handleParsed(parse('점심 7000원').proposal, 'LOCAL')).status, 'SAVED');
  assert.equal(count(), 4);
});

test('duplicate lookup: amount and memo must match, only recent records count, null memos match each other', () => {
  const record = (overrides = {}) => ({ type: 'EXPENSE', amount: 5000, memo: null, createdAt: NOW, ...overrides });
  const proposal = (amount, memo) => ({ payload: { amount, memo } });
  const later = new Date(Date.parse(NOW) + 120_000).toISOString();
  assert.ok(findRecentDuplicate(proposal(5000, null), [record()], later));
  assert.equal(findRecentDuplicate(proposal(5000, '커피'), [record()], later), null);
  assert.equal(findRecentDuplicate(proposal(5001, null), [record()], later), null);
  assert.equal(findRecentDuplicate(proposal(5000, null), [record({ type: 'INCOME' })], later), null);
  assert.equal(findRecentDuplicate(proposal(5000, null), [record()], new Date(Date.parse(NOW) + DUPLICATE_WINDOW_MS + 1).toISOString()), null);
});

test('an AI result is shown for confirmation first (no automatic save yet)', async () => {
  const { flow, parse, count } = await setup();
  const routed = parse('점심 7000원');
  const review = await flow.handleParsed(routed.proposal, 'AI');
  assert.equal(review.status, 'REVIEW');
  assert.equal(count(), 0);
  assert.equal((await flow.saveConfirmed(review.proposal)).status, 'SAVED');
  assert.equal(count(), 1);
});

test('blueprint 14.6 "커피 안 샀어 5000원" and the other rejected categories are never saved locally', async () => {
  const { flow, parse, count } = await setup();
  for (const text of ['커피 안 샀어 5000원', '점심 7000원 안 썼어', '예산 7000원', '7000원 쓸 예정이야', '월급 200만원 받았어']) {
    const routed = parse(text);
    assert.notEqual(routed.status, 'PARSED', text);
    assert.notEqual(routed.status, 'AI_REQUIRED', `${text} is refused, not sent to the AI`);
  }
  assert.equal(count(), 0);
  assert.ok(flow);
});

test('bundled expenses (총 · 합쳐서 · 다 해서 · 전부 해서 · 모두) go to the AI, never to the local parser', () => {
  const { parse } = { parse: text => routeCaptureInput(createCaptureParserInput(text, 'a', 'TEXT', NOW)) };
  for (const text of ['아이스크림 생수 밥 다 해서 12000원 썼어', '점심 총 12000원 썼어', '커피랑 빵 합쳐서 9000원', '간식 전부 해서 15000원 썼어', '모두 12000원 썼어']) {
    assert.equal(parse(text).status, 'AI_REQUIRED', text);
  }
  assert.equal(parse('점심 7000원 썼어').status, 'PARSED', 'a single expense stays local');
  assert.ok(TOTAL_WORD_RE.test('다   해서'));
  assert.ok(!TOTAL_WORD_RE.test('커피 4500원'));
});

test('an unreachable AI keeps the sentence: the result is a connection failure, nothing is saved or retried by itself', async () => {
  const { count } = await setup();
  let calls = 0;
  const interpret = createCaptureInterpretationService({ interpret: async () => { calls += 1; return { status: 'FAILED', reason: 'NETWORK_ERROR', message: '인터넷 연결을 확인해 주세요.' }; } });
  const result = await interpret(createCaptureParserInput('아이스크림 생수 밥 다 해서 12000원 썼어', 'a', 'TEXT', NOW));
  assert.deepEqual([result.status, result.reason], ['FAILED', 'NETWORK_ERROR']);
  assert.equal(calls, 1);
  assert.equal(count(), 0);
  const composer = fs.readFileSync(path.join(root, 'src/features/capture/capture-composer.tsx'), 'utf8');
  assert.match(composer, /UNAVAILABLE_REASONS = \['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'\]/);
  assert.match(composer, /직접 \[다시 처리\]를 눌러 주세요\. 자동으로 실행하지 않아요/);
  const focusBlock = composer.slice(composer.indexOf('useFocusEffect'), composer.indexOf('/** Shows what happened'));
  assert.ok(!focusBlock.includes('analyze'), 'no automatic re-run on focus or foreground');
});
