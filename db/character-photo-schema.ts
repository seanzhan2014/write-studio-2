// Jobs belong to a person rather than an outline. No FK: a full-state restore
// temporarily rebuilds characters; active jobs must survive that transaction.
export const characterPhotoSchema = [
  `CREATE TABLE IF NOT EXISTS character_photo_jobs (
    id TEXT PRIMARY KEY, character_id TEXT NOT NULL, state TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, credential_hash TEXT NOT NULL,
    request_json TEXT, remote_task_id TEXT, output_index INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', photo_id TEXT,
    runner_id TEXT, lease_until TEXT, next_poll_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS character_photo_jobs_state_idx ON character_photo_jobs(state,next_poll_at,created_at)",
  "CREATE INDEX IF NOT EXISTS character_photo_jobs_person_idx ON character_photo_jobs(character_id,created_at)",
];
