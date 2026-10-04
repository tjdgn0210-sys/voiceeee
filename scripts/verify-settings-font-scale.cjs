// Development-only: node --test scripts/verify-settings-font-scale.cjs
// M1-12 helpers (blueprint 10.2, README 6.4) and the local settings store (migration 003 settings table).
const { test } = require('node:test');
const { assert, createLoader, openMigratedDatabase } = require('./test-support.cjs');

const { load } = createLoader();
const scale = load('src/utils/font-scale.ts');
const { parseSettings, createSettingsService, DEFAULT_SETTINGS } = load('src/application/settings/app-settings.ts');
const { createSqliteSettingsRepository } = load('src/database/repositories/sqlite-settings-repository.ts');

test('scaleFont rounds px x scale: 70% shrinks, 200% doubles', () => {
  assert.equal(scale.scaleFont(16, 0.7), 11);
  assert.equal(scale.scaleFont(16, 1), 16);
  assert.equal(scale.scaleFont(16, 1.3), 21);
  assert.equal(scale.scaleFont(16, 2), 32);
  assert.equal(scale.scaleLineHeight(16, 2), 48);
});

test('spacing and icons move by half of the scale: 200% gives x1.5, 70% gives x0.85', () => {
  assert.equal(scale.scaleSpace(16, 2), 24);
  assert.equal(scale.scaleSpace(40, 2), 60);
  assert.equal(scale.scaleSpace(100, 0.7), 85);
  assert.equal(scale.scaleIcon(24, 2), 36);
  assert.equal(scale.scaleSpace(16, 1), 16);
});

test('touch targets never fall below 44 and grow with the space scale', () => {
  assert.equal(scale.touchTarget(0.7), 44);
  assert.equal(scale.touchTarget(1), 44);
  assert.equal(scale.touchTarget(1.3), 51);
  assert.equal(scale.touchTarget(2), 66);
  for (const step of scale.fontScaleSteps()) assert.ok(scale.touchTarget(step) >= 44);
});

test('there are 14 steps from 70% to 200%, and any value snaps to the grid inside the range', () => {
  const steps = scale.fontScaleSteps();
  assert.equal(steps.length, 14);
  assert.deepEqual([steps[0], steps[3], steps[13]], [0.7, 1.0, 2.0]);
  assert.equal(scale.clampFontScale(0.3), 0.7);
  assert.equal(scale.clampFontScale(5), 2);
  assert.equal(scale.clampFontScale(1.34), 1.3);
  assert.equal(scale.clampFontScale(Number.NaN), 1);
});

test('follow-system uses the system scale alone (never multiplied with the app setting)', () => {
  assert.equal(scale.effectiveFontScale({ fontScale: 1.5, followSystemFont: true, systemScale: 1.2 }), 1.2);
  assert.equal(scale.effectiveFontScale({ fontScale: 1.5, followSystemFont: false, systemScale: 1.2 }), 1.5);
  assert.equal(scale.effectiveFontScale({ fontScale: 1, followSystemFont: true, systemScale: 3 }), 2);
  const scaler = scale.createScaler(2);
  assert.deepEqual([scaler.font(10), scaler.space(10), scaler.touch], [20, 15, 66]);
});

test('settings: defaults, malformed values fall back, the default reminder is limited to the five choices', () => {
  assert.deepEqual(parseSettings({}), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.ownDefault, 0, 'default reminder is "정시"');
  assert.equal(DEFAULT_SETTINGS.lockscreenShowTitle, true);
  const odd = parseSettings({ fontScale: 'big', allOn: 'yes', ownDefault: -45, lockscreenShowTitle: 1, followSystemFont: null });
  assert.deepEqual(odd, DEFAULT_SETTINGS);
  assert.equal(parseSettings({ ownDefault: null }).ownDefault, null);
  assert.equal(parseSettings({ ownDefault: -60 }).ownDefault, -60);
  assert.equal(parseSettings({ fontScale: 1.34 }).fontScale, 1.3);
});

test('settings are stored as JSON, merged on update, and cleared by reset', async () => {
  const db = await openMigratedDatabase(load);
  const service = createSettingsService(createSqliteSettingsRepository(db));
  assert.deepEqual(await service.load(), DEFAULT_SETTINGS);
  const saved = await service.update({ fontScale: 1.5, ownDefault: null, allOn: false });
  assert.deepEqual([saved.fontScale, saved.ownDefault, saved.allOn, saved.ownOn], [1.5, null, false, true]);
  assert.equal(db.raw.prepare("SELECT value FROM settings WHERE key = 'fontScale'").get().value, '1.5');
  assert.equal(db.raw.prepare("SELECT value FROM settings WHERE key = 'ownDefault'").get().value, 'null');
  const reloaded = await createSettingsService(createSqliteSettingsRepository(db)).load();
  assert.deepEqual(reloaded, saved);
  await service.update({ followSystemFont: true });
  assert.equal((await service.load()).fontScale, 1.5, 'an earlier value survives a later patch');
  assert.equal((await service.update({ fontScale: 9 })).fontScale, 2, 'out-of-range values are clamped on save');
  await service.reset();
  assert.deepEqual(await service.load(), DEFAULT_SETTINGS);
  assert.throws(() => db.raw.prepare("INSERT INTO settings (key, value) VALUES ('bad', 'not json')").run(), /constraint/i);
});
