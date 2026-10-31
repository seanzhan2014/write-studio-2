import { normalizeTaskConcurrency } from "@/lib/task-concurrency";
import { supportsText } from "@/lib/ai-model-capabilities";
import { ensureDatabase, getDatabase, readStudioState, applyStudioChanges } from "./studio-state";
import { diffStudioData } from "@/lib/studio-changes";
import { isCloudDatabase } from "./sqlite";
import { styleLabChangedStatement } from "./style-lab-history";
import { currentTaskExecutionOrigin } from "./task-execution";
import { AiInputError, AiUpstreamCompletionError } from "@/db/ai-errors";
import { isRetryableAiError } from "@/db/ai-transport";
import { findModel, type AiModelRecord } from "@/db/ai-models";
import { generateText, generateWritingPreparation, styleLabCompletion } from "@/db/ai";
import { reviewGeneratedText, reviseGeneratedText } from "@/db/ai-review";
import { createWritingPreparation, PreparationResponseError } from "@/lib/writing-preparation";
import { normalizeArticleStorySettings } from "@/lib/story-settings";
import { DEFAULT_OUTLINE_NAMING_PROFILE } from "@/lib/naming-options";
import { createReviewRuleSnapshot, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { runGenerateReview, type GenerateReviewCheckpoint } from "@/lib/generate-review.mjs";
import { STYLE_FIELDS, advancedText } from "@/lib/advanced-writing";
import { LEARNING_RULES, SCORE_DIMENSIONS, STYLE_SCORE_RUBRIC, STYLE_TRIAL_INSTRUCTION, STYLE_TRIAL_EVALUATION_RULES, MIN_STYLE_CONTENT_SCORE, MAX_REFERENCE_TOTAL, applyLocks, configurationFingerprint, configurationOf, configurationSchema, fingerprint, modelConfiguration, normalizeConfiguration, normalizeStyleLibrary, sceneInstructions, textStatistics, type StyleConfiguration, type ReferenceDocument, type ConfigurationVersion } from "@/lib/style-learning";
import type { SelectedAiContext } from "@/lib/ai-context";

type Plan = { referenceId: string; scenes: Array<{ title: string; plan: string; targetWords: number }> };
type Evaluation = { scores: number[]; contentScore: number; evidence: string; suggestions: string };
export type StyleRound = { index: number; configuration: StyleConfiguration; drafts: Array<{ referenceId: string; scene: number; raw: string; text: string; brief?: string }>; evaluations: Evaluation[]; reviewCheckpoint?: GenerateReviewCheckpoint; score?: number; contentScore?: number; change?: string };
type Application = { id: string; at: string; before: StyleConfiguration; previousCalibration?: ConfigurationVersion; restoredAt?: string };
type Payload = { references: ReferenceDocument[]; base: StyleConfiguration; candidate: StyleConfiguration; best: StyleConfiguration; bestScore: number; bestRound: number; maxRounds: number; round: number; referenceIndex: number; outlines: Plan[]; analyses: StyleConfiguration[]; locked: string[]; modelFingerprint: string; reviewModel: string; reviewModelFingerprint: string; preparation: boolean; reviewRounds: number; reviewStrategy: "minimal" | "explore"; rules: ReviewRuleSnapshot; inputTokens: number; outputTokens: number; applied?: boolean; notice?: string;
  autoApply?: boolean; autoApplyPending?: boolean; archived?: boolean; completedAt?: string; executionOrigin?: "local" | "cloud";
  modelName?: string; providerName?: string; modelSnapshot?: Record<string, unknown>;
  applications?: Application[]; history?: Array<{ at: string; status: string; phase: string; error?: string; retry?: number; diagnostics?: unknown }>;
};
export type StyleJob = { id: string; articleId: string; kind: "learn" | "tune"; status: string; phase: string; model: string; createdAt: string; updatedAt: string; error?: string; payload: Payload; rounds?: StyleRound[] };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stamp = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v);
function modelFingerprint(model: AiModelRecord) { return fingerprint(json({ id: model.id, provider: model.providerId, model: model.modelId, url: model.baseUrl, prompt: model.systemPrompt, temperature: model.temperature, output: model.maxOutput, input: model.maxInputCharacters, reasoning: model.reasoningEffort })); }
function fromRow(row: Record<string, unknown>): StyleJob { return { id: String(row.id), articleId: String(row.article_id), kind: row.kind as StyleJob["kind"], status: String(row.status), phase: String(row.phase), model: String(row.model_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), error: row.error ? String(row.error) : undefined, payload: JSON.parse(String(row.payload_json)) }; }
export async function getStyleJob(id: string, withRounds = false) {
  await ensureDatabase();
  const row = await getDatabase().prepare("SELECT * FROM style_lab_jobs WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) throw new AiInputError("风格任务不存在");
  const job = fromRow(row);
  if (withRounds) {
    job.rounds = ((await getDatabase().prepare("SELECT payload_json FROM style_lab_rounds WHERE job_id=? ORDER BY round_index").bind(id).all<{ payload_json: string }>()).results ?? []).map(r => JSON.parse(r.payload_json));
    const artifacts = (await getDatabase().prepare("SELECT round_index,scene_index,payload_json FROM style_lab_artifacts WHERE job_id=? ORDER BY round_index,scene_index").bind(id).all<{round_index:number;scene_index:number;payload_json:string}>()).results ?? [];
    for (const artifact of artifacts) { const round = job.rounds!.find(r => r.index === artifact.round_index); if (round) round.drafts[artifact.scene_index] = JSON.parse(artifact.payload_json); }
  }
  return job;
}
export async function listStyleJobs(articleId?: string) {
  await ensureDatabase();
  const rows = articleId ? await getDatabase().prepare("SELECT id,status FROM style_lab_jobs WHERE article_id=? ORDER BY created_at DESC LIMIT 20").bind(articleId).all<{ id: string; status: string }>() : await getDatabase().prepare("SELECT id,status FROM style_lab_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 20").all<{ id: string; status: string }>();
  return rows.results ?? [];
}
export async function listStyleJobHistory(input: { articleId?: string; filter?: string; page?: number; paginate?: boolean }) {
  await ensureDatabase();
  const db = getDatabase(); const args: unknown[] = [];
  const where = ["1=1"];
  if (input.articleId) { where.push("article_id=?"); args.push(input.articleId); }
  if (input.filter === "archived") where.push("COALESCE(json_extract(payload_json,'$.archived'),0)=1");
  else where.push("COALESCE(json_extract(payload_json,'$.archived'),0)=0");
  if (input.filter === "active") where.push("status IN ('queued','running','paused','failed')");
  if (input.filter === "completed") where.push("status='completed'");
  if (input.filter === "pending") where.push("status='completed' AND COALESCE(json_extract(payload_json,'$.applied'),0)=0 AND (kind<>'tune' OR COALESCE(json_extract(payload_json,'$.bestScore'),-1)>=0)");
  const predicate = where.join(" AND ");
  const total = Number(await db.prepare(`SELECT COUNT(*) AS count FROM style_lab_jobs WHERE ${predicate}`).bind(...args).first<number>("count") ?? 0);
  const pages = input.paginate === false ? 1 : Math.max(1, Math.ceil(total / 20));
  const page = Math.max(1, Math.min(pages, Math.floor(Number(input.page) || 1)));
  const rows = await db.prepare(`SELECT id,article_id,kind,status,phase,model_id,error,created_at,updated_at,json_remove(payload_json,'$.references','$.outlines','$.analyses','$.applications','$.history','$.modelSnapshot','$.base','$.best','$.candidate','$.rules') AS payload_json FROM style_lab_jobs WHERE ${predicate} ORDER BY created_at DESC,id DESC${input.paginate === false ? "" : " LIMIT 20 OFFSET ?"}`).bind(...args, ...(input.paginate === false ? [] : [(page - 1) * 20])).all<Record<string, unknown>>();
  const jobs = (rows.results ?? []).map(fromRow).map(job => ({ ...job, payload: { ...job.payload, references: [], outlines: [], analyses: [], applications: [], history: [] } }));
  const active = Number(await db.prepare("SELECT COUNT(*) AS count FROM style_lab_jobs WHERE status IN ('queued','running','paused')" + (input.articleId ? " AND article_id=?" : "")).bind(...(input.articleId ? [input.articleId] : [])).first<number>("count") ?? 0);
  return { jobs, total, page, pages, active, executionMode: isCloudDatabase() ? "browser" as const : "server" as const };
}
function addHistory(job: StyleJob, status = job.status, error?: string) {
  job.payload.history = [...(job.payload.history ?? []), { at: stamp(), status, phase: job.phase, ...(error ? { error } : {}) }];
}
async function saveJobPayload(job: StyleJob) {
  const db = getDatabase();
  await db.batch([db.prepare("UPDATE style_lab_jobs SET payload_json=?,updated_at=? WHERE id=?").bind(json(job.payload), stamp(), job.id), styleLabChangedStatement(db)]);
}
async function hasQualifiedStyleResult(job: StyleJob) {
  if (job.kind !== "tune") return true;
  if (job.payload.bestScore < 0) return false;
  const raw = await getDatabase().prepare("SELECT payload_json FROM style_lab_rounds WHERE job_id=? AND round_index=?").bind(job.id, job.payload.bestRound).first<string>("payload_json");
  const round = raw ? JSON.parse(raw) as StyleRound : undefined;
  return !!round && typeof round.contentScore === "number" && Number.isFinite(round.contentScore) && round.contentScore >= MIN_STYLE_CONTENT_SCORE && Number.isFinite(round.score);
}
function failureDetails(error: unknown) {
  if (error instanceof PreparationResponseError) return { inputTokens: error.inputTokens, outputTokens: error.outputTokens, diagnostics: error.diagnostics };
  if (error instanceof AiUpstreamCompletionError) return { inputTokens: error.diagnostics.promptTokens ?? 0, outputTokens: error.diagnostics.completionTokens ?? 0, diagnostics: error.diagnostics };
  return { inputTokens: 0, outputTokens: 0, diagnostics: undefined };
}
export async function createStyleJob(input: Record<string, unknown>) {
  await ensureDatabase();
  if (input.kind !== "learn" && input.kind !== "tune") throw new AiInputError("风格任务类型无效");
  const snapshot = await readStudioState();
  const article = snapshot.data?.articles.find(a => a.id === input.articleId);
  if (!article || !snapshot.data) throw new AiInputError("文章不存在");
  const library = normalizeStyleLibrary(article.storySettings?.styleLibrary);
  if (!library.references.length || library.references.some(r => !r.text.trim())) throw new AiInputError("请先添加并保存参考文章");
  if (library.references.reduce((n, r) => n + r.text.length, 0) > MAX_REFERENCE_TOTAL) throw new AiInputError("参考材料总长度超过上限");
  const model = await findModel(String(input.model ?? ""));
  if (!model?.hasSecret || !supportsText(model)) throw new AiInputError("请选择已配置密钥的文本模型");
  const maximum = input.kind === "tune" ? Number(input.maxRounds ?? 3) : 0;
  if (!Number.isInteger(maximum) || maximum < 1 && input.kind === "tune" || maximum > 10) throw new AiInputError("微调次数必须为1–10的整数");
  const running = await getDatabase().prepare("SELECT id FROM style_lab_jobs WHERE article_id=? AND status IN ('queued','running','paused') LIMIT 1").bind(article.id).first();
  if (running) throw new AiInputError("本文章已有进行中的风格任务，请先完成或停止");
  const base = configurationOf(article);
  const previous = modelConfiguration(article, model.id);
  const initial = previous.calibration?.modelFingerprint === modelFingerprint(model) ? previous.configuration : base;
  const reviewModel = snapshot.data.settings.reviewModelMode === "fixed" ? await findModel(snapshot.data.settings.reviewModel) : model;
  const reviewRounds = Math.max(0, Math.min(10, Number(snapshot.data.settings.generateReviewMaxRounds) || 0));
  if (reviewRounds && !reviewModel?.hasSecret) throw new AiInputError("当前审校模型不可用，请先调整 AI 任务设置");
  const payload: Payload = { references: library.references, base, candidate: initial, best: initial, bestScore: -1, bestRound: 0, maxRounds: maximum, round: 0, referenceIndex: 0, outlines: [], analyses: [], locked: library.locked, modelFingerprint: modelFingerprint(model), reviewModel: reviewModel?.id ?? model.id, reviewModelFingerprint: modelFingerprint(reviewModel ?? model), preparation: true, reviewRounds, reviewStrategy: snapshot.data.settings.generateReviewStrategy === "explore" ? "explore" : "minimal", rules: createReviewRuleSnapshot(article, snapshot.data.settings.generateReviewInstruction), inputTokens: 0, outputTokens: 0 };
  const id = `style-${crypto.randomUUID()}`; const now = stamp();
  const phase = input.kind === "learn" ? "learn" : "outline";
  Object.assign(payload, { autoApply: input.autoApply !== false, executionOrigin: currentTaskExecutionOrigin(), modelName: model.name, providerName: model.providerName, modelSnapshot: { modelId: model.modelId, baseUrl: model.baseUrl, systemPrompt: model.systemPrompt, temperature: model.temperature, maxOutput: model.maxOutput, reasoningEffort: model.reasoningEffort }, applications: [], history: [{ at: now, status: "queued", phase }] });
  const db = getDatabase();
  const inserted = await db.batch([db.prepare("INSERT INTO style_lab_jobs(id,article_id,kind,status,phase,model_id,payload_json,created_at,updated_at) SELECT ?,?,?,'queued',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM style_lab_jobs WHERE article_id=? AND status IN ('queued','running','paused'))").bind(id, article.id, input.kind, phase, model.id, json(payload), now, now, article.id), styleLabChangedStatement(db)]);
  if (!Number(inserted[0]?.meta?.changes)) throw new AiInputError("本文章已有进行中的风格任务，请先完成或停止");
  return getStyleJob(id);
}

export async function applyStyleResult(id: string, force = false) {
  for (let retry = 0; retry < 5; retry++) {
    const snapshot = await readStudioState(); if (!snapshot.data) throw new AiInputError("文章不存在");
    const job = await getStyleJob(id);
    if (job.status !== "completed") throw new AiInputError("请等待任务完成");
    const p = job.payload;
    if (!await hasQualifiedStyleResult(job)) throw new AiInputError(`没有内容覆盖达到${MIN_STYLE_CONTENT_SCORE}分的试写结果，请查看评分后新建试验`);
    const next = structuredClone(snapshot.data); const article = next.articles.find(a => a.id === job.articleId); if (!article) throw new AiInputError("文章不存在");
    const story = normalizeArticleStorySettings(article.storySettings); const library = normalizeStyleLibrary(story.styleLibrary);
    const current = configurationOf(article);
    if (!force && p.applied) { p.autoApplyPending = false; await saveJobPayload(job); return; }
    if (!force && (configurationFingerprint(current) !== configurationFingerprint(p.base) || json(library.references) !== json(p.references))) {
      p.notice = "任务期间配置或参考资料已改变，结果已保留，请对照后应用。";
      p.autoApplyPending = false; await saveJobPayload(job); return;
    }
    if (job.kind === "tune") {
      const model = await findModel(job.model);
      if (!model || modelFingerprint(model) !== p.modelFingerprint) throw new AiInputError("模型设置已改变，请重新微调后应用");
    }
    const at = stamp(); const applicationId = crypto.randomUUID();
    const version: ConfigurationVersion = { id, name: `${job.kind === "learn" ? "学习" : "微调"} ${at.slice(0, 16).replace("T", " ")}`, createdAt: at, configuration: p.best, ...(job.kind === "tune" ? { model: job.model, baseFingerprint: configurationFingerprint(current), modelFingerprint: p.modelFingerprint } : {}) };
    p.applications = [...(p.applications ?? []), { id: applicationId, at, before: current, ...(library.calibrations[job.model] ? { previousCalibration: library.calibrations[job.model] } : {}) }];
    library.versions = library.versions.filter(v => v.id !== id);
    library.versions.push({ id: `${id}-before-${applicationId}`, name: "应用前配置", createdAt: at, configuration: current });
    if (job.kind === "learn") {
      library.versions.push(version);
      library.scenes = p.best.scenes;
      article.style = p.best.style; story.advancedStyle = p.best.advancedStyle;
      article.aiGenerateSettings = { ...article.aiGenerateSettings, proseControls: p.best.generate.proseControls, advanced: p.best.generate.advanced };
    } else { library.versions.push(version); library.calibrations[job.model] = version; }
    if (job.kind === "learn") library.activeVersionId = id;
    story.styleLibrary = normalizeStyleLibrary(library); article.storySettings = story; article.updatedAt = at;
    p.applied = true; p.autoApplyPending = false; p.notice = undefined;
    const saved = await applyStudioChanges(diffStudioData(snapshot.data, next), snapshot.revision, { recordSyncChange: false, additionalStatements: [getDatabase().prepare("UPDATE style_lab_jobs SET payload_json=?,updated_at=? WHERE id=?").bind(json(p), at, id)] });
    if (saved.conflict) continue;
    return;
  }
  throw new Error("配置保存冲突，请重试应用");
}

async function restoreStyleApplication(id: string) {
  for (let retry = 0; retry < 5; retry++) {
    const snapshot = await readStudioState(); if (!snapshot.data) throw new AiInputError("文章不存在");
    const job = await getStyleJob(id); const p = job.payload;
    const application = p.applications?.at(-1);
    if (!application || application.restoredAt) throw new AiInputError("没有可恢复的应用记录");
    const next = structuredClone(snapshot.data); const article = next.articles.find(a => a.id === job.articleId); if (!article) throw new AiInputError("文章不存在");
    const library = normalizeStyleLibrary(article.storySettings?.styleLibrary);
    if (job.kind === "learn") {
      if (configurationFingerprint(configurationOf(article)) !== configurationFingerprint(p.best)) throw new AiInputError("当前配置已经修改，请先对照学习历史，避免覆盖人工修改");
      const before = application.before;
      article.style = before.style;
      article.aiGenerateSettings = { ...article.aiGenerateSettings, proseControls: before.generate.proseControls, advanced: before.generate.advanced };
      library.scenes = before.scenes; library.activeVersionId = undefined;
      article.storySettings = { ...normalizeArticleStorySettings(article.storySettings), advancedStyle: before.advancedStyle };
    } else {
      if (library.calibrations[job.model]?.id !== id) throw new AiInputError("当前模型配置已经改变，不能直接恢复");
      if (application.previousCalibration) library.calibrations[job.model] = application.previousCalibration;
      else delete library.calibrations[job.model];
    }
    application.restoredAt = stamp(); p.applied = false; p.autoApplyPending = false; p.notice = "已恢复应用前配置，学习成果仍保存在历史中。";
    article.storySettings = { ...normalizeArticleStorySettings(article.storySettings), styleLibrary: library };
    const result = await applyStudioChanges(diffStudioData(snapshot.data, next), snapshot.revision, { recordSyncChange: false, additionalStatements: [getDatabase().prepare("UPDATE style_lab_jobs SET payload_json=?,updated_at=? WHERE id=?").bind(json(p), stamp(), id)] });
    if (!result.conflict) return;
  }
  throw new AiInputError("配置保存冲突，请重试恢复");
}

function trialContext(job: StyleJob, round: StyleRound, doc: number, scene: number): SelectedAiContext {
  const config = round.configuration; const plan = job.payload.outlines[doc];
  const previous = round.drafts.filter(d => d.referenceId === plan.referenceId);
  return { kind: "content", article: { id: "style-trial", title: "风格校准试写", summary: "仅依据本次固定大纲与前文写作", style: [config.style, advancedText(config.advancedStyle, STYLE_FIELDS), sceneInstructions(config.scenes)].filter(Boolean).join("\n"), location: "", negativeConstraints: "", outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE }, currentChapter: { id: "style-trial", title: "试写" }, currentOutline: { id: "style-trial", title: plan.scenes[scene].title, titleGenerationPending: false, plan: plan.scenes[scene].plan, content: "" }, previousOutlines: plan.scenes.slice(0, scene).map((s, i) => ({ id: `scene-${i}`, title: s.title, plan: s.plan })), previousContentTail: previous.map(d => d.text).join("\n\n").slice(-3000), chapterOutlines: [], characters: [], relationships: [], recentMessages: [], excellentFragments: [] };
}
export async function executeStyleStep(id: string) {
  let job = await getStyleJob(id); if (!["queued", "running"].includes(job.status)) return job;
  if (job.payload.executionOrigin && job.payload.executionOrigin !== currentTaskExecutionOrigin()) return job;
  const db = getDatabase(); const owner = crypto.randomUUID();
  const settings = (await readStudioState()).data?.settings;
  const capacity = normalizeTaskConcurrency(settings?.taskConcurrency);
  const until = new Date(Date.now() + 30_000).toISOString(); const now = stamp();
  const claim = await db.prepare("UPDATE style_lab_jobs SET status='running',owner=?,lease_until=?,updated_at=? WHERE id=? AND (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<?))) AND ((SELECT COUNT(*) FROM style_lab_jobs WHERE status='running' AND lease_until>?) + (SELECT COUNT(*) FROM ai_tasks WHERE status='running' AND lease_until>?) + (SELECT COUNT(*) FROM character_photo_jobs WHERE state='waiting' OR (state='running' AND lease_until>?)))<?").bind(owner, until, now, id, now, now, now, now, capacity).run();
  if (!Number(claim.meta?.changes)) return job;
  job = await getStyleJob(id);
  job.status = "running"; const p = job.payload;
  const abort = new AbortController(); let heartbeatBusy = false;
  const heartbeat = setInterval(() => { if (heartbeatBusy) return; heartbeatBusy = true; void db.prepare("UPDATE style_lab_jobs SET lease_until=? WHERE id=? AND status='running' AND owner=?").bind(new Date(Date.now() + 30_000).toISOString(), id, owner).run().then(r => { if (!Number(r.meta?.changes)) abort.abort(); }).catch(() => abort.abort()).finally(() => { heartbeatBusy = false; }); }, 5000);
  let round: StyleRound | undefined;
  async function assertOwned() {
    if (abort.signal.aborted) throw new Error("任务已停止");
    const row = await db.prepare("SELECT owner,status FROM style_lab_jobs WHERE id=?").bind(id).first<{ owner: string; status: string }>();
    if (row?.owner !== owner || row.status !== "running") throw new Error("任务执行权已转移");
  }
  async function save(release = false) {
    await assertOwned();
    if (release) addHistory(job, job.status === "completed" ? "completed" : "queued");
    const compactRound = round ? { ...round, drafts: round.drafts.map(({referenceId,scene}) => ({ referenceId, scene })) } : undefined;
    if (new TextEncoder().encode(json(p)).length > 1_800_000) throw new AiInputError("学习记录超过存储上限，请减少参考材料后新建任务");
    await db.batch([
      db.prepare("UPDATE app_settings SET value_json=CASE WHEN EXISTS(SELECT 1 FROM style_lab_jobs WHERE id=? AND owner=? AND status='running') THEN 'ready' ELSE NULL END WHERE key='state_write_guard'").bind(id, owner),
      ...(round ? [db.prepare("INSERT INTO style_lab_rounds(job_id,round_index,payload_json) VALUES(?,?,?) ON CONFLICT(job_id,round_index) DO UPDATE SET payload_json=excluded.payload_json").bind(id, round.index, json(compactRound))] : []),
      ...(round?.drafts.length ? [db.prepare("INSERT INTO style_lab_artifacts(job_id,round_index,scene_index,payload_json) VALUES(?,?,?,?) ON CONFLICT(job_id,round_index,scene_index) DO UPDATE SET payload_json=excluded.payload_json").bind(id, round.index, round.drafts.length - 1, json(round.drafts.at(-1)))] : []),
      db.prepare("UPDATE style_lab_jobs SET status=?,phase=?,payload_json=?,updated_at=?,owner=?,lease_until=?,error=NULL WHERE id=? AND owner=? AND status='running'").bind(job.status === "completed" ? "completed" : release ? "queued" : "running", job.phase, json(p), stamp(), release ? null : owner, release ? null : new Date(Date.now() + 30_000).toISOString(), id, owner),
      styleLabChangedStatement(db),
    ]);
  }
  async function attempt<T>(operation: () => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
      await assertOwned();
      try { return await operation(); }
      catch (error) {
        if (abort.signal.aborted || retry >= 2 || !isRetryableAiError(error)) throw error;
        const persisted = await getStyleJob(id), details = failureDetails(error);
        addHistory(persisted, "retrying", error instanceof Error ? error.message : "模型请求失败");
        Object.assign(persisted.payload.history!.at(-1)!, { retry: retry + 1, diagnostics: details.diagnostics });
        persisted.payload.inputTokens += details.inputTokens; persisted.payload.outputTokens += details.outputTokens;
        const saved = await db.batch([db.prepare("UPDATE style_lab_jobs SET payload_json=?,updated_at=? WHERE id=? AND owner=? AND status='running'").bind(json(persisted.payload), stamp(), id, owner), styleLabChangedStatement(db)]);
        if (!Number(saved[0]?.meta?.changes)) throw new Error("任务执行权已转移");
        p.history = persisted.payload.history; p.inputTokens += details.inputTokens; p.outputTokens += details.outputTokens;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(new Error("任务已停止")); };
          const timer = setTimeout(() => { abort.signal.removeEventListener("abort", cancel); resolve(); }, (retry + 1) * 1000);
          abort.signal.addEventListener("abort", cancel, { once: true });
          if (abort.signal.aborted) cancel();
        });
      }
    }
  }
  async function ask(system: string, data: unknown) { const response = await attempt(() => styleLabCompletion(job.model, system, data, abort.signal)); p.inputTokens += response.inputTokens; p.outputTokens += response.outputTokens; return response.result; }
  try {
    const model = await findModel(job.model);
    const reviewer = await findModel(p.reviewModel);
    if (!model || modelFingerprint(model) !== p.modelFingerprint || !reviewer || modelFingerprint(reviewer) !== p.reviewModelFingerprint) throw new AiInputError("模型设置已改变，请新建任务以保持对比条件一致");
    // Older tasks may have accepted an incomplete baseline as their best result.
    if (job.kind === "tune" && p.bestScore >= 0 && !await hasQualifiedStyleResult(job)) { p.bestScore = -1; p.bestRound = 0; p.best = p.base; }
    if (job.phase === "learn") {
      const ref = p.references[p.referenceIndex];
      const result = await ask(`你是风格学习助手。${LEARNING_RULES}只返回JSON：${json(configurationSchema())}`, { reference: ref, current: p.base });
      if (!String(record(result).style ?? "").trim()) throw new AiInputError("学习结果缺少风格说明，请重试");
      p.analyses.push(normalizeConfiguration(result)); p.referenceIndex++;
      if (p.referenceIndex >= p.references.length) { p.candidate = p.analyses[0]; job.phase = p.analyses.length > 1 ? "merge" : "validate"; }
    } else if (job.phase === "merge") {
      p.candidate = normalizeConfiguration(await ask(`${LEARNING_RULES}合并多篇分析，先提共性，差异作为场景偏好。只返回JSON：${json(configurationSchema())}`, { analyses: p.analyses })); job.phase = "validate";
    } else if (job.phase === "validate") {
      p.best = applyLocks(normalizeConfiguration(await ask(`${LEARNING_RULES}审查并修正候选配置中的剧情污染、设置冲突和重复归类。只返回修正后的配置JSON：${json(configurationSchema())}`, { candidate: p.candidate, references: p.references.map(r => ({ id: r.id, title: r.title })) })), p.base, p.locked);
      if (!p.best.style.trim()) throw new AiInputError("校验结果缺少风格说明");
      job.status = "completed"; job.phase = "completed";
    } else if (job.phase === "outline") {
      const ref = p.references[p.referenceIndex];
      const result = record(await ask('你是大纲整理助手。把参考文章拆成连续场景，完整覆盖原文事件与必要人物事实、知情变化和事件因果。仅整理，不续写，不评价文风，不复制原句。每场plan应自包含并交代后续必要事实；只返回JSON {"scenes":[{"title":"场景名","plan":"事实大纲","targetWords":1500}]}。每场不超过5000目标字数，最多30场。亲密情节仅保留非露骨的关系及剧情作用。', { reference: ref }));
      const scenes = (Array.isArray(result.scenes) ? result.scenes : []).slice(0, 30).map(v => { const s = record(v); return { title: String(s.title ?? "场景").slice(0, 150), plan: String(s.plan ?? "").slice(0, 10000), targetWords: Math.max(100, Math.min(5000, Number(s.targetWords) || 1500)) }; }).filter(s => s.plan);
      if (!scenes.length) throw new AiInputError("未能提取参考大纲，请重试");
      p.outlines.push({ referenceId: ref.id, scenes }); p.referenceIndex++;
      if (p.referenceIndex >= p.references.length) job.phase = "prepare";
    } else {
      const savedRound = await db.prepare("SELECT payload_json FROM style_lab_rounds WHERE job_id=? AND round_index=?").bind(id, p.round).first<string>("payload_json");
      round = savedRound ? JSON.parse(savedRound) : { index: p.round, configuration: p.candidate, drafts: [], evaluations: [] };
      if (savedRound) {
        const artifacts = (await db.prepare("SELECT scene_index,payload_json FROM style_lab_artifacts WHERE job_id=? AND round_index=? ORDER BY scene_index").bind(id,p.round).all<{scene_index:number;payload_json:string}>()).results ?? [];
        for (const artifact of artifacts) round!.drafts[artifact.scene_index] = JSON.parse(artifact.payload_json);
      }
      const current = round!;
      const allScenes = p.outlines.flatMap((outline, doc) => outline.scenes.map((_, scene) => ({ doc, scene })));
      const position = allScenes[current.drafts.length];
      const latest = current.drafts.at(-1);
      if (job.phase === "prepare" || job.phase === "generate") {
        if (!position) { job.phase = "evaluate"; }
        else {
          const context = trialContext(job, current, position.doc, position.scene); const config = current.configuration;
          const input = { outlineId: "style-trial", model: job.model, target: "content" as const, context, contentMode: "fresh" as const, targetWords: p.outlines[position.doc].scenes[position.scene].targetWords, proseControls: config.generate.proseControls, advanced: config.generate.advanced, reasoningEffort: config.generate.reasoningEffort, instruction: STYLE_TRIAL_INSTRUCTION };
          if (job.phase === "prepare") {
            const prepared = await attempt(() => generateWritingPreparation(input, createWritingPreparation(0, { strategy: "minimal", requireConfirmation: false }), abort.signal));
            current.change = prepared.brief; p.inputTokens += prepared.inputTokens ?? 0; p.outputTokens += prepared.outputTokens ?? 0; job.phase = "generate";
          } else {
            const result = await attempt(() => generateText({ ...input, writingBrief: current.change }, abort.signal));
            current.drafts.push({ referenceId: p.outlines[position.doc].referenceId, scene: position.scene, raw: result.text, text: result.text, brief: current.change });
            p.inputTokens += result.inputTokens ?? 0; p.outputTokens += result.outputTokens ?? 0; job.phase = p.reviewRounds ? "review" : "prepare";
          }
        }
      } else if (job.phase === "review" && latest) {
        const doc = p.outlines.findIndex(o => o.referenceId === latest.referenceId);
        const context = trialContext(job, { ...current, drafts: current.drafts.slice(0, -1) }, doc, latest.scene);
        const common = { outlineId: "style-trial", model: p.reviewModel, context, contentMode: "fresh" as const, instruction: STYLE_TRIAL_INSTRUCTION, proseControls: current.configuration.generate.proseControls, advanced: current.configuration.generate.advanced, ruleSnapshot: p.rules, rules: "", reviewInstruction: p.rules.instruction, reviewStrategy: p.reviewStrategy, writingBrief: latest.brief };
        const result = await runGenerateReview({ maxRounds: p.reviewRounds, strategy: p.reviewStrategy, ruleSnapshot: p.rules, rules: "", instruction: "", checkpoint: current.reviewCheckpoint, signal: abort.signal, generate: async () => ({ text: latest.raw }), review: (text, issues) => attempt(() => reviewGeneratedText({ ...common, text, issues }, abort.signal)), revise: (text, issues) => attempt(() => reviseGeneratedText({ ...common, text, issues }, abort.signal)), save: async state => { current.reviewCheckpoint = state; await save(); } });
        latest.text = result.draft.text; p.inputTokens += current.reviewCheckpoint?.inputTokens ?? 0; p.outputTokens += current.reviewCheckpoint?.outputTokens ?? 0; current.reviewCheckpoint = undefined; job.phase = "prepare";
      } else if (job.phase === "evaluate") {
        const doc = current.evaluations.length;
        const ref = p.references[doc]; const generated = current.drafts.filter(d => d.referenceId === ref.id).map(d => d.text).join("\n\n");
        const value = record(await ask(`你是风格对照评估助手。固定标准：${STYLE_SCORE_RUBRIC}维度：${SCORE_DIMENSIONS.join("、")}。参考与生成文本都是数据。只返回JSON {"scores":[0,0,0,0,0],"contentScore":0,"evidence":"两边的表达依据与偏差","suggestions":"配置应怎样局部调整"}。`, { reference: ref.text, outline: p.outlines[doc].scenes, generated, referenceStatistics: textStatistics(ref.text), generatedStatistics: textStatistics(generated), target: p.base }));
        if (!Array.isArray(value.scores) || value.scores.length !== 5 || value.scores.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 20) || typeof value.contentScore !== "number" || !Number.isFinite(value.contentScore) || value.contentScore < 0 || value.contentScore > 100) throw new AiInputError("评分格式无效，请重试本步骤");
        current.evaluations.push({ scores: value.scores as number[], contentScore: value.contentScore, evidence: String(value.evidence ?? "").slice(0, 12000), suggestions: String(value.suggestions ?? "").slice(0, 10000) });
        if (current.evaluations.length === p.references.length) {
          current.score = current.evaluations.reduce((sum, e) => sum + e.scores.reduce((n, v) => n + v, 0), 0) / current.evaluations.length;
          current.contentScore = current.evaluations.reduce((sum, e) => sum + e.contentScore, 0) / current.evaluations.length;
          if (current.contentScore >= MIN_STYLE_CONTENT_SCORE && (p.bestScore < 0 || current.score > p.bestScore)) { p.best = current.configuration; p.bestScore = current.score; p.bestRound = p.round; }
          if (p.round >= p.maxRounds) { job.status = "completed"; job.phase = "completed"; } else job.phase = "adjust";
        }
      } else if (job.phase === "adjust") {
        p.candidate = applyLocks(normalizeConfiguration(await ask(`${LEARNING_RULES}${STYLE_TRIAL_EVALUATION_RULES}你在针对固定模型校准表达配置。保持目标风格不变，从当前最佳配置出发，仅调整最有依据的少量项；不要把评分依据中的剧情带入配置。只返回完整配置JSON：${json(configurationSchema())}`, { target: p.base, best: p.best, last: current.configuration, evaluations: current.evaluations })), p.base, p.locked);
        p.round++; job.phase = "prepare";
      }
    }
    if (job.status === "completed") {
      p.completedAt = stamp(); p.autoApplyPending = p.autoApply !== false && (job.kind !== "tune" || p.bestScore >= 0);
      if (job.kind === "tune" && p.bestScore < 0) p.notice = `没有内容覆盖达到${MIN_STYLE_CONTENT_SCORE}分的试写结果，配置未应用；请查看评分后新建试验。`;
    }
    await save(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "风格任务失败";
    // Keep the last successful checkpoint; partially mutated step data is discarded.
    const persisted = await getStyleJob(id); addHistory(persisted, "failed", message);
    const details = failureDetails(error); persisted.payload.inputTokens += details.inputTokens; persisted.payload.outputTokens += details.outputTokens;
    if (details.diagnostics) persisted.payload.history!.at(-1)!.diagnostics = details.diagnostics;
    await db.batch([db.prepare("UPDATE style_lab_jobs SET status='failed',error=?,payload_json=?,owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND owner=? AND status='running'").bind(message, json(persisted.payload), stamp(), id, owner), styleLabChangedStatement(db)]);
  } finally { clearInterval(heartbeat); }
  if (job.status === "completed" && p.autoApplyPending) await attemptAutomaticApplication(id);
  return getStyleJob(id);
}

