"use client";

import { Button, ColorInput, NativeSelect, SegmentedControl, Slider } from "@mantine/core";
import { useState, type CSSProperties } from "react";
import { COLOR_PRESETS, DEFAULT_APPEARANCE, FONT_OPTIONS, type FontChoice } from "@/lib/appearance.mjs";
import { useStudio } from "../studio-state";

function CustomColor({ color, onChange }: { color: string; onChange: (value: string) => void }) {
  const [input, setInput] = useState({ source: color, value: color });
  const draft = input.source === color ? input.value : color;
  const valid = /^#[\da-f]{6}$/i.test(draft);
  return <ColorInput label="自定义色调" format="hex" value={draft}
    error={!valid ? "请输入完整色值，如 #2563a6" : undefined}
    onChange={(value) => { const complete = /^#[\da-f]{6}$/i.test(value); setInput({ source: complete ? value.toLowerCase() : color, value }); if (complete) onChange(value); }}
    onBlur={() => { if (!valid) setInput({ source: color, value: color }); }} />;
}

export function AppearancePanel() {
  const studio = useStudio();
  const settings = studio.data.settings;
  const [resetNotice, setResetNotice] = useState("");
  const fontOptions = FONT_OPTIONS.map(({ value, label }) => ({ value, label }));
  const isDefault = Object.entries(DEFAULT_APPEARANCE).every(([key, value]) => settings[key as keyof typeof DEFAULT_APPEARANCE] === value);
  return <div className="appearance-panel">
    <div className="appearance-intro"><Button variant="default" size="xs" disabled={isDefault} onClick={() => { studio.updateSettings(DEFAULT_APPEARANCE); setResetNotice("已恢复默认外观"); }}>恢复默认外观</Button></div>
    {resetNotice && <p className="appearance-notice" role="status">{resetNotice}</p>}
    <section className="setting-section" aria-labelledby="appearance-theme-title">
      <div className="setting-title"><h2 id="appearance-theme-title">主题与色调</h2></div>
      <div className="appearance-section-body">
        <div className="appearance-field"><span id="appearance-mode-label" className="ui-label">明暗模式</span><SegmentedControl aria-labelledby="appearance-mode-label" fullWidth value={settings.theme} data={[{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }]} onChange={(value) => studio.updateSettings({ theme: value as typeof settings.theme })} /></div>
        <div className="appearance-field"><span className="ui-label" id="appearance-palette-label">预设色调</span><div className="appearance-palette" role="group" aria-labelledby="appearance-palette-label">{COLOR_PRESETS.map((preset) => <button type="button" key={preset.color} className="appearance-swatch" aria-pressed={settings.accentColor === preset.color} onClick={() => studio.updateSettings({ accentColor: preset.color })}><span className="appearance-swatch-color" style={{ "--swatch-color": preset.color } as CSSProperties} aria-hidden="true">{settings.accentColor === preset.color ? "✓" : ""}</span><span>{preset.label}</span></button>)}</div></div>
        <CustomColor color={settings.accentColor} onChange={(accentColor) => studio.updateSettings({ accentColor })} />
      </div>
    </section>
    <section className="setting-section" aria-labelledby="appearance-font-title">
      <div className="setting-title"><h2 id="appearance-font-title">字体与排版</h2></div>
      <div className="appearance-section-body">
        <div className="appearance-font-grid"><NativeSelect label="界面字体" data={fontOptions} value={settings.uiFont} onChange={(event) => studio.updateSettings({ uiFont: event.currentTarget.value as FontChoice })} /><NativeSelect label="正文字体" data={fontOptions} value={settings.editorFont} onChange={(event) => studio.updateSettings({ editorFont: event.currentTarget.value as FontChoice })} /></div>
        <div className="appearance-range"><label id="appearance-size-label">正文字号 <output>{settings.fontSize}px</output></label><Slider thumbLabel="正文字号" min={14} max={24} step={1} value={settings.fontSize} onChange={(fontSize) => studio.updateSettings({ fontSize })} /></div>
        <div className="appearance-range"><label id="appearance-line-label">正文行高 <output>{settings.lineHeight.toFixed(1)}</output></label><Slider thumbLabel="正文行高" min={1.4} max={2.2} step={0.1} precision={1} value={settings.lineHeight} onChange={(lineHeight) => studio.updateSettings({ lineHeight })} /></div>
        <div className="appearance-range"><label id="appearance-width-label">正文宽度 <output>{settings.contentWidth}px</output></label><Slider thumbLabel="正文宽度" min={640} max={1200} step={20} value={settings.contentWidth} onChange={(contentWidth) => studio.updateSettings({ contentWidth })} /></div>
      </div>
    </section>
    <section className="appearance-preview" aria-labelledby="appearance-preview-title">
      <div className="appearance-preview-toolbar"><h2 id="appearance-preview-title">即时预览</h2><span>写作中</span></div>
      <div className="appearance-preview-page" style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight, maxWidth: settings.contentWidth }}><h3>第一章 · 风起时</h3><p>窗外的风翻动了书页。她拿起笔，把那些尚未说出口的话，一句一句写进故事里。</p><p>“慢慢写，”她想，“好的故事，值得等待。”</p></div>
      <div className="appearance-preview-footer"><span>每一个字，都有自己的节奏。</span><span className="appearance-preview-selection">正文</span></div>
    </section>
  </div>;
}
