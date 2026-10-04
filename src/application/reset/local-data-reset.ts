import { DEFAULT_SETTINGS, type AppSettings } from '../settings/app-settings';

/** The word the user types to confirm the reset (blueprint 3.7, 11.3: dangerous actions need two steps). */
export const RESET_CONFIRM_WORD = '삭제';

export const isResetConfirmed = (input: string): boolean => input.trim() === RESET_CONFIRM_WORD;

/** Deletes every personal record on this phone in one atomic step (events, tasks, expenses, reminders, notes, drafts, history, settings). */
export interface LocalDataStore {
  deleteAllPersonalData(): Promise<void>;
}

/** Settings after a reset: defaults, except that the first-run screens are not shown again. */
export const SETTINGS_AFTER_RESET: AppSettings = { ...DEFAULT_SETTINGS, onboardingDone: true };

/**
 * Reset "(c)" for a guest: the phone's records only; there is no server backup to delete (blueprint 3.7).
 * The caller confirms first and then reconciles notifications, because the reminders are gone.
 */
export function createLocalDataReset(dependencies: { store: LocalDataStore; afterReset(): Promise<void> }) {
  return {
    async reset(confirmation: string): Promise<{ status: 'DONE' } | { status: 'NOT_CONFIRMED' } | { status: 'FAILED'; message: string }> {
      if (!isResetConfirmed(confirmation)) return { status: 'NOT_CONFIRMED' };
      try {
        await dependencies.store.deleteAllPersonalData();
      } catch {
        // Nothing was deleted: the transaction rolled back.
        return { status: 'FAILED', message: '지우지 못했어요. 기록은 그대로 있어요. 다시 시도해 주세요' };
      }
      try {
        await dependencies.afterReset();
      } catch {
        return { status: 'FAILED', message: '기록은 지웠지만 예약된 알림을 정리하지 못했어요. 앱을 다시 열면 정리돼요' };
      }
      return { status: 'DONE' };
    },
  };
}

export type LocalDataReset = ReturnType<typeof createLocalDataReset>;
