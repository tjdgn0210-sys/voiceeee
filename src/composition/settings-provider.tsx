import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState, Button, PixelRatio, Text, View } from 'react-native';
import { createSettingsService, type AppSettings } from '../application/settings/app-settings';
import { getDatabase } from '../database/database';
import { createSqliteSettingsRepository } from '../database/repositories/sqlite-settings-repository';
import { SettingsContext } from '../features/settings/settings-context';
import { createScaler, effectiveFontScale } from '../utils/font-scale';

/** Loads the stored settings before any screen renders, so the first frame already has the right font size. */
export function SettingsProvider({ children }: PropsWithChildren) {
  const [service, setService] = useState<ReturnType<typeof createSettingsService> | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [systemFontScale, setSystemFontScale] = useState(() => PixelRatio.getFontScale());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getDatabase()
      .then(async database => {
        const created = createSettingsService(createSqliteSettingsRepository(database));
        const loaded = await created.load();
        if (active) { setService(created); setSettings(loaded); }
      })
      .catch(() => {
        console.error('Settings could not be loaded.');
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [attempt]);

  // The system font scale can change while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setSystemFontScale(PixelRatio.getFontScale()); });
    return () => subscription.remove();
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    if (!service) throw new Error('Settings are not ready.');
    const next = await service.update(patch);
    setSettings(next);
    return next;
  }, [service]);

  const scale = settings ? effectiveFontScale({ fontScale: settings.fontScale, followSystemFont: settings.followSystemFont, systemScale: systemFontScale }) : 1;
  const value = useMemo(
    () => (settings ? { settings, update, scaler: createScaler(scale), systemFontScale } : null),
    [settings, update, scale, systemFontScale],
  );

  if (value) return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
    <Text accessibilityRole={failed ? 'alert' : 'text'} style={{ color: '#111' }}>{failed ? '설정을 불러오지 못했어요.' : '설정을 불러오는 중이에요…'}</Text>
    {failed && <Button title="다시 시도" onPress={() => { setFailed(false); setAttempt(count => count + 1); }} />}
  </View>;
}
