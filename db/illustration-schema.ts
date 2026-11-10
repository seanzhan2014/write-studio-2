// Drizzle migrations and idempotent runtime bootstrap share this schema on both
// hosted D1 and self-hosted SQLite, including recovery of a missing table.
export const illustrationSchema = [
  `CREATE TABLE IF NOT EXISTS illustration_history (
    id TEXT PRIMARY KEY NOT NULL,
    outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '', model_name TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0, input_json TEXT NOT NULL DEFAULT '{}',
    asset_key TEXT, mime_type TEXT, revised_prompt TEXT, error_message TEXT,
    runner_id TEXT, lease_until TEXT, created_at TEXT NOT NULL, completed_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS illustration_history_outline_created_idx ON illustration_history(outline_id,created_at)",
  "CREATE INDEX IF NOT EXISTS illustration_history_status_idx ON illustration_history(status)",
];

const historyColumns = ["id", "outline_id", "kind", "status", "prompt", "excerpt", "style", "model_id", "model_name", "archived", "input_json", "asset_key", "mime_type", "revised_prompt", "error_message", "runner_id", "lease_until", "created_at", "completed_at"];
// Full studio replacements temporarily delete/reinsert the same outlines. Keep
// their library records inside that transaction so FK cascades cannot erase
// completed results or race a running task. Each backup row stays bounded.
export const preserveIllustrationHistorySql = `INSERT OR REPLACE INTO app_settings(key,value_json,updated_at)
  SELECT 'illustration_state_backup:'||id,json_object(${historyColumns.map(column => `'${column}',${column}`).join(",")}),created_at FROM illustration_history`;
export const restoreIllustrationHistorySql = `INSERT OR IGNORE INTO illustration_history(${historyColumns.join(",")})
  SELECT ${historyColumns.map(column => `json_extract(s.value_json,'$.${column}')`).join(",")} FROM app_settings s
  WHERE s.key LIKE 'illustration_state_backup:%' AND EXISTS(SELECT 1 FROM outlines o WHERE o.id=json_extract(s.value_json,'$.outline_id'))`;
export const clearIllustrationHistoryBackupSql = "DELETE FROM app_settings WHERE key LIKE 'illustration_state_backup:%'";
