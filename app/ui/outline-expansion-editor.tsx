"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Button, NumberInput, Select } from "@mantine/core";
import { isExpansionMultiplier, MAX_EXPANSION_MULTIPLIER, normalizeExpansionMultiplier, resolveOutlineExpansion, type OutlineExpansion } from "@/lib/outline-expansion";

export function OutlineExpansionEditor({ plan, value, globalMultiplier, onChange, children }: {
  plan: string; value?: OutlineExpansion; globalMultiplier?: number; onChange: (value: OutlineExpansion) => void; children: ReactNode;
}) {
  const [editing, setEditing] = useState(!plan.trim());
  const [selected, setSelected] = useState<number | null>(null);
  const [input, setInput] = useState<number | string>(10);
  const config = value ?? { enabled: false, marks: [] };
  const resolved = resolveOutlineExpansion(plan, config, globalMultiplier);
  const sentence = resolved?.sentences.find(sentence => sentence.start === selected);
  const invalid = !isExpansionMultiplier(typeof input === "number" ? input : Number(input));
  function setMultiplier(multiplier?: number) {
    if (!sentence) return;
    const marks = config.marks.filter(mark => mark.start !== sentence.start);
    if (multiplier !== undefined) marks.push({ start: sentence.start, end: sentence.end, text: sentence.text, multiplier });
    onChange({ ...config, marks });
  }
  const sources = { sentence: "本句设置", previous: "跟随前句", outline: "大纲默认", global: "全局默认" };
  return <div className="outline-expansion-editor" onFocusCapture={event => { if (config.enabled && event.target instanceof HTMLTextAreaElement) setEditing(true); }}>
    <div className="outline-expansion-controls">
      <Select label="篇幅控制" aria-label="篇幅控制" allowDeselect={false} value={config.enabled ? "outline" : "target"} data={[{ value: "target", label: "总目标字数" }, { value: "outline", label: "大纲句子倍率" }]} onChange={mode => { onChange({ ...config, enabled: mode === "outline" }); setSelected(null); }} />
      {config.enabled && <NumberInput label="大纲默认倍率" aria-label="大纲默认倍率" value={config.defaultMultiplier ?? ""} placeholder={`跟随全局 ${normalizeExpansionMultiplier(globalMultiplier)}×`} min={0.1} max={MAX_EXPANSION_MULTIPLIER} decimalScale={1} step={1} suffix="×" onChange={next => { if (next === "") onChange({ ...config, defaultMultiplier: undefined }); else if (isExpansionMultiplier(next)) onChange({ ...config, defaultMultiplier: next }); }} />}
    </div>
    {config.enabled && <>
      <div className="outline-expansion-toolbar"><span>默认 {resolved?.defaultMultiplier}× · {config.defaultMultiplier === undefined ? "来自全局" : "本大纲设置"}</span><Button variant="subtle" color="gray" size="compact-sm" onClick={() => { setEditing(!editing); setSelected(null); }}>{editing ? "完成文字编辑" : "编辑大纲文字"}</Button></div>
      {!editing && plan.trim() ? <div className="outline-sentence-document" role="group" aria-label="按完整句子设置倍率" onCopy={event => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
        const fragment = range.cloneContents();
        fragment.querySelectorAll(".outline-multiplier").forEach(marker => marker.remove());
        event.clipboardData.setData("text/plain", fragment.textContent ?? "");
        event.preventDefault();
      }}>
        {resolved?.sentences.map((item, index, sentences) => <Fragment key={item.start}>
          {plan.slice(index ? sentences[index - 1].end : 0, item.start)}
          <button className={`outline-sentence${selected === item.start ? " active" : ""}`} type="button" aria-label={`第${index + 1}句，${item.multiplier}倍，${sources[item.source]}：${item.text}`} aria-pressed={selected === item.start} onClick={() => { setSelected(item.start); setInput(item.multiplier); }}>
            <span>{item.text}</span>{(item.source === "sentence" || index === 0) && <small className="outline-multiplier" aria-hidden="true">×{item.multiplier}</small>}
          </button>
          {index === sentences.length - 1 ? plan.slice(item.end) : ""}
        </Fragment>)}
      </div> : children}
      {sentence && !editing && <div className="outline-sentence-settings" aria-label="所选整句倍率">
        <p className="outline-sentence-quote">{sentence.text}</p>
        <span>{sources[sentence.source]} · 当前 {sentence.multiplier}× · {sentence.words} 字 → 约 {sentence.targetCharacters.toLocaleString("zh-CN")} 字</span>
        <div className="outline-multiplier-actions"><NumberInput label="本句倍率" aria-label="本句倍率" value={input} onChange={setInput} min={0.1} max={MAX_EXPANSION_MULTIPLIER} decimalScale={1} suffix="×" error={invalid ? "请输入 0.1–1000，最多一位小数" : undefined} /><Button color="gray" variant="default" disabled={invalid} onClick={() => setMultiplier(Number(input))}>应用倍率</Button></div>
        <div className="outline-multiplier-presets">{[1, 10, 100].map(multiplier => <Button key={multiplier} color="gray" variant="subtle" size="compact-sm" onClick={() => { setInput(multiplier); setMultiplier(multiplier); }}>{multiplier}×</Button>)}<Button color="gray" variant="subtle" size="compact-sm" onClick={() => { setMultiplier(); setSelected(null); }}>{resolved?.sentences[0].start === sentence.start ? "恢复默认倍率" : "恢复跟随前句"}</Button><Button color="gray" variant="subtle" size="compact-sm" onClick={() => setSelected(null)}>关闭</Button></div>
      </div>}
      <p className="outline-expansion-hint">点击整句设置倍率；未单独设置的句子跟随前句，首句使用大纲默认，再跟随全局。标识不属于大纲文字。</p>
      <p className="outline-expansion-estimate">预计展开约 {resolved?.estimatedCharacters.toLocaleString("zh-CN")} 字 · 无整体字数限制{(resolved?.estimatedCharacters ?? 0) > 30000 ? "。篇幅较长，请留意所选模型的单次输出能力。" : ""}</p>
    </>}
    {!config.enabled && children}
  </div>;
}
