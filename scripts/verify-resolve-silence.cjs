// Development-only: node scripts/verify-resolve-silence.cjs (Node 22.13+).
// Notification priority (blueprint 8.2): global off > permission > own setting > per-friend setting.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/application/notifications/resolve-silence.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
}).outputText;
const mod = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(() => assert.fail('Pure module: no imports'), mod, mod.exports);
const { resolveSilence, describeSilence } = mod.exports;

// Everything on, own event: rings.
const ringing = { allOn: true, ownOn: true, permission: 'GRANTED', friendNotifyEventTime: null, isReceived: false };
const silent = reason => ({ silent: true, reason });

test('everything on rings, for own and received events', () => {
  assert.deepEqual(resolveSilence(ringing), { silent: false });
  assert.deepEqual(resolveSilence({ ...ringing, isReceived: true, friendNotifyEventTime: true }), { silent: false });
});

test('1. global off', () => {
  assert.deepEqual(resolveSilence({ ...ringing, allOn: false }), silent('ALL_OFF'));
  assert.equal(describeSilence('ALL_OFF', ''), '모든 알림이 꺼져 있어요');
});

test('2. permission blocked', () => {
  assert.deepEqual(resolveSilence({ ...ringing, permission: 'BLOCKED' }), silent('PERMISSION_BLOCKED'));
  assert.equal(describeSilence('PERMISSION_BLOCKED', ''), '기기의 알림 권한이 꺼져 있어요');
});

test('permission not asked yet does not silence', () => {
  assert.deepEqual(resolveSilence({ ...ringing, permission: 'UNDETERMINED' }), { silent: false });
});

test('3. own reminders off silences my own events', () => {
  assert.deepEqual(resolveSilence({ ...ringing, ownOn: false }), silent('OWN_OFF'));
  assert.equal(describeSilence('OWN_OFF', ''), '내 일정 알림이 꺼져 있어요');
});

test('4. friend event-time reminders off silences a received event; alias name is used', () => {
  const received = { ...ringing, isReceived: true, friendNotifyEventTime: false };
  assert.deepEqual(resolveSilence(received), silent('FRIEND_OFF'));
  assert.equal(describeSilence('FRIEND_OFF', '민수형'), '민수형님 일정의 시각 알림을 꺼 두었어요');
});

test('5. the friend switch does not affect my own events', () => {
  assert.deepEqual(resolveSilence({ ...ringing, isReceived: false, friendNotifyEventTime: false }), { silent: false });
});

test('an unknown friend setting (null) does not silence a received event', () => {
  assert.deepEqual(resolveSilence({ ...ringing, isReceived: true, friendNotifyEventTime: null }), { silent: false });
});

test('combination: global off wins over every other setting', () => {
  const everythingOff = { allOn: false, ownOn: false, permission: 'BLOCKED', friendNotifyEventTime: false, isReceived: true };
  assert.deepEqual(resolveSilence(everythingOff), silent('ALL_OFF'));
  assert.deepEqual(resolveSilence({ ...everythingOff, isReceived: false }), silent('ALL_OFF'));
  // Global off with the individual switches on still shows the global reason.
  assert.deepEqual(resolveSilence({ ...ringing, allOn: false, ownOn: true }), silent('ALL_OFF'));
  assert.deepEqual(resolveSilence({ ...ringing, allOn: false, isReceived: true, friendNotifyEventTime: true }), silent('ALL_OFF'));
});

test('combination: permission wins over own and friend settings', () => {
  assert.deepEqual(resolveSilence({ ...ringing, permission: 'BLOCKED', ownOn: false }), silent('PERMISSION_BLOCKED'));
  assert.deepEqual(resolveSilence({ ...ringing, permission: 'BLOCKED', isReceived: true, friendNotifyEventTime: false }), silent('PERMISSION_BLOCKED'));
});

test('combination: a received event is not silenced by the own-event switch', () => {
  assert.deepEqual(resolveSilence({ ...ringing, ownOn: false, isReceived: true, friendNotifyEventTime: true }), { silent: false });
  assert.deepEqual(resolveSilence({ ...ringing, ownOn: false, isReceived: true, friendNotifyEventTime: false }), silent('FRIEND_OFF'));
});

test('every input combination returns exactly one outcome and follows the priority order', () => {
  const bools = [true, false];
  for (const allOn of bools) for (const ownOn of bools) for (const isReceived of bools)
    for (const permission of ['GRANTED', 'BLOCKED', 'UNDETERMINED']) for (const friendNotifyEventTime of [true, false, null]) {
      const result = resolveSilence({ allOn, ownOn, permission, friendNotifyEventTime, isReceived });
      let expected = { silent: false };
      if (!allOn) expected = silent('ALL_OFF');
      else if (permission === 'BLOCKED') expected = silent('PERMISSION_BLOCKED');
      else if (!isReceived && !ownOn) expected = silent('OWN_OFF');
      else if (isReceived && friendNotifyEventTime === false) expected = silent('FRIEND_OFF');
      assert.deepEqual(result, expected, JSON.stringify({ allOn, ownOn, isReceived, permission, friendNotifyEventTime }));
    }
});
