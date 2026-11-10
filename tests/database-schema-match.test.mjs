import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runtimeHarness } from './database-runtime-model.mjs';
import { REQUIRED_DATABASE_COLUMNS, databaseSchemaMatches, missingDatabaseColumns } from '../db/schema-match.ts';

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const adapter = native => ({ prepare: sql => ({ async all() { return { results: native.prepare(sql).all() }; } }), batch: statements => Promise.all(statements.map(statement => statement.all())) });
const entries = Object.entries(REQUIRED_DATABASE_COLUMNS);

for (const cloud of [false, true]) test(`database matching: ${cloud ? 'cloud' : 'local'} initialization exactly matches declared business tables and columns`, async () => {
  const { native, runtime, db } = runtimeHarness(cloud);
  try {
    await runtime.ensureDatabase();
    assert.equal(await databaseSchemaMatches(db), true);
    const businessTables = native.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
      .filter(name => !name.startsWith('sqlite_') && !name.startsWith('search_documents_'));
    assert.deepEqual(businessTables.sort(), entries.map(([table]) => table).sort(), 'a runtime-only table must also have a schema contract');
    for (const [table, columns] of entries) {
      const actual = native.prepare(`PRAGMA table_info(${quote(table)})`).all().map(column => column.name);
      assert.deepEqual(actual.sort(), [...columns].sort(), `${table}: declarations, initializers and readiness checks must agree`);
    }
  } finally { native.close(); }
});

for (const cloud of [false, true]) test(`database matching: ${cloud ? 'cloud' : 'local'} frozen v21 fixture upgrades to the complete current contract`, async () => {
  const { native, runtime, db } = runtimeHarness(cloud);
  try {
    native.exec(readFileSync(new URL('./fixtures/database-v21.sql', import.meta.url), 'utf8'));
    assert.equal(await databaseSchemaMatches(db), false, 'the historical fixture must exercise a real upgrade');
    await runtime.ensureDatabase();
    assert.deepEqual(await missingDatabaseColumns(db), []);
    assert.equal(await runtime.hasCurrentRuntimeSchema(db), true);
  } finally { native.close(); }
});

function probeDatabase(missingTable, missingColumn) {
  const native = new DatabaseSync(':memory:');
  for (const [table, columns] of entries) {
    if (table === missingTable && !missingColumn) continue;
    const included = columns.filter(column => table !== missingTable || column !== missingColumn);
    native.exec(`CREATE TABLE ${quote(table)} (${included.map(column => `${quote(column)} TEXT`).join(',')})`);
  }
  return native;
}

test('database matching prevents an incomplete migration from recording the current version', async () => {
  const { native, runtime } = runtimeHarness();
  try {
    native.exec(readFileSync(new URL('./fixtures/database-v21.sql', import.meta.url), 'utf8'));
    // This core column has no additive repair: simulate a forgotten migration.
    native.exec('ALTER TABLE style_lab_artifacts DROP COLUMN payload_json');
    await assert.rejects(runtime.ensureDatabase(), /数据库结构与代码不匹配.*style_lab_artifacts\.payload_json/);
    assert.equal(native.prepare("SELECT value_json FROM app_settings WHERE key='runtime_schema_version'").get().value_json, '21');
  } finally { native.close(); }
});

test('database matching rejects every missing business table and column, without reading or changing rows', async t => {
  let checkedColumns = 0;
  for (const [table, columns] of entries) {
    const absent = probeDatabase(table);
    try {
      assert.equal(await databaseSchemaMatches(adapter(absent)), false, `missing table ${table}`);
      assert.ok((await missingDatabaseColumns(adapter(absent))).includes(`${table}.*`));
    } finally { absent.close(); }
    for (const column of columns) {
      const incomplete = probeDatabase(table, column);
      try {
        assert.equal(await databaseSchemaMatches(adapter(incomplete)), false, `missing column ${table}.${column}`);
        assert.deepEqual(await missingDatabaseColumns(adapter(incomplete)), [`${table}.${column}`]);
        checkedColumns++;
      } finally { incomplete.close(); }
    }
  }
  const complete = probeDatabase();
  try {
    complete.exec("INSERT INTO articles(id,title) VALUES('kept','原有文章')");
    assert.equal(await databaseSchemaMatches(adapter(complete)), true);
    assert.equal(complete.prepare('SELECT title FROM articles').get().title, '原有文章');
    complete.exec('ALTER TABLE outlines ADD COLUMN legacy_extra TEXT');
    assert.equal(await databaseSchemaMatches(adapter(complete)), true, 'retained legacy columns remain compatible');
  } finally { complete.close(); }
  t.diagnostic(`covered ${entries.length} business tables and ${checkedColumns} columns`);
});
