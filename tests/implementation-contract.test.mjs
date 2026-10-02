import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("database schema contains every specification entity", async () => {
  const schema = await read("db/schema.ts");
  for (const entity of ["articles", "chapters", "outlines", "contents", "versions", "characters", "relationships", "chatSessions", "chatMessages", "aiTasks", "aiProviders", "aiModels", "appSettings"]) {
    assert.match(schema, new RegExp(`export const ${entity}\\b`), entity);
  }
});

test("character records keep compact description and profile storage", async () => {
  const schema = await read("db/schema.ts");
  const runtime = await read("db/runtime.ts");
  const state = await read("app/studio-state.tsx");
  const app = await read("app/WriterStudioApp.tsx");
  const characterSchema = schema.match(/export const characters[\s\S]*?export const relationships/)?.[0] ?? "";
  for (const field of ["name", "aliasesJson", "description", "profileJson", "archived"]) assert.match(characterSchema, new RegExp(`\\b${field}\\b`));
  for (const removed of ["role", "appearance", "personality", "abilities", "background", "color"]) assert.doesNotMatch(characterSchema, new RegExp(`\\b${removed}\\b`));
  assert.match(runtime, /INSERT INTO characters\(id,article_id,name,aliases_json,description,profile_json,archived,created_at,updated_at,revision\)\s*VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/);
  assert.match(state, /description: string/);
  assert.match(app, /character-description-input/);
});

test("empty article structures remain empty and destructive controls match the specification", async () => {
  const state = await read("app/studio-state.tsx");
  const api = await read("app/api/[...segments]/route.ts");
  const app = await read("app/WriterStudioApp.tsx");
  assert.doesNotMatch(state, /articles\.length <= 1|chapters\.length <= 1|replacementId = makeId\("outline"\)/);
  assert.doesNotMatch(api, /至少保留一篇文章|至少保留一个章节/);
  assert.match(app, /清除全部业务数据/);
  assert.doesNotMatch(app, /恢复演示数据/);
  const mobileMenu = app.match(/function OutlineActionSheet[\s\S]*?function DesktopOutlineMenu/)?.[0] ?? "";
  assert.doesNotMatch(mobileMenu, /label: "重命名"|label: "在下方新建"/);
  assert.match(mobileMenu, /key: "delete"[\s\S]*label: "删除大纲"/);
});

test("writing workspace menu supports named save-as versions", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  assert.match(app, /function saveAsCurrentContent/);
  assert.match(app, /另存为正文版本/);
  assert.match(app, /resolvedOutlineContentName\(studio\.currentOutline\)/);
  assert.match(app, /const saved = await studio\.saveNow\(\);[\s\S]*已另存为/);
});

test("snapshot inserts name every migration-sensitive column explicitly", async () => {
  const runtime = await read("db/runtime.ts");
  assert.match(runtime, /INSERT INTO characters\(id,article_id,name,aliases_json,description,profile_json,archived,created_at,updated_at,revision\)/);
  assert.match(runtime, /INSERT INTO relationships\(id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision\)/);
  assert.match(runtime, /INSERT INTO chat_sessions\(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision\)/);
  assert.match(runtime, /INSERT INTO chat_messages\(id,session_id,role,content,status,order_index,created_at\)/);
  assert.doesNotMatch(runtime, /INSERT INTO (?:characters|relationships|chat_sessions|chat_messages) VALUES/);
  assert.doesNotMatch(runtime, /INSERT INTO (?:characters|relationships|chat_sessions|chat_messages)_next SELECT \*/);
});

test("schema-extensible inserts name their columns explicitly", async () => {
  const runtime = await read("db/runtime.ts");
  const ai = await read("db/ai.ts");
  assert.match(runtime, /INSERT INTO outlines\(id,article_id,chapter_id,title,name_versions_json,default_name_version_id,summary,generate_instruction,settings_json,position,archived,state,title_generation_pending,created_at,updated_at,revision\)/);
  assert.match(runtime, /INSERT INTO contents\(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision\)/);
  assert.match(ai, /INSERT INTO ai_providers\(id,name,adapter_kind,base_url,timeout_ms,has_secret,secret,created_at,updated_at\)/);
  assert.match(ai, /INSERT INTO ai_models\(id,provider_id,name,base_url,model_id,system_prompt,temperature,max_output,max_input_characters,timeout_ms,timeout_override_ms,has_secret,secret,created_at,updated_at,reasoning_effort\)/);
  assert.doesNotMatch(ai, /INSERT INTO ai_models VALUES/);
});

