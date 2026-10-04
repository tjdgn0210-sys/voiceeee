import type { SettingsRepository } from '../../domain/settings/settings-repository';
import type { ApplicationDatabase } from '../database';

/** settings(key, value): value is JSON text (migration 003 checks json_valid). */
export function createSqliteSettingsRepository(database: ApplicationDatabase): SettingsRepository {
  return {
    async readAll() {
      const rows = await database.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key ASC');
      const result: Record<string, unknown> = {};
      for (const row of rows) result[row.key] = JSON.parse(row.value);
      return result;
    },
    async writeMany(entries) {
      const keys = Object.keys(entries);
      if (!keys.length) return;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const key of keys) {
          await transaction.runAsync(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            key, JSON.stringify(entries[key]),
          );
        }
      });
    },
    async clear() {
      await database.runAsync('DELETE FROM settings');
    },
  };
}
