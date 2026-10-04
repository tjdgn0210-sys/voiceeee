// Development-only: node --test scripts/verify-onboarding.cjs
// M1-10 structure checks: the first-run gate, the explanation before the system prompt, and no login buttons before M2.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('the app opens only /onboarding until it is done, and never again afterwards', () => {
  const stack = read('src/composition/root-stack.tsx');
  assert.match(stack, /<Stack\.Protected guard=\{!settings\.onboardingDone\}>\s*<Stack\.Screen name="onboarding"/);
  assert.match(stack, /<Stack\.Protected guard=\{settings\.onboardingDone\}>[\s\S]*name="\(tabs\)"/);
});

test('the explanation comes before the system prompt; "나중에" moves on without asking the system', () => {
  const screen = read('src/features/onboarding/onboarding-screen.tsx');
  assert.equal(screen.split('requestPermission').length - 1, 1, 'the system prompt is requested in one place only');
  assert.ok(screen.indexOf("step === 'NOTIFICATIONS'") < screen.indexOf('onPress={ask}'), 'only the explanation screen can trigger it');
  assert.ok(screen.indexOf("step === 'WELCOME'") < screen.indexOf("step === 'NOTIFICATIONS'"));
  assert.match(screen, /일정 시간과 친구가 보낸 일정을 알려 드리려면 알림이 필요해요\./);
  assert.match(screen, /onPress=\{ask\}/);
  assert.match(screen, /onPress=\{\(\) => setStep\('START'\)\}[^>]*>\s*<Text style=\{styles\.secondaryText\}>나중에/);
  const ask = screen.slice(screen.indexOf('const ask'), screen.indexOf('const finish'));
  assert.match(ask, /catch\(\(\) => 'UNDETERMINED'\)/, 'a failed or refused prompt does not block the app');
});

test('before login exists only "로그인 없이 시작" is offered: no provider buttons, no "준비 중"', () => {
  const screen = read('src/features/onboarding/onboarding-screen.tsx');
  assert.match(screen, /로그인 없이 시작/);
  for (const word of ['Apple', '애플', '구글', 'Google', '카카오', 'Kakao', '준비 중']) assert.ok(!screen.includes(word), word);
});

test('the settings screen shows the blocked-notification notice with a way to the system settings', () => {
  const notice = read('src/features/settings/notification-permission-notice.tsx');
  assert.match(notice, /permission === 'BLOCKED'/);
  assert.match(notice, /openSystemSettings/);
  assert.match(read('src/features/settings/notification-settings.tsx'), /<NotificationPermissionNotice \/>/);
  assert.match(read('src/features/settings/settings-screen.tsx'), /<NotificationSettings \/>/);
});
