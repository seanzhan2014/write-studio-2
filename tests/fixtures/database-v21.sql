-- Frozen v21 schema baseline reconstructed without user data.
-- Keep this fixture independent of current declarations and initialization code.

CREATE TABLE ai_models (
    id TEXT PRIMARY KEY NOT NULL, provider_id TEXT REFERENCES ai_providers(id) ON DELETE RESTRICT,
    name TEXT NOT NULL, base_url TEXT NOT NULL, model_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '', reasoning_effort TEXT, temperature REAL, max_output INTEGER, max_input_characters INTEGER NOT NULL DEFAULT 60000,
    timeout_ms INTEGER NOT NULL, timeout_override_ms INTEGER, has_secret INTEGER NOT NULL DEFAULT 0, secret TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  , metadata_json TEXT NOT NULL DEFAULT '{}');

CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, adapter_kind TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 120000,
    has_secret INTEGER NOT NULL DEFAULT 0, secret TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE TABLE ai_tasks (
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
  , history_json TEXT NOT NULL DEFAULT '[]');

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE TABLE articles (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    article_type TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '', story_settings_json TEXT NOT NULL DEFAULT '{}', review_rules TEXT NOT NULL DEFAULT '', review_rule_items_json TEXT, chapter_naming_json TEXT NOT NULL DEFAULT '{}', outline_naming_json TEXT NOT NULL DEFAULT '{}', ai_generate_settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  , illustration_settings_json TEXT NOT NULL DEFAULT '{}');

CREATE TABLE chapters (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT NOT NULL, name_versions_json TEXT NOT NULL DEFAULT '[]', default_name_version_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(article_id, position)
  );

CREATE TABLE character_photo_jobs (
    id TEXT PRIMARY KEY, character_id TEXT NOT NULL, state TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, credential_hash TEXT NOT NULL,
    request_json TEXT, remote_task_id TEXT, output_index INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', photo_id TEXT,
    runner_id TEXT, lease_until TEXT, next_poll_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE TABLE characters (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE, aliases_json TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '', profile_json TEXT NOT NULL DEFAULT '{}', visual_json TEXT, photos_json TEXT, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, UNIQUE(article_id, name)
  );

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','stopped')),
    order_index INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, order_index)
  );

CREATE TABLE chat_request_claims (
    request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );

CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE, draft TEXT NOT NULL DEFAULT '',
    model_id TEXT, context_options_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
  );

CREATE TABLE contents (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL UNIQUE REFERENCES outlines(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '', content_name TEXT NOT NULL DEFAULT '', content_override INTEGER NOT NULL DEFAULT 0,
    source_version_id TEXT, current_version_id TEXT, default_version_id TEXT, outline_snapshot_json TEXT,
    manual_excellent INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  );

CREATE TABLE excellent_fragments (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES versions(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, selected_text TEXT NOT NULL,
    prefix_context TEXT NOT NULL DEFAULT '', suffix_context TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK(start_offset >= 0), CHECK(end_offset > start_offset)
  );

CREATE TABLE illustration_history (
    id TEXT PRIMARY KEY NOT NULL,
    outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '', model_name TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0, input_json TEXT NOT NULL DEFAULT '{}',
    asset_key TEXT, mime_type TEXT, revised_prompt TEXT, error_message TEXT,
    runner_id TEXT, lease_until TEXT, created_at TEXT NOT NULL, completed_at TEXT
  );

CREATE TABLE outlines (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, title TEXT NOT NULL,
    name_versions_json TEXT NOT NULL DEFAULT '[]', default_name_version_id TEXT,
    summary TEXT NOT NULL DEFAULT '', generate_instruction TEXT NOT NULL DEFAULT '', generate_options_json TEXT, settings_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'saved', title_generation_pending INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, illustration_options_json TEXT, UNIQUE(chapter_id, position)
  );

CREATE TABLE relationships (
    id TEXT PRIMARY KEY NOT NULL, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    character_low_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    character_high_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, CHECK(character_low_id <> character_high_id),
    UNIQUE(article_id, character_low_id, character_high_id)
  );

CREATE VIRTUAL TABLE search_documents USING fts5(
      article_id UNINDEXED, chapter_id UNINDEXED, outline_id UNINDEXED,
      entity_type UNINDEXED, entity_id UNINDEXED, title, body, tokenize='trigram'
    );

CREATE TABLE style_lab_artifacts (
    job_id TEXT NOT NULL REFERENCES style_lab_jobs(id) ON DELETE CASCADE,
    round_index INTEGER NOT NULL, scene_index INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY(job_id,round_index,scene_index)
  );

CREATE TABLE style_lab_jobs (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL,
    model_id TEXT NOT NULL, payload_json TEXT NOT NULL, error TEXT,
    owner TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE TABLE style_lab_rounds (
    job_id TEXT NOT NULL REFERENCES style_lab_jobs(id) ON DELETE CASCADE,
    round_index INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY(job_id,round_index)
  );

CREATE TABLE sync_change_log (
    database_version INTEGER PRIMARY KEY NOT NULL, change_json TEXT NOT NULL, created_at TEXT NOT NULL
  );

CREATE TABLE versions (
    id TEXT PRIMARY KEY NOT NULL, outline_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
    name TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, model_id TEXT, model_name TEXT, prompt TEXT,
    task_id TEXT, rewrite_source_id TEXT, rewrite_source_name TEXT, review_report_json TEXT, outline_snapshot_json TEXT, setting_snapshot_json TEXT, last_selected_at TEXT, manual_excellent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  , review_rule_snapshot_json TEXT);

CREATE INDEX ai_models_provider_idx ON ai_models(provider_id);

CREATE INDEX ai_tasks_article_created_idx ON ai_tasks(article_id, created_at DESC);

CREATE INDEX ai_tasks_outline_created_idx ON ai_tasks(outline_id, created_at DESC);

CREATE INDEX ai_tasks_status_created_idx ON ai_tasks(status, created_at);

CREATE INDEX articles_last_opened_idx ON articles(last_opened_at);

CREATE INDEX chapters_article_archived_position_idx ON chapters(article_id, archived, position);

CREATE INDEX character_photo_jobs_person_idx ON character_photo_jobs(character_id,created_at);

CREATE INDEX character_photo_jobs_state_idx ON character_photo_jobs(state,next_poll_at,created_at);

CREATE INDEX chat_request_claims_expires_idx ON chat_request_claims(expires_at);

CREATE INDEX chat_sessions_outline_updated_idx ON chat_sessions(outline_id, updated_at DESC);

CREATE INDEX excellent_fragments_outline_idx ON excellent_fragments(outline_id);

CREATE INDEX excellent_fragments_version_idx ON excellent_fragments(version_id);

CREATE INDEX illustration_history_outline_created_idx ON illustration_history(outline_id,created_at);

CREATE INDEX illustration_history_status_idx ON illustration_history(status);

CREATE INDEX outlines_article_chapter_archived_position_idx ON outlines(article_id, chapter_id, archived, position);

CREATE INDEX style_lab_jobs_article_idx ON style_lab_jobs(article_id,created_at DESC);

CREATE INDEX versions_outline_created_idx ON versions(outline_id, created_at DESC);

INSERT INTO app_settings(key,value_json,updated_at) VALUES('runtime_schema_version','21','2026-11-10');
