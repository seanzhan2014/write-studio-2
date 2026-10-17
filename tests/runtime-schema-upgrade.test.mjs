import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

test("a database marked current before image settings upgrades without losing articles", async () => {
  const source = readFileSync(new URL("../db/runtime.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
  const functions = ["hasCurrentRuntimeSchema", "ensureDatabase", "ensureAiGenerateSettingsColumns", "ensureStorySettingColumns", "rows"];
  const variables = ["schemaStatements", "RUNTIME_SCHEMA_VERSION", "RUNTIME_SCHEMA_VERSION_KEY", "initialized"];
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    ? functions.includes(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.includes(declaration.name.getText(parsed))));
  const code = ts.transpileModule(selected.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^export /gm, "");
  const native = new DatabaseSync(":memory:");
  function statement(sql, values = []) {
    return {
      bind: (...next) => statement(sql, next),
      async run() { native.prepare(sql).run(...values); return { success: true }; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
    };
  }
  const db = { prepare: sql => statement(sql), batch: async statements => Promise.all(statements.map(statement => statement.run())) };
  const noop = async () => {};
  const context = { getDatabase: () => db, isCloudDatabase: () => false, illustrationSchema: [], taskHistoryTriggers: [], startGenerateReviewRunner: noop };
  for (const name of [...source.matchAll(/await (ensure\w+|migrateReviewRules|createSearchIndex)\(db\)/g)].map(match => match[1])) {
    if (!functions.includes(name)) context[name] = noop;
  }
  const runtime = Function(...Object.keys(context), `${code}\nreturn { ensureDatabase, schemaStatements };`)(...Object.values(context));
  try {
    for (const sql of runtime.schemaStatements) native.exec(sql);
    native.exec("ALTER TABLE characters DROP COLUMN visual_json");
    native.exec("INSERT INTO app_settings VALUES('runtime_schema_version','15','2026-10-16')");
    native.exec("INSERT INTO articles(id,title,created_at,updated_at,last_opened_at) VALUES('article-kept','原有文章','2026-10-16','2026-10-16','2026-10-16')");
    await runtime.ensureDatabase();
    assert.ok(native.prepare("PRAGMA table_info(articles)").all().some(column => column.name === "illustration_settings_json"));
    assert.ok(native.prepare("PRAGMA table_info(outlines)").all().some(column => column.name === "illustration_options_json"));
    assert.ok(native.prepare("PRAGMA table_info(characters)").all().some(column => column.name === "visual_json"));
    assert.equal(native.prepare("SELECT title FROM articles WHERE id='article-kept'").get().title, "原有文章");
    native.prepare("UPDATE articles SET illustration_settings_json=? WHERE id='article-kept'").run(JSON.stringify({ promptLanguage: "en", stylePreset: "ink", resolution: "2k" }));
    assert.equal(JSON.parse(native.prepare("SELECT illustration_settings_json FROM articles WHERE id='article-kept'").get().illustration_settings_json).resolution, "2k");
    await runtime.ensureDatabase();
  } finally { native.close(); }
});
