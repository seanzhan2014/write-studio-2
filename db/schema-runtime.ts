import { AI_GENERATE_SETTINGS_COLUMNS, ensureTableColumns } from "@/db/schema-columns";
import { databaseSchemaMatches, missingDatabaseColumns, verifyDatabaseSchema } from "@/db/schema-match";

import { styleLabSchema } from "@/db/style-lab-schema";

import { characterPhotoSchema } from "@/db/character-photo-schema";
import { normalizeReviewRuleItems, createReviewRuleSnapshot } from "@/lib/review-rules.mjs";

import { taskHistoryTriggers } from "@/db/task-history-schema";
import { illustrationSchema } from "@/db/illustration-schema";

import { normalizeReviewRules } from "@/lib/generate-review.mjs";

import { decryptAiSecret } from "@/lib/ai-secret";

import { getDatabase, type SqliteDatabase } from "@/db/sqlite";

import { rows, safeJson } from "@/db/sql-helpers";

export const schemaStatements = [
  ...characterPhotoSchema,
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    article_type TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', story_settings_json TEXT NOT NULL DEFAULT '{}', review_rules TEXT NOT NULL DEFAULT '', review_rule_items_json TEXT, chapter_naming_json TEXT NOT NULL DEFAULT '{}', outline_naming_json TEXT NOT NULL DEFAULT '{}', ai_generate_settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  )`,
  "CREATE INDEX IF NOT EXISTS articles_last_opened_idx ON articles(last_opened_at)",
  `CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT NOT NULL, name_versions_json TEXT NOT NULL DEFAULT '[]', default_name_version_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(article_id, position)
  )`,
  "CREATE INDEX IF NOT EXISTS chapters_article_archived_position_idx ON chapters(article_id, archived, position)",
  `CREATE TABLE IF NOT EXISTS outlines (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, title TEXT NOT NULL,
    name_versions_json TEXT NOT NULL DEFAULT '[]', default_name_version_id TEXT,
    summary TEXT NOT NULL DEFAULT '', generate_instruction TEXT NOT NULL DEFAULT '', generate_options_json TEXT, expansion_json TEXT, settings_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'saved', title_generation_pending INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, UNIQUE(chapter_id, position)
  )`,
  "CREATE INDEX IF NOT EXISTS outlines_article_chapter_archived_position_idx ON outlines(article_id, chapter_id, archived, position)",
  `CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL UNIQUE REFERENCES outlines(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '', content_name TEXT NOT NULL DEFAULT '', content_override INTEGER NOT NULL DEFAULT 0,
    source_version_id TEXT, current_version_id TEXT, default_version_id TEXT, outline_snapshot_json TEXT,
    manual_excellent INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    name TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, model_id TEXT, model_name TEXT, prompt TEXT,
    task_id TEXT, rewrite_source_id TEXT, rewrite_source_name TEXT, review_report_json TEXT, outline_snapshot_json TEXT, setting_snapshot_json TEXT, last_selected_at TEXT, manual_excellent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS versions_outline_created_idx ON versions(outline_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS excellent_fragments (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES versions(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, selected_text TEXT NOT NULL,
    prefix_context TEXT NOT NULL DEFAULT '', suffix_context TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK(start_offset >= 0), CHECK(end_offset > start_offset)
  )`,
  "CREATE INDEX IF NOT EXISTS excellent_fragments_outline_idx ON excellent_fragments(outline_id)",
  "CREATE INDEX IF NOT EXISTS excellent_fragments_version_idx ON excellent_fragments(version_id)",
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE, aliases_json TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '', profile_json TEXT NOT NULL DEFAULT '{}', visual_json TEXT, photos_json TEXT, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, UNIQUE(article_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    character_low_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    character_high_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, CHECK(character_low_id <> character_high_id),
    UNIQUE(article_id, character_low_id, character_high_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE, draft TEXT NOT NULL DEFAULT '',
    model_id TEXT, context_options_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  )`,
  "CREATE INDEX IF NOT EXISTS chat_sessions_outline_updated_idx ON chat_sessions(outline_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','stopped')),
    order_index INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, order_index)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_request_claims (
    request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS chat_request_claims_expires_idx ON chat_request_claims(expires_at)",
  `CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    target TEXT NOT NULL, instruction TEXT NOT NULL, model_id TEXT NOT NULL,
    execution_origin TEXT NOT NULL DEFAULT 'local',
    context_options_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, result_text TEXT, result_version_id TEXT,
    review_state_json TEXT, error_code TEXT, error_message TEXT, input_tokens INTEGER, output_tokens INTEGER,
    phase TEXT, last_progress_at TEXT, received_characters INTEGER, timeout_ms INTEGER,
    runner_id TEXT, lease_until TEXT,
    created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS ai_tasks_status_created_idx ON ai_tasks(status, created_at)",
  "CREATE INDEX IF NOT EXISTS ai_tasks_outline_created_idx ON ai_tasks(outline_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS ai_tasks_article_created_idx ON ai_tasks(article_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, adapter_kind TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 120000,
    has_secret INTEGER NOT NULL DEFAULT 0, secret TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY NOT NULL, provider_id TEXT REFERENCES ai_providers(id) ON DELETE RESTRICT,
    name TEXT NOT NULL, base_url TEXT NOT NULL, model_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '', reasoning_effort TEXT, temperature REAL, max_output INTEGER, max_input_characters INTEGER NOT NULL DEFAULT 60000,
    timeout_ms INTEGER NOT NULL, timeout_override_ms INTEGER, has_secret INTEGER NOT NULL DEFAULT 0, secret TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_change_log (
    database_version INTEGER PRIMARY KEY NOT NULL, change_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
];

export const RUNTIME_SCHEMA_VERSION = "22";

export const RUNTIME_SCHEMA_VERSION_KEY = "runtime_schema_version";

export let initialized: Promise<void> | null = null;

let onDatabaseReady: (() => void) | undefined;

// The application supplies background processing without a persistence import cycle.
export function registerDatabaseReadyListener(listener: () => void) {
  onDatabaseReady = listener;
}

export async function hasCurrentRuntimeSchema(db: SqliteDatabase) {
  try {
    const version = await db.prepare("SELECT value_json FROM app_settings WHERE key=?")
      .bind(RUNTIME_SCHEMA_VERSION_KEY)
      .first<string>("value_json");
    if (version !== RUNTIME_SCHEMA_VERSION) return false;
    // Validate every declared business table and column, even with a current marker.
    return databaseSchemaMatches(db);
  } catch {
    // Fresh and legacy databases may not have app_settings yet.
    return false;
  }
}

export async function createSearchIndex(db: SqliteDatabase) {
  try {
    await db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS search_documents USING fts5(
      article_id UNINDEXED, chapter_id UNINDEXED, outline_id UNINDEXED,
      entity_type UNINDEXED, entity_id UNINDEXED, title, body, tokenize='trigram'
    )`).run();
    await db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES('search_mode', '\"fts5-trigram\"', ?)").bind(new Date().toISOString()).run();
  } catch {
    try {
      await db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS search_documents USING fts5(
        article_id UNINDEXED, chapter_id UNINDEXED, outline_id UNINDEXED,
        entity_type UNINDEXED, entity_id UNINDEXED, title, body
      )`).run();
      await db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES('search_mode', '\"fts5\"', ?)").bind(new Date().toISOString()).run();
    } catch {
      await db.prepare(`CREATE TABLE IF NOT EXISTS search_documents (
        article_id TEXT, chapter_id TEXT, outline_id TEXT, entity_type TEXT,
        entity_id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL
      )`).run();
      await db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES('search_mode', '\"substring\"', ?)").bind(new Date().toISOString()).run();
    }
  }
}

