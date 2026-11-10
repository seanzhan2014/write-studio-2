import { runtimeHarness } from "./database-runtime-model.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import path from "node:path";
import { freePort, waitForServer, stopServer, removeTestDirectory } from "../scripts/test-server.mjs";
import { styleLabSchema } from "../db/style-lab-schema.ts";
import { AI_GENERATE_SETTINGS_COLUMNS } from "../db/schema-columns.ts";


function seedExistingArticle(native) {
  native.exec("INSERT INTO articles(id,title,created_at,updated_at,last_opened_at) VALUES('article-kept','原有文章','2026-11-10','2026-11-10','2026-11-10')");
  native.exec("INSERT INTO chapters(id,article_id,title,position,created_at,updated_at) VALUES('chapter-kept','article-kept','原有章节',1024,'2026-11-10','2026-11-10')");
  native.exec("INSERT INTO outlines(id,article_id,chapter_id,title,summary,position,created_at,updated_at) VALUES('outline-kept','article-kept','chapter-kept','原有大纲','原有大纲内容。',1024,'2026-11-10','2026-11-10')");
  native.exec("INSERT INTO versions(id,outline_id,name,text,source,created_at) VALUES('version-kept','outline-kept','原有版本','原有正文','manual','2026-11-10')");
  native.exec("INSERT INTO contents(id,outline_id,text,content_name,current_version_id,default_version_id,updated_at) VALUES('content-kept','outline-kept','原有正文','原有正文','version-kept','version-kept','2026-11-10')");
}

for (const cloud of [false, true]) {
  for (const [table, definitions] of Object.entries(AI_GENERATE_SETTINGS_COLUMNS)) {
    for (const column of Object.keys(definitions)) {
      test(`${cloud ? "cloud" : "local"}: readiness and upgrade share required column ${table}.${column}`, async () => {
        const { native, runtime, db } = runtimeHarness(cloud);
        try {
          await runtime.ensureDatabase();
          assert.equal(await runtime.hasCurrentRuntimeSchema(db), true);
          native.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
          assert.equal(await runtime.hasCurrentRuntimeSchema(db), false, "a current marker cannot conceal a missing declared generation column");
          runtime.newIsolate();
          await runtime.ensureDatabase();
          assert.equal(await runtime.hasCurrentRuntimeSchema(db), true);
        } finally { native.close(); }
      });
    }
  }
  for (const marker of ["21", "current"]) {
    test(`${cloud ? "cloud" : "local"}: ${marker} marker with only missing outline expansion repairs before writes`, async () => {
      const { native, runtime, writes } = runtimeHarness(cloud);
      try {
        // Start with every table and readiness prerequisite present, as in production.
        // Incomplete style tables would accidentally force the migration and mask this bug.
        await runtime.ensureDatabase();
        seedExistingArticle(native);
        native.exec("ALTER TABLE outlines DROP COLUMN expansion_json");
        native.prepare("UPDATE app_settings SET value_json=? WHERE key='runtime_schema_version'").run(marker === "current" ? runtime.version : marker);
        runtime.newIsolate();
        assert.throws(() => native.prepare("UPDATE outlines SET expansion_json='{}' WHERE id='outline-kept'").run(), /no such column/);

        await runtime.ensureDatabase();
        const expansion = JSON.stringify({ enabled: true, defaultMultiplier: 10, marks: [] });
        native.prepare("UPDATE outlines SET expansion_json=? WHERE id='outline-kept'").run(expansion);
        assert.equal(native.prepare("SELECT expansion_json FROM outlines WHERE id='outline-kept'").get().expansion_json, expansion);
        assert.equal(native.prepare("SELECT summary FROM outlines WHERE id='outline-kept'").get().summary, "原有大纲内容。");
        assert.equal(native.prepare("SELECT text FROM versions WHERE id='version-kept'").get().text, "原有正文");
        assert.equal(native.prepare("SELECT value_json FROM app_settings WHERE key='runtime_schema_version'").get().value_json, runtime.version);
        const before = writes(); runtime.newIsolate(); await runtime.ensureDatabase();
        assert.equal(writes(), before, "a repaired database must take the read-only fast path on the next isolate");
      } finally { native.close(); }
    });
  }
}

