// Development-only: node --test scripts/verify-navigation.cjs
// M1-07 structure check: four tabs in the blueprint's order, first tab screens have no back button, a settings button, 44px tab targets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('the four tab routes exist and the layout lists them in order: 홈, 캘린더, 지출, 사람', () => {
  for (const name of ['index', 'calendar', 'expenses', 'people']) {
    assert.ok(fs.existsSync(path.join(root, 'src/app/(tabs)', `${name}.tsx`)), `${name}.tsx`);
  }
  const layout = read('src/app/(tabs)/_layout.tsx');
  const titles = [...layout.matchAll(/<Tabs\.Screen name="(\w+)" options=\{\{ title: '([^']+)' \}\}/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(titles, [['index', '홈'], ['calendar', '캘린더'], ['expenses', '지출'], ['people', '사람']]);
  assert.match(layout, /headerRight/, 'settings button at the top right');
  assert.match(layout, /\/settings/);
});

test('tabs do not add a back button: the tab layout is the stack screen without its own header', () => {
  const root_ = read('src/composition/root-stack.tsx');
  assert.match(root_, /name="\(tabs\)" options=\{\{ headerShown: false \}\}/);
  assert.doesNotMatch(root_, /name="index"/);
});

test('the tab bar marks the selected tab with a role, a state and a bar, and keeps a 44px touch target', () => {
  const bar = read('src/components/app-tab-bar.tsx');
  assert.match(bar, /accessibilityRole="tab"/);
  assert.match(bar, /accessibilityState=\{\{ selected: focused \}\}/);
  assert.match(bar, /borderTopWidth: 3/);
  assert.match(bar, /minHeight: s\.touch/);
});

test('the starter tab components are gone', () => {
  assert.ok(!fs.existsSync(path.join(root, 'src/components/app-tabs.tsx')));
  assert.ok(!fs.existsSync(path.join(root, 'src/components/app-tabs.web.tsx')));
});
