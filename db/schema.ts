import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  articleType: text("article_type").notNull().default(""),
  style: text("style").notNull().default(""),
  storySettingsJson: text("story_settings_json").notNull().default("{}"),
  reviewRules: text("review_rules").notNull().default(""),
  reviewRuleItemsJson: text("review_rule_items_json"),
  chapterNamingJson: text("chapter_naming_json").notNull().default("{}"),
  outlineNamingJson: text("outline_naming_json").notNull().default("{}"),
  illustrationSettingsJson: text("illustration_settings_json").notNull().default("{}"),
  aiGenerateSettingsJson: text("ai_generate_settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastOpenedAt: text("last_opened_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [index("articles_last_opened_idx").on(table.lastOpenedAt)]);

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  nameVersionsJson: text("name_versions_json").notNull().default("[]"),
  defaultNameVersionId: text("default_name_version_id"),
  settingsJson: text("settings_json").notNull().default("{}"),
  position: integer("position").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  uniqueIndex("chapters_article_position_unique").on(table.articleId, table.position),
  index("chapters_article_archived_position_idx").on(table.articleId, table.archived, table.position),
]);

export const outlines = sqliteTable("outlines", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  nameVersionsJson: text("name_versions_json").notNull().default("[]"),
  defaultNameVersionId: text("default_name_version_id"),
  summary: text("summary").notNull().default(""),
  generateInstruction: text("generate_instruction").notNull().default(""),
  illustrationOptionsJson: text("illustration_options_json"),
  generateOptionsJson: text("generate_options_json"),
  settingsJson: text("settings_json").notNull().default("{}"),
  position: integer("position").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  state: text("state").notNull().default("saved"),
  titleGenerationPending: integer("title_generation_pending", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  uniqueIndex("outlines_chapter_position_unique").on(table.chapterId, table.position),
  index("outlines_article_chapter_archived_position_idx").on(table.articleId, table.chapterId, table.archived, table.position),
]);

