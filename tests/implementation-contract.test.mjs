import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("database schema contains every specification entity", async () => {
  const schema = await read("db/schema.ts");
  for (const entity of ["articles", "chapters", "outlines", "contents", "versions", "characters", "relationships", "chatSessions", "chatMessages", "aiTasks", "aiModels", "appSettings"]) {
    assert.match(schema, new RegExp(`export const ${entity}\\b`), entity);
  }
});

test("character records use only name, aliases, description and archive business fields", async () => {
  const schema = await read("db/schema.ts");
  const runtime = await read("db/runtime.ts");
  const state = await read("app/studio-state.tsx");
  const app = await read("app/WriterStudioApp.tsx");
  const characterSchema = schema.match(/export const characters[\s\S]*?export const relationships/)?.[0] ?? "";
  for (const field of ["name", "aliasesJson", "description", "archived"]) assert.match(characterSchema, new RegExp(`\\b${field}\\b`));
  for (const removed of ["role", "appearance", "personality", "abilities", "background", "color"]) assert.doesNotMatch(characterSchema, new RegExp(`\\b${removed}\\b`));
  assert.match(runtime, /INSERT INTO characters VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?\)/);
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

test("relationship snapshot insert matches the eight-column table", async () => {
  const runtime = await read("db/runtime.ts");
  assert.match(runtime, /INSERT INTO relationships VALUES\(\?,\?,\?,\?,\?,\?,\?,\?\)/);
  assert.doesNotMatch(runtime, /INSERT INTO relationships VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?\)/);
});

test("schema-extensible inserts name their columns explicitly", async () => {
  const runtime = await read("db/runtime.ts");
  const ai = await read("db/ai.ts");
  assert.match(runtime, /INSERT INTO outlines\(id,article_id,chapter_id,title,summary,generate_instruction,position,archived,state,title_generation_pending,created_at,updated_at,revision\)/);
  assert.match(runtime, /INSERT INTO contents\(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision\)/);
  assert.match(ai, /INSERT INTO ai_models\(id,name,base_url,model_id,system_prompt,temperature,max_output,max_input_characters,timeout_ms,has_secret,created_at,updated_at\)/);
  assert.doesNotMatch(ai, /INSERT INTO ai_models VALUES/);
});