export async function ensureDatabase() {
  if (!initialized) {
    initialized = (async () => {
      const db = getDatabase();
      if (await hasCurrentRuntimeSchema(db)) return;

      await db.batch([...schemaStatements, ...styleLabSchema].map((statement) => db.prepare(statement)));
      await db.batch(illustrationSchema.map((statement) => db.prepare(statement)));
      await ensureAiModelSecretColumn(db);
      await ensureAiModelMaxInputCharactersColumn(db);
      await ensureAiProviderShape(db);
      const modelColumns = await db.prepare("PRAGMA table_info(ai_models)").all<{ name: string }>();
      if (!modelColumns.results?.some((column) => column.name === "metadata_json")) {
        await db.prepare("ALTER TABLE ai_models ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'").run();
      }
      await ensureArticleNamingColumns(db);
      await ensureAiGenerateSettingsColumns(db);
      await ensureCharacterDescriptionShape(db);
      await ensureStorySettingColumns(db);
      await ensureMultipleChatSessions(db);
      await ensureOutlineTitleGenerationColumn(db);
      await ensureNameVersionColumns(db);
      await ensureOutlineGenerateInstructionColumn(db);
      await ensureOutlineSettingsColumn(db);
      await ensureContentOverrideColumn(db);
      await ensureContentNameColumn(db);
      await ensureContentSelectionColumns(db);
      await ensureVersionOutlineSnapshotColumn(db);
      await ensureVersionModelNameColumn(db);
      await ensureVersionRewriteSourceColumns(db);
      await ensureVersionSelectionColumn(db);
      await ensureBodyExcellentColumns(db);
      await ensureAiTaskProgressColumns(db);
      await ensureGenerateReviewColumns(db);
      await db.batch(taskHistoryTriggers.map((statement) => db.prepare(statement)));
      await migrateReviewRules(db);
      await createSearchIndex(db);
      try {
        await verifyDatabaseSchema(db);
      } catch (error) {
        throw new Error(`数据库结构与代码不匹配，升级未完成：${(await missingDatabaseColumns(db)).join("、") || (error instanceof Error ? error.message : "结构探测失败")}`, { cause: error });
      }
      const initializedAt = new Date().toISOString();
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('state_revision', '0', ?)").bind(initializedAt),
        db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) SELECT 'database_version', value_json, ? FROM app_settings WHERE key='state_revision'").bind(initializedAt),
        db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES('sync_schema_version', '18', ?)").bind(initializedAt),
        db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('sync_database_id', ?, ?)").bind(crypto.randomUUID(), initializedAt),
        db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('state_write_guard', 'ready', ?)").bind(initializedAt),
        db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES(?, ?, ?)").bind(RUNTIME_SCHEMA_VERSION_KEY, RUNTIME_SCHEMA_VERSION, initializedAt),
      ]);
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
  onDatabaseReady?.();
}

