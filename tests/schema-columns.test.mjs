import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureTableColumns } from '../db/schema-columns.ts';

test('simultaneous isolate upgrades tolerate a column added after their readiness reads', async () => {
  const native = new DatabaseSync(':memory:');
  native.exec('CREATE TABLE outlines(id TEXT PRIMARY KEY)');
  const db = { prepare: sql => ({ async all() { return { results: native.prepare(sql).all() }; }, async run() { native.prepare(sql).run(); return { success: true }; } }) };
  try {
    await Promise.all([ensureTableColumns(db, 'outlines', { expansion_json: 'TEXT' }), ensureTableColumns(db, 'outlines', { expansion_json: 'TEXT' })]);
    assert.equal(native.prepare('PRAGMA table_info(outlines)').all().filter(column => column.name === 'expansion_json').length, 1);
  } finally { native.close(); }
});

test('upgrade errors remain errors when the column is still missing', async () => {
  const failure = new Error('migration could not write');
  const db = { prepare: () => ({ async all() { return { results: [] }; }, async run() { throw failure; } }) };
  await assert.rejects(ensureTableColumns(db, 'outlines', { expansion_json: 'TEXT' }), failure);
});
