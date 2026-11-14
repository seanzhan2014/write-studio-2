import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/generate-model-usage.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { normalizeGenerateModelUsage, rememberGenerateModelUsage, sortGenerateModelOptions } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const task = (model, createdAt, extra = {}) => ({ target: "正文", model, createdAt, ...extra });
const resolve = (reference) => ({ "Provider-Old name": "model-a", "Model B": "model-b" })[reference];

test("generation history ranks the latest use across outlines without mutating the original options", () => {
  const options = [{ value: "" }, { value: "model-a" }, { value: "model-b" }, { value: "unused" }];
  const usage = rememberGenerateModelUsage({}, [
    task("Model B", "2026-11-13T10:00:00Z"),
    task("Renamed model", "2026-11-14T10:00:00Z", { contextOptions: { configuredModelId: "model-a" } }),
    task("Provider-Old name", "2026-11-12T10:00:00Z"),
  ], resolve);
  assert.deepEqual(sortGenerateModelOptions(options, usage).map(item => item.value), ["model-a", "model-b", "", "unused"]);
  assert.deepEqual(options.map(item => item.value), ["", "model-a", "model-b", "unused"]);
});

test("local generation participates in recency and unrelated or invalid tasks do not affect order", () => {
  const usage = rememberGenerateModelUsage({}, [
    task("Model B", "2026-11-13T10:00:00Z"),
    task("", "2026-11-14T10:00:00Z"),
    task("Provider-Old name", "2026-11-15T10:00:00Z", { target: "AI Chat" }),
    task("Provider-Old name", "invalid"),
    task("Deleted model", "2026-11-15T10:00:00Z"),
  ], resolve);
  assert.deepEqual(Object.keys(usage).sort(), ["", "model-b"]);
  assert.deepEqual(sortGenerateModelOptions([{ value: "model-b" }, { value: "" }], usage).map(item => item.value), ["", "model-b"]);
});

test("remembered usage survives removed history and preserves existing order for equal timestamps", () => {
  const previous = { "model-a": Date.parse("2026-11-14T10:00:00Z"), "model-b": Date.parse("2026-11-14T10:00:00Z") };
  assert.equal(rememberGenerateModelUsage(previous, [], resolve), previous);
  assert.equal(rememberGenerateModelUsage(previous, [task("Provider-Old name", "2026-11-12T10:00:00Z")], resolve), previous);
  assert.deepEqual(sortGenerateModelOptions([{ value: "model-b" }, { value: "model-a" }], previous).map(item => item.value), ["model-b", "model-a"]);
});

test("invalid stored usage cannot produce a broken sort", () => {
  for (const value of [null, [], "invalid", 1]) assert.deepEqual(normalizeGenerateModelUsage(value), {});
  assert.deepEqual(normalizeGenerateModelUsage({ "": 3, valid: 2, negative: -1, zero: 0, text: "4", infinite: Infinity, invalid: NaN }), { "": 3, valid: 2 });
});
