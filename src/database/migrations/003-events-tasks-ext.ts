/** Immutable migration SQL. Never interpolate user input or edit an applied migration.
 * events is rebuilt because SQLite cannot ALTER the 001 time_kind CHECK to allow ALL_DAY.
 * Existing rows keep their values; FUZZY rows get date NULL (no guessing).
 * `date(x) IS x` rejects malformed and impossible dates (e.g. 2026-02-30).
 */
export const eventsTasksExtensionSql = `
CREATE TABLE events_v3 (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  time_kind TEXT NOT NULL CHECK (time_kind IN ('EXACT', 'FUZZY', 'ALL_DAY')),
  start_at TEXT,
  fuzzy_time TEXT,
  date TEXT CHECK (date IS NULL OR date(date) IS date),
  end_at TEXT,
  timezone TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL CHECK (status IN ('UPCOMING', 'PAST', 'COMPLETED', 'CANCELLED')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  source_action_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (time_kind = 'EXACT' AND start_at IS NOT NULL AND fuzzy_time IS NULL AND date IS NULL)
    OR (time_kind = 'FUZZY' AND start_at IS NULL AND fuzzy_time IS NOT NULL AND length(trim(fuzzy_time)) > 0)
    OR (time_kind = 'ALL_DAY' AND start_at IS NULL AND fuzzy_time IS NULL AND date IS NOT NULL AND end_at IS NULL)
  )
);

INSERT INTO events_v3 (id, title, time_kind, start_at, fuzzy_time, date, end_at, timezone, location, status, visibility, source_action_id, created_at, updated_at, deleted_at)
SELECT id, title, time_kind, start_at, fuzzy_time, NULL, end_at, timezone, location, status, 'PRIVATE', source_action_id, created_at, updated_at, deleted_at
FROM events;

DROP TABLE events;
ALTER TABLE events_v3 RENAME TO events;

-- Same definition as 001; dropped together with the old table.
CREATE INDEX events_status_start_at_idx ON events (status, start_at) WHERE deleted_at IS NULL;

ALTER TABLE tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PUBLIC', 'PRIVATE'));

ALTER TABLE transactions ADD COLUMN include_in_total INTEGER NOT NULL DEFAULT 1 CHECK (include_in_total IN (0, 1));
ALTER TABLE transactions ADD COLUMN bundle_items TEXT
  CHECK (bundle_items IS NULL OR (json_valid(bundle_items) AND json_type(bundle_items) = 'array'));

ALTER TABLE reminders ADD COLUMN last_error TEXT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value))
);
`;
