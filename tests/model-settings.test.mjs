import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../app/WriterStudioApp.tsx", import.meta.url), "utf8");
function extract(name, next, context) {
  const start = source.indexOf("  " + name);
  const code = source.slice(start, source.indexOf("  " + next, start));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(context), js + "; return " + name.match(/function (\w+)/)[1])(...Object.values(context));
}

test("fetch selects existing models only within the chosen provider", () => {
  let selected;
  const open = extract("function openCreateModel", "function openEditModel", {
    providers: [], models: [{ providerId: "p", modelId: "existing" }, { providerId: "other", modelId: "new" }],
    setError() {}, setEditingModelId() {}, setDiscoveredModels() {},
    setSelectedModelIds(value) { selected = value; }, setModelForm() {}, setModelFormOpen() {},
    DEFAULT_MAX_INPUT_CHARACTERS: 60000,
  });
  open("p", ["existing", "new"]);
  assert.deepEqual(selected, ["existing"]);
});

for (const confirmed of [false, true]) {
  test("provider check tests every configured model and respects deletion confirmation: " + confirmed, async () => {
    const checked = [], deleted = [];
    let progress, notice;
    const check = extract("async function checkProviderModels", "const namingSelection", {
      modelCheck: null,
      models: [{ id: "ok", name: "OK", providerId: "p" }, { id: "bad", name: "Bad", providerId: "p" }, { id: "other", providerId: "q" }],
      setError() {}, setModelCheckNotice(value) { notice = value; },
      setModelCheck(value) { progress = typeof value === "function" ? value(progress) : value; },
      async fetchServerAction(url) { checked.push(url); return { ok: !url.includes("bad"), async json() { return { ok: !url.includes("bad"), error: "Unavailable" }; } }; },
      window: { confirm(message) { assert.match(message, /Unavailable/); return confirmed; } },
      async deleteModel(model) { deleted.push(model.id); }, async load() {},
    });
    await check({ id: "p", name: "Provider" });
    assert.deepEqual(checked, ["/api/models/ok/test", "/api/models/bad/test"]);
    assert.deepEqual(deleted, confirmed ? ["bad"] : []);
    assert.equal(progress, null);
    assert.match(notice, /检测完成/);
  });
}
