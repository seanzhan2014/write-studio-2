import assert from "node:assert/strict";
import test from "node:test";
import { ILLUSTRATION_STYLES, normalizeIllustrationStyles, resolveIllustrationStyle, illustrationVisualDirection } from "../lib/illustration-styles.ts";
import { normalizeIllustrationOptions } from "../lib/illustration-options.ts";
import { normalizePhotoDraft, normalizeCharacterPhotos } from "../lib/character-photos.ts";

test("style library migrates presets and preserves deletion of all styles", () => {
  assert.deepEqual(normalizeIllustrationStyles(undefined), ILLUSTRATION_STYLES);
  assert.deepEqual(normalizeIllustrationStyles([]), [ILLUSTRATION_STYLES[0]]);
  const custom = { value: "custom-test", label: " 新风格 ", description: "说明", instruction: " 胶片颗粒与暖色灯光 " };
  const styles = normalizeIllustrationStyles([null, {}, custom, custom, { ...custom, value: "unknown" }, { ...custom, value: "custom-blank", instruction: " " }]);
  assert.equal(styles.length, 2);
  assert.equal(styles[1].label, "新风格");
  assert.equal(illustrationVisualDirection("custom-test", "背光", styles), "插图风格：新风格。 胶片颗粒与暖色灯光 \n背光");
  assert.equal(resolveIllustrationStyle("literary", styles).value, "auto");
  assert.equal(illustrationVisualDirection("custom-deleted", "背光", styles), "背光");
  assert.equal(normalizeIllustrationOptions({ stylePreset: "custom-test" }).stylePreset, "custom-test");
  assert.equal(normalizePhotoDraft({ style: "custom-test" }).style, "custom-test");
  assert.equal(normalizeCharacterPhotos({ photos: [], stylePreset: "custom-test" }).stylePreset, "custom-test");
});