export async function ensureAiModelSecretColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "ai_models", {"secret":"TEXT"});
}

export async function ensureOutlineTitleGenerationColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('outlines')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("title_generation_pending")) {
    await db.prepare("ALTER TABLE outlines ADD COLUMN title_generation_pending INTEGER NOT NULL DEFAULT 0").run();
    await db.prepare("UPDATE outlines SET title_generation_pending=1 WHERE TRIM(title)=''").run();
  }
}

export async function ensureContentOverrideColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "contents", {"content_override":"INTEGER NOT NULL DEFAULT 0"});
}

export async function ensureContentNameColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "contents", {"content_name":"TEXT NOT NULL DEFAULT ''"});
}

export async function ensureVersionOutlineSnapshotColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "versions", {"outline_snapshot_json":"TEXT"});
}

export async function ensureVersionModelNameColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "versions", {"model_name":"TEXT"});
}

export async function ensureVersionRewriteSourceColumns(db: SqliteDatabase) {
  await ensureTableColumns(db, "versions", {"rewrite_source_id":"TEXT","rewrite_source_name":"TEXT"});
}

export async function ensureVersionSelectionColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "versions", {"last_selected_at":"TEXT"});
}

export async function ensureNameVersionColumns(db: SqliteDatabase) {
  for (const table of ["chapters", "outlines"]) {
    const columns = rows(await db.prepare(`PRAGMA table_info('${table}')`).all<Record<string, unknown>>()).map((row) => String(row.name));
    if (!columns.includes("name_versions_json")) await db.prepare(`ALTER TABLE ${table} ADD COLUMN name_versions_json TEXT NOT NULL DEFAULT '[]'`).run();
    if (!columns.includes("default_name_version_id")) await db.prepare(`ALTER TABLE ${table} ADD COLUMN default_name_version_id TEXT`).run();
  }
}

export function providerNameFromUrl(value: string) {
  try { return new URL(value).host || "AI Provider"; } catch { return "AI Provider"; }
}

