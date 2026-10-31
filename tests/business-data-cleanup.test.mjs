import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { fullStudioFixture } from "./fixtures.mjs";

const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
const databasePath = process.env.WRITER_STUDIO_TEST_DB_PATH;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
async function api(url, body, method = body === undefined ? "GET" : "POST", headers = {}) {
  const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data;
}

test("clearing business data removes task snapshots and managed images while preserving configuration and backups", { skip: !base || !databasePath }, async () => {
  const before = await api("/api/state");
  const fixture = fullStudioFixture();
  fixture.settings.fontSize = 21;
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(before.revision) });
  const provider = await api("/api/providers", { name: "清理保留测试", adapterKind: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", secret: "synthetic-cleanup-key" });
  const photo = await api("/api/ai/character-photos", { action: "upload", characterId: "character-lin", dataUrl: `data:image/png;base64,${png}`, name: "测试照片" });
  const assetPath = path.join(path.dirname(databasePath), photo.gallery.photos[0].assetKey);
  assert.ok((await readFile(assetPath)).length);
  const backupPath = path.join(path.dirname(databasePath), "recovery", "keep-backup.json");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "synthetic recovery backup");
  const exportPath = path.join(path.dirname(databasePath), "keep-export.json");
  await writeFile(exportPath, "synthetic manual export");
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare("INSERT INTO character_photo_jobs(id,character_id,state,snapshot_json,credential_hash,created_at,updated_at) VALUES('cleanup-job','character-lin','success',?,'','2026-10-31','2026-10-31')").run(JSON.stringify({ person: { name: "测试人物" }, prompt: "合成照片任务快照" }));
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM sync_change_log").get().n > 0);
    const result = await api("/api/database/business-data", undefined, "DELETE");
    assert.equal(result.cleanupPending, false);
    for (const table of ["articles", "characters", "contents", "versions", "ai_tasks", "character_photo_jobs", "illustration_history", "sync_change_log", "search_documents"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    }
    await assert.rejects(readFile(assetPath), { code: "ENOENT" });
    assert.equal(await readFile(backupPath, "utf8"), "synthetic recovery backup");
    assert.equal(await readFile(exportPath, "utf8"), "synthetic manual export");
    const cleared = await api("/api/state");
    assert.equal(cleared.data.articles.length, 0);
    assert.equal(cleared.data.settings.fontSize, 21);
    assert.equal((await api("/api/providers")).providers.find(item => item.id === provider.id).hasSecret, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'business_asset_cleanup:%'").get().n, 0);
  } finally { db.close(); }
});

test("failed asset removal keeps the cleared database and a retry receipt", { skip: !base || !databasePath }, async () => {
  const current = await api("/api/state");
  await api("/api/state", { data: fullStudioFixture() }, "PUT", { "If-Match": String(current.revision) });
  const key = "illustrations/bad-a5";
  const blockedPath = path.join(path.dirname(databasePath), key);
  await mkdir(blockedPath, { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)").run(`business_asset_cleanup:${key}`, key, new Date().toISOString());
    const result = await api("/api/database/business-data", undefined, "DELETE");
    assert.equal(result.cleanupPending, true);
    assert.match(result.message, /重试/);
    assert.equal((await api("/api/state")).data.articles.length, 0);
    assert.equal(db.prepare("SELECT value_json FROM app_settings WHERE key=?").get(`business_asset_cleanup:${key}`).value_json, key);
    await rmdir(blockedPath);
    const retry = await api("/api/database/business-data", undefined, "DELETE");
    assert.equal(retry.cleanupPending, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'business_asset_cleanup:%'").get().n, 0);
    assert.equal((await api("/api/state")).data.articles.length, 0);
  } finally { db.close(); }
});