async function attemptAutomaticApplication(id: string) {
  try { await applyStyleResult(id); }
  catch (error) {
    const job = await getStyleJob(id);
    job.payload.autoApplyPending = false;
    job.payload.notice = `成果已保存，自动应用未完成：${error instanceof Error ? error.message : "请手动应用"}`;
    await saveJobPayload(job);
  }
}

export async function styleJobAction(id: string, action: string) {
  const job = await getStyleJob(id);
  if (action === "apply") { await applyStyleResult(id, true); return getStyleJob(id); }
  if (action === "restore") { await restoreStyleApplication(id); return getStyleJob(id); }
  if (["archive", "unarchive"].includes(action)) {
    if (!["completed", "cancelled", "failed"].includes(job.status)) throw new AiInputError("请先完成或停止任务，再归档历史");
    job.payload.archived = action === "archive"; await saveJobPayload(job); return getStyleJob(id);
  }
  const next = action === "pause" ? "paused" : action === "stop" ? "cancelled" : action === "resume" || action === "retry" ? "queued" : "";
  if (!next || ["completed", "cancelled"].includes(job.status) || next === "queued" && !["paused", "failed"].includes(job.status)) throw new AiInputError("当前状态不支持此操作");
  const db = getDatabase();
  const at = stamp();
  const allowed = next === "queued" ? "'paused','failed'" : next === "paused" ? "'queued','running'" : "'queued','running','paused','failed'";
  const result = await db.batch([db.prepare(`UPDATE style_lab_jobs SET status=?,payload_json=json_set(payload_json,'$.history',json_insert(COALESCE(json_extract(payload_json,'$.history'),'[]'),'$[#]',json_object('at',?,'status',?,'phase',phase)),'$.executionOrigin',CASE WHEN ?='queued' THEN ? ELSE json_extract(payload_json,'$.executionOrigin') END,'$.archived',json('false'),'$.notice',NULL),owner=NULL,lease_until=NULL,error=NULL,updated_at=? WHERE id=? AND status IN (${allowed})`).bind(next, at, next, next, currentTaskExecutionOrigin(), at, id), styleLabChangedStatement(db)]);
  if (!Number(result[0]?.meta?.changes)) throw new AiInputError("任务状态已改变，请刷新后重试");
  return getStyleJob(id);
}

export async function dispatchStyleJobs() {
  if (isCloudDatabase()) return;
  await ensureDatabase();
  const pending = await getDatabase().prepare("SELECT id FROM style_lab_jobs WHERE status='completed' AND json_extract(payload_json,'$.autoApplyPending')=1 ORDER BY updated_at LIMIT 1").first<{ id: string }>();
  if (pending) await attemptAutomaticApplication(pending.id);
  const row = await getDatabase().prepare("SELECT id FROM style_lab_jobs WHERE (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<?))) AND COALESCE(json_extract(payload_json,'$.executionOrigin'),'local')='local' ORDER BY updated_at,id LIMIT 1").bind(stamp()).first<{id:string}>();
  if (row) void executeStyleStep(row.id).catch(error => console.error("Style job dispatch failed", error));
}
