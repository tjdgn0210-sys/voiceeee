// Development-only: node --test scripts/verify-accessibility.cjs
// M1-16 static audit of the screens: every pressable has a role and a readable name, inputs have labels,
// states are exposed through accessibilityState (never colour alone), and nothing relies on a fixed text height.
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const files = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx$/.test(entry.name)) files.push(full);
  }
};
walk(path.join(root, 'src/features'));
files.push(path.join(root, 'src/components/app-tab-bar.tsx'), path.join(root, 'src/components/undo-bar.tsx'));

/** The opening tags `<Name ... >` of one JSX element name, with their attribute text and the text that follows until the next tag. */
function openingTags(source, name) {
  const result = [];
  const marker = `<${name}`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start < 0) break;
    from = start + marker.length;
    if (!/[\s>/]/.test(source[from] ?? '')) continue; // <PressableX
    // Walk to the end of the tag, skipping braces (attribute expressions may contain '>').
    let depth = 0;
    let index = from;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0 && source[index - 1] !== '=') break;
    }
    const attributes = source.slice(from, index);
    const after = source.slice(index + 1, index + 400);
    result.push({ attributes, after, line: source.slice(0, start).split('\n').length });
  }
  return result;
}

test('every Pressable has a role, and a name: its own label or visible text inside', () => {
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const tag of openingTags(source, 'Pressable')) {
      const where = `${path.relative(root, file)}:${tag.line}`;
      if (!/accessibilityRole=/.test(tag.attributes)) problems.push(`${where} has no accessibilityRole`);
      const hasLabel = /accessibilityLabel=/.test(tag.attributes);
      const hasText = /^\s*(<Text|\{)/.test(tag.after) || /<Text/.test(tag.after.slice(0, 200));
      if (!hasLabel && !hasText) problems.push(`${where} has no accessible name`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every TextInput (and FieldInput) is labelled', () => {
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const tag of openingTags(source, 'TextInput')) {
      if (!/accessibilityLabel=/.test(tag.attributes)) problems.push(`${path.relative(root, file)}:${tag.line} TextInput without accessibilityLabel`);
    }
  }
  assert.deepEqual(problems, []);
});

test('selectable and switchable controls expose their state', () => {
  const source = name => fs.readFileSync(path.join(root, name), 'utf8');
  const controls = source('src/features/calendar/form-controls.tsx');
  assert.match(controls, /accessibilityRole="radiogroup"/);
  assert.match(controls, /accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ selected/);
  assert.match(controls, /accessibilityRole="checkbox"[\s\S]*?accessibilityState=\{\{ checked: isSelected/);
  assert.match(controls, /accessibilityRole="switch"[\s\S]*?accessibilityState=\{\{ checked: value/);
  assert.match(controls, /styles\.toggle, value && styles\.toggleOn/, 'the switch knob moves to the other side when on');
  assert.match(controls, /aria-checked=\{value\}/);
  assert.match(controls, /\{isSelected \? '✓ ' : ''\}/, 'a selected chip has a mark, not only a colour');
  const calendar = source('src/features/calendar/calendar-screen.tsx');
  assert.match(calendar, /accessibilityState=\{\{ selected: isSelected \}\}/);
  assert.match(calendar, /borderColor: isSelected \? palette\.ink/, 'the selected day also has a border');
  assert.match(calendar, /textDecorationLine: isToday \? 'underline'/, 'today is underlined, not only coloured');
  const tab = source('src/components/app-tab-bar.tsx');
  assert.match(tab, /accessibilityState=\{\{ selected: focused \}\}/);
});

test('failures and warnings are written out and announced', () => {
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const tag of openingTags(source, 'Text')) {
      if (/style=\{styles\.(error|fieldError)\}/.test(tag.attributes) && !/accessibilityRole="alert"/.test(tag.attributes)) {
        problems.push(`${path.relative(root, file)}:${tag.line} error text is not an alert`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('lists with several parts read as one item with a full sentence', () => {
  const rows = ['src/features/calendar/event-row.tsx', 'src/features/calendar/task-row.tsx', 'src/features/money/expenses-screen.tsx', 'src/features/settings/licenses-screen.tsx'];
  for (const name of rows) assert.match(fs.readFileSync(path.join(root, name), 'utf8'), /accessibilityLabel=\{`/, name);
});

test('headings are marked so a screen reader can jump between sections', () => {
  const screens = ['src/features/settings/settings-screen.tsx', 'src/features/calendar/event-detail-screen.tsx', 'src/features/money/expenses-screen.tsx', 'src/features/settings/export-screen.tsx', 'src/features/onboarding/onboarding-screen.tsx'];
  for (const name of screens) assert.match(fs.readFileSync(path.join(root, name), 'utf8'), /accessibilityRole="header"|<ScreenIntro/, name);
});

test('no fixed text height or width that would clip large text', () => {
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/numberOfLines=\{1\}/.test(line)) problems.push(`${path.relative(root, file)}:${index + 1} cuts text to one line`);
      if (/\b(height|lineHeight):\s*\d/.test(line) && !/s\.(space|icon|font|line)/.test(line)) problems.push(`${path.relative(root, file)}:${index + 1} fixed height`);
    });
  }
  assert.deepEqual(problems, []);
});
