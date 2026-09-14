import assert from "node:assert/strict";
import test from "node:test";
import { appearanceColors, COLOR_PRESETS, DEFAULT_APPEARANCE, normalizeAppearance } from "../lib/appearance.mjs";

test("old or malformed appearance preferences fall back to usable defaults", () => {
  assert.deepEqual(normalizeAppearance(), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ theme: "unknown", accentColor: "var(--invalid)", uiFont: "unknown", editorFont: null, fontSize: NaN, lineHeight: Infinity }), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ editorFont: "serif", fontSize: 22 }), { ...DEFAULT_APPEARANCE, editorFont: "serif", fontSize: 22 });
  assert.equal(normalizeAppearance({ accentColor: "#AA44CC" }).accentColor, "#aa44cc");
  assert.equal(normalizeAppearance({ contentWidth: -10 }).contentWidth, 640);
});

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test("preset and extreme custom colors keep accent text and button labels readable in both modes", () => {
  const colors = [...COLOR_PRESETS.map((item) => item.color), "#ffffff", "#000000", "#ffff00", "#00ffff", "#ff00ff", "#777777"];
  for (const color of colors) for (const dark of [false, true]) {
    const tokens = appearanceColors(color, dark);
    assert.ok(contrast(tokens["--accent"], tokens["--surface"]) >= 4.5, `${color}, dark=${dark}: accent text`);
    assert.ok(contrast(tokens["--accent"], tokens["--accent-contrast"]) >= 4.5, `${color}, dark=${dark}: button label`);
    assert.ok(contrast(tokens["--accent-hover"], tokens["--accent-contrast"]) >= 4.5, `${color}, dark=${dark}: hovered button label`);
  }
});
