import assert from "node:assert/strict";
import test from "node:test";
import { civitaiImageInput } from "../lib/civitai-api.ts";
import { spicyImageInput } from "../lib/spicy-api.ts";

const prompt = "A lighthouse by the sea";
const negativePrompt = "text, watermark, blurry";

test("Civitai sends negative prompts in their native field for both supported ecosystems", () => {
  for (const family of ["sd1", "sdxl"]) {
    const input = civitaiImageInput(`urn:air:${family}:checkpoint:civitai:101055@128078`, prompt, { negativePrompt });
    assert.equal(input.prompt, prompt);
    assert.equal(input.negativePrompt, negativePrompt);
  }
  assert.equal("negativePrompt" in civitaiImageInput("urn:air:sdxl:checkpoint:civitai:101055@128078", prompt, { negativePrompt: " " }), false);
});

test("SpicyAPI uses the live negative prompt field or explicit avoidance instructions", () => {
  const model = { model: "example/image", enabled: true, available: true, modality: "image", tasks: ["text-to-image"], inputSchema: { type: "object", required: ["prompt"], additionalProperties: false, properties: { prompt: { type: "string", maxLength: 5000 } } } };
  for (const key of ["negative_prompt", "negativePrompt"]) {
    const native = { ...model, inputSchema: { ...model.inputSchema, properties: { ...model.inputSchema.properties, [key]: { type: "string", maxLength: 100 } } } };
    assert.deepEqual(spicyImageInput(native, prompt, { negativePrompt }), { prompt, [key]: negativePrompt });
    assert.throws(() => spicyImageInput(native, prompt, { negativePrompt: "x".repeat(101) }), /参数不符合/);
  }
  assert.deepEqual(spicyImageInput(model, prompt, { negativePrompt }), { prompt: `${prompt}\n\nNegative prompt (elements to avoid):\n${negativePrompt}` });
  assert.throws(() => spicyImageInput(model, "x".repeat(4990), { negativePrompt }), /长度上限/);
});
