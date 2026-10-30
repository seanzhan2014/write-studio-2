import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../lib/image-model-parameters.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseImageParameterText, validateImageParameters, formatImageParameterText, defaultImageParameters, imageParameterDraft, readImageParameterDraft, splitCivitaiParameters } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const moss = { adapterKind: "civitai", modelId: "urn:air:mossimage:checkpoint:civitai:3018302@3426693+3321739" };

test("comma-separated image parameters preserve numeric, boolean and string values", () => {
  assert.deepEqual(parseImageParameterText('width=1216，height=832,seed=0,sampler="heunpp2"', moss), { width: 1216, height: 832, seed: 0, sampler: "heunpp2" });
  assert.deepEqual(parseImageParameterText('enable_prompt_expansion=false,seed=42', { adapterKind: "spicyapi" }), { enable_prompt_expansion: false, seed: 42 });
  assert.deepEqual(parseImageParameterText('output_format=webp,output_compression=85', {}), { output_format: "webp", output_compression: 85 });
  assert.deepEqual(parseImageParameterText(formatImageParameterText({ seed: 42, sampler: "euler" }), moss), { seed: 42, sampler: "euler" });
  assert.deepEqual(parseImageParameterText(" , ， \n", moss), {});
});

test("parameter parsing validates structure without a provider parameter allowlist", () => {
  for (const text of ['seed=1,seed=2', 'steps', 'seed=9007199254740992', 'sampler="unclosed', '__proto__=true', 'constructor=true', 'workflow.__proto__=true', 'data={"__proto__":true}', 'data=[1,2', 'data={"x":1]', 'data=[1,]']) assert.throws(() => parseImageParameterText(text, moss), undefined, text);
  const custom = { allowMatureContent: true, custom_flag: false, steps: 0, cfgScale: 0, width: 1025, sampler: "future_sampler", scheduler: "linear_quadratic", "workflow.futureField": { values: [0, false, null, "a,b"] }, "query.custom-option": "value", seed: null };
  assert.deepEqual(parseImageParameterText(formatImageParameterText(custom), moss), custom);
  assert.deepEqual(validateImageParameters({ unknown: true }), { unknown: true });
  assert.throws(() => validateImageParameters({ steps: Infinity }, moss), /无效/);
  assert.throws(() => validateImageParameters({ custom: undefined }, moss), /无效/);
  assert.throws(() => validateImageParameters({ custom: new Date() }, moss), /无效/);
  assert.deepEqual(parseImageParameterText('custom={"a":[1,2],"b":"x,y"},seed=0', moss), { custom: { a: [1, 2], b: "x,y" }, seed: 0 });
});

test("provider-specific validation and default restoration retain existing MOSS and SD behavior", () => {
  assert.deepEqual(defaultImageParameters(moss), { steps: 12, cfgScale: 1, sampler: "heunpp2", scheduler: "simple" });
  assert.equal(defaultImageParameters({ ...moss, modelId: moss.modelId.replace("3426693", "999") }).steps, 25);
  const sd = { adapterKind: "civitai", modelId: "urn:air:sdxl:checkpoint:civitai:1@2" };
  assert.deepEqual(parseImageParameterText("sampleMethod=heun,schedule=karras,clipSkip=2,uCache=off", sd), { sampleMethod: "heun", schedule: "karras", clipSkip: 2, uCache: "off" });
  assert.deepEqual(validateImageParameters({ clipSkip: 2 }, moss), { clipSkip: 2 });
  assert.deepEqual(validateImageParameters({ steps: 12 }, {}), { steps: 12 });
});

test("legacy Civitai settings reopen in separate workflow and image areas without changing their request scopes", () => {
  const legacy = { steps: 18, seed: 0, width: 1216, allowMatureContent: true, currencies: ["yellow"], "workflow.futureFlag": false, "query.hideMatureContent": true };
  const draft = imageParameterDraft(legacy, moss);
  assert.deepEqual(draft.values, { steps: "18", seed: "0" });
  assert.equal(draft.extra, "width=1216");
  assert.deepEqual(parseImageParameterText(draft.workflow, moss), { allowMatureContent: true, currencies: ["yellow"], futureFlag: false, "query.hideMatureContent": true });
  const saved = readImageParameterDraft(draft, moss);
  assert.deepEqual(splitCivitaiParameters(saved), splitCivitaiParameters(legacy));
  assert.deepEqual(imageParameterDraft(saved, moss), draft);
});

test("explicit editor areas preserve same-name parameters and arbitrary future fields independently", () => {
  const saved = readImageParameterDraft({ values: { steps: "18", seed: "0" }, extra: 'custom={"values":[false,0]},shared=image', workflow: 'shared=workflow,steps=[],allowMatureContent=false,query.custom=0' }, moss);
  assert.deepEqual(splitCivitaiParameters(saved), { input: { steps: 18, seed: 0, custom: { values: [false, 0] }, shared: "image" }, workflow: { shared: "workflow", steps: [], allowMatureContent: false }, query: { custom: 0 } });
  assert.deepEqual(readImageParameterDraft(imageParameterDraft(saved, moss), moss), saved);
  assert.throws(() => readImageParameterDraft({ values: {}, extra: "", workflow: "futureFlag=true,workflow.futureFlag=false" }, moss), /重复/);
  const escaped = { "workflow.query.future": false, "input.workflow.future": 0 };
  assert.deepEqual(readImageParameterDraft(imageParameterDraft(escaped, moss), moss), escaped);
  assert.deepEqual(readImageParameterDraft(imageParameterDraft({ quality: "high", custom: false }, {}), {}), { quality: "high", custom: false });
});
