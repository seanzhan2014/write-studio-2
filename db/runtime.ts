import type { StudioData } from "@/app/studio-state";
import { timestampContentName } from "@/lib/content-name.mjs";
import { DEFAULT_GENERATE_TARGET_WORDS, normalizeGeneratePresets, normalizeGenerateTargetWords } from "@/lib/generate-options";
import { DEFAULT_MAX_INPUT_CHARACTERS } from "@/lib/model-options";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";
import { normalizeExcellentFragments, type ExcellentFragment } from "@/lib/excellent-fragments.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { normalizeReviewPresets } from "@/lib/review-options";
import { databaseEngine, getDatabase, type SqliteDatabase, type SqliteResult, type SqliteStatement } from "./sqlite";

export { getDatabase } from "./sqlite";

const schemaStatements = [
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    article_type TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', chapter_naming_json TEXT NOT NULL DEFAULT '{}', outline_naming_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  )`,
  "CREATE INDEX IF NOT EXISTS articles_last_opened_idx ON articles(last_opened_at)",
  `CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT NOT NULL, position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(article_id, position)
  )`,
  "CREATE INDEX IF NOT EXISTS chapters_article_archived_position_idx ON chapters(article_id, archived, position)",
  `CREATE TABLE IF NOT EXISTS outlines (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '', generate_instruction TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
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
    task_id TEXT, outline_snapshot_json TEXT, manual_excellent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
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
    description TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
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
    context_options_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, result_text TEXT, result_version_id TEXT,
    error_code TEXT, error_message TEXT, input_tokens INTEGER, output_tokens INTEGER,
    phase TEXT, last_progress_at TEXT, received_characters INTEGER, timeout_ms INTEGER,
    runner_id TEXT, lease_until TEXT,
    created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS ai_tasks_status_created_idx ON ai_tasks(status, created_at)",
  "CREATE INDEX IF NOT EXISTS ai_tasks_outline_created_idx ON ai_tasks(outline_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS ai_tasks_article_created_idx ON ai_tasks(article_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, base_url TEXT NOT NULL, model_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '', temperature REAL, max_output INTEGER, max_input_characters INTEGER NOT NULL DEFAULT 60000,
    timeout_ms INTEGER NOT NULL, has_secret INTEGER NOT NULL DEFAULT 0, secret TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
];

let initialized: Promise<void> | null = null;

async function createSearchIndex(db: SqliteDatabase) {
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
      for (const statement of schemaStatements) await db.prepare(statement).run();
      await ensureAiModelSecretColumn(db);
      await ensureAiModelMaxInputCharactersColumn(db);
      await ensureArticleNamingColumns(db);
      await ensureCharacterDescriptionShape(db);
      await ensureMultipleChatSessions(db);
      await ensureOutlineTitleGenerationColumn(db);
      await ensureOutlineGenerateInstructionColumn(db);
      await ensureContentOverrideColumn(db);
      await ensureContentNameColumn(db);
      await ensureContentSelectionColumns(db);
      await ensureVersionOutlineSnapshotColumn(db);
      await ensureVersionModelNameColumn(db);
      await ensureBodyExcellentColumns(db);
      await ensureAiTaskProgressColumns(db);
      await createSearchIndex(db);
      const initializedAt = new Date().toISOString();
      await db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('state_revision', '0', ?)").bind(initializedAt).run();
      await db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) SELECT 'database_version', value_json, ? FROM app_settings WHERE key='state_revision'").bind(initializedAt).run();
      await db.prepare("INSERT OR REPLACE INTO app_settings(key, value_json, updated_at) VALUES('sync_schema_version', '2', ?)").bind(initializedAt).run();
      await db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('sync_database_id', ?, ?)").bind(crypto.randomUUID(), initializedAt).run();
      await db.prepare("INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES('state_write_guard', 'ready', ?)").bind(initializedAt).run();
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  return initialized;
}

function rows<T>(result: SqliteResult<T>) {
  return result.results ?? [];
}

function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function bool(value: unknown) { return Number(value) === 1; }

async function ensureAiModelSecretColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('ai_models')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("secret")) await db.prepare("ALTER TABLE ai_models ADD COLUMN secret TEXT").run();
}

async function ensureOutlineTitleGenerationColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('outlines')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("title_generation_pending")) {
    await db.prepare("ALTER TABLE outlines ADD COLUMN title_generation_pending INTEGER NOT NULL DEFAULT 0").run();
    await db.prepare("UPDATE outlines SET title_generation_pending=1 WHERE TRIM(title)=''").run();
  }
}

async function ensureContentOverrideColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('contents')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("content_override")) await db.prepare("ALTER TABLE contents ADD COLUMN content_override INTEGER NOT NULL DEFAULT 0").run();
}

async function ensureContentNameColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('contents')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("content_name")) await db.prepare("ALTER TABLE contents ADD COLUMN content_name TEXT NOT NULL DEFAULT ''").run();
}

async function ensureVersionOutlineSnapshotColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('versions')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("outline_snapshot_json")) await db.prepare("ALTER TABLE versions ADD COLUMN outline_snapshot_json TEXT").run();
}

async function ensureVersionModelNameColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('versions')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("model_name")) await db.prepare("ALTER TABLE versions ADD COLUMN model_name TEXT").run();
}

async function ensureOutlineGenerateInstructionColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('outlines')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (columns.includes("generate_instruction")) return;
  await db.prepare("ALTER TABLE outlines ADD COLUMN generate_instruction TEXT NOT NULL DEFAULT ''").run();
  await db.prepare(`UPDATE outlines SET generate_instruction=COALESCE((
    SELECT instruction FROM ai_tasks
    WHERE ai_tasks.outline_id=outlines.id AND ai_tasks.target='content'
    ORDER BY ai_tasks.created_at DESC LIMIT 1
  ), '')`).run();
}

async function ensureContentSelectionColumns(db: SqliteDatabase) {
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

async function ensureBodyExcellentColumns(db: SqliteDatabase) {
  const contentColumns = rows(await db.prepare("PRAGMA table_info('contents')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!contentColumns.includes("manual_excellent")) await db.prepare("ALTER TABLE contents ADD COLUMN manual_excellent INTEGER NOT NULL DEFAULT 0").run();
  const versionColumns = rows(await db.prepare("PRAGMA table_info('versions')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!versionColumns.includes("manual_excellent")) await db.prepare("ALTER TABLE versions ADD COLUMN manual_excellent INTEGER NOT NULL DEFAULT 0").run();
}

async function ensureAiTaskProgressColumns(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('ai_tasks')").all<Record<string, unknown>>()).map((row) => String(row.name));
  const additions = [
    ["phase", "TEXT"],
    ["last_progress_at", "TEXT"],
    ["received_characters", "INTEGER"],
    ["timeout_ms", "INTEGER"],
    ["runner_id", "TEXT"],
    ["lease_until", "TEXT"],
  ] as const;
  for (const [name, type] of additions) {
    if (!columns.includes(name)) await db.prepare(`ALTER TABLE ai_tasks ADD COLUMN ${name} ${type}`).run();
  }
}

async function ensureCharacterDescriptionShape(db: SqliteDatabase) {
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
    db.prepare("INSERT INTO relationships_next SELECT * FROM relationships"),
    db.prepare("DROP TABLE relationships"),
    db.prepare("DROP TABLE characters"),
    db.prepare("ALTER TABLE characters_next RENAME TO characters"),
    db.prepare("ALTER TABLE relationships_next RENAME TO relationships"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS characters_article_name_unique ON characters(article_id,name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS relationships_article_pair_unique ON relationships(article_id,character_low_id,character_high_id)"),
  ]);
}

async function ensureMultipleChatSessions(db: SqliteDatabase) {
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
    db.prepare("INSERT INTO chat_sessions_next SELECT * FROM chat_sessions"),
    db.prepare(`CREATE TABLE chat_messages_next (
      id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES chat_sessions_next(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','stopped')),
      order_index INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, order_index)
    )`),
    db.prepare("INSERT INTO chat_messages_next SELECT * FROM chat_messages"),
    db.prepare("DROP TABLE chat_messages"),
    db.prepare("DROP TABLE chat_sessions"),
    db.prepare("ALTER TABLE chat_sessions_next RENAME TO chat_sessions"),
    db.prepare("ALTER TABLE chat_messages_next RENAME TO chat_messages"),
    db.prepare("CREATE INDEX chat_sessions_outline_updated_idx ON chat_sessions(outline_id, updated_at DESC)"),
    db.prepare("CREATE UNIQUE INDEX chat_messages_session_order_unique ON chat_messages(session_id, order_index)"),
  ]);
}

export async function readStudioState(): Promise<{ data: StudioData | null; revision: number; databaseVersion: number }> {
  await ensureDatabase();
  const db = getDatabase();
  const [articleResult, chapterResult, outlineResult, contentResult, versionResult, excellentFragmentResult, characterResult, relationshipResult, sessionResult, messageResult, taskResult, settingResult] = await Promise.all([
    db.prepare("SELECT * FROM articles ORDER BY last_opened_at DESC, rowid").all(),
    db.prepare("SELECT * FROM chapters ORDER BY article_id, position, id").all(),
    db.prepare("SELECT * FROM outlines ORDER BY chapter_id, position, id").all(),
    db.prepare("SELECT * FROM contents").all(),
    db.prepare("SELECT * FROM versions ORDER BY created_at DESC, rowid").all(),
    db.prepare("SELECT * FROM excellent_fragments ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM characters ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM relationships ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM chat_sessions ORDER BY outline_id, created_at, rowid").all(),
    db.prepare("SELECT * FROM chat_messages ORDER BY session_id, order_index").all(),
    db.prepare("SELECT * FROM ai_tasks ORDER BY created_at DESC, rowid LIMIT 20").all(),
    db.prepare("SELECT * FROM app_settings").all(),
  ]);
  const articleRows = rows(articleResult);
  const settingsMap = new Map(rows(settingResult).map((row) => [String((row as Record<string, unknown>).key), (row as Record<string, unknown>).value_json]));
  const revision = Number(settingsMap.get("state_revision") ?? 0);
  const databaseVersion = Number(settingsMap.get("database_version") ?? revision);
  if (!articleRows.length) {
    const ui = safeJson<Partial<StudioData>>(settingsMap.get("studio_ui"), {});
    return { revision, databaseVersion, data: { version: 1, currentArticleId: "", currentOutlineId: "", articles: [], tasks: [], settings: normalizeStudioSettings(ui.settings) } };
  }

  const chapters = rows(chapterResult) as Record<string, unknown>[];
  const outlines = rows(outlineResult) as Record<string, unknown>[];
  const contents = new Map((rows(contentResult) as Record<string, unknown>[]).map((row) => [String(row.outline_id), row]));
  const versions = rows(versionResult) as Record<string, unknown>[];
  const excellentFragments = rows(excellentFragmentResult) as Record<string, unknown>[];
  const characters = rows(characterResult) as Record<string, unknown>[];
  const relationships = rows(relationshipResult) as Record<string, unknown>[];
  const sessions = rows(sessionResult) as Record<string, unknown>[];
  const messages = rows(messageResult) as Record<string, unknown>[];
  const tasks = (rows(taskResult) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id), articleId: String(row.article_id), chapterId: String(row.chapter_id), outlineId: String(row.outline_id),
    target: row.target === "content" ? "正文" : row.target === "outline" ? "大纲" : row.target === "chat" ? "AI Chat" : "章节标题",
    prompt: String(row.instruction), model: String(row.model_id),
    state: row.status === "queued" ? "waiting" : row.status === "error" ? "failed" : row.status,
    createdAt: String(row.created_at), resultVersionId: row.result_version_id ? String(row.result_version_id) : undefined,
    resultText: row.result_text ? String(row.result_text) : undefined,
    error: row.error_message ? String(row.error_message) : undefined,
    attempt: Number(row.attempt ?? 0),
    phase: row.phase ? String(row.phase) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    lastProgressAt: row.last_progress_at ? String(row.last_progress_at) : undefined,
    receivedCharacters: row.received_characters == null ? undefined : Number(row.received_characters),
    timeoutMs: row.timeout_ms == null ? undefined : Number(row.timeout_ms),
    inputTokens: row.input_tokens == null ? undefined : Number(row.input_tokens),
    outputTokens: row.output_tokens == null ? undefined : Number(row.output_tokens),
    runnerId: row.runner_id ? String(row.runner_id) : undefined,
    leaseUntil: row.lease_until ? String(row.lease_until) : undefined,
    contextOptions: safeJson(row.context_options_json, undefined),
  })) as StudioData["tasks"];

  const articles = (articleRows as Record<string, unknown>[]).map((articleRow) => {
    const articleId = String(articleRow.id);
    const articleChapters = chapters.filter((row) => row.article_id === articleId).map((chapterRow) => {
      const chapterId = String(chapterRow.id);
      const chapterOutlines = outlines.filter((row) => row.chapter_id === chapterId).map((outlineRow) => {
        const outlineId = String(outlineRow.id);
        const content = contents.get(outlineId);
        const outlineSessionRows = sessions.filter((row) => row.outline_id === outlineId);
        const sessionItems = outlineSessionRows.map((sessionRow) => {
          const options = safeJson<{ title?: string; includePrevious?: boolean; includeCharacters?: boolean; active?: boolean; lastReadMessageId?: string | null }>(sessionRow.context_options_json, {});
          const sessionMessages = messages.filter((row) => row.session_id === sessionRow.id).map((row) => ({
            id: String(row.id), role: String(row.role) as "user" | "assistant", text: String(row.content),
            createdAt: String(row.created_at), stopped: row.status === "stopped" || undefined,
          }));
          return {
            id: String(sessionRow.id),
            title: options.title?.trim() || "新对话",
            messages: sessionMessages,
            draft: "",
            includePrevious: options.includePrevious !== false,
            includeCharacters: options.includeCharacters !== false,
            lastReadMessageId: null,
            createdAt: String(sessionRow.created_at),
            updatedAt: String(sessionRow.updated_at),
          };
        });
        const fallbackSession = {
          id: `chat:${outlineId}`, title: "新对话", messages: [], draft: "", includePrevious: true, includeCharacters: true,
          lastReadMessageId: null,
          createdAt: String(outlineRow.updated_at), updatedAt: String(outlineRow.updated_at),
        };
        const activeSessionId = String(sessionItems[0]?.id ?? fallbackSession.id);
        const mapExcellentFragments = (sourceText: string, versionId?: string): ExcellentFragment[] => normalizeExcellentFragments(sourceText, excellentFragments
          .filter((row) => row.outline_id === outlineId && (versionId ? row.version_id === versionId : !row.version_id))
          .map((row) => ({
            id: String(row.id), start: Number(row.start_offset), end: Number(row.end_offset), text: String(row.selected_text),
            prefix: String(row.prefix_context ?? ""), suffix: String(row.suffix_context ?? ""), sourceHash: String(row.source_hash ?? ""),
            createdAt: String(row.created_at), updatedAt: String(row.updated_at),
          })));
        const outlineVersions = versions.filter((row) => row.outline_id === outlineId).map((row) => ({
          id: String(row.id), name: String(row.name), content: String(row.text),
          source: row.source === "ai-generate" ? "AI Generate" as const : row.source === "ai-chat" ? "AI Chat" as const : row.source === "ai-review" ? "AI Review" as const : row.source === "unsaved" ? "未保存内容" as const : "手动" as const,
          createdAt: String(row.created_at), model: row.model_name ? String(row.model_name) : row.model_id ? String(row.model_id) : undefined, modelId: row.model_name && row.model_id ? String(row.model_id) : undefined,
          prompt: row.prompt ? String(row.prompt) : undefined, taskId: row.task_id ? String(row.task_id) : undefined,
          outlineSnapshot: row.outline_snapshot_json ? safeJson<{ title: string; plan: string } | undefined>(row.outline_snapshot_json, undefined) : undefined,
          manualExcellent: bool(row.manual_excellent),
          excellentFragments: mapExcellentFragments(String(row.text), String(row.id)),
        }));
        const currentVersionId = content?.current_version_id && outlineVersions.some((version) => version.id === String(content.current_version_id))
          ? String(content.current_version_id)
          : null;
        const defaultVersionId = content?.default_version_id && outlineVersions.some((version) => version.id === String(content.default_version_id))
          ? String(content.default_version_id)
          : null;
        return {
          id: outlineId, title: normalizeOutlineTitle(outlineRow.title), plan: String(outlineRow.summary), generateInstruction: String(outlineRow.generate_instruction ?? ""),
          titleGenerationPending: bool(outlineRow.title_generation_pending),
          content: String(content?.text ?? ""), contentName: String(content?.content_name ?? "").trim() || timestampContentName(String(outlineRow.updated_at)),
          currentVersionId, defaultVersionId,
          contentOutlineSnapshot: content?.outline_snapshot_json ? safeJson<{ title: string; plan: string } | undefined>(content.outline_snapshot_json, undefined) : undefined,
          manualExcellent: bool(content?.manual_excellent), archived: bool(outlineRow.archived),
          state: String(outlineRow.state) as "saved" | "running" | "failed", updatedAt: String(outlineRow.updated_at),
          excellentFragments: mapExcellentFragments(String(content?.text ?? "")),
          versions: outlineVersions,
          chat: { sessions: sessionItems.length ? sessionItems : [fallbackSession], activeSessionId },
        };
      });
      return { id: chapterId, title: String(chapterRow.title), archived: bool(chapterRow.archived), outlines: chapterOutlines };
    });
    return {
      id: articleId, title: String(articleRow.title), summary: String(articleRow.summary), type: String(articleRow.article_type),
      style: String(articleRow.style), createdAt: String(articleRow.created_at), updatedAt: String(articleRow.updated_at),
      chapterNaming: normalizeNamingProfile(safeJson(articleRow.chapter_naming_json, {}), DEFAULT_CHAPTER_NAMING_PROFILE),
      outlineNaming: normalizeNamingProfile(safeJson(articleRow.outline_naming_json, {}), DEFAULT_OUTLINE_NAMING_PROFILE),
      lastOutlineId: "", chapters: articleChapters,
      characters: characters.filter((row) => row.article_id === articleId).map((row) => ({
        id: String(row.id), name: String(row.name), aliases: safeJson<string[]>(row.aliases_json, []),
        description: String(row.description), archived: bool(row.archived),
      })),
      relationships: relationships.filter((row) => row.article_id === articleId).map((row) => ({
        id: String(row.id), characterAId: String(row.character_low_id), characterBId: String(row.character_high_id), description: String(row.description),
      })),
    };
  });
  const ui = safeJson<Partial<StudioData>>(settingsMap.get("studio_ui"), {});
  const currentArticleId = articles[0].id;
  const selectedArticle = articles[0];
  const currentOutlineId = selectedArticle.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
  return {
    revision,
    databaseVersion,
    data: {
      version: 1,
      currentArticleId,
      currentOutlineId,
      articles,
      tasks,
      settings: normalizeStudioSettings(ui.settings),
    },
  };
}

const defaultSettings: StudioData["settings"] = {
  theme: "light", editorFont: "sans", fontSize: 17, lineHeight: 1.8, contentWidth: 920,
  outlineExpanded: true, showArchived: false, openLastArticle: true, taskConcurrency: 2,
  chatModel: "", generateModel: "", namingModelMode: "inherit", namingModel: "", reviewModel: "", generateTargetWords: DEFAULT_GENERATE_TARGET_WORDS, generatePresets: [],
  reviewPresets: [],
};

function normalizeStudioSettings(value: unknown): StudioData["settings"] {
  const settings = value && typeof value === "object" ? value as Partial<StudioData["settings"]> : {};
  return {
    ...defaultSettings,
    ...settings,
    namingModelMode: settings.namingModelMode === "fixed" ? "fixed" : "inherit",
    namingModel: String(settings.namingModel ?? ""),
    generateTargetWords: normalizeGenerateTargetWords(settings.generateTargetWords),
    generatePresets: normalizeGeneratePresets(settings.generatePresets),
    reviewPresets: normalizeReviewPresets(settings.reviewPresets),
  };
}

function insert(db: SqliteDatabase, sql: string, values: unknown[]) { return db.prepare(sql).bind(...values); }

function uniqueExcellentFragments(content: string, fragments: unknown, usedIds: Set<string>) {
  return normalizeExcellentFragments(content, fragments).map((fragment) => {
    let id = fragment.id;
    while (usedIds.has(id)) id = `excellent-${crypto.randomUUID()}`;
    usedIds.add(id);
    return id === fragment.id ? fragment : { ...fragment, id };
  });
}

async function ensureAiModelMaxInputCharactersColumn(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('ai_models')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("max_input_characters")) await db.prepare(`ALTER TABLE ai_models ADD COLUMN max_input_characters INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_INPUT_CHARACTERS}`).run();
}

async function ensureArticleNamingColumns(db: SqliteDatabase) {
  const columns = rows(await db.prepare("PRAGMA table_info('articles')").all<Record<string, unknown>>()).map((row) => String(row.name));
  if (!columns.includes("chapter_naming_json")) await db.prepare("ALTER TABLE articles ADD COLUMN chapter_naming_json TEXT NOT NULL DEFAULT '{}'").run();
  if (!columns.includes("outline_naming_json")) await db.prepare("ALTER TABLE articles ADD COLUMN outline_naming_json TEXT NOT NULL DEFAULT '{}'").run();
}

export async function writeStudioState(data: StudioData, expectedRevision: number) {
  await ensureDatabase();
  const db = getDatabase();
  const current = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
  if (current !== expectedRevision) return { conflict: true as const, current: await readStudioState() };
  const currentDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? current);

  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;
  const nextDatabaseVersion = currentDatabaseVersion + 1;
  const statements: SqliteStatement[] = [
    db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? THEN ? ELSE NULL END, updated_at=? WHERE key='state_write_guard'").bind(expectedRevision, crypto.randomUUID(), now),
    db.prepare("DELETE FROM articles"),
    db.prepare("DELETE FROM search_documents"),
  ];
  const writtenExcellentFragmentIds = new Set<string>();
  for (const article of data.articles) {
    statements.push(insert(db, "INSERT INTO articles(id,title,summary,article_type,style,chapter_naming_json,outline_naming_json,created_at,updated_at,last_opened_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [article.id, article.title.slice(0, 120), article.summary, article.type, article.style, JSON.stringify(normalizeNamingProfile(article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE)), JSON.stringify(normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE)), article.createdAt, article.updatedAt, article.updatedAt, nextRevision]));
    article.chapters.forEach((chapter, chapterIndex) => {
      statements.push(insert(db, "INSERT INTO chapters VALUES(?,?,?,?,?,?,?,?)", [chapter.id, article.id, chapter.title, (chapterIndex + 1) * 1024, chapter.archived ? 1 : 0, article.createdAt, article.updatedAt, nextRevision]));
      statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, chapter.id, null, "chapter", chapter.id, chapter.title, ""]));
      chapter.outlines.forEach((outline, outlineIndex) => {
        const referenceContent = resolvedOutlineContent(outline);
        const normalizedTitle = normalizeOutlineTitle(outline.title);
        const defaultVersionId = Object.prototype.hasOwnProperty.call(outline, "defaultVersionId") ? outline.defaultVersionId : outline.sourceVersionId ?? null;
        const currentVersionId = Object.prototype.hasOwnProperty.call(outline, "currentVersionId") ? outline.currentVersionId : outline.contentOverride === false ? outline.sourceVersionId ?? null : null;
        const contentOutlineSnapshot = outline.contentOutlineSnapshot
          ?? (!currentVersionId && outline.sourceVersionId ? outline.versions.find((version) => version.id === outline.sourceVersionId)?.outlineSnapshot : undefined)
          ?? { title: normalizedTitle, plan: outline.plan };
        statements.push(insert(db, "INSERT INTO outlines(id,article_id,chapter_id,title,summary,generate_instruction,position,archived,state,title_generation_pending,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [outline.id, article.id, chapter.id, normalizedTitle, outline.plan.slice(0, 10000), String(outline.generateInstruction ?? "").slice(0, 20000), (outlineIndex + 1) * 1024, outline.archived ? 1 : 0, outline.state, outline.titleGenerationPending ? 1 : 0, outline.updatedAt, outline.updatedAt, nextRevision]));
        statements.push(insert(db, "INSERT INTO contents(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [`content:${outline.id}`, outline.id, outline.content, outline.contentName?.trim() || timestampContentName(outline.updatedAt), currentVersionId ? 0 : 1, defaultVersionId, currentVersionId, defaultVersionId, JSON.stringify(contentOutlineSnapshot), outline.manualExcellent ? 1 : 0, outline.updatedAt, nextRevision]));
        statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, chapter.id, outline.id, "outline", outline.id, outlineDisplayTitle({ title: normalizedTitle, plan: outline.plan }), `${outline.plan}\n${referenceContent}`]));
        outline.versions.forEach((version) => {
          statements.push(insert(db, "INSERT INTO versions(id,outline_id,name,text,source,model_id,model_name,prompt,task_id,outline_snapshot_json,manual_excellent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [version.id, outline.id, version.name, version.content, version.source === "AI Generate" ? "ai-generate" : version.source === "AI Chat" ? "ai-chat" : version.source === "AI Review" ? "ai-review" : version.source === "未保存内容" ? "unsaved" : "manual", version.modelId ?? null, version.model ?? null, version.prompt ?? null, version.taskId ?? null, version.outlineSnapshot ? JSON.stringify(version.outlineSnapshot) : null, version.manualExcellent ? 1 : 0, version.createdAt]));
          uniqueExcellentFragments(version.content, version.excellentFragments, writtenExcellentFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, version.id, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
        });
        uniqueExcellentFragments(outline.content, outline.excellentFragments, writtenExcellentFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, null, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
        outline.chat.sessions.forEach((session) => {
          statements.push(insert(db, "INSERT INTO chat_sessions VALUES(?,?,?,?,?,?,?,?,?)", [session.id, article.id, outline.id, session.draft, null, JSON.stringify({ title: session.title, includePrevious: session.includePrevious, includeCharacters: session.includeCharacters, active: session.id === outline.chat.activeSessionId, lastReadMessageId: session.lastReadMessageId ?? null }), session.createdAt, session.updatedAt, nextRevision]));
          session.messages.forEach((message, index) => statements.push(insert(db, "INSERT INTO chat_messages VALUES(?,?,?,?,?,?,?)", [message.id, session.id, message.role, message.text, message.stopped ? "stopped" : "complete", index, message.createdAt])));
        });
      });
    });
    article.characters.forEach((character) => {
      statements.push(insert(db, "INSERT INTO characters VALUES(?,?,?,?,?,?,?,?,?)", [character.id, article.id, character.name, JSON.stringify(character.aliases), character.description, character.archived ? 1 : 0, now, now, nextRevision]));
      statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, null, null, "character", character.id, character.name, `${character.aliases.join(" ")}\n${character.description}`]));
    });
    article.relationships.forEach((relationship) => {
      const [low, high] = [relationship.characterAId, relationship.characterBId].sort();
      statements.push(insert(db, "INSERT INTO relationships VALUES(?,?,?,?,?,?,?,?)", [relationship.id, article.id, low, high, relationship.description, now, now, nextRevision]));
    });
  }
  for (const task of data.tasks.slice(0, 20)) {
    statements.push(insert(db, "INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,context_options_json,idempotency_key,status,attempt,result_text,result_version_id,error_message,input_tokens,output_tokens,phase,last_progress_at,received_characters,timeout_ms,runner_id,lease_until,created_at,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [task.id, task.articleId, task.chapterId, task.outlineId, task.target === "正文" ? "content" : task.target === "大纲" ? "outline" : task.target === "AI Chat" ? "chat" : "chapter-title", task.prompt, task.model, JSON.stringify(task.contextOptions ?? {}), task.id, task.state === "waiting" ? "queued" : task.state === "failed" ? "error" : task.state, task.attempt ?? 0, task.resultText ?? null, task.resultVersionId ?? null, task.error ?? null, task.inputTokens ?? null, task.outputTokens ?? null, task.phase ?? null, task.lastProgressAt ?? null, task.receivedCharacters ?? null, task.timeoutMs ?? null, task.runnerId ?? null, task.leaseUntil ?? null, task.createdAt, task.startedAt ?? null, task.completedAt ?? null]));
  }
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('studio_ui',?,?)", [JSON.stringify({ settings: normalizeStudioSettings(data.settings) }), now]));
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)", [String(nextRevision), now]));
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('database_version',?,?)", [String(nextDatabaseVersion), now]));
  try {
    await db.batch(statements);
  } catch (error) {
    const actual = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    if (actual !== expectedRevision) return { conflict: true as const, current: await readStudioState() };
    throw error;
  }
  return { conflict: false as const, revision: nextRevision, databaseVersion: nextDatabaseVersion };
}

export async function databaseStatus() {
  const state = await readStudioState();
  const db = getDatabase();
  const searchMode = await db.prepare("SELECT value_json FROM app_settings WHERE key='search_mode'").first<string>("value_json");
  return { connected: true, engine: databaseEngine(), revision: state.revision, databaseVersion: state.databaseVersion, articles: state.data?.articles.length ?? 0, searchMode: safeJson(searchMode, "substring") };
}

export async function claimChatRequest(requestId: string, requestHash: string) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare("DELETE FROM chat_request_claims WHERE expires_at <= ?").bind(createdAt),
    db.prepare("INSERT INTO chat_request_claims(request_id,request_hash,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(request_id) DO NOTHING").bind(requestId, requestHash, createdAt, expiresAt),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) > 0) return "claimed" as const;
  const existing = await db.prepare("SELECT request_hash FROM chat_request_claims WHERE request_id=?").bind(requestId).first<{ request_hash?: string }>();
  return existing?.request_hash === requestHash ? "duplicate" as const : "mismatch" as const;
}

export async function integrityCheck() {
  await ensureDatabase();
  const db = getDatabase();
  const result = await db.prepare("PRAGMA foreign_key_check").all();
  return { ok: rows(result).length === 0, issues: rows(result) };
}

export async function searchDocuments(articleId: string, query: string) {
  await ensureDatabase();
  const pattern = `%${query}%`;
  const result = await getDatabase().prepare("SELECT article_id,chapter_id,outline_id,entity_type,entity_id,title,body FROM search_documents WHERE article_id=? AND (title LIKE ? OR body LIKE ?) LIMIT 100").bind(articleId, pattern, pattern).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function clearBusinessData() {
  await ensureDatabase();
  const db = getDatabase();
  const current = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
  const currentDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? current);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM articles"),
    db.prepare("DELETE FROM search_documents"),
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'last_outline:%'"),
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)").bind(String(current + 1), now),
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('database_version',?,?)").bind(String(currentDatabaseVersion + 1), now),
  ]);
  return { revision: current + 1, databaseVersion: currentDatabaseVersion + 1 };
}
