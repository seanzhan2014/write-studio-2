import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_GENERATE_OPTIONS, normalizeAiGenerateOptions } from "../lib/generate-options.ts";

test("closing summaries default off, inherit defaults and allow an explicit opt-out", () => {
  assert.equal(DEFAULT_AI_GENERATE_OPTIONS.includeClosingSummary, false);
  assert.equal(normalizeAiGenerateOptions({}).includeClosingSummary, false);
  assert.equal(normalizeAiGenerateOptions({ includeClosingSummary: "true" }).includeClosingSummary, false);
  const defaults = normalizeAiGenerateOptions({ includeClosingSummary: true });
  assert.equal(normalizeAiGenerateOptions({}, defaults).includeClosingSummary, true);
  assert.equal(normalizeAiGenerateOptions({ includeClosingSummary: false }, defaults).includeClosingSummary, false);
  assert.equal(normalizeAiGenerateOptions({}).closingSummaryLength, "none");
  assert.equal(defaults.closingSummaryLength, "short");
  for (const closingSummaryLength of ["none", "short", "medium", "auto"]) {
    const normalized = normalizeAiGenerateOptions({ closingSummaryLength, includeClosingSummary: true });
    assert.equal(normalized.closingSummaryLength, closingSummaryLength);
    assert.equal(normalized.includeClosingSummary, closingSummaryLength !== "none");
    assert.equal(normalizeAiGenerateOptions({}, normalized).closingSummaryLength, closingSummaryLength);
  }
  assert.equal(normalizeAiGenerateOptions({ closingSummaryLength: "long" }).closingSummaryLength, "auto");
  assert.deepEqual(normalizeAiGenerateOptions({ inheritance: { includeClosingSummary: "article" } }).inheritance, { closingSummaryLength: "article" });
});

test("AI Generate options inherit article defaults and normalize outline overrides", () => {
  const articleDefaults = normalizeAiGenerateOptions({
    ...DEFAULT_AI_GENERATE_OPTIONS,
    model: "provider:model",
    reasoningEffort: "high",
    targetWords: 6800,
    contentMode: "continue",
    includePrevious: false,
    reviewMaxRounds: 2,
    reviewInstruction: "  保留首尾空格以便继续编辑  ",
  });
  const outlineOptions = normalizeAiGenerateOptions({
    targetWords: 7200,
    proseControls: { dialogueDensity: "high", narrativePace: "fast" },
    firstAppearanceOverrides: { "character-valid": true, "character-false": false, "": true, invalid: "yes" },
  }, articleDefaults);

  assert.equal(outlineOptions.model, "provider:model");
  assert.equal(outlineOptions.reasoningEffort, "high");
  assert.equal(outlineOptions.targetWords, 7200);
  assert.equal(outlineOptions.contentMode, "continue");
  assert.equal(outlineOptions.includePrevious, false);
  assert.equal(outlineOptions.reviewInstruction, "  保留首尾空格以便继续编辑  ");
  assert.deepEqual(outlineOptions.proseControls, {
    dialogueDensity: "high",
    introspectionDensity: "auto",
    descriptionDetail: "auto",
    narrativePace: "fast",
    paragraphLength: "auto",
  });
  assert.deepEqual(outlineOptions.firstAppearanceOverrides, { "character-valid": true, "character-false": false });
  assert.equal(normalizeAiGenerateOptions({ ...outlineOptions, reasoningEffort: undefined }, articleDefaults).reasoningEffort, undefined);
});

test("AI Generate option normalization clamps unsafe values", () => {
  const normalized = normalizeAiGenerateOptions({
    model: " x ".repeat(200),
    reasoningEffort: "impossible",
    targetWords: 999_999,
    contentMode: "invalid",
    rewriteRetention: "invalid",
    reviewMaxRounds: 99,
    reviewInstruction: "a".repeat(25_000),
  });

  assert.equal(normalized.model.length, 300);
  assert.equal(normalized.reasoningEffort, undefined);
  assert.equal(normalized.targetWords, 100_000);
  assert.equal(normalized.contentMode, "fresh");
  assert.equal(normalized.rewriteRetention, "balanced");
  assert.equal(normalized.reviewMaxRounds, 10);
  assert.equal(normalized.reviewInstruction.length, 20_000);
});
