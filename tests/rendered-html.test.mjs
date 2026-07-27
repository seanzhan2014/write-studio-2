import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Writer Studio shell exposes the core product surfaces", async () => {
  const [layout, app] = await Promise.all([source("app/layout.tsx"), source("app/WriterStudioApp.tsx")]);
  assert.match(layout, /Writer Studio · 结构化长篇写作/);
  assert.match(app, /AI Chat/);
  assert.match(app, /AI Generate/);
  assert.match(app, /正文编辑器/);
  assert.match(app, /正在打开 Writer Studio/);
  assert.doesNotMatch(app, /codex-preview|Your site is taking shape|Building your site/i);
});

test("application routes cover writing, chat, generate, continuous editors, info and settings", async () => {
  const app = await source("app/WriterStudioApp.tsx");
  for (const fragment of [
    "/outlines`",
    "/outlines/${outlineId}/write",
    "/outlines/${outlineId}/chat",
    "/outlines/${outlineId}/generate",
    "/outlines/edit-all",
    "/chapters/${chapterId}",
    "/edit`",
    "/search`",
    "/info/characters",
    "/info/relationships",
    "/settings/models",
    "/settings/database",
  ]) assert.ok(app.includes(fragment), fragment);
});
