import type { SqliteDatabase } from "./sqlite";

type HistoryRow = { id: string; article_id: string; kind: string; status: string; phase: string; model_id: string; payload_json: string; error: string | null; created_at: string; updated_at: string };
type RoundRow = { job_id: string; round_index: number; payload_json: string };
type ArtifactRow = RoundRow & { scene_index: number };
export type StyleLabSnapshot = { jobs: HistoryRow[]; rounds: RoundRow[]; artifacts: ArtifactRow[] };
const jobColumns = ["id", "article_id", "kind", "status", "phase", "model_id", "payload_json", "error", "owner", "lease_until", "created_at", "updated_at"];
const tables = [
  { name: "style_lab_jobs", columns: jobColumns, key: "id", parent: "articles", parentKey: "article_id" },
  { name: "style_lab_rounds", columns: ["job_id", "round_index", "payload_json"], key: "job_id||':'||round_index", parent: "style_lab_jobs", parentKey: "job_id" },
  { name: "style_lab_artifacts", columns: ["job_id", "round_index", "scene_index", "payload_json"], key: "job_id||':'||round_index||':'||scene_index", parent: "style_lab_jobs", parentKey: "job_id" },
];

// Keep every row inside the replacement transaction, including execution leases.
export const preserveStyleLabSql = tables.map(t => `INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) SELECT 'style_backup:${t.name}:'||${t.key},json_object(${t.columns.map(c => `'${c}',${c}`).join(",")}),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM ${t.name}`);
export const restoreStyleLabSql = tables.map(t => `INSERT OR IGNORE INTO ${t.name}(${t.columns.join(",")}) SELECT ${t.columns.map(c => `json_extract(s.value_json,'$.${c}')`).join(",")} FROM app_settings s WHERE s.key LIKE 'style_backup:${t.name}:%' AND EXISTS(SELECT 1 FROM ${t.parent} p WHERE p.id=json_extract(s.value_json,'$.${t.parentKey}'))`);
export const clearStyleLabBackupSql = "DELETE FROM app_settings WHERE key LIKE 'style_backup:%'";

export async function readStyleLabSnapshot(db: SqliteDatabase): Promise<StyleLabSnapshot> {
  const [jobs, rounds, artifacts] = await Promise.all([
    db.prepare("SELECT id,article_id,kind,status,phase,model_id,payload_json,error,created_at,updated_at FROM style_lab_jobs ORDER BY id").all<HistoryRow>(),
    db.prepare("SELECT job_id,round_index,payload_json FROM style_lab_rounds ORDER BY job_id,round_index").all<RoundRow>(),
    db.prepare("SELECT job_id,round_index,scene_index,payload_json FROM style_lab_artifacts ORDER BY job_id,round_index,scene_index").all<ArtifactRow>(),
  ]);
  return { jobs: jobs.results ?? [], rounds: rounds.results ?? [], artifacts: artifacts.results ?? [] };
}

export function validateStyleLabSnapshot(value: unknown, articleIds: Set<string>): asserts value is StyleLabSnapshot {
  const v = value as StyleLabSnapshot;
  if (!v || !Array.isArray(v.jobs) || !Array.isArray(v.rounds) || !Array.isArray(v.artifacts)) throw new Error("学习历史格式无效");
  const ids = new Set<string>();
  function payload(row: { payload_json: string }) {
    if (typeof row.payload_json !== "string" || new TextEncoder().encode(row.payload_json).length > 1_800_000) throw new Error("学习历史内容超过上限");
    const p = JSON.parse(row.payload_json);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("学习历史内容无效");
  }
  for (const row of v.jobs) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) || !articleIds.has(row.article_id) || !["learn", "tune"].includes(row.kind) || !["queued", "running", "paused", "failed", "completed", "cancelled"].includes(row.status) || ![row.phase, row.model_id, row.created_at, row.updated_at].every(s => typeof s === "string") || !(row.error == null || typeof row.error === "string")) throw new Error("学习任务记录无效");
    payload(row); ids.add(row.id);
  }
  for (const rows of [v.rounds, v.artifacts]) {
    const keys = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object") throw new Error("学习轮次记录无效");
      const scene = "scene_index" in row ? row.scene_index : undefined;
      const key = `${row.job_id}:${row.round_index}:${scene ?? ""}`;
      if (!row || !ids.has(row.job_id) || !Number.isInteger(row.round_index) || row.round_index < 0 || row.round_index > 10 || scene !== undefined && (!Number.isInteger(scene) || Number(scene) < 0) || keys.has(key)) throw new Error("学习轮次记录无效");
      payload(row); keys.add(key);
    }
  }
}

export function importStyleLabStatements(db: SqliteDatabase, snapshot: StyleLabSnapshot) {
  return [
    db.prepare("DELETE FROM style_lab_jobs"),
    ...snapshot.jobs.map(row => {
      const p = JSON.parse(row.payload_json);
      const interrupted = ["queued", "running"].includes(row.status);
      if (interrupted) p.notice = "同步导入的未完成任务已暂停；确认执行端与模型后可继续。";
      // A copied result is never automatically applied or executed by its recipient.
      p.autoApplyPending = false;
      return db.prepare("INSERT INTO style_lab_jobs(id,article_id,kind,status,phase,model_id,payload_json,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(row.id, row.article_id, row.kind, interrupted ? "paused" : row.status, row.phase, row.model_id, JSON.stringify(p), row.error, row.created_at, row.updated_at);
    }),
    ...snapshot.rounds.map(row => db.prepare("INSERT INTO style_lab_rounds(job_id,round_index,payload_json) VALUES(?,?,?)").bind(row.job_id, row.round_index, row.payload_json)),
    ...snapshot.artifacts.map(row => db.prepare("INSERT INTO style_lab_artifacts(job_id,round_index,scene_index,payload_json) VALUES(?,?,?,?)").bind(row.job_id, row.round_index, row.scene_index, row.payload_json)),
  ];
}

// A version gap intentionally selects full snapshot sync, which includes history.
// Heartbeats and lease claims do not change durable learning results.
export function styleLabChangedStatement(db: SqliteDatabase) {
  return db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='database_version' AND changes()>0");
}