export const contents = sqliteTable("contents", {
  id: text("id").primaryKey(),
  outlineId: text("outline_id").notNull().unique().references(() => outlines.id, { onDelete: "cascade" }),
  text: text("text").notNull().default(""),
  contentName: text("content_name").notNull().default(""),
  contentOverride: integer("content_override", { mode: "boolean" }).notNull().default(false),
  sourceVersionId: text("source_version_id"),
  currentVersionId: text("current_version_id"),
  defaultVersionId: text("default_version_id"),
  outlineSnapshotJson: text("outline_snapshot_json"),
  manualExcellent: integer("manual_excellent", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
});

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  text: text("text").notNull(),
  source: text("source").notNull(),
  modelId: text("model_id"),
  modelName: text("model_name"),
  prompt: text("prompt"),
  taskId: text("task_id"),
  rewriteSourceId: text("rewrite_source_id"),
  rewriteSourceName: text("rewrite_source_name"),
  reviewReportJson: text("review_report_json"),
  reviewRuleSnapshotJson: text("review_rule_snapshot_json"),
  outlineSnapshotJson: text("outline_snapshot_json"),
  settingSnapshotJson: text("setting_snapshot_json"),
  manualExcellent: integer("manual_excellent", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [index("versions_outline_created_idx").on(table.outlineId, table.createdAt)]);

export const excellentFragments = sqliteTable("excellent_fragments", {
  id: text("id").primaryKey(),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  versionId: text("version_id").references(() => versions.id, { onDelete: "cascade" }),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  selectedText: text("selected_text").notNull(),
  prefixContext: text("prefix_context").notNull().default(""),
  suffixContext: text("suffix_context").notNull().default(""),
  sourceHash: text("source_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("excellent_fragments_outline_idx").on(table.outlineId),
  index("excellent_fragments_version_idx").on(table.versionId),
]);

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  description: text("description").notNull().default(""),
  profileJson: text("profile_json").notNull().default("{}"),
  visualJson: text("visual_json"),
  photosJson: text("photos_json"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [uniqueIndex("characters_article_name_unique").on(table.articleId, table.name)]);

export const relationships = sqliteTable("relationships", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  characterLowId: text("character_low_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  characterHighId: text("character_high_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [uniqueIndex("relationships_article_pair_unique").on(table.articleId, table.characterLowId, table.characterHighId)]);

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  draft: text("draft").notNull().default(""),
  modelId: text("model_id"),
  contextOptionsJson: text("context_options_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [index("chat_sessions_outline_updated_idx").on(table.outlineId, table.updatedAt)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("complete"),
  orderIndex: integer("order_index").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("chat_messages_session_order_unique").on(table.sessionId, table.orderIndex)]);

export const chatRequestClaims = sqliteTable("chat_request_claims", {
  requestId: text("request_id").primaryKey(),
  requestHash: text("request_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [index("chat_request_claims_expires_idx").on(table.expiresAt)]);

export const aiTasks = sqliteTable("ai_tasks", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  instruction: text("instruction").notNull(),
  modelId: text("model_id").notNull(),
  executionOrigin: text("execution_origin").notNull().default("local"),
  contextOptionsJson: text("context_options_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  resultText: text("result_text"),
  reviewStateJson: text("review_state_json"),
  resultVersionId: text("result_version_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  phase: text("phase"),
  historyJson: text("history_json").notNull().default("[]"),
  lastProgressAt: text("last_progress_at"),
  receivedCharacters: integer("received_characters"),
  timeoutMs: integer("timeout_ms"),
  runnerId: text("runner_id"),
  leaseUntil: text("lease_until"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (table) => [
  index("ai_tasks_status_created_idx").on(table.status, table.createdAt),
  index("ai_tasks_outline_created_idx").on(table.outlineId, table.createdAt),
  index("ai_tasks_article_created_idx").on(table.articleId, table.createdAt),
]);

export const aiProviders = sqliteTable("ai_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  adapterKind: text("adapter_kind").notNull().default("openai-compatible"),
  baseUrl: text("base_url").notNull(),
  timeoutMs: integer("timeout_ms").notNull().default(120000),
  hasSecret: integer("has_secret", { mode: "boolean" }).notNull().default(false),
  secret: text("secret"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const aiModels = sqliteTable("ai_models", {
  metadataJson: text("metadata_json").notNull().default("{}"),
  id: text("id").primaryKey(),
  providerId: text("provider_id").references(() => aiProviders.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  // Transitional shadow columns stay until every deployed database has
  // completed the provider backfill. Runtime reads these values from providers.
  baseUrl: text("base_url").notNull(),
  modelId: text("model_id").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  reasoningEffort: text("reasoning_effort"),
  temperature: real("temperature"),
  maxOutput: integer("max_output"),
  maxInputCharacters: integer("max_input_characters").notNull().default(60000),
  timeoutMs: integer("timeout_ms").notNull(),
  timeoutOverrideMs: integer("timeout_override_ms"),
  hasSecret: integer("has_secret", { mode: "boolean" }).notNull().default(false),
  secret: text("secret"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("ai_models_provider_idx").on(table.providerId)]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncChangeLog = sqliteTable("sync_change_log", {
  databaseVersion: integer("database_version").primaryKey(),
  changeJson: text("change_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const illustrationHistory = sqliteTable("illustration_history", {
  id: text("id").primaryKey(),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), status: text("status").notNull(),
  prompt: text("prompt").notNull().default(""), excerpt: text("excerpt").notNull().default(""),
  style: text("style").notNull().default(""), modelId: text("model_id").notNull().default(""),
  modelName: text("model_name").notNull().default(""), archived: integer("archived").notNull().default(0),
  inputJson: text("input_json").notNull().default("{}"), assetKey: text("asset_key"),
  mimeType: text("mime_type"), revisedPrompt: text("revised_prompt"), errorMessage: text("error_message"),
  runnerId: text("runner_id"), leaseUntil: text("lease_until"),
  createdAt: text("created_at").notNull(), completedAt: text("completed_at"),
}, (table) => [
  index("illustration_history_outline_created_idx").on(table.outlineId, table.createdAt),
  index("illustration_history_status_idx").on(table.status),
]);
