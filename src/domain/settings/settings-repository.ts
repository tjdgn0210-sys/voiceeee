/** Key-value preferences kept on the phone. Values are JSON; unknown keys are preserved untouched.
 * Not a product mutation: preferences have no ActionLog or Undo.
 */
export interface SettingsRepository {
  /** Every stored key with its parsed JSON value. */
  readAll(): Promise<Record<string, unknown>>;
  /** Writes all entries in one atomic step. */
  writeMany(entries: Record<string, unknown>): Promise<void>;
  /** Removes every setting (used by the local data reset). */
  clear(): Promise<void>;
}
