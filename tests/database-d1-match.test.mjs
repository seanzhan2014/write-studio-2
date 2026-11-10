import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { DATABASE_SCHEMA_PROBE_STATEMENTS, databaseSchemaMatches, missingDatabaseColumns } from '../db/schema-match.ts';

test('the full database schema probe works in the Cloudflare D1 runtime', { timeout: 30000 }, async () => {
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'], compatibilityDate: '2026-10-01',
  }));
  try {
    const db = await worker.getD1Database('DB');
    const statements = readFileSync(new URL('./fixtures/database-v21.sql', import.meta.url), 'utf8').split(';').map(sql => sql.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
    assert.equal(await databaseSchemaMatches(db), false);
    assert.deepEqual(await missingDatabaseColumns(db), ['outlines.expansion_json']);
    await db.prepare('ALTER TABLE outlines ADD COLUMN expansion_json TEXT').run();
    // Do not hide a D1 platform error behind a boolean assertion.
    const probes = await db.batch(DATABASE_SCHEMA_PROBE_STATEMENTS.map(sql => db.prepare(sql)));
    assert.ok(probes.every(probe => probe.results.length === 0));
    assert.equal(await databaseSchemaMatches(db), true);
    await db.prepare('ALTER TABLE outlines DROP COLUMN expansion_json').run();
    assert.equal(await databaseSchemaMatches(db), false);
  } finally { await worker.dispose(); }
});
