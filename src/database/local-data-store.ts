import type { LocalDataStore } from '../application/reset/local-data-reset';
import type { ApplicationDatabase } from './database';

/** Order does not matter for foreign keys today (no table references another), but children come first anyway. */
const PERSONAL_DATA_TABLES = ['reminders', 'events', 'tasks', 'transactions', 'notes', 'capture_drafts', 'action_logs', 'settings'] as const;

export function createSqliteLocalDataStore(database: ApplicationDatabase): LocalDataStore {
  return {
    async deleteAllPersonalData() {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const table of PERSONAL_DATA_TABLES) await transaction.runAsync(`DELETE FROM ${table}`);
      });
    },
  };
}
