import { captureDraftsSql } from './002-capture-drafts';
import { initialSchemaSql } from './001-initial-schema';
import { eventsTasksExtensionSql } from './003-events-tasks-ext';

export interface Migration {
  readonly version: number;
  readonly sql: string;
}

/** Append new versions here; keep versions contiguous and old SQL immutable. */
export const migrations: readonly Migration[] = [
  { version: 1, sql: initialSchemaSql },
  { version: 2, sql: captureDraftsSql },
  { version: 3, sql: eventsTasksExtensionSql },
];