export async function ensureAiProviderShape(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('ai_models')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("provider_id")) await db.prepare("ALTER TABLE ai_models ADD COLUMN provider_id TEXT REFERENCES ai_providers(id) ON DELETE RESTRICT").run();
  if (!columns.includes("timeout_override_ms")) await db.prepare("ALTER TABLE ai_models ADD COLUMN timeout_override_ms INTEGER").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ai_models_provider_idx ON ai_models(provider_id)").run();

  const result = await db.prepare("SELECT id,name,base_url,timeout_ms,has_secret,secret,created_at,updated_at FROM ai_models WHERE provider_id IS NULL OR provider_id='' ORDER BY created_at,id").all<Record<string, unknown>>();
  const legacy = result.results ?? [];
  if (!legacy.length) return;

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const model of legacy) {
    const baseUrl = String(model.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const stored = String(model.secret ?? "");
    let credential = "none";
    if (stored) {
      try { credential = `secret:${await decryptAiSecret(stored)}`; }
      catch { credential = `unreadable:${String(model.id)}`; }
    }
    const key = `${baseUrl}\n${credential}`;
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }

  const usedNames = new Set<string>();
  for (const models of groups.values()) {
    const first = models[0];
    const providerId = crypto.randomUUID();
    const baseUrl = String(first.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const baseName = providerNameFromUrl(baseUrl);
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) { name = `${baseName} ${suffix}`; suffix += 1; }
    usedNames.add(name);
    const timeoutMs = Math.max(5000, Math.min(600000, Number(first.timeout_ms ?? 120000)));
    const storedSecret = String(first.secret ?? "");
    const createdAt = String(first.created_at ?? new Date().toISOString());
    const updatedAt = String(first.updated_at ?? createdAt);
    await db.prepare("INSERT INTO ai_providers(id,name,adapter_kind,base_url,timeout_ms,has_secret,secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(providerId, name, "openai-compatible", baseUrl, timeoutMs, storedSecret ? 1 : 0, storedSecret || null, createdAt, updatedAt).run();
    for (const model of models) {
      const modelTimeout = Math.max(5000, Math.min(600000, Number(model.timeout_ms ?? timeoutMs)));
      await db.prepare("UPDATE ai_models SET provider_id=?,timeout_override_ms=?,secret=NULL,has_secret=0 WHERE id=?")
        .bind(providerId, modelTimeout === timeoutMs ? null : modelTimeout, String(model.id)).run();
    }
  }
}

export async function ensureOutlineGenerateInstructionColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "outlines", {"generate_instruction":"TEXT NOT NULL DEFAULT ''"});
}

export async function ensureContentSelectionColumns(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('contents')").all<Record<string, unknown>>()).map((row) => String(row.name));
  const addedCurrent = !columns.includes("current_version_id");
  const addedDefault = !columns.includes("default_version_id");
  const addedSnapshot = !columns.includes("outline_snapshot_json");
  if (addedCurrent) await db.prepare("ALTER TABLE contents ADD COLUMN current_version_id TEXT").run();
  if (addedDefault) await db.prepare("ALTER TABLE contents ADD COLUMN default_version_id TEXT").run();
  if (addedSnapshot) await db.prepare("ALTER TABLE contents ADD COLUMN outline_snapshot_json TEXT").run();
  if (addedDefault) await db.prepare("UPDATE contents SET default_version_id=source_version_id WHERE source_version_id IS NOT NULL").run();
  if (addedCurrent) {
    await db.prepare(`UPDATE contents SET current_version_id=CASE
      WHEN content_override=0 THEN source_version_id
      ELSE (SELECT id FROM versions WHERE versions.outline_id=contents.outline_id AND versions.name=contents.content_name AND versions.text=contents.text ORDER BY versions.created_at DESC LIMIT 1)
    END`).run();
  }
  if (addedSnapshot) {
    await db.prepare(`UPDATE contents SET outline_snapshot_json=(
      SELECT outline_snapshot_json FROM versions
      WHERE versions.id=contents.source_version_id AND versions.outline_id=contents.outline_id
    ) WHERE current_version_id IS NULL AND source_version_id IS NOT NULL`).run();
  }
}