test("business data uses server SQLite with revision conflicts and interrupted-draft candidates", async () => {
  const state = await read("app/studio-state.tsx");
  const runtime = await read("db/runtime.ts");
  assert.match(state, /fetchFromServer\("\/api\/state"/);
  assert.match(state, /sessionStorage/);
  assert.doesNotMatch(state, /localStorage\.setItem\(legacyStorageKey,\s*JSON\.stringify\(data\)/);
  assert.match(runtime, /state_revision/);
  assert.match(runtime, /conflict:\s*true/);
  assert.match(runtime, /CREATE VIRTUAL TABLE IF NOT EXISTS search_documents USING fts5/);
});

test("database initialization persists a schema marker and batches cold-start DDL", async () => {
  const runtime = await read("db/runtime.ts");
  const migration = await read("drizzle/0014_runtime_schema_fast_path.sql");
  assert.match(runtime, /RUNTIME_SCHEMA_VERSION_KEY = "runtime_schema_version"/);
  assert.match(runtime, /if \(await hasCurrentRuntimeSchema\(db\)\) return/);
  assert.match(runtime, /db\.batch\(schemaStatements\.map\(\(statement\) => db\.prepare\(statement\)\)\)/);
  assert.match(runtime, /INSERT OR REPLACE INTO app_settings\(key, value_json, updated_at\) VALUES\(\?, \?, \?\)/);
  assert.match(migration, /runtime_schema_version/);
  assert.match(migration, /ON CONFLICT\(`key`\) DO UPDATE/);
});

test("device snapshots revalidate by database identity and revision without reloading the full library", async () => {
  const route = await read("app/api/state/route.ts");
  const state = await read("app/studio-state.tsx");
  const runtime = await read("db/runtime.ts");
  const offline = await read("lib/offline-store.ts");
  const serviceWorker = await read("public/sw.js");
  assert.match(runtime, /export async function readStudioStateIdentity\(\)/);
  assert.match(route, /if \(matchesEtag\(request, etag\)\) return new Response\(null, \{ status: 304/);
  assert.match(route, /X-Writer-Studio-Database-Id/);
  assert.match(state, /readOfflineStudioSnapshot\(\)/);
  assert.match(state, /"If-None-Match": studioStateEtag\(stateIdentityRef\.current\)/);
  assert.match(state, /if \(response\.status === 304\) return true/);
  assert.match(offline, /const databaseName = "writer-studio-offline-v1"/);
  assert.match(offline, /baseData: StudioData/);
  assert.match(offline, /localData: StudioData/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /caches\.match\("\/", \{ ignoreVary: true \}\)/);
});

test("offline server actions fail before issuing a network request", async () => {
  const network = await read("lib/browser-network.ts");
  const state = await read("app/studio-state.tsx");
  const app = await read("app/WriterStudioApp.tsx");
  assert.match(network, /navigator\.onLine === false/);
  assert.match(network, /requireBrowserOnline\(\);[\s\S]*globalThis\.fetch/);
  assert.match(network, /connectivityTimeoutMs[\s\S]*globalThis\.fetch\("\/api\/connectivity"/);
  assert.match(state, /if \(browserIsOffline\(\)\) \{[\s\S]*persistOfflineCache\(snapshot\)/);
  assert.match(app, /fetchServerAction\("\/api\/ai\/tasks"/);
  assert.match(app, /if \(browserIsOffline\(\)\) \{ onNotice\(OFFLINE_OPERATION_MESSAGE\); return; \}/);
});

test("ordinary saves and automatic cloud uploads use bounded change sets", async () => {
  const state = await read("app/studio-state.tsx");
  const mutations = await read("app/api/state/mutations/route.ts");
  const runtime = await read("db/runtime.ts");
  const sync = await read("db/sync.ts");
  const changes = await read("lib/studio-changes.ts");
  assert.match(state, /diffStudioData\(base, durable\)/);
  assert.match(state, /fetchFromServer\("\/api\/state\/mutations"/);
  assert.match(mutations, /applyStudioChanges/);
  assert.match(changes, /from "fast-deep-equal"/);
  assert.match(changes, /version: 2/);
  assert.match(changes, /outlines: changedOutlines/);
  assert.match(runtime, /for \(const item of changes\.outlines\.patch \?\? \[\]\)/);
  assert.match(runtime, /generate_instruction/);
  assert.match(runtime, /INSERT INTO sync_change_log/);
  assert.match(sync, /remoteApplyChanges/);
  assert.match(sync, /createPendingChanges/);
  assert.match(sync, /const snapshot = await createCurrentSnapshot\(\)[\s\S]*remoteReplace\(config, snapshot, stored\.lastCloudVersion, operationId\)/, "a full snapshot remains available only as a gap-recovery fallback");
});

test("synthetic name and chat metadata use stable database creation times", async () => {
  const [runtime, names] = await Promise.all([
    read("db/runtime.ts"),
    read("app/api/ai/names/route.ts"),
  ]);
  assert.match(runtime, /createdAt: String\(outlineRow\.created_at\), updatedAt: String\(outlineRow\.updated_at\)/);
  assert.match(runtime, /outlineRow\.default_name_version_id,\s*String\(outlineRow\.created_at\)/);
  assert.match(runtime, /chapterRow\.default_name_version_id,\s*String\(chapterRow\.created_at\)/);
  assert.match(names, /chapter\.default_name_version_id, String\(chapter\.created_at\)/);
  assert.match(names, /outline\.default_name_version_id, String\(outline\.created_at\)/);
});

test("cloud sync uses a database-version baseline and manual overwrite escape hatches", async () => {
  const sync = await read("db/sync.ts");
  const ai = await read("db/ai.ts");
  const runtime = await read("db/runtime.ts");
  const state = await read("app/studio-state.tsx");
  const app = await read("app/WriterStudioApp.tsx");
  assert.match(runtime, /database_version/);
  assert.match(sync, /lastCloudVersion/);
  assert.match(sync, /canAutomaticallyUpload\(policy\)/);
  assert.match(sync, /OAI-Sites-Authorization/);
  assert.match(sync, /writeRecoverySnapshot\("sync-local-before-pull"/);
  assert.match(sync, /writeRecoverySnapshot\("sync-cloud-before-push"/);
  assert.match(sync, /sync_auto_upload/);
  assert.match(sync, /shouldDisableAutomaticUpload\(state\)[\s\S]*sync_auto_upload = "0"/);
  assert.match(sync, /sync_pending_operation_id/);
  assert.match(sync, /sync_last_applied_operation_id/);
  assert.match(sync, /wasSyncOperationApplied/);
  assert.match(sync, /revision_busy/);
  assert.match(sync, /pendingSyncOperationId/);
  assert.match(runtime, /isStudioChangesEmpty/);
  assert.match(sync, /modelScope/);
  assert.match(ai, /exportModelsForSync/);
  assert.match(ai, /replaceModelsFromSync/);
  assert.match(ai, /plainSecret[\s\S]*encryptAiSecret/);
  assert.match(state, /\/api\/sync\/upload/);
  assert.match(app, /从云端取回/);
  assert.match(app, /复制到云端/);
  assert.match(app, /同时覆盖大模型配置/);
  assert.match(app, /同时覆盖 API Key \/ Secret/);
  assert.match(app, /本地保存后自动异步复制到云端/);
  assert.match(app, /云端版本 = 同步基线/);
});

test("task execution ownership keeps cloud reads from resuming local work", async () => {
  const schema = await read("db/schema.ts");
  const runtime = await read("db/runtime.ts");
  const sync = await read("db/sync.ts");
  const executor = await read("app/api/ai/tasks/[taskId]/execute/route.ts");
  const taskState = await read("app/api/ai/tasks/[taskId]/state/route.ts");
  const app = await read("app/WriterStudioApp.tsx");
  assert.match(schema, /executionOrigin: text\("execution_origin"\)\.notNull\(\)\.default\("local"\)/);
  assert.match(runtime, /execution_origin TEXT NOT NULL DEFAULT 'local'/);
  assert.match(executor, /initialTask\.executionOrigin !== executionOrigin/);
  assert.match(executor, /WHERE key='state_revision'/, "claiming a task advances only the runtime revision");
  assert.match(app, /task\.executionOrigin === currentStudio\.executionOrigin/);
  assert.match(taskState, /body\.action !== "transfer"/);
  assert.match(sync, /reason: "active_tasks"/);
  assert.match(sync, /完成后再自动上传/);
});

test("explicit mobile outline and AI context decisions are retained", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const executor = await read("app/api/ai/tasks/[taskId]/execute/route.ts");
  const ai = await read("db/ai.ts");
  const selector = await read("lib/ai-context.ts");
  assert.match(app, /useSensor\(TouchSensor, \{ activationConstraint: \{ delay: 420, tolerance: 10 \} \}\)/);
  assert.match(app, /useSensor\(KeyboardSensor, \{ coordinateGetter: sortableKeyboardCoordinates \}\)/);
  assert.match(app, /<DragOverlay/);
  assert.match(app, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(app, /复制大纲内容/);
  assert.doesNotMatch(app, /保存大纲[^<]*<\/button>.*OutlineActionSheet/s);
  assert.match(executor, /task\.target === "正文" \? "content"/);
  assert.match(selector, /visibleOutlines\.slice\(0, currentIndex\)/);
  assert.match(selector, /if \(chapter\.archived\)/);
  assert.match(selector, /if \(outline\.archived\)/);
  assert.match(ai, /type PromptSource = SelectedAiContext/);
  assert.doesNotMatch(ai, /不得推测或声称读取了后续大纲|boundary="before-current-only"/);
  assert.match(ai, /function composeSystemPrompt/);
  assert.match(ai, /用户配置的附加指令/);
  assert.match(ai, /instruction_policy="reference-data-only"/);
  assert.match(ai, /\.\.\.fitted\.history/);
  assert.match(ai, /previous_content_tail maximum="3000"/);
  assert.match(ai, /function renderChapterOutlines/);
  assert.match(ai, /<chapter_outlines>/);
  assert.match(selector, /chapterOutlines: kind === "chapter-title" \? chapter\.outlines\.filter\(\(item\) => !item\.archived\)/);
  assert.match(app, /selectAiContext\(\{ articles: \[article\] \}/);
  assert.doesNotMatch(ai, /text\.slice\(0, 30000\)[\s\S]*text\.slice\(-30000\)/);
});

test("desktop and mobile outline sorting share touch-safe cross-chapter behavior", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const state = await read("app/studio-state.tsx");
  assert.doesNotMatch(app, /className="mobile-primary-nav"|label="打开文章导航"/);
  assert.match(app, /label="AI 任务"[^>]+className="mobile-header-action"/);
  assert.match(app, /label="设置"[^>]+className="mobile-header-action"/);
  assert.match(app, /aria-label="文章功能"[\s\S]*章节与大纲[\s\S]*全文编辑[\s\S]*搜索[\s\S]*文章资料/);
  assert.doesNotMatch(app, /全章节编辑|全大纲编辑|只看标题/);
  assert.match(app, /aria-label=\{`切换文章，当前 \$\{articleTitle\}`\}/);
  assert.match(app, /useSensor\(TouchSensor, \{ activationConstraint: \{ delay: 420, tolerance: 10 \} \}\)/);
  assert.match(app, /<DndContext[\s\S]*sensors=\{sensors\}/);
  assert.match(app, /useSortable\(\{ id: item\.id, data: \{ type: "outline", outlineId: item\.id \} \}\)/);
  assert.match(app, /className="outline-drag-handle"/);
  assert.match(app, /function DesktopChapterDropRow/);
  assert.match(app, /function MobileChapterDropHeader/);
  assert.match(app, /function EmptyChapterDropZone/);
  assert.match(app, /studio\.moveOutline\(sourceId, targetId, placement\)/);
  assert.match(app, /studio\.moveOutlineToChapter\(sourceId, chapterId\)/);
  assert.match(app, /onMoveUp=\{previousActionOutline/);
  assert.match(app, /onMoveDown=\{nextActionOutline/);
  assert.doesNotMatch(app, /document\.elementFromPoint|callbacks\.current\.onDragOver/);
  assert.match(state, /moveOutlineBetweenChapters\(article\.chapters, sourceId, targetId, placement\)/);
  assert.match(state, /moveOutlineToChapterEnd\(article\.chapters, outlineId, chapterId\)/);
  assert.doesNotMatch(app, /整理章节与大纲顺序|gesture-tip|sort-outline-button/);
});

test("full outline and full content editors use one continuous auto-growing document", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const styles = await read("app/globals.css");
  const settings = await read("app/ui/story-settings-editor.tsx");
  assert.match(app, /pathname\.endsWith\("\/chapters\/edit-all"\)\) return "outline-edit"/);
  assert.match(app, /"outline-edit": `\$\{base\}\/outlines\/edit-all`/);
  assert.doesNotMatch(app, /"chapter-edit":/);
  assert.match(app, /read: `\$\{base\}\/edit`/);
  assert.match(app, /function ContinuousDocumentEditor/);
  assert.match(app, /function AutoGrowTextarea/);
  assert.match(app, /const mirror = node\.cloneNode\(false\) as HTMLTextAreaElement/);
  assert.match(app, /const nextHeight = Math\.max\(mirror\.scrollHeight, 34\)/);
  assert.match(app, /node\.style\.height = `\$\{nextHeight\}px`/);
  assert.match(app, /mode === "outline" \? studio\.updateOutline/);
  assert.match(app, /onContentBlur=\{mode === "content" \? \(\) => commitContent\(item\.id\)/);
  assert.match(app, /studio\.stageContentDraft\(outlineId, text\)/);
  assert.match(app, /studio\.saveCurrentContent\(outlineId, next, editSourceVersionIdsRef\.current\[outlineId\]\)/);
  assert.match(app, /async function copyAllOutlines\(\)/);
  assert.match(app, /copyTextToClipboard\(text\)/);
  assert.match(app, />复制<\/Button>/);
  assert.match(app, /<ArticleSettingsInline \/>/);
  assert.match(app, /<ScopedSettingsInline level="chapter"/);
  assert.match(app, /<ScopedSettingsInline level="outline"/);
  assert.match(app, /function UnifiedNamingEditor/);
  assert.match(app, /className="continuous-outline-primary-actions"/);
  assert.match(app, /function ContinuousOutlinePropertiesDrawer/);
  assert.match(app, /className="continuous-outline-action-menu"/);
  assert.doesNotMatch(app, /className="continuous-outline-secondary-actions"/);
  const unifiedEditor = app.match(/function ContinuousDocumentEditor[\s\S]*?function SearchPage/)?.[0] ?? "";
  assert.match(unifiedEditor, /setOutlinePanel/);
  assert.match(styles, /\.continuous-outline-primary-actions[\s\S]*flex-wrap: nowrap/);
  assert.match(styles, /\.continuous-outline-properties-tabs/);
  assert.match(settings, /STORY_FIELD_KEYS\.filter\(\(key\) => showInherited \|\| Boolean\(settings\.story\[key\]\)\)/);
  assert.match(settings, /open=\{Boolean\(override\)\}/);
  assert.match(settings, /查看继承内容/);
  assert.match(await read("app/studio-state.tsx"), /saveCurrentContent[\s\S]*currentVersionId: null/);
  assert.match(app, /className="continuous-drag-handle"/);
  assert.match(styles, /\.continuous-text-editor[\s\S]*overflow: hidden/);
  assert.match(styles, /\.continuous-chapter[\s\S]*content-visibility: auto/);
  assert.doesNotMatch(app, /全文阅读/);
});

test("each body in full content editing can preview and independently set current and default", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const styles = await read("app/globals.css");
  assert.match(app, /aria-label=\{`选择正文版本：\$\{displayTitle\}`\}/);
  assert.match(app, /selectedVersionId=\{mode === "content" \? versionSelections\[item\.id\]/);
  assert.match(app, /function selectContentVersion\(item: Outline, versionId\?: string\)/);
  assert.match(app, /studio\.setCurrentVersion\(item\.id, version\.id\)/);
  assert.match(app, /studio\.setDefaultVersion\(item\.id, version\.id\)/);
  assert.match(app, /onSetCurrentVersion=\{mode === "content"/);
  assert.match(app, /onSetDefaultVersion=\{mode === "content"/);
  assert.match(styles, /\.continuous-version-trigger/);
  assert.match(styles, /\.continuous-version-option/);
});

test("full content editing exposes one-call chapter AI Review with named current bodies", async () => {
  const [app, state, schema, runtime, ai, route] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("db/schema.ts"),
    read("db/runtime.ts"),
    read("db/ai.ts"),
    read("app/api/ai/review/route.ts"),
  ]);
  assert.match(app, /name="review" label="AI Review"/);
  assert.match(app, /function AiReviewDialog/);
  assert.match(app, /ArticleReviewRulesPage/);
  assert.match(state, /reviewPresets: string\[\]/);
  assert.match(state, /source: "手动" \| "AI Generate" \| "AI Chat" \| "AI Review"/);
  assert.match(schema, /contentName: text\("content_name"\)/);
  assert.match(runtime, /version\.source === "AI Review" \? "ai-review"/);
  const reviewFunction = ai.match(/export async function reviewChapter[\s\S]*?\r?\n}\r?\n\r?\nfunction localOutlineTitle/)?.[0] ?? "";
  assert.equal((reviewFunction.match(/await upstream\(/g) ?? []).length, 1);
  assert.match(route, /aiReviewContentName\(outline\)/);
  assert.match(route, /outline\.currentVersionId = versionId/);
  assert.match(route, /source: "AI Review"/);
});

test("empty outline titles derive a single-line display name from outline content", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const state = await read("app/studio-state.tsx");
  const api = await read("app/api/[...segments]/route.ts");
  const runtime = await read("db/runtime.ts");
  const title = await read("lib/outline-title.ts");
  assert.match(title, /replace\(\/\\s\+\/g, " "\)/);
  assert.match(title, /slice\(0, MAX_OUTLINE_TITLE_LENGTH\)/);
  assert.match(title, /title === legacyUntitledOutline \? "" : title/);
  assert.match(app, /placeholder=\{displayTitle\}/);
  assert.match(app, /outlineDisplayTitle\(studio\.currentOutline\)/);
  assert.doesNotMatch(app, /未命名大纲/);
  assert.doesNotMatch(state, /outline\([^\n]+"未命名大纲"/);
  assert.doesNotMatch(api, /title: "未命名大纲"/);
  assert.match(runtime, /outlineDisplayTitle\(\{ title: normalizedTitle, plan: outline\.plan \}\)/);
});

test("shared component framework owns responsive overlays and form controls", async () => {
  const [pkg, layout, app, dataTransfer, overlays, styles, vite, overlayGuide, pullRequestTemplate] = await Promise.all([
    read("package.json"),
    read("app/layout.tsx"),
    read("app/WriterStudioApp.tsx"),
    read("app/data-transfer.tsx"),
    read("app/ui/overlays.tsx"),
    read("app/globals.css"),
    read("vite.config.ts"),
    read("docs/mobile-overlay-contract.md"),
    read(".github/pull_request_template.md"),
  ]);
  for (const dependency of ["@mantine/core", "@mantine/hooks", "@dnd-kit/core", "@dnd-kit/sortable"]) assert.match(pkg, new RegExp(dependency.replace("/", "\\/")));
  assert.match(layout, /@mantine\/core\/styles\.css/);
  assert.match(layout, /<MantineProvider/);
  for (const primitive of ["MobileActionSheet", "ScrollableDrawer", "ResponsiveModal"]) assert.match(overlays, new RegExp(`export function ${primitive}`));
  assert.doesNotMatch(`${app}\n${dataTransfer}`, /<(?:Modal|Drawer)\b/);
  assert.doesNotMatch(app, /className="(?:modal-layer|outline-sheet-layer|desktop-action-layer)"/);
  assert.match(app, /<ResponsiveModal[\s\S]*opened=\{providerFormOpen\}/);
  assert.match(app, /<ResponsiveModal[\s\S]*opened=\{modelFormOpen\}/);
  assert.match(app, /function VersionDrawer[\s\S]*<ScrollableDrawer/);
  assert.match(app, /function TaskPanel[\s\S]*<ScrollableDrawer/);
  assert.match(app, /function ChapterActionSheet[\s\S]*<MobileActionSheet/);
  assert.match(app, /title="本次生成上下文"[\s\S]*position=\{compact \? "bottom" : "right"\}/);
  assert.match(overlays, /data-ui-overlay="drawer"/);
  assert.match(overlays, /data-ui-overlay="modal"/);
  assert.match(overlays, /data-ui-draggable=\{draggable \? "true" : "false"\}/);
  assert.match(overlays, /function useModalDrag/);
  assert.match(overlays, /data-ui-overlay-scroll/);
  assert.match(styles, /\.ws-overlay-surface \{[\s\S]*max-height: calc\(100dvh/);
  assert.match(styles, /\.ws-overlay-body--scroll,[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.ws-overlay-body--contained \{[\s\S]*overflow: hidden/);
  assert.match(styles, /\.ws-modal-draggable \{[\s\S]*translate: var\(--ws-modal-drag-x/);
  assert.match(styles, /\.studio-shell,[\s\S]*\.main-area \{[\s\S]*height: 100dvh;/);
  for (const viewport of ["390 × 844", "320 × 568", "667 × 375", "390 × 480"]) {
    assert.match(overlayGuide, new RegExp(viewport));
    assert.match(pullRequestTemplate, new RegExp(viewport.replace(" × ", "×")));
  }
  assert.match(vite, /exclude: \["@mantine\/core", "@mantine\/hooks"\]/);
});

test("passive explanatory copy is removed from the interface", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  for (const copy of ["左滑管理", "这里只生成正文", "只提供建议", "这些设置只影响", "创建后会自动生成", "也可以继续手动填写", "应用前可以继续编辑"]) {
    assert.doesNotMatch(app, new RegExp(copy));
  }
  for (const alwaysVisibleClass of ["generate-review-settings", "generate-advanced-options", "ai-review-article-rules", "ai-review-advanced", "structure-reasoning"]) {
    assert.doesNotMatch(app, new RegExp(`<details className="${alwaysVisibleClass}"`));
  }
  assert.match(app, /<form className="name-version-add"/);
  assert.doesNotMatch(app, /<details className="name-version-add-panel"/);
});

test("rewrite versions retain a direct source link and report missing originals", async () => {
  const schema = await read("db/schema.ts");
  const runtime = await read("db/runtime.ts");
  const taskRoute = await read("app/api/ai/tasks/route.ts");
  const executor = await read("app/api/ai/tasks/[taskId]/execute/route.ts");
  const app = await read("app/WriterStudioApp.tsx");
  assert.match(schema, /rewriteSourceId: text\("rewrite_source_id"\)/);
  assert.match(runtime, /rewriteSourceName: row\.rewrite_source_name/);
  assert.match(taskRoute, /rewriteSourceId = source\.version_id \? String\(source\.version_id\) : String\(source\.content_id\)/);
  assert.match(executor, /rewriteSourceId: task\.contextOptions\?\.contentMode === "rewrite"/);
  assert.match(app, /改写自：\{version\.rewriteSourceName \|\| "原正文"\}/);
  assert.match(app, /原正文已删除，无法打开/);
});

test("provider settings own credentials and server-side model discovery", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const ai = await read("db/ai.ts");
  const styles = await read("app/globals.css");
  assert.match(app, /openEditProvider\(provider\)/);
  assert.match(app, /openEditModel\(model\)/);
  assert.match(app, /<SettingSection title="Providers">/);
  assert.match(app, /models\.filter\(\(model\) => model\.providerId === provider\.id\)/);
  assert.match(app, /className="provider-model-row"/);
  assert.match(app, /aria-label=\{`添加模型到 \$\{provider\.name\}`\}/);
  assert.doesNotMatch(app, /<SettingSection title="Provider 设置">|<SettingSection title="大模型设置">/);
  assert.match(app, /Fetch 模型/);
  assert.match(app, /选择获取到的大模型/);
  assert.match(app, /<MultiSelect[\s\S]*?className="discovered-model-select"/);
  assert.match(app, /withCheckIcon/);
  assert.match(app, /多个模型 ID 使用逗号分隔/);
  assert.match(app, /\/api\/models\/bulk/);
  assert.match(app, /model-form-error/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /aria-label="Provider 超时（分钟）"/);
  assert.match(app, /timeoutMs: Math\.round\(providerTimeoutMinutes \* 60_000\)/);
  assert.doesNotMatch(app, /超时（毫秒）/);
  assert.match(app, /className="model-card-actions provider-model-actions"/);
  assert.match(styles, /\.model-card-actions \{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.provider-model-actions\.model-card-actions \{[\s\S]*grid-column: auto/);
  assert.match(styles, /\.provider-model-header,[\s\S]*\.provider-model-row[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.model-form \{[\s\S]*padding: 18px 20px 20px/);
  assert.match(styles, /\.model-form-modal \.model-form-actions[\s\S]*position: sticky/);
  assert.match(ai, /\/models/);
  assert.match(ai, /Authorization: `Bearer \$\{secret\}`/);
  assert.match(ai, /readProviderSecret\(model\.providerId\)/);
  assert.doesNotMatch(app.match(/function ModelSettings[\s\S]*?function TaskSettings/)?.[0] ?? "", /\/api\/models\/discover|\/api\/models\/[^`]+\/secret/);
  assert.match(ai, /本机 3002 服务无法访问模型 API/);
  assert.match(ai, /if \(!normalized\) return null/);
});

test("AI Generate keeps the prompt primary and automatically sets completed bodies as current", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const state = await read("app/studio-state.tsx");
  const runtime = await read("db/runtime.ts");
  const executor = await read("app/api/ai/tasks/[taskId]/execute/route.ts");
  const styles = await read("app/globals.css");
  assert.match(app, /generate-quick-prompts/);
  assert.match(app, /正文目标字数/);
  assert.match(app, /全新生成/);
  assert.match(app, /改写正文/);
  assert.match(app, /续写正文/);
  assert.match(app, /thumbLabel="原文保留度"/);
  assert.match(app, /控制改写幅度，不代表精确相似度/);
  assert.match(app, /contentMode: generationMode/);
  assert.match(app, /rewriteRetention/);
  assert.match(app, /补充指令（可选）/);
  assert.match(app, /const storedPromptAtOpen = studio\.currentOutline\.generateInstruction/);
  assert.match(app, />保存指令<\/Button>/);
  assert.match(state, /generateInstruction: task\.prompt\.slice\(0, 20000\)/);
  assert.match(runtime, /generate_instruction TEXT NOT NULL DEFAULT ''/);
  assert.doesNotMatch(app, /if \(!taskId\)[^\n]+\n\s*setPrompt\(""\)/);
  assert.match(app, /GeneratePresetDialog/);
  assert.match(app, /aria-label="生成使用的大纲内容"/);
  assert.match(app, /studio\.saveOutlinePlan\(studio\.currentOutline\.id, outlinePlanDraft\)/);
  assert.doesNotMatch(app, /onBlur=\{\(\) => void studio\.saveNow\(\)\}/);
  assert.match(state, /generateTargetWords: number/);
  assert.match(state, /generatePresets: string\[\]/);
  assert.match(state, /contentMode\?: ContentGenerationMode/);
  assert.match(state, /rewriteRetention\?: RewriteRetentionLevel/);
  assert.match(runtime, /context_options_json/);
  const ai = await read("db/ai.ts");
  assert.match(ai, /appendContinuation/);
  assert.match(ai, /<rewrite_retention level=/);
  assert.match(ai, /REWRITE_RETENTION_INSTRUCTIONS/);
  for (const removedPreset of ["续写当前场景", "加强冲突", "补充细节", "调整语气", "收束本段"]) assert.doesNotMatch(app, new RegExp(`const quickPrompts[\\s\\S]*${removedPreset}`));
  assert.match(app, /本次生成上下文/);
  assert.doesNotMatch(app, /候选版本对比/);
  assert.doesNotMatch(app, /className="generation-card candidate-card"/);
  assert.match(app, /完成后更新当前正文，旧版本保留/);
  assert.match(app, /查看全部 AI 任务/);
  assert.doesNotMatch(app, /约 3,840 字/);
  assert.doesNotMatch(executor, /found\.outline\.defaultVersionId = version\.id/);
  assert.match(executor, /found\.outline\.currentVersionId = version\.id/);
  assert.doesNotMatch(executor, /found\.outline\.content = version\.content/);
  assert.match(executor, /AI Generate 前/);
  assert.match(executor, /hasEarlierBodyTask/);
  assert.match(app, /selectedTask\.target !== "正文"/);
  assert.match(app, /打开生成版本/);
  assert.match(app, /size=\{compact \? "calc\(100dvh - 10px\)" : 920\}/);
  assert.match(runtime, /version\.model/);
  assert.match(runtime, /version\.prompt/);
  assert.match(runtime, /version\.taskId/);
  assert.match(styles, /\.generate-context-scrim/);
  assert.match(styles, /\.generate-preset-dialog \{[\s\S]*background: var\(--surface\);[\s\S]*box-shadow:/);
  assert.match(styles, /\.generate-outline-editor textarea/);
});

test("mobile Generate edits use an explicit draft save and insecure HTTP clipboard fallback", async () => {
  const [app, state, merge, styles] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("app/studio-conflict.mjs"),
    read("app/globals.css"),
  ]);
  assert.match(app, /async function copyTextToClipboard/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /document\.execCommand\("copy"\)/);
  assert.doesNotMatch(app, /onClick=\{\(\) => (?:void )?navigator\.clipboard\.writeText/);
  assert.match(app, /const \[outlinePlanDraft, setOutlinePlanDraft\]/);
  assert.match(app, /value=\{outlinePlanDraft\}/);
  assert.doesNotMatch(app, /id="generate-outline-plan"[\s\S]{0,700}onBlur=\{\(\) => void studio\.saveNow\(\)\}/);
  assert.match(app, /createServerTask\(studio, \{/);
  assert.match(app, /currentPlan: outlinePlanDraft/);
  const generateSubmit = app.match(/const submit = useCallback[\s\S]*?useEffect\(\(\) => \{/)[0];
  assert.doesNotMatch(generateSubmit, /saveNow\(|await saveOutlineDraft/);
  assert.match(state, /saveOutlinePlan: \(outlineId: string, plan: string\) => Promise<boolean>/);
  assert.match(state, /mergeStudioConflict/);
  assert.match(state, /durableSnapshot/);
  assert.match(merge, /resolveStudioConflict/);
  assert.match(app, /fullScreen=\{compact\}/);
  assert.match(styles, /\.conflict-actions[\s\S]*@media \(max-width: 767px\)/);
});

test("AI Generate only bundles outline naming when the user opts in", async () => {
  const [app, state, runtime, ai, naming, migration, executor] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("db/runtime.ts"),
    read("db/ai.ts"),
    read("lib/naming-options.ts"),
    read("drizzle/0010_broad_aqueduct.sql"),
    read("app/api/ai/tasks/[taskId]/execute/route.ts"),
  ]);
  assert.match(state, /includeOutlineTitle\?: boolean/);
  assert.match(app, /aria-label="同时生成大纲名"/);
  assert.match(ai, /includeOutlineTitle = input\.target === "content" && input\.includeOutlineTitle === true/);
  assert.doesNotMatch(ai, /source\.currentOutline\.titleGenerationPending/);
  assert.match(ai, /<outline_title>大纲标题<\/outline_title>[\s\S]*<generated_text>/);
  assert.match(ai, /normalizeGenerateResult\(input\.target, completion\.content, includeOutlineTitle, outlineNaming\)/);
  assert.match(ai, /finishReason === "length"/);
  assert.match(ai, /generated_text 标签未闭合/);
  assert.match(naming, /NAMING_STYLE_OPTIONS/);
  assert.match(naming, /采用简化词牌风格/);
  assert.match(naming, /词牌名.*绝对不要出现在结果中/);
  assert.match(app, /NAMING_EXPRESSION_OPTIONS/);
  assert.match(app, /生成句数/);
  assert.match(app, /currentPlan: outlinePlanDraft/);
  assert.match(app, /includeOutlineTitle,[\s\S]*excellentFragmentIds/);
  assert.match(executor, /found\.outline\.plan === task\.contextOptions\?\.outlinePlanSnapshot/);
  assert.match(runtime, /max_input_characters INTEGER NOT NULL DEFAULT 60000/);
  assert.match(migration, /max_input_characters/);
});

test("dedicated naming is centralized and all-name generation is one durable background task and one model call", async () => {
  const [app, state, ai, route, executor, runtime, versions, migration] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("db/ai.ts"),
    read("app/api/ai/names/route.ts"),
    read("app/api/ai/tasks/[taskId]/execute/route.ts"),
    read("db/runtime.ts"),
    read("lib/name-versions.ts"),
    read("drizzle/0013_remarkable_the_anarchist.sql"),
  ]);
  assert.match(app, /function UnifiedNamingEditor/);
  assert.match(app, /生成全部名称/);
  assert.match(app, /AI 生成候选/);
  assert.match(app, /persist: true/);
  assert.match(app, /studio\.setDefaultNameVersion/);
  assert.match(app, /target: "all-names"/);
  assert.match(app, /已创建后台任务，将用一次模型请求生成/);
  assert.doesNotMatch(app.match(/async function generateAll\(\)[\s\S]*?async function selectDefault/)?.[0] ?? "", /for \(const|requestNames\(/);
  const outlineActions = app.match(/function OutlineActionSheet[\s\S]*?function DesktopOutlineMenu/)?.[0] ?? "";
  const desktopOutlineActions = app.match(/function DesktopOutlineMenu[\s\S]*?function ChapterActionSheet/)?.[0] ?? "";
  const chapterActions = app.match(/function ChapterActionSheet[\s\S]*?type NameGeneratePreview/)?.[0] ?? "";
  assert.doesNotMatch(outlineActions, /重新生成大纲名字/);
  assert.doesNotMatch(desktopOutlineActions, /重新生成大纲名字/);
  assert.doesNotMatch(chapterActions, /AI生成名称/);
  assert.match(state, /addGeneratedNameCandidates/);
  assert.match(state, /addManualNameVersion/);
  assert.match(state, /setDefaultNameVersion/);
  assert.match(versions, /normalizeNameVersionState/);
  assert.match(versions, /appendNameVersion/);
  assert.match(migration, /name_versions_json/);
  assert.match(migration, /default_name_version_id/);
  assert.match(app, /chapterNaming: article\.chapterNaming/);
  assert.match(app, /outlineNaming: article\.outlineNaming/);
  assert.match(app, /namingContext: namingArticleContext\(article\)/);
  assert.match(app, /studio\.acceptServerMutation/);
  assert.match(ai, /export async function generateNames/);
  assert.match(ai, /export async function generateArticleNames/);
  assert.match(ai, /purpose="article-chapter-and-outline-naming"/);
  assert.match(ai, /function generatedNameForPreview/);
  assert.match(ai, /const name = normalizeGeneratedName/);
  assert.match(ai, /if \(!name\) throw new AiInputError/);
  assert.match(ai, /input\.chapterNaming \?\? article\.chapterNaming/);
  assert.match(ai, /input\.outlineNaming \?\? article\.outlineNaming/);
  assert.match(ai, /if \(characters > maximum\) throw new AiPromptTooLongError/);
  const namingImplementation = ai.match(/export async function generateNames[\s\S]*?export type AiReviewInput/)?.[0] ?? "";
  assert.doesNotMatch(namingImplementation, /for \(const .*upstream/);
  assert.doesNotMatch(namingImplementation, /current_title|current_chapter|sibling_titles|reservedTitles|reserved_outline_titles/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /generateNames\(body, request\.signal\)/);
  assert.match(route, /status = error instanceof AiPromptTooLongError \? 413/);
  assert.match(executor, /initialTask\.target === "全部名称"/);
  assert.match(executor, /generateArticleNames\(/);
  assert.match(executor, /appendNameVersion\(/);
  assert.match(runtime, /row\.target === "all-names" \? "全部名称"/);
  assert.match(runtime, /task\.target === "全部名称" \? "all-names"/);
});

test("AI task panel orders every status by submission time", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const panel = app.match(/function TaskPanel[\s\S]*?function NewArticleDialog/)?.[0] ?? "";
  assert.match(panel, /sort\(\(a, b\) => new Date\(b\.createdAt\)\.getTime\(\) - new Date\(a\.createdAt\)\.getTime\(\)\)/);
  assert.doesNotMatch(panel, /rank\[a\.state\]|rank\[b\.state\]/);
});

test("body versions retain the outline snapshot used at creation", async () => {
  const [app, state, runtime, schema, executor] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("db/runtime.ts"),
    read("db/schema.ts"),
    read("app/api/ai/tasks/[taskId]/execute/route.ts"),
  ]);
  assert.match(state, /outlineSnapshot/);
  assert.match(runtime, /outline_snapshot_json/);
  assert.match(schema, /outlineSnapshotJson: text\("outline_snapshot_json"\)/);
  assert.match(executor, /outlineSnapshot:[\s\S]*outlinePlanSnapshot/);
  assert.match(state, /modelId\?: string/);
  assert.match(runtime, /model_name/);
  assert.match(executor, /modelId: model\?\.modelId/);
  assert.match(app, /此正文大纲/);
  assert.match(app, /displayedVersion = previewVersion \?\? currentVersion/);
  assert.match(app, /displayedVersion\?\.outlineSnapshot \?\? studio\.currentOutline\.contentOutlineSnapshot/);
});

test("AI tasks expose durable phases, heartbeats, timeout and cross-device refresh", async () => {
  const [app, state, runtime, ai, schema] = await Promise.all([
    read("app/WriterStudioApp.tsx"), read("app/studio-state.tsx"), read("db/runtime.ts"), read("db/ai.ts"), read("db/schema.ts"),
  ]);
  for (const field of ["phase", "lastProgressAt", "receivedCharacters", "timeoutMs", "runnerId", "leaseUntil"]) assert.match(state, new RegExp(field));
  assert.match(runtime, /ensureAiTaskProgressColumns/);
  assert.match(runtime, /last_progress_at/);
  assert.match(schema, /receivedCharacters: integer\("received_characters"\)/);
  assert.match(ai, /return \{ response, controller, cleanup, model, requestStartedAt, responseHeadersAt/);
  assert.match(ai, /consumeUpstream/);
  assert.doesNotMatch(ai, /finally \{ clearTimeout\(timeout\); \}/);
  assert.match(state, /refreshFromServer/);
  assert.match(app, /phaseLabels/);
  assert.match(app, /最近更新/);
  assert.match(app, /重新执行/);
  assert.match(app, /\/api\/ai\/tasks\/\$\{encodeURIComponent\(task\.id\)\}\/execute/);
  assert.match(app, /studio\.saveStatus === "failed" \|\| studio\.saveStatus === "conflict"/);
  assert.doesNotMatch(state, /id: "task-running"/);
  const executor = await read("app/api/ai/tasks/[taskId]/execute/route.ts");
  assert.match(executor, /runnerId = `server-/);
  assert.match(executor, /setInterval[\s\S]*5_000/);
  assert.match(executor, /found\.outline\.versions\.unshift\(version,/);
});

test("AI Chat participates in task tracking and completed tasks can be cleared", async () => {
  const [app, state, runtime, api, styles] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/studio-state.tsx"),
    read("db/runtime.ts"),
    read("app/api/[...segments]/route.ts"),
    read("app/globals.css"),
  ]);
  assert.match(state, /target: "正文" \| "大纲" \| "章节标题" \| "全部名称" \| "AI Chat"/);
  assert.match(state, /clearCompletedTasks: \(\) => void/);
  assert.match(state, /tasks\.filter\(\(task\) => task\.state !== "success"\)/);
  assert.match(app, /action: "submit"[\s\S]*promptContext/);
  assert.match(app, /finalizeChat\(stream, "success"\)/);
  assert.match(app, /setLocalStreaming\(\{ taskId, text: stream\.result \}\)/);
  assert.match(app, /submissionLock\.current = submissionToken/);
  assert.match(app, /"Idempotency-Key": taskId/);
  assert.match(app, /正在保存消息并创建任务/);
  assert.match(app, /const dispatchableTasks: AiTask\[\] = \[\]/);
  assert.match(app, /occupiedBodyOutlines/);
  assert.match(app, /清空已完成/);
  assert.match(app, /const \[selectedTaskId, setSelectedTaskId\] = useState/);
  assert.match(app, /aria-label="任务详情"/);
  assert.match(app, /onClick=\{\(\) => setSelectedTaskId\(task\.id\)\}>打开<\/button>/);
  assert.match(app, /打开对应内容/);
  assert.doesNotMatch(app, /onClick=\{\(\) => locate\(task\)\}>打开<\/button>/);
  assert.match(styles, /\.task-detail-body[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.task-detail-actions[\s\S]*safe-area-inset-bottom/);
  assert.match(runtime, /row\.target === "chat" \? "AI Chat"/);
  assert.match(runtime, /task\.target === "AI Chat" \? "chat"/);
  assert.match(api, /s\[2\] === "completed"[\s\S]*task\.state !== "success"/);
});

test("AI entry points use bounded server transactions instead of full-state save barriers", async () => {
  const [app, taskRoute, chatRoute, state] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/api/ai/tasks/route.ts"),
    read("app/api/outlines/[outlineId]/chat/transactions/route.ts"),
    read("app/studio-state.tsx"),
  ]);
  const generateSubmit = app.match(/const submit = useCallback[\s\S]*?useEffect\(\(\) => \{/)[0];
  const chatSubmit = app.match(/async function requestAnswer[\s\S]*?async function send/)[0];
  const naming = app.match(/async function requestNames[\s\S]*?async function selectDefault/)[0];
  const review = app.match(/async function runReview[\s\S]*?function clearDragState/)[0];
  for (const flow of [generateSubmit, chatSubmit, naming, review]) assert.doesNotMatch(flow, /saveNow\(/);
  assert.match(taskRoute, /INSERT INTO ai_tasks/);
  assert.match(taskRoute, /UPDATE outlines SET summary=COALESCE/);
  assert.match(chatRoute, /INSERT INTO chat_messages/);
  assert.match(chatRoute, /completeChatTask/);
  assert.match(await read("db/chat-tasks.ts"), /UPDATE ai_tasks SET status=/);
  assert.match(state, /fetchFromServer\("\/api\/ai\/tasks"/);
  assert.match(state, /\}\), "partial"\);/, "task polling must not treat a partial task snapshot as a complete global revision");
  assert.match(state, /epoch !== saveEpochRef\.current/, "stale save responses must not roll the accepted server baseline backward");
  assert.doesNotMatch(state, /setInterval\([\s\S]{0,500}refreshFromServer\(\)[\s\S]{0,100}3000/);
});

test("version selection previews immediately and writing uses explicit draft commits", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const state = await read("app/studio-state.tsx");
  const selector = await read("lib/ai-context.ts");
  const resolver = await read("lib/outline-content.ts");
  const runtime = await read("db/runtime.ts");
  const api = await read("app/api/[...segments]/route.ts");
  const styles = await read("app/globals.css");
  assert.match(app, /onPreview=\{\(versionId\) => \{ setPreviewSelection\(\{ outlineId: currentOutline, versionId \}\)/);
  assert.match(app, /className="version-content-preview"/);
  assert.match(app, /className="content-reader"/);
  assert.doesNotMatch(app, /version-preview-bar|返回当前正文/);
  assert.match(app, /保存正文修改？/);
  assert.match(app, /放弃修改/);
  assert.doesNotMatch(app, />只读</);
  assert.doesNotMatch(app, /readOnly=\{Boolean\(previewVersion\)\}/);
  assert.match(state, /commitContentEdit/);
  assert.match(state, /currentVersionId: versionId/);
  assert.match(state, /versions: \[version, \.\.\.item\.versions\]/);
  assert.match(state, /preserveContentDraft/);
  assert.match(state, /source: "未保存内容"/);
  assert.doesNotMatch(app, /className="set-default-body-button"|className="start-edit-button"|className=\{`appreciate-body-button/);
  assert.match(app, /className=\{`body-title-toggle/);
  assert.match(app, /toggleDisplayedContentDefault/);
  assert.match(app, /className="content-word-count"/);
  assert.match(app, /className="content-selection-menu" role="menu"/);
  assert.match(app, /role="menuitemcheckbox"/);
  assert.match(app, /document\.addEventListener\("selectionchange", onSelectionChange\)/);
  assert.match(app, /else queueSelectionMenu\(\)/);
  assert.match(app, /onDoubleClick=\{\(event\) => \{ event\.preventDefault\(\); beginEditing\(\); \}\}/);
  assert.match(app, /isTouchDoubleTap\(event, lastReaderTouchRef\)/);
  assert.match(app, /pendingContentScrollRef/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*snapshot\.ratio \* max[\s\S]*\}, \[editing\]\)/);
  assert.match(state, /setDefaultVersion/);
  assert.match(selector, /resolvedOutlineContent\(outline\)/);
  assert.match(resolver, /currentOutlineVersion\(outline\)\?\.content \?\? outline\.content/);
  assert.match(app, /content: previewVersion\?\.content \?\? resolvedOutlineContent\(activeOutline\)/);
  assert.match(runtime, /const referenceContent = resolvedOutlineContent\(outline\)/);
  assert.match(api, /defaultVersionId: found\.outline\.defaultVersionId/);
  assert.match(styles, /\.content-editor-section \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/);
  assert.match(styles, /\.content-editor \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/);
  assert.match(styles, /\.content-reader \{[\s\S]*touch-action: manipulation/);
  assert.match(styles, /@media \(max-width: 767px\) \{[\s\S]*\.content-reader \{ -webkit-touch-callout: none; \}/);
  assert.match(styles, /\.content-selection-menu \{/);
});

test("AI Chat is a session workspace with writing-safe actions and touch-sized controls", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const state = await read("app/studio-state.tsx");
  const runtime = await read("db/runtime.ts");
  const schema = await read("db/schema.ts");
  const styles = await read("app/globals.css");
  assert.match(state, /createChatSession/);
  assert.match(state, /branchChatSession/);
  assert.match(state, /activeSessionId/);
  assert.match(state, /lastReadMessageId/);
  assert.match(state, /markChatSessionRead/);
  assert.match(runtime, /outline\.chat\.sessions\.forEach/);
  assert.match(runtime, /lastReadMessageId: session\.lastReadMessageId \?\? null/);
  const chatSessionSchema = schema.match(/export const chatSessions[\s\S]*?export const chatMessages/)?.[0] ?? "";
  assert.match(chatSessionSchema, /chat_sessions_outline_updated_idx/);
  assert.doesNotMatch(chatSessionSchema, /outlineId:[^\n]+\.unique\(\)/);
  assert.match(app, /chat-session-switcher/);
  assert.match(app, /保存为候选版本/);
  assert.match(app, /交给 AI Generate/);
  assert.match(app, /添加文本参考/);
  assert.match(app, /sessionId: session\.id/);
  assert.match(app, /const activeChatStreams = new Map/);
  assert.match(app, /cancelActiveChatStream\(task\.id\)/);
  assert.match(app, /chatSessionHasUnread/);
  assert.match(app, /\.message-action-trigger, \.message-action-menu/);
  assert.match(app, /<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
  assert.doesNotMatch(app, /const iconGlyph/);
  assert.match(styles, /\.chat-header-actions \.icon-button \{ height: 44px; width: 44px; \}/);
  assert.match(styles, /\.composer-send \{ border-radius: 50%; flex-basis: 44px; height: 44px; width: 44px; \}/);
});

test("shared UI controls use one type and action scale across native and component buttons", async () => {
  const styles = await read("app/globals.css");
  const app = await read("app/WriterStudioApp.tsx");
  const layout = await read("app/layout.tsx");
  assert.match(styles, /--font-ui: 14px/);
  assert.match(styles, /--font-label: 13px/);
  assert.match(styles, /--font-meta: 12px/);
  assert.match(styles, /--control-height: 38px/);
  assert.match(styles, /--accent: #755835/);
  assert.doesNotMatch(styles, /#2563eb|#1d4ed8|37, 99, 235/);
  assert.match(layout, /primaryColor: "studio"/);
  assert.doesNotMatch(layout, /primaryColor: "blue"/);
  assert.doesNotMatch(app, /color="blue"/);
  assert.match(styles, /\.mantine-Button-root \{[\s\S]*font-size: var\(--font-ui\)/);
  assert.match(styles, /\.model-card-actions \.mantine-Button-root \{[\s\S]*min-height: var\(--control-height\)/);
  assert.match(styles, /\.info-page \.page-header \{[\s\S]*flex-direction: row/);
  assert.match(styles, /\.mantine-Modal-root \.mantine-Button-root,[\s\S]*min-height: 44px/);
  assert.match(styles, /\.setting-row \.toggle span \{[\s\S]*height: 24px/);
  assert.match(app, /<Button variant="default" size="xs" loading=\{busy === `test-\$\{provider\.id\}`\}[\s\S]{0,220}测试连接<\/Button>/);
  assert.match(app, /<Menu\.Target><Button variant="default" size="xs">更多<\/Button><\/Menu\.Target>/);
});

test("test servers cannot reuse or open the production database", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const testServer = await read("scripts/dev-test-server.mjs");
  const sqlite = await read("db/sqlite.ts");
  const playwright = await read("playwright.config.ts");
  const apiRunner = await read("scripts/run-tests.mjs");
  const uiRunner = await read("scripts/run-ui-tests.mjs");

  assert.equal(packageJson.scripts["dev:test"], "node scripts/dev-test-server.mjs");
  assert.match(testServer, /Refusing to start a test server outside \.test-data/);
  assert.match(testServer, /WRITER_STUDIO_TEST_MODE = "1"/);
  assert.match(sqlite, /Test mode refuses to open a database outside \.test-data/);
  assert.match(playwright, /reuseExistingServer: false/);
  assert.match(playwright, /WRITER_STUDIO_TEST_MODE: "1"/);
  assert.match(apiRunner, /WRITER_STUDIO_TEST_MODE: "1"/);
  assert.match(uiRunner, /WRITER_STUDIO_TEST_MODE: "1"/);
});

test("data management exposes scoped exports, safe imports and secret-free model portability", async () => {
  const [app, transfer, helpers, state] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("app/data-transfer.tsx"),
    read("lib/data-transfer.ts"),
    read("app/studio-state.tsx"),
  ]);
  assert.match(app, /\["settings-database", "数据管理"\]/);
  for (const label of ["导出大纲", "导入大纲", "导出这篇文章", "所有文章", "系统配置", "导出全部"]) assert.match(app, new RegExp(label));
  assert.match(transfer, /envelope\.scope !== "outline"/);
  assert.match(transfer, /envelope\.scope !== "system-config"/);
  assert.match(transfer, /不(?:会)?覆盖现有数据/);
  assert.match(transfer, /不包含 API Key/);
  assert.match(helpers, /kind: TRANSFER_KIND/);
  assert.match(helpers, /state: interrupted \? "cancelled"/);
  assert.match(helpers, /duplicateArticleForCopy/);
  assert.match(helpers, /contentVersions: "default"/);
  assert.doesNotMatch(helpers, /\bsecret\s*:/);
  assert.match(state, /duplicateOutlineForImport/);
  assert.match(state, /duplicateArticlesForImport/);
  assert.match(state, /duplicateArticleForCopy/);
  assert.match(app, /复制这篇文章/);
  assert.match(app, /AI 任务、执行状态和任务历史不会复制/);
});