test("business data uses server SQLite with revision conflicts and interrupted-draft candidates", async () => {
  const state = await read("app/studio-state.tsx");
  const runtime = await read("db/runtime.ts");
  assert.match(state, /fetch\("\/api\/state"/);
  assert.match(state, /sessionStorage/);
  assert.doesNotMatch(state, /localStorage\.setItem\(legacyStorageKey,\s*JSON\.stringify\(data\)/);
  assert.match(runtime, /state_revision/);
  assert.match(runtime, /conflict:\s*true/);
  assert.match(runtime, /CREATE VIRTUAL TABLE IF NOT EXISTS search_documents USING fts5/);
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
  assert.match(app, /aria-label="文章功能"[\s\S]*全大纲编辑[\s\S]*全文编辑[\s\S]*搜索[\s\S]*文章资料/);
  assert.match(app, /aria-label=\{`切换文章，当前 \$\{articleTitle\}`\}/);
  assert.match(app, /addEventListener\("touchmove", touchMove, \{ passive: false \}\)/);
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
  assert.match(app, /"outline-edit": `\$\{base\}\/outlines\/edit-all`/);
  assert.match(app, /read: `\$\{base\}\/edit`/);
  assert.match(app, /function ContinuousDocumentEditor/);
  assert.match(app, /function AutoGrowTextarea/);
  assert.match(app, /node\.style\.height = `\$\{Math\.max\(node\.scrollHeight, 34\)\}px`/);
  assert.match(app, /mode === "outline" \? studio\.updateOutline/);
  assert.match(app, /onContentBlur=\{mode === "content" \? \(\) => commitContent\(item\.id\)/);
  assert.match(app, /studio\.stageContentDraft\(outlineId, text\)/);
  assert.match(app, /studio\.saveCurrentContent\(outlineId, next, editSourceVersionIdsRef\.current\[outlineId\]\)/);
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
  assert.match(app, /预定义 Review 要求/);
  assert.match(state, /reviewPresets: string\[\]/);
  assert.match(state, /source: "手动" \| "AI Generate" \| "AI Chat" \| "AI Review"/);
  assert.match(schema, /contentName: text\("content_name"\)/);
  assert.match(runtime, /version\.source === "AI Review" \? "ai-review"/);
  const reviewFunction = ai.match(/export async function reviewChapter[\s\S]*?\n}\n\nfunction localOutlineTitle/)?.[0] ?? "";
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
  const [pkg, layout, app, overlays, styles, vite, overlayGuide, pullRequestTemplate] = await Promise.all([
    read("package.json"),
    read("app/layout.tsx"),
    read("app/WriterStudioApp.tsx"),
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
  assert.doesNotMatch(app, /<(?:Modal|Drawer)\b/);
  assert.doesNotMatch(app, /className="(?:modal-layer|outline-sheet-layer|desktop-action-layer)"/);
  assert.match(app, /<ResponsiveModal[\s\S]*opened=\{formOpen\}/);
  assert.match(app, /function VersionDrawer[\s\S]*<ScrollableDrawer/);
  assert.match(app, /function TaskPanel[\s\S]*<ScrollableDrawer/);
  assert.match(app, /function ChapterActionSheet[\s\S]*<MobileActionSheet/);
  assert.match(app, /title="本次生成上下文"[\s\S]*position=\{compact \? "bottom" : "right"\}/);
  assert.match(overlays, /data-ui-overlay="drawer"/);
  assert.match(overlays, /data-ui-overlay="modal"/);
  assert.match(overlays, /data-ui-overlay-scroll/);
  assert.match(styles, /\.ws-overlay-surface \{[\s\S]*max-height: calc\(100dvh/);
  assert.match(styles, /\.ws-overlay-body--scroll,[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.ws-overlay-body--contained \{[\s\S]*overflow: hidden/);
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
});

test("model settings support editing and server-side model discovery", async () => {
  const app = await read("app/WriterStudioApp.tsx");
  const ai = await read("db/ai.ts");
  const styles = await read("app/globals.css");
  assert.match(app, /openEdit\(model\)/);
  assert.match(app, /Fetch 模型/);
  assert.match(app, /compact && <Button className="mobile-model-fetch"/);
  assert.match(app, /选择获取到的大模型/);
  assert.match(app, /<MultiSelect[\s\S]*?className="discovered-model-select"/);
  assert.match(app, /withCheckIcon/);
  assert.match(app, /多个模型 ID 使用逗号分隔/);
  assert.match(app, /\/api\/models\/bulk/);
  assert.match(app, /model-form-error/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /aria-label="超时（分钟）"/);
  assert.match(app, /timeoutMs: Math\.round\(parsedTimeoutMinutes \* 60_000\)/);
  assert.doesNotMatch(app, /超时（毫秒）/);
  assert.match(app, /className="model-card-actions"/);
  assert.match(styles, /\.model-card-actions \{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.model-form \{[\s\S]*padding: 18px 20px 20px/);
  assert.match(styles, /\.mobile-model-fetch\.mantine-Button-root[\s\S]*min-height: 48px/);
  assert.match(styles, /\.model-form-modal \.model-form-actions[\s\S]*position: sticky/);
  assert.match(ai, /\/models/);
  assert.match(ai, /Authorization: `Bearer \$\{secret\}`/);
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
  assert.match(app, /latestGeneratePromptForOutline/);
  assert.match(app, /task\.outlineId === outlineId && task\.target === "正文"/);
  assert.match(app, /studio\.currentOutline\.generateInstruction \|\| latestGeneratePromptForOutline/);
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
  assert.match(app, /任务成功后会自动设为该大纲的当前正文/);
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
  assert.match(app, /await saveOutlineDraft\(\)/);
  assert.match(state, /saveOutlinePlan: \(outlineId: string, plan: string\) => Promise<boolean>/);
  assert.match(state, /mergeAiManagedConflict/);
  assert.match(merge, /serverAdditions/);
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
  assert.match(ai, /const result = normalizeGenerateResult\(input\.target,[\s\S]*includeOutlineTitle, outlineNaming\)/);
  assert.match(naming, /NAMING_STYLE_OPTIONS/);
  assert.match(naming, /采用简化词牌风格/);
  assert.match(naming, /词牌名.*绝对不要出现在结果中/);
  assert.match(app, /NAMING_EXPRESSION_OPTIONS/);
  assert.match(app, /生成句数/);
  assert.match(app, /outlinePlanSnapshot: outlinePlanDraft/);
  assert.match(app, /includeOutlineTitle, excellentFragmentIds/);
  assert.match(executor, /found\.outline\.plan === task\.contextOptions\?\.outlinePlanSnapshot/);
  assert.match(runtime, /max_input_characters INTEGER NOT NULL DEFAULT 60000/);
  assert.match(migration, /max_input_characters/);
});

test("dedicated naming is one call, has a preview, and blocks oversized chapters before upstream", async () => {
  const [app, ai, route] = await Promise.all([
    read("app/WriterStudioApp.tsx"),
    read("db/ai.ts"),
    read("app/api/ai/names/route.ts"),
  ]);
  assert.match(app, /重新生成大纲名字/);
  assert.match(app, /AI生成名称/);
  assert.match(app, /取消全选/);
  assert.match(app, /应用所有名称/);
  assert.match(app, /regenerateItem/);
  assert.match(app, /function NameGenerateDialog/);
  assert.match(app, /studio\.applyGeneratedNames/);
  assert.match(ai, /export async function generateNames/);
  assert.match(ai, /if \(characters > maximum\) throw new AiPromptTooLongError/);
  const namingImplementation = ai.match(/export async function generateNames[\s\S]*?export type AiReviewInput/)?.[0] ?? "";
  assert.doesNotMatch(namingImplementation, /for \(const .*upstream/);
  assert.doesNotMatch(namingImplementation, /current_title|current_chapter|sibling_titles|reservedTitles|reserved_outline_titles/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /generateNames\(body, request\.signal\)/);
  assert.doesNotMatch(app.match(/function NameGenerateDialog[\s\S]*?function NamingProfileEditor/)?.[0] ?? "", /reservedTitles/);
  assert.match(route, /status = error instanceof AiPromptTooLongError \? 413/);
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
  assert.match(ai, /return \{ response, controller, cleanup \}/);
  assert.match(ai, /consumeUpstream/);
  assert.doesNotMatch(ai, /finally \{ clearTimeout\(timeout\); \}/);
  assert.match(state, /refreshFromServer/);
  assert.match(app, /phaseLabels/);
  assert.match(app, /最近更新/);
  assert.match(app, /重新执行/);
  assert.match(app, /\/api\/ai\/tasks\/\$\{encodeURIComponent\(task\.id\)\}\/execute/);
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
  assert.match(state, /target: "正文" \| "大纲" \| "章节标题" \| "AI Chat"/);
  assert.match(state, /clearCompletedTasks: \(\) => void/);
  assert.match(state, /tasks\.filter\(\(task\) => task\.state !== "success"\)/);
  assert.match(app, /target: "AI Chat"[\s\S]*state: "running"/);
  assert.match(app, /studio\.updateTask\(taskId, \{ state: "success", phase: "completed"[\s\S]*resultText: streamingRef\.current/);
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
  assert.match(styles, /--font-ui: 13px/);
  assert.match(styles, /--font-label: 12px/);
  assert.match(styles, /--control-height: 36px/);
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
  assert.match(app, /<Button variant="default" size="xs" loading=\{busy === model\.id\}[\s\S]{0,220}测试<\/Button>/);
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
  assert.doesNotMatch(helpers, /\bsecret\s*:/);
  assert.match(state, /duplicateOutlineForImport/);
  assert.match(state, /duplicateArticlesForImport/);
});
