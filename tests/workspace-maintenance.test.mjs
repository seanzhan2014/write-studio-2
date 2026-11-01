import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import formatLintResults from "../scripts/eslint-formatter.mjs";
import { cleanWorkspace } from "../scripts/clean-workspace.mjs";

test("lint formatter bounds long code frames without padding other diagnostics", () => {
  const output = formatLintResults([{ filePath: "bundle.js", errorCount: 1, warningCount: 1, messages: [
    { severity: 2, line: 1, column: 90000, message: `Invalid code\n${" ".repeat(200000)}${"x".repeat(200000)}`, ruleId: "rule" },
    { severity: 1, line: 2, column: 1, message: "A normal warning", ruleId: "other" },
  ] }]);
  assert.ok(Buffer.byteLength(output) < 1000);
  assert.match(output, /bundle\.js:2:1 warning A normal warning \(other\)/);
  assert.match(output, /1 errors, 1 warnings/);
});

test("cleanup previews by default, preserves business data and backups, and rejects linked trees", async () => {
  const parent = path.resolve(".test-data");
  await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(path.join(parent, "maintenance-test-"));
  const outside = await mkdtemp(path.join(parent, "maintenance-outside-"));
  try {
    const fixtures = [
      ".npm-cache/old", ".test-data/old-result/trace.zip", "outputs/release.tar.gz", "work/old-dist/index.js",
      "test-results/trace.zip", ".wrangler/test-state-123/db.sqlite", ".wrangler/playwright-state-123/db.sqlite",
      ".wrangler/state/business.sqlite", "data/writer-studio.sqlite", "data/recovery/backup.sqlite",
      ".test-data/before-update.sqlite", ".test-data/backup-copy/studio.sqlite", "app/source.ts",
    ];
    const old = new Date(Date.now() - 10 * 86400000);
    for (const name of fixtures) {
      const target = path.join(workspace, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, name);
      await utimes(target, old, old);
    }
    // A newer sibling must keep the entire directory available for active work.
    await mkdir(path.join(workspace, ".test-data/recent"), { recursive: true });
    await writeFile(path.join(workspace, ".test-data/recent/trace.zip"), "recent");
    await writeFile(path.join(outside, "keep.txt"), "keep");
    await symlink(outside, path.join(workspace, "outputs/linked"), process.platform === "win32" ? "junction" : "dir");
    await mkdir(path.join(workspace, "work/linked-tree"), { recursive: true });
    await symlink(outside, path.join(workspace, "work/linked-tree/link"), process.platform === "win32" ? "junction" : "dir");
    // Directory mtimes matter as well, so age only the completed fixtures.
    for (const directory of [".npm-cache", ".test-data/old-result", "outputs", "work/old-dist", "test-results", ".wrangler/test-state-123", ".wrangler/playwright-state-123"]) {
      await utimes(path.join(workspace, directory), old, old);
    }
    const preview = await cleanWorkspace(workspace);
    assert.equal(preview.apply, false);
    assert.equal(preview.selected.length, 7);
    assert.ok(preview.bytes > 0);
    assert.equal(await readFile(path.join(workspace, ".npm-cache/old"), "utf8"), ".npm-cache/old");
    const cleaned = await cleanWorkspace(workspace, { apply: true });
    assert.equal(cleaned.bytes, preview.bytes);
    assert.deepEqual(cleaned.failed, []);
    await assert.rejects(stat(path.join(workspace, ".npm-cache")), { code: "ENOENT" });
    for (const name of fixtures.slice(7)) assert.ok((await stat(path.join(workspace, name))).isFile());
    assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "keep");
    assert.ok((await stat(path.join(workspace, ".test-data/recent/trace.zip"))).isFile());
    await assert.rejects(cleanWorkspace(workspace, { days: -1 }), /non-negative/);
  } finally {
    // Both are fixed mkdtemp descendants of the test-only directory above.
    for (const target of [workspace, outside]) {
      assert.equal(path.dirname(target), parent);
      await rm(target, { recursive: true, force: true });
    }
  }
});
