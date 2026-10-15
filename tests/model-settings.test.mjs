import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../lib/ai-model-capabilities.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { catalogEntry, supportsText, supportsImages, manualModelMetadata, normalizeModelMetadata, imageParameterValues } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
test("existing text configurations work while image models are excluded from text choices", () => {
  assert.equal(supportsText({}), true); assert.equal(supportsImages({}), false);
  const image = { metadata: manualModelMetadata("image") };
  assert.equal(supportsImages(image), true); assert.equal(supportsText(image), false);
  assert.equal(supportsText({ metadata: manualModelMetadata("both") }), true);
});
test("catalog preserves modalities and typed parameters without inferring from names", () => {
  const entry = catalogEntry({ id: "some-model", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] }, supported_parameters: { size: { type: "enum", values: ["1024x1024", "1536x1024"] } }, context_length: 32000 });
  assert.equal(supportsText(entry), false);
  assert.deepEqual(imageParameterValues(entry, "size"), ["1024x1024", "1536x1024"]);
  assert.equal(entry.metadata.contextLength, 32000);
  assert.equal(supportsImages(catalogEntry("image-looking-name")), false);
  assert.equal(supportsText(catalogEntry("text-looking-name")), false);
  assert.equal(catalogEntry(null), null);
});
test("metadata normalization bounds duplicate capability values", () => {
  const value = normalizeModelMetadata({ source: "manual", inputModalities: ["text", "text", 3], outputModalities: ["image", "image"] });
  assert.deepEqual(value.inputModalities, ["text"]); assert.deepEqual(value.outputModalities, ["image"]);
});
