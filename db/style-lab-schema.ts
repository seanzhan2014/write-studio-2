export const styleLabSchema = [
  `CREATE TABLE IF NOT EXISTS style_lab_jobs (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
    model_id TEXT NOT NULL, payload_json TEXT NOT NULL, error TEXT,
    owner TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS style_lab_jobs_article_idx ON style_lab_jobs(article_id,created_at DESC)",
  `CREATE TABLE IF NOT EXISTS style_lab_rounds (
    job_id TEXT NOT NULL REFERENCES style_lab_jobs(id) ON DELETE CASCADE,
    round_index INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY(job_id,round_index)
  )`,
  `CREATE TABLE IF NOT EXISTS style_lab_artifacts (
    job_id TEXT NOT NULL REFERENCES style_lab_jobs(id) ON DELETE CASCADE,
    round_index INTEGER NOT NULL, scene_index INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY(job_id,round_index,scene_index)
  )`,
];
