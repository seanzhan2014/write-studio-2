import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sqliteShim = `data:text/javascript;base64,${Buffer.from('export const isCloudDatabase = () => true; export const databasePath = () => "unused";').toString("base64")}`;
const source = ts.transpileModule(readFileSync(new URL("../db/illustration-assets.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace('"./sqlite"', JSON.stringify(sqliteShim));
const { listIllustrationAssetKeys } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const symbol = Symbol.for("writer-studio.illustration-bucket");

test("cloud image cleanup enumerates all pages and only managed asset keys", async t => {
  const requests = [];
  globalThis[symbol] = { async list(options) {
    requests.push(options);
    return options.cursor ? { objects: [{ key: "illustrations/bb-bb" }, { key: "exports/cc-cc" }], truncated: false }
      : { objects: [{ key: "illustrations/aa-aa" }, { key: "illustrations/../export" }, { key: "illustrations/manual-export.png" }], truncated: true, cursor: "page-2" };
  } };
  t.after(() => { delete globalThis[symbol]; });
  assert.deepEqual(await listIllustrationAssetKeys(), ["illustrations/aa-aa", "illustrations/bb-bb"]);
  assert.deepEqual(requests, [{ prefix: "illustrations/" }, { prefix: "illustrations/", cursor: "page-2" }]);
});

test("cloud image cleanup rejects missing and cyclic cursors before clearing data", async t => {
  t.after(() => { delete globalThis[symbol]; });
  globalThis[symbol] = { async list() { return { objects: [], truncated: true }; } };
  await assert.rejects(listIllustrationAssetKeys(), /分页无效/);
  let requests = 0;
  globalThis[symbol] = { async list() { return { objects: [], truncated: true, cursor: ++requests % 2 ? "a" : "b" }; } };
  await assert.rejects(listIllustrationAssetKeys(), /分页无效/);
  assert.equal(requests, 3);
});
