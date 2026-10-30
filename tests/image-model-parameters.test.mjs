import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../lib/image-model-parameters.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseImageParameterText, validateImageParameters, formatImageParameterText, defaultImageParameters } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const moss = { adapterKind: "civitai", modelId: "urn:air:mossimage:checkpoint:civitai:3018302@3426693+3321739" };

test("comma-separated image parameters preserve numeric, boolean and string values", () => {
  assert.deepEqual(parseImageParameterText('width=1216，height=832,seed=0,sampler="heunpp2"', moss), { width: 1216, height: 832, seed: 0, sampler: "heunpp2" });
  assert.deepEqual(parseImageParameterText('enable_prompt_expansion=false,seed=42', { adapterKind: "spicyapi" }), { enable_prompt_expansion: false, seed: 42 });
  assert.deepEqual(parseImageParameterText('output_format=webp,output_compression=85', {}), { output_format: "webp", output_compression: 85 });
  assert.deepEqual(parseImageParameterText(formatImageParameterText({ seed: 42, sampler: "euler" }), moss), { seed: 42, sampler: "euler" });
  assert.deepEqual(parseImageParameterText(" , ， \n", moss), {});
});

test("parameter parsing reports duplicates, malformed values and unsupported fields before any request", () => {
  for (const text of ['seed=1,seed=2', 'steps', 'steps=1.5', 'steps=0', 'cfgScale=0', 'width=1025', 'seed=9007199254740992', 'sampler=unknown', 'scheduler=linear_quadratic', 'sampler="unclosed', 'sampler="heun,pp2"', 'seed="42"', 'allowMatureContent=true', 'enableSafetyChecker=false', 'prompt=test', 'engine=comfy', 'diffusionModel=other', 'quantity=4', '__proto__=true']) assert.throws(() => parseImageParameterText(text, moss), undefined, text);
  assert.throws(() => validateImageParameters({ unknown: true }), /不支持/);
  assert.throws(() => validateImageParameters({ steps: Infinity }, moss), /无效/);
  assert.throws(() => validateImageParameters({ seed: {} }, moss), /无效/);
});

test("provider-specific validation and default restoration retain existing MOSS and SD behavior", () => {
  assert.deepEqual(defaultImageParameters(moss), { steps: 12, cfgScale: 1, sampler: "heunpp2", scheduler: "simple" });
  assert.equal(defaultImageParameters({ ...moss, modelId: moss.modelId.replace("3426693", "999") }).steps, 25);
  const sd = { adapterKind: "civitai", modelId: "urn:air:sdxl:checkpoint:civitai:1@2" };
  assert.deepEqual(parseImageParameterText("sampleMethod=heun,schedule=karras,clipSkip=2,uCache=off", sd), { sampleMethod: "heun", schedule: "karras", clipSkip: 2, uCache: "off" });
  assert.throws(() => validateImageParameters({ clipSkip: 2 }, moss), /不支持/);
  assert.throws(() => validateImageParameters({ steps: 12 }, {}), /不支持/);
});
