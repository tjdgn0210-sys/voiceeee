import { clampFontScale, FONT_SCALE_DEFAULT } from '../../utils/font-scale';
import type { SettingsRepository } from '../../domain/settings/settings-repository';

/** Default reminder for a new event: null = none, 0 = at the time, negative = minutes before (D-15). */
export type DefaultReminder = null | 0 | -10 | -30 | -60;
export const DEFAULT_REMINDER_CHOICES: readonly DefaultReminder[] = [null, 0, -10, -30, -60];

/** Local settings (blueprint 10.1). Defined once here; the repository only stores key/value pairs. */
export interface AppSettings {
  fontScale: number;
  followSystemFont: boolean;
  /** Settings > notifications: all notifications. */
  allOn: boolean;
  /** Reminders of my own events. */
  ownOn: boolean;
  ownDefault: DefaultReminder;
  lockscreenShowTitle: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontScale: FONT_SCALE_DEFAULT,
  followSystemFont: false,
  allOn: true,
  ownOn: true,
  ownDefault: 0,
  lockscreenShowTitle: true,
  onboardingDone: false,
};

const isDefaultReminder = (value: unknown): value is DefaultReminder => DEFAULT_REMINDER_CHOICES.some(choice => choice === value);

/** Reads stored values defensively: a missing or malformed entry falls back to its default. */
export function parseSettings(raw: Record<string, unknown>): AppSettings {
  const flag = (key: 'followSystemFont' | 'allOn' | 'ownOn' | 'lockscreenShowTitle' | 'onboardingDone') =>
    typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_SETTINGS[key];
  return {
    fontScale: typeof raw.fontScale === 'number' ? clampFontScale(raw.fontScale) : DEFAULT_SETTINGS.fontScale,
    followSystemFont: flag('followSystemFont'),
    allOn: flag('allOn'),
    ownOn: flag('ownOn'),
    ownDefault: isDefaultReminder(raw.ownDefault) ? raw.ownDefault : DEFAULT_SETTINGS.ownDefault,
    lockscreenShowTitle: flag('lockscreenShowTitle'),
    onboardingDone: flag('onboardingDone'),
  };
}

export function createSettingsService(repository: SettingsRepository) {
  return {
    async load(): Promise<AppSettings> {
      return parseSettings(await repository.readAll());
    },
    /** Merges the patch into the stored values and returns the settings as saved. */
    async update(patch: Partial<AppSettings>): Promise<AppSettings> {
      const next = parseSettings({ ...(await repository.readAll()), ...patch });
      const entries: Record<string, unknown> = {};
      for (const key of Object.keys(patch) as (keyof AppSettings)[]) entries[key] = next[key];
      await repository.writeMany(entries);
      return next;
    },
    reset(): Promise<void> {
      return repository.clear();
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
