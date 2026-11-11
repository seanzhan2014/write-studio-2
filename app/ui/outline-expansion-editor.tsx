"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Button, NumberInput, Select } from "@mantine/core";
import { convertTargetWordsToExpansion, EXPANSION_DECIMALS, EXPANSION_MULTIPLIER_HELP, isExpansionMultiplier, isSentenceTargetWords, MIN_EXPANSION_MULTIPLIER, MAX_EXPANSION_MULTIPLIER, MAX_SENTENCE_TARGET_WORDS, normalizeExpansionMultiplier, normalizeSentenceTargetWords, normalizeOutlineLengthMode, outlineLengthMode, resolveOutlineExpansion, sentenceLengthLabel, withOutlineLengthMode, type OutlineExpansion } from "@/lib/outline-expansion";
import { wordCount } from "@/lib/studio-display";

export function OutlineExpansionEditor({ plan, value, globalMultiplier, globalTargetWords, legacyTargetWords, documentView = false, onChange, onModeChange, children }: {
  plan: string; value?: OutlineExpansion; globalMultiplier?: number; globalTargetWords?: number; legacyTargetWords?: number; documentView?: boolean; onChange: (value: OutlineExpansion) => void; onModeChange?: (value: OutlineExpansion) => void; children: ReactNode;
}) {
  const [editing, setEditing] = useState(!plan.trim());
  const [selected, setSelected] = useState<number | null>(null);
  const [input, setInput] = useState<number | string>(10);
  const [inputMode, setInputMode] = useState<"multiplier" | "words">("multiplier");
  const [conversionWords, setConversionWords] = useState<number | string>(legacyTargetWords || "");
  const config = value ?? { enabled: false, marks: [] };
  const resolved = resolveOutlineExpansion(plan, config, globalMultiplier, globalTargetWords);
  const sentence = resolved?.sentences.find(sentence => sentence.start === selected);
  const invalid = !(inputMode === "words" ? isSentenceTargetWords(Number(input)) : isExpansionMultiplier(Number(input)));
  const planWords = wordCount(plan);
  const converted = convertTargetWordsToExpansion(plan, Number(conversionWords), config);
  const conversionValid = planWords > 0 && Number(conversionWords) > 0 && converted.defaultMultiplier !== undefined;
  function setLength(amount?: number, mode = inputMode) {
    if (!sentence) return;
    const marks = config.marks.filter(mark => mark.start !== sentence.start);
    if (amount !== undefined) marks.push({ start: sentence.start, end: sentence.end, text: sentence.text, ...(mode === "words" ? { targetWords: amount } : { multiplier: amount }) });
    onChange({ ...config, marks });
  }
  const sources = { sentence: "本句设置", previous: "跟随前句", outline: "大纲默认", global: "全局默认" };
  const wordsMode = config.mode === "words";
  const defaultControl = config.enabled && (wordsMode
    ? <NumberInput label="大纲默认字数" aria-label="大纲默认字数" value={config.defaultTargetWords ?? ""} placeholder={`跟随全局 ${normalizeSentenceTargetWords(globalTargetWords)} 字`} min={1} max={MAX_SENTENCE_TARGET_WORDS} decimalScale={0} suffix=" 字" onChange={next => { if (next === "") onChange({ ...config, defaultTargetWords: undefined }); else if (isSentenceTargetWords(next)) onChange({ ...config, defaultTargetWords: next }); }} />
    : <NumberInput label="大纲默认倍率" aria-label="大纲默认倍率" value={config.defaultMultiplier ?? ""} placeholder={`跟随全局 ${normalizeExpansionMultiplier(globalMultiplier)}×`} min={MIN_EXPANSION_MULTIPLIER} max={MAX_EXPANSION_MULTIPLIER} decimalScale={EXPANSION_DECIMALS} step={1} suffix="×" onChange={next => { if (next === "") onChange({ ...config, defaultMultiplier: undefined }); else if (isExpansionMultiplier(next)) onChange({ ...config, defaultMultiplier: next }); }} />);
  const converter = <details className="outline-expansion-converter"><summary>按总字数换算倍率</summary><div className="outline-multiplier-actions"><NumberInput label="换算目标字数" aria-label="换算目标字数" min={1} max={100000} decimalScale={0} value={conversionWords} onChange={setConversionWords} suffix=" 字" /><Button color="gray" variant="default" disabled={!conversionValid} onClick={() => onChange(converted)}>换算为倍率</Button></div><p>{planWords ? `大纲 ${planWords.toLocaleString("zh-CN")} 字${conversionValid ? ` · ${Number(conversionWords).toLocaleString("zh-CN")} ÷ ${planWords.toLocaleString("zh-CN")} ≈ ${converted.defaultMultiplier}×` : ""}。换算后保留本句设置，不再限制整体字数。` : "大纲为空，暂时无法换算；先使用全局默认倍率。"}</p></details>;
  const sourceLabel = `默认 ${wordsMode ? `${resolved?.defaultTargetWords} 字` : `${resolved?.defaultMultiplier}×`} · ${(wordsMode ? config.defaultTargetWords : config.defaultMultiplier) === undefined ? "来自全局" : "本大纲设置"}`;
  return <div className="outline-expansion-editor" onFocusCapture={event => { if (config.enabled && event.target instanceof HTMLTextAreaElement) setEditing(true); }}>
    {documentView && !config.enabled && <p className="outline-expansion-estimate">{legacyTargetWords && legacyTargetWords > 0 ? `整体字数限制 ${legacyTargetWords.toLocaleString("zh-CN")} 字` : "无整体字数限制"}</p>}
    {!documentView && <div className="outline-expansion-controls">
      <Select label="篇幅控制" aria-label="篇幅控制" allowDeselect={false} value={outlineLengthMode(config)} data={[{ value: "target", label: "总体字数控制" }, { value: "multiplier", label: "大纲句子倍率" }, { value: "words", label: "大纲句子字数" }]} onChange={mode => { const selectedMode = normalizeOutlineLengthMode(mode); const next = withOutlineLengthMode(config, selectedMode); if (onModeChange) onModeChange(next); else onChange(next); setSelected(null); }} />
      {defaultControl}
    </div>}
    {config.enabled && <>
      {!documentView && !wordsMode && converter}
      <div className="outline-expansion-toolbar">{documentView ? <details className="outline-expansion-defaults"><summary>{wordsMode ? "精确字数限制" : "精确倍数限制"} · {sourceLabel}</summary><div>{defaultControl}</div></details> : <span>{sourceLabel}</span>}<Button variant="subtle" color="gray" size="compact-sm" onClick={() => { setEditing(!editing); setSelected(null); }}>{editing ? "完成文字编辑" : "编辑大纲文字"}</Button></div>
      {!editing && plan.trim() ? <div className="outline-sentence-document" role="group" aria-label="按完整句子设置篇幅" onCopy={event => {
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
          <button className={`outline-sentence${selected === item.start ? " active" : ""}`} type="button" aria-label={`第${index + 1}句，${item.targetWords !== undefined ? `${item.targetWords}字` : `${item.multiplier}倍`}，${sources[item.source]}：${item.text}`} aria-pressed={selected === item.start} onClick={() => { setSelected(item.start); setInputMode(item.targetWords !== undefined ? "words" : "multiplier"); setInput(item.targetWords ?? item.multiplier!); }}>
            <span>{item.text}</span>{(item.source === "sentence" || index === 0) && <small className="outline-multiplier" aria-hidden="true">{item.targetWords !== undefined ? sentenceLengthLabel(item) : `×${item.multiplier}`}</small>}
          </button>
          {index === sentences.length - 1 ? plan.slice(item.end) : ""}
        </Fragment>)}
      </div> : children}
      {sentence && !editing && <div className="outline-sentence-settings" aria-label="所选整句篇幅">
        <p className="outline-sentence-quote">{sentence.text}</p>
        <span>{sources[sentence.source]} · 当前 {sentenceLengthLabel(sentence)} · 本句情节目标 {sentence.targetCharacters.toLocaleString("zh-CN")} 字</span>
        <Select label="本句控制" aria-label="本句控制" allowDeselect={false} value={inputMode} data={[{ value: "multiplier", label: "倍率" }, { value: "words", label: "字数" }]} onChange={mode => { const next = mode === "words" ? "words" : "multiplier"; setInputMode(next); setInput(next === "words" ? sentence.targetCharacters || normalizeSentenceTargetWords(globalTargetWords) : sentence.multiplier ?? normalizeExpansionMultiplier(globalMultiplier)); }} />
        <div className="outline-multiplier-actions"><NumberInput label={inputMode === "words" ? "本句字数" : "本句倍率"} aria-label={inputMode === "words" ? "本句字数" : "本句倍率"} value={input} onChange={setInput} min={inputMode === "words" ? 1 : MIN_EXPANSION_MULTIPLIER} max={inputMode === "words" ? MAX_SENTENCE_TARGET_WORDS : MAX_EXPANSION_MULTIPLIER} decimalScale={inputMode === "words" ? 0 : EXPANSION_DECIMALS} suffix={inputMode === "words" ? " 字" : "×"} error={invalid ? inputMode === "words" ? "请输入 1–100,000 的整数字数" : EXPANSION_MULTIPLIER_HELP : undefined} /><Button color="gray" variant="default" disabled={invalid} onClick={() => setLength(Number(input))}>{inputMode === "words" ? "应用字数" : "应用倍率"}</Button></div>
        <div className="outline-multiplier-presets">{(inputMode === "words" ? [100, 300, 500, 1000] : [1, 10, 100]).map(amount => <Button key={amount} color="gray" variant="subtle" size="compact-sm" onClick={() => { setInput(amount); setLength(amount); }}>{inputMode === "words" ? `${amount} 字` : `${amount}×`}</Button>)}<Button color="gray" variant="subtle" size="compact-sm" onClick={() => { setLength(); setSelected(null); }}>{resolved?.sentences[0].start === sentence.start ? wordsMode ? "恢复默认字数" : "恢复默认倍率" : "恢复跟随前句"}</Button><Button color="gray" variant="subtle" size="compact-sm" onClick={() => setSelected(null)}>关闭</Button></div>
      </div>}
      {!documentView && <><p className="outline-expansion-hint">点击整句设置字数或倍率；未单独设置的句子跟随前句，首句使用大纲默认，再跟随全局。标识不属于大纲文字。</p>
      <p className="outline-expansion-estimate">预计展开约 {resolved?.estimatedCharacters.toLocaleString("zh-CN")} 字 · 无整体字数限制{(resolved?.estimatedCharacters ?? 0) > 30000 ? "。篇幅较长，请留意所选模型的单次输出能力。" : ""}</p></>}
    </>}
    {!config.enabled && children}
  </div>;
}
