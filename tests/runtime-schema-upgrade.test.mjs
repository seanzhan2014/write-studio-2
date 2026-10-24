import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { characterPhotoSchema } from "../db/character-photo-schema.ts";
import { styleLabSchema } from "../db/style-lab-schema.ts";

function runtimeHarness(cloud = false) {
  const source = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
  const functions = ["hasCurrentRuntimeSchema", "ensureDatabase", "ensureAiGenerateSettingsColumns", "ensureStorySettingColumns", "ensureVersionSelectionColumn", "rows"];
  const variables = ["schemaStatements", "RUNTIME_SCHEMA_VERSION", "RUNTIME_SCHEMA_VERSION_KEY", "initialized"];
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    ? functions.includes(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.includes(declaration.name.getText(parsed))));
  const code = ts.transpileModule(selected.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^export /gm, "");
  const native = new DatabaseSync(":memory:");
  let writes = 0;
  function statement(sql, values = []) {
    return {
      bind: (...next) => statement(sql, next),
      async run() { writes++; native.prepare(sql).run(...values); return { success: true }; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
    };
  }
  const db = { prepare: sql => statement(sql), batch: async statements => Promise.all(statements.map(statement => statement.run())) };
  const noop = async () => {};
  const context = { characterPhotoSchema, styleLabSchema, getDatabase: () => db, isCloudDatabase: () => cloud, illustrationSchema: [], taskHistoryTriggers: [], startGenerateReviewRunner: noop };
  for (const name of [...source.matchAll(/await (ensure\w+|migrateReviewRules|createSearchIndex)\(db\)/g)].map(match => match[1])) {
    if (!functions.includes(name)) context[name] = noop;
  }
  const runtime = Function(...Object.keys(context), `${code}\nreturn { ensureDatabase, schemaStatements, version: RUNTIME_SCHEMA_VERSION, newIsolate() { initialized = null; } };`)(...Object.values(context));
  return { native, runtime, writes: () => writes };
}

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