export async function ensureBodyExcellentColumns(db: SqliteDatabase) {
  await ensureTableColumns(db, "contents", {"manual_excellent":"INTEGER NOT NULL DEFAULT 0"});
  await ensureTableColumns(db, "versions", {"manual_excellent":"INTEGER NOT NULL DEFAULT 0"});
}

export async function ensureGenerateReviewColumns(db: SqliteDatabase) {
  for (const [table, column, definition] of [["articles", "review_rules", "TEXT NOT NULL DEFAULT ''"], ["articles", "review_rule_items_json", "TEXT"], ["versions", "review_rule_snapshot_json", "TEXT"], ["versions", "review_report_json", "TEXT"], ["ai_tasks", "review_state_json", "TEXT"]]) {
    const columns = rows(await db.prepare(`PRAGMA table_info('${table}')`).all<Record<string, unknown>>());
    if (!columns.some((row) => row.name === column)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export async function migrateReviewRules(db: SqliteDatabase) {
  const articles = rows(await db.prepare("SELECT id,created_at,review_rules FROM articles WHERE review_rule_items_json IS NULL").all<Record<string, unknown>>());
  for (const article of articles) {
    const items = normalizeReviewRuleItems(undefined, String(article.id), normalizeReviewRules(article.review_rules), String(article.created_at));
    await db.prepare("UPDATE articles SET review_rule_items_json=? WHERE id=? AND review_rule_items_json IS NULL").bind(JSON.stringify(items), article.id).run();
  }
  // Keep pre-upgrade resumable tasks independent of subsequently edited rules.
  const tasks = rows(await db.prepare("SELECT id,article_id,context_options_json FROM ai_tasks WHERE status IN ('queued','running','error')").all<Record<string, unknown>>());
  for (const task of tasks) {
    const options = safeJson<Record<string, unknown>>(task.context_options_json, {});
    if (!options.reviewMaxRounds || options.reviewRuleSnapshot) continue;
    const snapshot = createReviewRuleSnapshot({ id: String(task.article_id), reviewRules: normalizeReviewRules(options.reviewRules) }, normalizeReviewRules(options.reviewInstruction));
    await db.prepare("UPDATE ai_tasks SET context_options_json=json_set(context_options_json,'$.reviewRuleSnapshot',json(?)) WHERE id=?").bind(JSON.stringify(snapshot), task.id).run();
  }
}

export async function ensureAiTaskProgressColumns(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('ai_tasks')").all<Record<string, unknown>>()).map((row) => String(row.name));
  const additions = [
    ["phase", "TEXT"],
    ["history_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["last_progress_at", "TEXT"],
    ["received_characters", "INTEGER"],
    ["timeout_ms", "INTEGER"],
    ["runner_id", "TEXT"],
    ["lease_until", "TEXT"],
    ["execution_origin", "TEXT NOT NULL DEFAULT 'local'"],
  ] as const;
  for (const [name, type] of additions) {
    if (!columns.includes(name)) await db.prepare(`ALTER TABLE ai_tasks ADD COLUMN ${name} ${type}`).run();
  }
}

export async function ensureCharacterDescriptionShape(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('characters')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (columns.includes("description") && !columns.some((column) => ["role", "appearance", "personality", "abilities", "background", "color"].includes(column))) return;
  const legacy = new Set(columns);
  const descriptionParts = [
    ["role", "身份"], ["appearance", "外貌"], ["personality", "性格"],
    ["abilities", "能力"], ["background", "背景"],
  ].filter(([column]) => legacy.has(column)).map(([column, label]) => `CASE WHEN TRIM(${column}) <> '' THEN '${label}：' || TRIM(${column}) || CHAR(10) ELSE '' END`);
  const descriptionSql = legacy.has("description") ? "description" : `RTRIM(${descriptionParts.join(" || ") || "''"}, CHAR(10))`;
  await db.batch([
    db.prepare("DROP TABLE IF EXISTS relationships_next"),
    db.prepare("DROP TABLE IF EXISTS characters_next"),
    db.prepare(`CREATE TABLE characters_next (
      id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE, aliases_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(article_id, name)
    )`),
    db.prepare(`INSERT INTO characters_next(id,article_id,name,aliases_json,description,archived,created_at,updated_at,revision)
      SELECT id,article_id,name,aliases_json,${descriptionSql},archived,created_at,updated_at,revision FROM characters`),
    db.prepare(`CREATE TABLE relationships_next (
      id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      character_low_id TEXT NOT NULL REFERENCES characters_next(id) ON DELETE CASCADE,
      character_high_id TEXT NOT NULL REFERENCES characters_next(id) ON DELETE CASCADE,
      description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, CHECK(character_low_id <> character_high_id),
      UNIQUE(article_id, character_low_id, character_high_id)
    )`),
    db.prepare(`INSERT INTO relationships_next(
      id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision
    ) SELECT id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision FROM relationships`),
    db.prepare("DROP TABLE relationships"),
    db.prepare("DROP TABLE characters"),
    db.prepare("ALTER TABLE characters_next RENAME TO characters"),
    db.prepare("ALTER TABLE relationships_next RENAME TO relationships"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS characters_article_name_unique ON characters(article_id,name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS relationships_article_pair_unique ON relationships(article_id,character_low_id,character_high_id)"),
  ]);
}

export async function ensureMultipleChatSessions(db: SqliteDatabase) {
  const indexes = rows(await db.prepare("PRAGMA index_list('chat_sessions')").all<Record<string, unknown>>());
  const hasOutlineUnique = indexes.some((row) => Number(row.unique) === 1 && String(row.origin) === "u");
  if (!hasOutlineUnique) return;
  await db.batch([
    db.prepare("DROP TABLE IF EXISTS chat_messages_next"),
    db.prepare("DROP TABLE IF EXISTS chat_sessions_next"),
    db.prepare(`CREATE TABLE chat_sessions_next (
      id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE, draft TEXT NOT NULL DEFAULT '',
      model_id TEXT, context_options_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    )`),
    db.prepare(`INSERT INTO chat_sessions_next(
      id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision
    ) SELECT id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision FROM chat_sessions`),
    db.prepare(`CREATE TABLE chat_messages_next (
      id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES chat_sessions_next(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','stopped')),
      order_index INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, order_index)
    )`),
    db.prepare(`INSERT INTO chat_messages_next(
      id,session_id,role,content,status,order_index,created_at
    ) SELECT id,session_id,role,content,status,order_index,created_at FROM chat_messages`),
    db.prepare("DROP TABLE chat_messages"),
    db.prepare("DROP TABLE chat_sessions"),
    db.prepare("ALTER TABLE chat_sessions_next RENAME TO chat_sessions"),
    db.prepare("ALTER TABLE chat_messages_next RENAME TO chat_messages"),
    db.prepare("CREATE INDEX chat_sessions_outline_updated_idx ON chat_sessions(outline_id, updated_at DESC)"),
    db.prepare("CREATE UNIQUE INDEX chat_messages_session_order_unique ON chat_messages(session_id, order_index)"),
  ]);
}

export async function ensureAiModelMaxInputCharactersColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "ai_models", {"reasoning_effort":"TEXT"});
}

export async function ensureArticleNamingColumns(db: SqliteDatabase) {
  await ensureTableColumns(db, "articles", {"chapter_naming_json":"TEXT NOT NULL DEFAULT '{}'","outline_naming_json":"TEXT NOT NULL DEFAULT '{}'"});
}

export async function ensureAiGenerateSettingsColumns(db: SqliteDatabase) {
  for (const [table, columns] of Object.entries(AI_GENERATE_SETTINGS_COLUMNS)) await ensureTableColumns(db, table, columns);
}

export async function ensureOutlineSettingsColumn(db: SqliteDatabase) {
  await ensureTableColumns(db, "outlines", {"settings_json":"TEXT NOT NULL DEFAULT '{}'"});
}

export async function ensureStorySettingColumns(db: SqliteDatabase) {
  await ensureTableColumns(db, "articles", {"story_settings_json":"TEXT NOT NULL DEFAULT '{}'"});
  await ensureTableColumns(db, "chapters", {"settings_json":"TEXT NOT NULL DEFAULT '{}'"});
  await ensureTableColumns(db, "characters", {"profile_json":"TEXT NOT NULL DEFAULT '{}'","photos_json":"TEXT","visual_json":"TEXT"});
  await ensureTableColumns(db, "versions", {"setting_snapshot_json":"TEXT"});
}
