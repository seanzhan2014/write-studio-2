"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, MultiSelect, NumberInput, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { supportsText } from "@/lib/ai-model-capabilities";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { STYLE_FIELDS, GENERATE_FIELDS } from "@/lib/advanced-writing";
import { configurationFingerprint, configurationOf, MAX_REFERENCE_TOTAL, normalizeConfiguration, normalizeStyleLibrary, type ReferenceDocument, type ConfigurationVersion, type StyleConfiguration } from "@/lib/style-learning";
import type { StyleJob } from "@/db/style-lab";

const phases: Record<string, string> = { learn: "逐篇学习", merge: "提取共性与场景差异", validate: "检查配置与情节污染", outline: "提取并固定参考大纲", prepare: "整理试写准备稿", generate: "生成试写稿", review: "按现有规则审校", evaluate: "对照参考评价", adjust: "调整配置", completed: "已完成" };
const statuses: Record<string, string> = { queued: "等待执行", running: "进行中", paused: "已暂停", failed: "需要处理", completed: "已完成", cancelled: "已停止" };
let runtimeBusy = false;
async function api(path: string, body?: unknown) {
  const response = body === undefined ? await fetchFromServer(path, { cache: "no-store" }) : await fetchServerAction(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "风格任务请求失败"); return result;
}
export function StyleLabRuntime() {
  const studio = useStudio(); const studioRef = useRef(studio); studioRef.current = studio;
  useEffect(() => {
    let active = true;
    async function tick() {
      if (runtimeBusy || !active || navigator.onLine === false) return;
      runtimeBusy = true;
      try {
        const { jobs } = await api("/api/style-lab");
        const job = (jobs as StyleJob[]).find(j => j.status === "queued") ?? (jobs as StyleJob[]).find(j => j.status === "running");
        if (job) { const response = await api(`/api/style-lab/${job.id}/step`, {}); window.dispatchEvent(new CustomEvent("style-lab-progress")); if (response.job.status === "completed") await studioRef.current.refreshFromServer(); }
      } catch { /* Persisted failed jobs display their error in the panel; connectivity recovers on next tick. */ }
      finally { runtimeBusy = false; }
    }
    const timer = window.setInterval(() => { void tick(); }, 2500); void tick();
    const wake = () => { void tick(); }; window.addEventListener("style-lab-progress", wake);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("style-lab-progress", wake); };
  }, []);
  return null;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function configurationRows(c: StyleConfiguration) {
  return { "写作风格": c.style, ...Object.fromEntries(Object.entries(c.advancedStyle).map(([k,v]) => [`风格 · ${STYLE_FIELDS[k as keyof typeof STYLE_FIELDS][0]}`, v])), ...Object.fromEntries(Object.entries(c.generate.proseControls).map(([k,v]) => [`正文表达 · ${k}`, v])), ...Object.fromEntries(Object.entries(c.generate.advanced).map(([k,v]) => [`生成 · ${GENERATE_FIELDS[k as keyof typeof GENERATE_FIELDS][0]}`, v])), "场景偏好": c.scenes.map(s => `${s.name}（${s.when}）：${s.instruction}`).join("\n") };
}
function ConfigComparison({ before, after }: { before: StyleConfiguration; after: StyleConfiguration }) {
  const a: Record<string, string | undefined> = configurationRows(before); const b: Record<string, string | undefined> = configurationRows(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
  return <div className="style-comparison"><table><thead><tr><th>设置项</th><th>原设置</th><th>建议设置</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th>{key}</th><td>{a[key] || "自动"}</td><td>{b[key] || "自动"}</td></tr>)}</tbody></table>{!keys.length && <Text size="sm" c="dimmed">没有配置变化。</Text>}</div>;
}
export function StyleLabPanel() {
  const studio = useStudio(); const article = studio.currentArticle;
  const library = normalizeStyleLibrary(article.storySettings?.styleLibrary);
  const [references, setReferences] = useState<ReferenceDocument[]>(library.references);
  const [dirty, setDirty] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; providerName: string; hasSecret: boolean }>>([]);
  const [model, setModel] = useState(article.aiGenerateSettings.model);
  const [rounds, setRounds] = useState<number | string>(3);
  const [jobs, setJobs] = useState<StyleJob[]>([]);
  const [selected, setSelected] = useState<StyleJob | null>(null);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const refreshed = useRef(new Set<string>());
  const state = useRef({ article, studio, selected }); state.current = { article, studio, selected };
  const fileRef = useRef<HTMLInputElement>(null); const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setReferences(normalizeStyleLibrary(article.storySettings?.styleLibrary).references); setDirty(false); setSelected(null); }, [article.id]);
  useEffect(() => { void api("/api/models").then(result => setModels((result.models ?? []).filter(supportsText))).catch(error => setNotice(String(error.message))); }, []);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await api(`/api/style-lab?articleId=${encodeURIComponent(article.id)}`); if (!active) return; setJobs(result.jobs);
        const current = state.current.selected;
        if (current) { const detail = await api(`/api/style-lab/${current.id}`); if (active) setSelected(detail.job); }
        const completed = result.jobs.filter((j: StyleJob) => j.status === "completed" && j.payload.applied && !refreshed.current.has(j.id));
        if (completed.length && state.current.studio.saveStatus === "saved") { completed.forEach((j: StyleJob) => refreshed.current.add(j.id)); await state.current.studio.refreshFromServer(); }
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
    const result = await api("/api/style-lab", { articleId: article.id, kind, model, maxRounds: Number(rounds) });
    setSelected(result.job); setJobs(current => [result.job, ...current]); window.dispatchEvent(new CustomEvent("style-lab-progress"));
  }
  async function action(job: StyleJob, actionName: string) { const result = await api(`/api/style-lab/${job.id}`, { action: actionName }); setSelected(result.job); window.dispatchEvent(new CustomEvent("style-lab-progress")); await studio.refreshFromServer(); }
  function restore(version: ConfigurationVersion, asBase = false) {
    const current = configurationOf(article); const next = normalizeStyleLibrary(library);
    next.versions.push({ id: crypto.randomUUID(), name: "应用前配置", createdAt: new Date().toISOString(), configuration: current });
    if (version.model && !asBase) {
      next.calibrations[version.model] = { ...version, baseFingerprint: configurationFingerprint(current) };
      studio.updateArticle({ storySettings: { ...article.storySettings!, styleLibrary: normalizeStyleLibrary(next) } });
    } else {
      next.scenes = version.configuration.scenes;
      studio.updateArticle({ style: version.configuration.style, aiGenerateSettings: { ...article.aiGenerateSettings, proseControls: version.configuration.generate.proseControls, advanced: version.configuration.generate.advanced }, storySettings: { ...article.storySettings!, advancedStyle: version.configuration.advancedStyle, styleLibrary: normalizeStyleLibrary(next) } });
    }
    setNotice("已应用配置，可在版本记录中恢复。");
  }
  const active = jobs.some(j => ["queued", "running", "paused"].includes(j.status));
  const total = references.reduce((n,r) => n+r.text.length, 0);
  const lockOptions = [{ value: "style", label: "写作风格" }, { value: "proseControls", label: "全部正文表达选项" }, { value: "scenes", label: "场景偏好" }, ...Object.entries(STYLE_FIELDS).map(([k,[label]]) => ({ value: `style.${k}`, label: `风格 · ${label}` })), ...Object.entries(GENERATE_FIELDS).map(([k,[label]]) => ({ value: `generate.${k}`, label: `生成 · ${label}` }))];
  return <section className="form-card article-ai-task-section style-lab" aria-label="风格学习与微调">
    <header><h2>学习与微调</h2><Text size="sm" c="dimmed">从参考文章提取共性与场景偏好，再为指定模型校准。配置与试写过程均可回看。</Text></header>
    <details className="writing-advanced"><summary>参考文章<span>{references.length} 篇 · {total.toLocaleString()} 字符{dirty ? " · 未保存" : ""}</span></summary><Stack className="writing-advanced-body" gap="md">
      {references.map((ref,index) => <div className="style-reference" key={ref.id}><TextInput label={`参考文章 ${index+1} 名称`} value={ref.title} onChange={event => { const title = event.currentTarget.value; setReferences(current => current.map(r => r.id === ref.id ? { ...r, title } : r)); setDirty(true); }} /><Textarea label={`参考文章 ${index+1} 正文`} autosize minRows={5} maxRows={14} value={ref.text} maxLength={100000} onChange={event => { const text = event.currentTarget.value; setReferences(current => current.map(r => r.id === ref.id ? { ...r, text } : r)); setDirty(true); }} /><Button color="red" variant="subtle" size="compact-sm" onClick={() => { setReferences(current => current.filter(r => r.id !== ref.id)); setDirty(true); }}>移除参考文章 {index+1}</Button></div>)}
      <Group><Button variant="default" disabled={references.length >= 8} onClick={() => { setReferences(current => [...current, { id: crypto.randomUUID(), title: `参考文章 ${current.length+1}`, text: "" }]); setDirty(true); }}>粘贴参考文章</Button><Button variant="default" onClick={() => fileRef.current?.click()}>上传 TXT / Markdown</Button><Button variant="light" loading={busy} onClick={() => void perform(async () => { await saveReferences(); setNotice("参考文章已保存。"); })}>保存参考文章</Button></Group>
      <input ref={fileRef} type="file" hidden multiple accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => { const files=Array.from(event.currentTarget.files ?? []); event.currentTarget.value=""; void perform(async () => { if (files.length+references.length>8) throw new Error("最多添加8篇参考文章"); const additions=await Promise.all(files.map(async file => { const text=await file.text(); if(text.length>100000) throw new Error(`${file.name} 超过100,000字符`); return { id:crypto.randomUUID(), title:file.name, text }; })); if(total+additions.reduce((n,r)=>n+r.text.length,0)>MAX_REFERENCE_TOTAL) throw new Error("参考材料总长度超过240,000字符"); setReferences(current=>[...current,...additions]);setDirty(true); }); }} />
      <Text size="xs" c="dimmed">最多8篇，每篇100,000字符，总计240,000字符。模型输入不足时会明确提示。</Text>
    </Stack></details>
    <div className="style-lab-controls"><Select label="学习 / 生成模型" placeholder="选择文本模型" data={models.map(m => ({ value:m.id,label:`${m.providerName} · ${m.name}${m.hasSecret?"":"（需密钥）"}`,disabled:!m.hasSecret }))} value={model} onChange={value=>setModel(value??"")} /><NumberInput label="微调轮次" description={`基线1次＋最多${Number(rounds)||0}次调整，另含准备与评估请求。`} min={1} max={10} allowDecimal={false} value={rounds} onChange={setRounds} /></div>
    <Group><Button loading={busy} disabled={!model || !references.length || active} onClick={()=>void perform(()=>start("learn"))}>学习并设定</Button><Button variant="light" loading={busy} disabled={!model || !references.length || active} onClick={()=>void perform(()=>start("tune"))}>微调设定</Button></Group>
    {notice && <Alert role="status">{notice}</Alert>}
    <details className="writing-advanced"><summary>学习与微调高级设定<span>{library.locked.length?`锁定${library.locked.length}项`:"自动"}</span></summary><Stack gap="md" className="writing-advanced-body"><MultiSelect label="锁定设置项" description="学习和微调保留这些项目。" searchable clearable data={lockOptions} value={library.locked} onChange={locked=>studio.updateArticle({storySettings:{...article.storySettings!,styleLibrary:{...library,locked}}})} /><Text size="sm" c="dimmed">多篇材料提取共性，差异保存为场景偏好。微调固定参考大纲、生成模型和评分标准，并沿用当前审校设置。配置变化时结果保留待应用；模型设置变化时需要新建试验。</Text><Button variant="default" onClick={()=>importRef.current?.click()}>导入可复用配置</Button><input ref={importRef} type="file" hidden accept=".json" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void perform(async()=>{const value=JSON.parse(await file.text());if(value.kind!=="writer-studio-style-configuration"||!value.configuration)throw new Error("配置文件格式无效");const configuration=normalizeConfiguration(value.configuration);const version={id:crypto.randomUUID(),name:file.name,createdAt:new Date().toISOString(),configuration};studio.updateArticle({storySettings:{...article.storySettings!,styleLibrary:normalizeStyleLibrary({...library,versions:[...library.versions,version]})}});setNotice("配置已导入版本列表，可对照后应用。");});}} /></Stack></details>
    {!!library.scenes.length && <details className="writing-advanced"><summary>场景偏好<span>{library.scenes.length} 项</span></summary><div className="writing-advanced-body">{library.scenes.map((scene,i)=><div key={i}><strong>{scene.name}</strong><p>{scene.when}</p><p>{scene.instruction}</p></div>)}</div></details>}
    {!!jobs.length && <div className="style-job-list">{jobs.map(job=><article key={job.id} className="style-job"><div><strong>{job.kind==="learn"?"学习并设定":"微调设定"}</strong><Text size="sm">{statuses[job.status]} · {phases[job.phase]??job.phase}{job.kind==="tune"?` · ${job.payload.round===0?"基线":`第${job.payload.round}轮`}`:""}</Text>{job.error&&<Text c="red" size="sm">{job.error}</Text>}{job.payload.notice&&<Text size="sm">{job.payload.notice}</Text>}</div><Group gap="xs"><Button size="compact-sm" variant="subtle" onClick={()=>void perform(async()=>setSelected((await api(`/api/style-lab/${job.id}`)).job))}>查看过程</Button>{["queued","running"].includes(job.status)&&<Button size="compact-sm" variant="subtle" onClick={()=>void perform(()=>action(job,"pause"))}>暂停</Button>}{["paused","failed"].includes(job.status)&&<Button size="compact-sm" variant="subtle" onClick={()=>void perform(()=>action(job,job.status==="failed"?"retry":"resume"))}>{job.status==="failed"?"重试本步骤":"继续"}</Button>}{["queued","running","paused","failed"].includes(job.status)&&<Button size="compact-sm" color="red" variant="subtle" onClick={()=>void perform(()=>action(job,"stop"))}>停止</Button>}{job.status==="completed"&&!job.payload.applied&&<Button size="compact-sm" onClick={()=>void perform(()=>action(job,"apply"))}>应用结果</Button>}</Group></article>)}</div>}
    {selected&&<details className="writing-advanced" open><summary>本次过程与结果<span>{statuses[selected.status]}</span></summary><Stack gap="md" className="writing-advanced-body"><Text size="sm">模型：{models.find(m=>m.id===selected.model)?.name??selected.model} · 输入 {selected.payload.inputTokens.toLocaleString()} / 输出 {selected.payload.outputTokens.toLocaleString()} tokens</Text>{selected.kind==="tune"&&<Text size="sm">当前最佳：{selected.payload.bestRound===0?"基线":`第${selected.payload.bestRound}轮`} · {selected.payload.bestScore<0?"尚未评分":`${selected.payload.bestScore.toFixed(1)} / 100`}</Text>}<ConfigComparison before={selected.payload.base} after={selected.payload.best}/>{selected.payload.best.notes&&<Text className="style-prewrap" size="sm">{selected.payload.best.notes}</Text>}<details><summary>固定参考大纲</summary><pre className="style-prewrap">{selected.payload.outlines.map(o=>o.scenes.map(s=>`${s.title}\n${s.plan}`).join("\n\n")).join("\n\n")||"尚未提取"}</pre></details>{selected.rounds?.map(round=><details key={round.index}><summary>{round.index===0?"基线":`第${round.index}轮`} · {round.score===undefined?"进行中":`风格${round.score.toFixed(1)}分 · 内容${round.contentScore?.toFixed(1)}分`}</summary><ConfigComparison before={selected.payload.base} after={round.configuration}/>{round.evaluations.map((evaluation,i)=><div key={i}><Text fw={600}>参考文章 {i+1} · {evaluation.scores.join(" / ")}</Text><p className="style-prewrap">{evaluation.evidence}</p><p className="style-prewrap">{evaluation.suggestions}</p></div>)}{round.drafts.map((draft,i)=><details key={i}><summary>场景 {i+1} 试写稿</summary><pre className="style-prewrap">{draft.text}</pre>{draft.raw!==draft.text&&<details><summary>审校前版本</summary><pre className="style-prewrap">{draft.raw}</pre></details>}</details>)}</details>)}<Button variant="default" onClick={()=>download(`style-run-${selected.id}.json`,selected)}>导出本次完整记录</Button></Stack></details>}
    {!!library.versions.length&&<details className="writing-advanced"><summary>配置版本与复用<span>{library.versions.length} 个</span></summary><Stack gap="md" className="writing-advanced-body">{library.versions.slice().reverse().map(version=><div className="style-version" key={version.id}><strong>{version.name}</strong>{version.model&&<Text size="xs" c="dimmed">模型专用 · {models.find(m=>m.id===version.model)?.name??version.model}{version.baseFingerprint!==configurationFingerprint(configurationOf(article))?" · 基础配置已变更，建议复测":""}</Text>}<Group gap="xs"><Button size="compact-sm" variant="subtle" onClick={()=>restore(version)}>应用此版本</Button>{version.model&&<Button size="compact-sm" variant="subtle" onClick={()=>restore(version,true)}>另存为文章基础配置</Button>}<Button size="compact-sm" variant="subtle" onClick={()=>download("writer-studio-style.json",{kind:"writer-studio-style-configuration",version:1,configuration:version.configuration})}>导出复用</Button></Group><details><summary>查看配置差异</summary><ConfigComparison before={configurationOf(article)} after={version.configuration}/></details></div>)}</Stack></details>}
  </section>;
}
