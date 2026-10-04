import { createContext, useContext } from 'react';
import type { AppSettings } from '../../application/settings/app-settings';
import type { Scaler } from '../../utils/font-scale';

export interface SettingsContextValue {
  settings: AppSettings;
  /** Saves a patch and returns the settings as stored; rejects when the write failed (nothing changes on screen then). */
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Font and spacing helpers for the scale in effect (own setting or the system's). */
  scaler: Scaler;
  /** The scale the system reports (1 on web). */
  systemFontScale: number;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('SettingsProvider is required');
  return value;
}

export function useScaler(): Scaler {
  return useSettings().scaler;
}
