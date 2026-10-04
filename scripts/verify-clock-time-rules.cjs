// Development-only: node scripts/verify-clock-time-rules.cjs (Node 22.13+).
// Runs docs/impl/time-vectors.json (blueprint 4.3 / 4.4 / 14.6 sentences) through the pure clock-time rules.
// The same JSON file is what the M3 server tests must use, so both implementations agree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
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
    assert(name.startsWith('.'), `Time rules must stay dependency-free: ${name}`);
    return load(path.resolve(path.dirname(file), name) + '.ts');
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}

const { resolveClockTime } = load('src/application/proposals/clock-time-rules.ts');
const document = JSON.parse(fs.readFileSync(path.join(root, 'docs/impl/time-vectors.json'), 'utf8'));
const { vectors } = document;

// Strips the display-only fields so the module only sees what the gateway would pass.
const inputOf = vector => {
  const { nowLocal, ...input } = vector.input;
  return input;
};
const expectedOf = vector => {
  const { atLocal, ...expected } = vector.expect;
  return expected;
};

test('vector file is well formed and its local labels match the UTC values', () => {
  assert.equal(document.version, 1);
  const ids = vectors.map(vector => vector.id);
  assert.equal(new Set(ids).size, ids.length, 'vector ids are unique');
  for (const vector of vectors) {
    assert.equal(Date.parse(vector.input.nowLocal), Date.parse(vector.input.now), `${vector.id} now/nowLocal`);
    if (vector.expect.status === 'OK') assert.equal(Date.parse(vector.expect.atLocal), Date.parse(vector.expect.at), `${vector.id} at/atLocal`);
  }
  for (const group of ['blueprint', 'midnight', 'boundary', 'timezone']) {
    assert(vectors.some(vector => vector.group === group), `group ${group} is present`);
  }
});

for (const vector of vectors) {
  test(`${vector.id} [${vector.group}] ${vector.sentence} (${vector.input.nowLocal})`, () => {
    assert.deepEqual(resolveClockTime(inputOf(vector)), expectedOf(vector));
  });
}

test('result does not depend on the host timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const hostZone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = hostZone;
      for (const vector of vectors) assert.deepEqual(resolveClockTime(inputOf(vector)), expectedOf(vector), `${vector.id} under host TZ ${hostZone}`);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('missing meridiem and confirmedNextDay fields behave like null and false', () => {
  const vector = vectors.find(item => item.id === 'bp-02');
  const { meridiem, confirmedNextDay, ...bare } = inputOf(vector);
  assert.deepEqual(resolveClockTime(bare), expectedOf(vector));
});

test('a cue or a 24-hour number is never overridden by the AM/PM rules', () => {
  const base = { now: '2026-10-03T11:00:00.000Z', timeZone: 'Asia/Seoul', dayOffset: 0, minute: 0, kind: 'EVENT' };
  // 20:00 KST: 7시 without a cue would ask for tomorrow, but "저녁 7시" is already past and is still returned as spoken.
  assert.deepEqual(resolveClockTime({ ...base, hour: 7, meridiem: 'PM' }), { status: 'OK', at: '2026-10-03T10:00:00.000Z', autoMeridiem: false });
  assert.deepEqual(resolveClockTime({ ...base, hour: 7, meridiem: 'AM' }), { status: 'OK', at: '2026-10-02T22:00:00.000Z', autoMeridiem: false });
  assert.deepEqual(resolveClockTime({ ...base, hour: 13, meridiem: 'AM' }), { status: 'OK', at: '2026-10-03T04:00:00.000Z', autoMeridiem: false });
});

test('minutes are kept: 7시 반 and 7시 5분', () => {
  const base = { now: '2026-10-02T21:30:00.000Z', timeZone: 'Asia/Seoul', dayOffset: 0, hour: 7, kind: 'EVENT' };
  assert.deepEqual(resolveClockTime({ ...base, minute: 30 }), { status: 'OK', at: '2026-10-02T22:30:00.000Z', autoMeridiem: true });
  // 06:35 KST: 7:05 AM is still ahead, 7:30 AM too.
  assert.deepEqual(resolveClockTime({ ...base, now: '2026-10-02T21:35:00.000Z', minute: 5 }), { status: 'OK', at: '2026-10-02T22:05:00.000Z', autoMeridiem: true });
  // 07:10 KST: 7:05 AM has passed, so 7:05 PM.
  assert.deepEqual(resolveClockTime({ ...base, now: '2026-10-02T22:10:00.000Z', minute: 5 }), { status: 'OK', at: '2026-10-03T10:05:00.000Z', autoMeridiem: true });
});

test('malformed input throws RangeError instead of guessing', () => {
  const good = { now: '2026-10-03T01:00:00.000Z', timeZone: 'Asia/Seoul', dayOffset: 0, hour: 7, minute: 0, kind: 'EVENT' };
  for (const bad of [{ hour: 24 }, { hour: -1 }, { hour: 7.5 }, { minute: 60 }, { minute: -1 }, { dayOffset: 0.5 }, { now: 'not a date' }, { confirmedNextDay: true, kind: 'EXPENSE' }]) {
    assert.throws(() => resolveClockTime({ ...good, ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => resolveClockTime({ ...good, timeZone: 'Not/AZone' }), RangeError);
});
