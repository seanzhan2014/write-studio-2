import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as generateOptions from "../lib/generate-options.ts";
import * as namingOptions from "../lib/naming-options.ts";
import * as nameVersions from "../lib/name-versions.ts";
import * as reviewOptions from "../lib/review-options.ts";
import * as reviewRules from "../lib/review-rules.mjs";
import * as generateReview from "../lib/generate-review.mjs";
import * as excellentFragments from "../lib/excellent-fragments.mjs";
import * as outlineTitle from "../lib/outline-title.ts";
import * as contentName from "../lib/content-name.mjs";
import * as taskHistory from "../lib/task-history.ts";
import * as taskTargets from "../lib/task-target.ts";
import * as storySettings from "../lib/story-settings.ts";
import * as appearanceSettings from "../lib/appearance.mjs";
import * as conflict from "../app/studio-conflict.mjs";
import { fullStudioFixture } from "./fixtures.mjs";

// Exercise the provider's actual snapshot functions without mounting React or
// loading browser-only storage and network dependencies.
const source = readFileSync(new URL("../app/studio-state.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("studio-state.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["makeId", "emptyChat", "normalizedArticleSummary", "normalizeCharacter", "normalizeAiTask", "reconcileTaskPoll", "normalizeStudioData", "durableSnapshot", "serializeDurable"];
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map((node) => node.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {
  ...generateOptions, ...namingOptions, ...nameVersions, ...reviewOptions,
  ...reviewRules, ...generateReview, ...excellentFragments, ...outlineTitle,
  ...contentName, ...taskHistory, ...taskTargets, ...conflict, now: "2026-07-28T14:32:00.000Z", seedData: fullStudioFixture(),
  ...storySettings, ...appearanceSettings,
};
export const { normalizeStudioData, reconcileTaskPoll, durableSnapshot, serializeDurable } = Function(
  ...Object.keys(context), `${code}\nreturn { normalizeStudioData, reconcileTaskPoll, durableSnapshot, serializeDurable };`,
)(...Object.values(context));


import equal from "fast-deep-equal";
const changesSource = readFileSync(new URL("../lib/studio-changes.ts", import.meta.url), "utf8");
const changesCode = ts.transpileModule(changesSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import .*;$/gm, "").replace(/^export /gm, "");
export const { diffStudioData, isStudioChangesEmpty } = Function("equal", "articleReviewRules", "outlineDisplayTitle", changesCode + "\nreturn { diffStudioData, isStudioChangesEmpty };")(equal, reviewRules.articleReviewRules, outlineTitle.outlineDisplayTitle);