test("a real server upgrades the frozen v21 database fixture and completes generation", { timeout: 60000 }, async () => {
  const workspace = process.cwd();
  mkdirSync(path.join(workspace, '.test-data'), { recursive: true });
  const directory = mkdtempSync(path.join(workspace, '.test-data', 'expansion-upgrade-'));
  const databasePath = path.join(directory, 'studio.sqlite');
  const { native, runtime } = runtimeHarness();
  try {
    // Never generate the old schema from the current initializer: doing so would
    // silently include future columns and conceal missing upgrade steps.
    native.exec(readFileSync(new URL('./fixtures/database-v21.sql', import.meta.url), 'utf8'));
    seedExistingArticle(native);
    native.prepare('VACUUM INTO ?').run(databasePath);
  } finally { native.close(); }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [path.join(workspace, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port)], {
    cwd: workspace,
    env: { ...process.env, WRITER_STUDIO_DB_PATH: databasePath, WRITER_STUDIO_TEST_MODE: '1', VINEXT_NO_DEV_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  try {
    await waitForServer(base, child, output, 30000);
    const response = await fetch(base + '/api/ai/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ articleId: 'article-kept', chapterId: 'chapter-kept', outlineId: 'outline-kept', target: 'content', model: '', preparationEnabled: false, reviewMaxRounds: 0, currentPlan: '原有大纲内容。', currentExpansion: { enabled: true, defaultMultiplier: 10, marks: [] } }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    let task = payload.data;
    const execute = await fetch(`${base}/api/ai/tasks/${encodeURIComponent(task.id)}/execute`, { method: 'POST' });
    assert.equal(execute.status, 200, await execute.text());
    for (let attempt = 0; attempt < 100 && !['success', 'failed'].includes(task.state); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      task = (await (await fetch(base + '/api/ai/tasks')).json()).tasks.find(item => item.id === task.id);
    }
    assert.equal(task.state, 'success', task.error);
    const persisted = new DatabaseSync(databasePath);
    try {
      assert.equal(persisted.prepare("SELECT value_json FROM app_settings WHERE key='runtime_schema_version'").get().value_json, runtime.version);
      assert.equal(JSON.parse(persisted.prepare("SELECT expansion_json FROM outlines WHERE id='outline-kept'").get().expansion_json).defaultMultiplier, 10);
      assert.equal(persisted.prepare("SELECT text FROM versions WHERE id='version-kept'").get().text, '原有正文');
      assert.ok(persisted.prepare('SELECT text FROM versions WHERE task_id=?').get(task.id).text);
    } finally { persisted.close(); }
  } catch (error) {
    error.message += '\n' + output.join('').slice(-4000);
    throw error;
  } finally {
    await stopServer(child);
    await removeTestDirectory(workspace, path.relative(workspace, directory));
  }
});

test("a current database missing version selection history upgrades without losing versions", async () => {
  const { native, runtime } = runtimeHarness();
  try {
    for (const sql of runtime.schemaStatements) native.exec(sql);
    native.exec("ALTER TABLE versions DROP COLUMN last_selected_at");
    native.prepare("INSERT INTO app_settings VALUES('runtime_schema_version',?,'2026-10-24')").run(runtime.version);
    await runtime.ensureDatabase();
    assert.ok(native.prepare("PRAGMA table_info(versions)").all().some(column => column.name === "last_selected_at"));
  } finally { native.close(); }
});

test("a database marked current before image settings upgrades without losing articles", async () => {
  const { native, runtime } = runtimeHarness();
  try {
    for (const sql of runtime.schemaStatements) native.exec(sql);
    native.exec("ALTER TABLE characters DROP COLUMN visual_json");
    native.exec("ALTER TABLE characters DROP COLUMN photos_json");
    native.exec("INSERT INTO app_settings VALUES('runtime_schema_version','15','2026-10-16')");
    native.exec("INSERT INTO articles(id,title,created_at,updated_at,last_opened_at) VALUES('article-kept','原有文章','2026-10-16','2026-10-16','2026-10-16')");
    await runtime.ensureDatabase();
    assert.ok(native.prepare("PRAGMA table_info(articles)").all().some(column => column.name === "illustration_settings_json"));
    assert.ok(native.prepare("PRAGMA table_info(outlines)").all().some(column => column.name === "illustration_options_json"));
    assert.ok(native.prepare("PRAGMA table_info(characters)").all().some(column => column.name === "visual_json"));
    assert.ok(native.prepare("PRAGMA table_info(characters)").all().some(column => column.name === "photos_json"));
    assert.equal(native.prepare("SELECT title FROM articles WHERE id='article-kept'").get().title, "原有文章");
    native.prepare("UPDATE articles SET illustration_settings_json=? WHERE id='article-kept'").run(JSON.stringify({ promptLanguage: "en", stylePreset: "ink", resolution: "2k" }));
    assert.equal(JSON.parse(native.prepare("SELECT illustration_settings_json FROM articles WHERE id='article-kept'").get().illustration_settings_json).resolution, "2k");
    await runtime.ensureDatabase();
  } finally { native.close(); }
});

for (const cloud of [false, true]) {
  for (const marker of ["17", "current"]) {
    test(`${cloud ? "cloud" : "local"}: ${marker} schema marker without style tables upgrades existing data`, async () => {
      const { native, runtime, writes } = runtimeHarness(cloud);
      try {
        for (const sql of runtime.schemaStatements) native.exec(sql);
        native.prepare("INSERT INTO app_settings VALUES('runtime_schema_version',?,'2026-10-21')").run(marker === "current" ? runtime.version : marker);
        native.exec("INSERT INTO articles(id,title,style,story_settings_json,created_at,updated_at,last_opened_at) VALUES('article-kept','原有文章','原风格','{\"location\":\"原地点\"}','2026-10-21','2026-10-21','2026-10-21')");
        assert.throws(() => native.prepare("SELECT * FROM style_lab_jobs").all(), /no such table/);
        await runtime.ensureDatabase();
        for (const table of ["style_lab_jobs", "style_lab_rounds", "style_lab_artifacts"]) {
          assert.deepEqual(native.prepare(`SELECT * FROM ${table}`).all(), []);
        }
        const article = native.prepare("SELECT title,style,story_settings_json FROM articles WHERE id='article-kept'").get();
        assert.equal(article.title, "原有文章"); assert.equal(article.style, "原风格");
        assert.equal(JSON.parse(article.story_settings_json).location, "原地点");
        assert.equal(native.prepare("SELECT value_json FROM app_settings WHERE key='runtime_schema_version'").get().value_json, runtime.version);
        const before = writes(); runtime.newIsolate(); await runtime.ensureDatabase();
        assert.equal(writes(), before, "a complete current database should skip migration writes");
      } finally { native.close(); }
    });
  }
}

test("cloud initialization completes partially created style tables and preserves existing tasks", async () => {
  const { native, runtime } = runtimeHarness(true);
  try {
    for (const sql of runtime.schemaStatements) native.exec(sql);
    native.prepare("INSERT INTO app_settings VALUES('runtime_schema_version',?,'2026-10-21')").run(runtime.version);
    native.exec("INSERT INTO articles(id,title,created_at,updated_at,last_opened_at) VALUES('article-kept','原有文章','2026-10-21','2026-10-21','2026-10-21')");
    native.exec(styleLabSchema[0]);
    native.exec("INSERT INTO style_lab_jobs(id,article_id,kind,status,phase,model_id,payload_json,created_at,updated_at) VALUES('task-kept','article-kept','learn','paused','learn','model','{}','2026-10-21','2026-10-21')");
    await runtime.ensureDatabase();
    assert.equal(native.prepare("SELECT status FROM style_lab_jobs WHERE id='task-kept'").get().status, "paused");
    assert.deepEqual(native.prepare("SELECT * FROM style_lab_rounds").all(), []);
    assert.deepEqual(native.prepare("SELECT * FROM style_lab_artifacts").all(), []);
    assert.ok(native.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='style_lab_jobs_article_idx'").get());
  } finally { native.close(); }
});
