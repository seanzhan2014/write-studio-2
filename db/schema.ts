import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  articleType: text("article_type").notNull().default(""),
  style: text("style").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastOpenedAt: text("last_opened_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [index("articles_last_opened_idx").on(table.lastOpenedAt)]);

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
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
  summary: text("summary").notNull().default(""),
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
  outlineSnapshotJson: text("outline_snapshot_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("versions_outline_created_idx").on(table.outlineId, table.createdAt)]);

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  description: text("description").notNull().default(""),
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

export const aiTasks = sqliteTable("ai_tasks", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  outlineId: text("outline_id").notNull().references(() => outlines.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  instruction: text("instruction").notNull(),
  modelId: text("model_id").notNull(),
  contextOptionsJson: text("context_options_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  resultText: text("result_text"),
  resultVersionId: text("result_version_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  phase: text("phase"),
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

export const aiModels = sqliteTable("ai_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  modelId: text("model_id").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  temperature: real("temperature"),
  maxOutput: integer("max_output"),
  timeoutMs: integer("timeout_ms").notNull(),
  hasSecret: integer("has_secret", { mode: "boolean" }).notNull().default(false),
  secret: text("secret"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
