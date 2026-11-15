"use client";
import { globalAiSettings } from "@/lib/ai-settings-inheritance";
import { resolveStyleLearningSettings } from "@/lib/style-learning-settings";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Group, MultiSelect, NumberInput, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { supportsText } from "@/lib/ai-model-capabilities";
import { STYLE_FIELDS, GENERATE_FIELDS } from "@/lib/advanced-writing";
import { configurationFingerprint, configurationOf, MAX_REFERENCE_TOTAL, normalizeConfiguration, normalizeStyleLibrary, type ReferenceDocument, type ConfigurationVersion } from "@/lib/style-learning";
import type { StyleJob } from "@/db/style-lab";
import { StyleJobHistory, ConfigComparison, styleLabApi as api, downloadStyleRecord as download } from "./style-job-history";

let runtimeBusy = false;
let styleTaskSummary = { active: 0, total: 0, failed: 0 };
export function useStyleTaskSummary() {
  const [summary, setSummary] = useState(styleTaskSummary);
  useEffect(() => { const update = () => setSummary(styleTaskSummary); window.addEventListener("style-lab-summary", update); update(); return () => window.removeEventListener("style-lab-summary", update); }, []);
  return summary;
}
export function useActiveStyleCount() {
  return useStyleTaskSummary().active;
}
export function StyleLabRuntime() {
  const studio = useStudio(); const studioRef = useRef(studio);
  useLayoutEffect(() => { studioRef.current = studio; }, [studio]);
  useEffect(() => {
    let active = true; const observed = new Set<string>();
    async function tick() {
      if (runtimeBusy || !active || navigator.onLine === false) return;
      runtimeBusy = true;
      try {
        const result = await api("/api/style-lab");
        if (!active) return;
        styleTaskSummary = { active: result.active ?? result.jobs.length, total: result.total ?? result.jobs.length, failed: result.failed ?? 0 };
        window.dispatchEvent(new CustomEvent("style-lab-summary"));
        const jobs = result.jobs as StyleJob[];
        for (const job of jobs) observed.add(job.id);
        for (const id of observed) {
          if (jobs.some(job => job.id === id)) continue;
          const { job } = await api("/api/style-lab/" + id);
          if (!active) return;
          if (job.payload.autoApplyPending) continue;
          observed.delete(id);
          if (["completed", "failed"].includes(job.status)) {
            window.dispatchEvent(new CustomEvent("style-lab-progress"));
            window.dispatchEvent(new CustomEvent("writer-studio-style-completed", { detail: job.status === "failed" ? "学习任务需要处理，可在 AI 任务中重试" : job.payload.applied ? "学习成果已保存并应用，可在学习历史中查看" : "学习成果已保存，等待应用" }));
            if (job.payload.applied && studioRef.current.saveStatus === "saved") await studioRef.current.refreshFromServer();
          }
        }
        // Self-hosted services own execution. The cloud retains its existing page-driven fallback.
        if (result.executionMode === "browser") {
          const job = jobs.find(j => j.status === "queued") ?? jobs.find(j => j.status === "running");
          if (job) { await api("/api/style-lab/" + job.id + "/step", {}); window.dispatchEvent(new CustomEvent("style-lab-progress")); }
        }
      } catch { /* The next tick recovers connectivity; durable failures remain in history. */ }
      finally { runtimeBusy = false; }
    }
    const timer = window.setInterval(() => void tick(), 2500); void tick();
    const wake = () => void tick(); window.addEventListener("style-lab-progress", wake);
    return () => { active = false; clearInterval(timer); window.removeEventListener("style-lab-progress", wake); };
  }, []);
  return null;
}
export function StyleLabPanel() {
  const studio = useStudio();
  return <ArticleStyleLabPanel key={studio.currentArticle.id} />;
}
function ArticleStyleLabPanel() {
  const studio = useStudio(); const article = studio.currentArticle;
  const library = normalizeStyleLibrary(article.storySettings?.styleLibrary);
  const [openReferenceId,setOpenReferenceId]=useState<string|null>(null);
  const [references, setReferences] = useState<ReferenceDocument[]>(library.references);
  const [dirty, setDirty] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; providerName: string; hasSecret: boolean }>>([]);
  const defaults = resolveStyleLearningSettings(studio.data.settings, globalAiSettings("generate", studio.data.settings).model);
  const [taskOptions, setTaskOptions] = useState<{ model?: string; maxRounds?: number | string; autoApply?: boolean }>({});
  const model = taskOptions.model ?? defaults.model;
  const rounds = taskOptions.maxRounds ?? defaults.maxRounds;
  const autoApply = taskOptions.autoApply ?? defaults.autoApply;
  const [active, setActive] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [executionMode, setExecutionMode] = useState<"server" | "browser" | null>(null);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const state = useRef({ article, studio });
  useLayoutEffect(() => { state.current = { article, studio }; }, [article, studio]);
  const fileRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void api("/api/models").then(result => setModels((result.models ?? []).filter(supportsText))).catch(error => setNotice(String(error.message))); }, []);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await api(`/api/style-lab?articleId=${encodeURIComponent(article.id)}&filter=active`); if (!active) return;
        setActive((result.active ?? result.jobs.filter((j: StyleJob) => ["queued", "running", "paused"].includes(j.status)).length) > 0);
        setExecutionMode(result.executionMode ?? null);
      } catch (error) { if (active) setNotice(error instanceof Error ? error.message : "读取失败"); }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 4000);
    const update = () => { void refresh(); }; window.addEventListener("style-lab-progress", update);
    return () => { active = false; clearInterval(timer); window.removeEventListener("style-lab-progress", update); };
  }, [article.id]);
  async function saveReferences() {
    const total = references.reduce((n,r) => n+r.text.length, 0);
    if (total > MAX_REFERENCE_TOTAL || references.some(r => r.text.length > 100000)) throw new Error("每篇最多100,000字符，总计最多240,000字符");
    const current = state.current.article;
    state.current.studio.updateArticle({ storySettings: { ...current.storySettings!, styleLibrary: { ...normalizeStyleLibrary(current.storySettings?.styleLibrary), references } } });
    if (!await state.current.studio.saveNow()) throw new Error("参考文章尚未保存，请先完成同步");
    setDirty(false);
  }
  async function perform(operation: () => Promise<void>) { if (busy) return; setBusy(true); setNotice(""); try { await operation(); } catch(error) { setNotice(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); } }
  async function start(kind: "learn" | "tune") {
    await saveReferences();
    const result = await api("/api/style-lab", { articleId: article.id, kind, model, maxRounds: Number(rounds), autoApply });
    setSelectedJobId(result.job.id); setActive(true); setNotice("任务已提交"); window.dispatchEvent(new CustomEvent("style-lab-progress"));
  }
  function restore(version: ConfigurationVersion, asBase = false) {
    const current = configurationOf(article, studio.data.settings); const next = normalizeStyleLibrary(library);
    next.versions.push({ id: crypto.randomUUID(), name: "应用前配置", createdAt: new Date().toISOString(), configuration: current });
    if (version.model && !asBase) {
      next.calibrations[version.model] = { ...version, baseFingerprint: configurationFingerprint(current) };
      studio.updateArticle({ storySettings: { ...article.storySettings!, styleLibrary: normalizeStyleLibrary(next) } });
    } else {
      next.scenes = version.configuration.scenes;
      next.expression = { proseControls: version.configuration.generate.proseControls, advanced: version.configuration.generate.advanced };
      next.activeVersionId = version.id;
      studio.updateArticle({ style: version.configuration.style, storySettings: { ...article.storySettings!, advancedStyle: version.configuration.advancedStyle, styleLibrary: normalizeStyleLibrary(next) } });
    }
    setNotice("已应用配置");
  }
  const total = references.reduce((n,r) => n+r.text.length, 0);
  const lockOptions = [{ value: "style", label: "写作风格" }, { value: "proseControls", label: "全部正文表达选项" }, { value: "scenes", label: "场景偏好" }, ...Object.entries(STYLE_FIELDS).map(([k,[label]]) => ({ value: `style.${k}`, label: `风格 · ${label}` })), ...Object.entries(GENERATE_FIELDS).map(([k,[label]]) => ({ value: `generate.${k}`, label: `生成 · ${label}` }))];
  return <section className="article-ai-task-section style-lab ai-task-sections" aria-label="风格学习与微调">
    <section className="ai-task-section" aria-label="参考文章"><div className="ai-task-section-heading"><h2>参考文章</h2><Text size="sm" c="dimmed">{references.length} 篇 · {total.toLocaleString()} 字符{dirty ? " · 未保存" : ""}</Text></div><Stack gap="md">
      {references.map((ref,index) => <details className="style-reference" key={ref.id} open={openReferenceId===ref.id}><summary onClick={event=>{event.preventDefault();setOpenReferenceId(current=>current===ref.id?null:ref.id);}}><strong>{ref.title || `参考文章 ${index+1}`}</strong><span>{ref.text.length.toLocaleString()} 字符</span></summary><TextInput label={`参考文章 ${index+1} 名称`} value={ref.title} onChange={event => { const title = event.currentTarget.value; setReferences(current => current.map(r => r.id === ref.id ? { ...r, title } : r)); setDirty(true); }} /><Textarea label={`参考文章 ${index+1} 正文`} autosize minRows={5} maxRows={14} value={ref.text} maxLength={100000} onChange={event => { const text = event.currentTarget.value; setReferences(current => current.map(r => r.id === ref.id ? { ...r, text } : r)); setDirty(true); }} /><Button color="red" variant="subtle" size="compact-sm" onClick={() => { setReferences(current => current.filter(r => r.id !== ref.id)); setDirty(true); }}>移除参考文章 {index+1}</Button></details>)}
      <Group><Button variant="default" disabled={references.length >= 8} onClick={() => { const id=crypto.randomUUID();setReferences(current => [...current, { id, title: `参考文章 ${current.length+1}`, text: "" }]);setOpenReferenceId(id);setDirty(true); }}>粘贴参考文章</Button><Button variant="default" onClick={() => fileRef.current?.click()}>上传 TXT / Markdown</Button><Button variant="light" loading={busy} onClick={() => void perform(async () => { await saveReferences(); setNotice("参考文章已保存。"); })}>保存参考文章</Button></Group>
      <input ref={fileRef} type="file" hidden multiple accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => { const files=Array.from(event.currentTarget.files ?? []); event.currentTarget.value=""; void perform(async () => { if (files.length+references.length>8) throw new Error("最多添加8篇参考文章"); const additions=await Promise.all(files.map(async file => { const text=await file.text(); if(text.length>100000) throw new Error(`${file.name} 超过100,000字符`); return { id:crypto.randomUUID(), title:file.name, text }; })); if(total+additions.reduce((n,r)=>n+r.text.length,0)>MAX_REFERENCE_TOTAL) throw new Error("参考材料总长度超过240,000字符"); setReferences(current=>[...current,...additions]);setDirty(true); }); }} />
      <Text size="xs" c="dimmed">最多8篇，每篇100,000字符，总计240,000字符。模型输入不足时会明确提示。</Text>
    </Stack></section>
    <section className="ai-task-section ai-task-learning-options" aria-label="学习与微调"><h2>学习与微调</h2>
    <div className="style-lab-controls"><Select searchable nothingFoundMessage="没有匹配的模型" label="学习 / 生成模型" placeholder="选择文本模型" data={models.map(m => ({ value:m.id,label:`${m.providerName} · ${m.name}${m.hasSecret?"":"（需密钥）"}`,disabled:!m.hasSecret }))} value={model} onChange={value=>setTaskOptions(current => ({ ...current, model: value ?? "" }))} /><NumberInput label="微调轮次" description={`基线1次＋最多${Number(rounds)||0}次调整，另含准备与评估请求。`} min={1} max={10} allowDecimal={false} value={rounds} onChange={maxRounds => setTaskOptions(current => ({ ...current, maxRounds }))} /></div>
    <Checkbox label="完成后自动应用" description="文章配置或参考资料有变化时，成果会保留为待应用。" checked={autoApply} onChange={event => { const autoApply = event.currentTarget.checked; setTaskOptions(current => ({ ...current, autoApply })); }} />
    {Object.keys(taskOptions).length > 0 && <Button variant="subtle" size="compact-sm" onClick={() => setTaskOptions({})}>恢复全局任务默认</Button>}
    <Group><Button loading={busy} disabled={!model || !references.length || active} onClick={()=>void perform(()=>start("learn"))}>学习并设定</Button><Button variant="light" loading={busy} disabled={!model || !references.length || active} onClick={()=>void perform(()=>start("tune"))}>微调设定</Button></Group>
    {executionMode && <Text size="sm" c="dimmed">{executionMode === "server" ? "由本机服务在后台执行，服务运行时关闭页面也会继续；重启后接续已保存进度。" : "当前云端任务需要保留一个应用页面，过程与结果会持续保存。"}</Text>}
    <Button variant="subtle" size="compact-sm" onClick={() => window.dispatchEvent(new CustomEvent("writer-studio-open-task", { detail: "style:" + selectedJobId }))}>在 AI 任务中查看学习与微调</Button>
    {notice && <Alert role="status">{notice}</Alert>}
    </section>
    <details className="writing-advanced"><summary>学习与微调高级设定<span>{library.locked.length?`锁定${library.locked.length}项`:"自动"}</span></summary><Stack gap="md" className="writing-advanced-body"><MultiSelect label="锁定设置项" searchable clearable data={lockOptions} value={library.locked} onChange={locked=>studio.updateArticle({storySettings:{...article.storySettings!,styleLibrary:{...library,locked}}})} /><Button variant="default" onClick={()=>importRef.current?.click()}>导入可复用配置</Button><input ref={importRef} type="file" hidden accept=".json" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void perform(async()=>{const value=JSON.parse(await file.text());if(value.kind!=="writer-studio-style-configuration"||!value.configuration)throw new Error("配置文件格式无效");const configuration=normalizeConfiguration(value.configuration);const version={id:crypto.randomUUID(),name:file.name,createdAt:new Date().toISOString(),configuration};studio.updateArticle({storySettings:{...article.storySettings!,styleLibrary:normalizeStyleLibrary({...library,versions:[...library.versions,version]})}});setNotice("配置已导入版本列表，可对照后应用。");});}} /></Stack></details>
    {!!library.scenes.length && <details className="writing-advanced"><summary>场景偏好<span>{library.scenes.length} 项</span></summary><div className="writing-advanced-body">{library.scenes.map((scene,i)=><div key={i}><strong>{scene.name}</strong><p>{scene.when}</p><p>{scene.instruction}</p></div>)}</div></details>}
    <StyleJobHistory articleId={article.id} initialJobId={selectedJobId} />
    {!!library.versions.length&&<details className="writing-advanced"><summary>配置版本与复用<span>{library.versions.length} 个</span></summary><Stack gap="md" className="writing-advanced-body">{library.versions.slice().reverse().map(version=><div className="style-version" key={version.id}><strong>{version.name}</strong>{version.model&&<Text size="xs" c="dimmed">模型专用 · {models.find(m=>m.id===version.model)?.name??version.model}{version.baseFingerprint!==configurationFingerprint(configurationOf(article, studio.data.settings))?" · 基础配置已变更，建议复测":""}</Text>}<Group gap="xs"><Button size="compact-sm" variant="subtle" onClick={()=>restore(version)}>应用此版本</Button>{version.model&&<Button size="compact-sm" variant="subtle" onClick={()=>restore(version,true)}>另存为文章基础配置</Button>}<Button size="compact-sm" variant="subtle" onClick={()=>download("writer-studio-style.json",{kind:"writer-studio-style-configuration",version:1,configuration:version.configuration})}>导出复用</Button></Group><details><summary>查看配置差异</summary><ConfigComparison before={configurationOf(article, studio.data.settings)} after={version.configuration}/></details></div>)}</Stack></details>}
  </section>;
}
