import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { diffStudioData, durableSnapshot } from "./studio-test-runtime.mjs";
import { outlineSentences } from "../lib/outline-expansion.ts";
import { reviewModelServer } from "./review-model.mjs";

const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method = 'GET', body, headers = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}
const outlineOf = data => data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current');

test('sentence budgets persist through snapshots and incremental sync, and reach preparation, prose and review unchanged', { skip: !base }, async () => {
  const fake = await reviewModelServer();
  try {
    const provider = await api('/api/providers', 'POST', { name: 'Expansion test', baseUrl: fake.baseUrl, secret: 'fake-key' });
    const model = await api('/api/models', 'POST', { providerId: provider.id, name: 'Expansion test', modelId: 'expansion-test', maxInputCharacters: 120000 });
    const existing = await api('/api/state');
    const data = fullStudioFixture();
    data.tasks = [];
    data.settings.outlineExpansionMultiplier = 8;
    const outline = outlineOf(data);
    outline.plan = '原文中有[10x]和展开×20。第二句。第三句。';
    outline.expansion = { enabled: true, marks: [{ ...outlineSentences(outline.plan)[1], multiplier: 25 }] };
    await api('/api/state', 'PUT', { data }, { 'If-Match': String(existing.revision) });
    let saved = await api('/api/state');
    assert.deepEqual(outlineOf(saved.data).expansion, outline.expansion);
    const local = structuredClone(saved.data);
    outlineOf(local).expansion.defaultMultiplier = 4;
    await api('/api/state/mutations', 'POST', { changes: diffStudioData(durableSnapshot(saved.data), durableSnapshot(local)) }, { 'If-Match': String(saved.revision) });
    saved = await api('/api/state');
    assert.equal(outlineOf(saved.data).expansion.defaultMultiplier, 4);
    const input = { articleId: 'article-main', chapterId: 'chapter-main', outlineId: outline.id, target: 'content', model: model.id, targetWords: 5000, currentPlan: outline.plan, currentExpansion: outlineOf(saved.data).expansion, preparationEnabled: true, preparationRounds: 0, preparationRequireConfirmation: false, reviewMaxRounds: 1, reviewInstruction: '年龄须与人物资料一致', contentMode: 'fresh' };
    const created = (await api('/api/ai/tasks', 'POST', input, { 'Idempotency-Key': crypto.randomUUID() })).data;
    assert.equal(created.contextOptions.targetWords, undefined);
    assert.deepEqual(created.contextOptions.promptContext.currentOutline.expansion.sentences.map(item => item.multiplier), [4, 25, 25]);
    // Changing both defaults after submission must not rewrite the queued task.
    saved = await api('/api/state');
    const changed = structuredClone(saved.data);
    changed.settings.outlineExpansionMultiplier = 90;
    outlineOf(changed).expansion.defaultMultiplier = 60;
    await api('/api/state/mutations', 'POST', { changes: diffStudioData(durableSnapshot(saved.data), durableSnapshot(changed)) }, { 'If-Match': String(saved.revision) });
    let task;
    for (let attempt = 0; attempt < 150; attempt++) {
      task = (await api('/api/ai/tasks')).tasks.find(item => item.id === created.id);
      if (['success', 'failed'].includes(task.state)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(task.state, 'success', task.error);
    assert.deepEqual(task.contextOptions.promptContext.currentOutline.expansion.sentences.map(item => item.multiplier), [4, 25, 25]);
    assert.deepEqual(fake.control.calls.map(call => call.kind), ['prepare', 'generate', 'review', 'revise', 'review']);
    for (const call of fake.control.calls) {
      const prompt = call.body.messages.at(-1).content;
      assert.match(prompt, /<outline_expansion unit="sentence" total_limit="none">/);
      assert.match(prompt, /multiplier="25"/);
      assert.doesNotMatch(prompt, /<target_characters>5000<\/target_characters>/);
    }
    const completedOutline = outlineOf((await api('/api/state')).data);
    assert.equal(completedOutline.plan, outline.plan);
    assert.deepEqual(completedOutline.versions.find(version => version.taskId === created.id).outlineSnapshot.expansion.sentences.map(item => item.multiplier), [4, 25, 25]);
    const invalid = { ...input, currentExpansion: { enabled: true, marks: [{ start: 0, end: 1, text: '原', multiplier: 10 }] } };
    const rejected = await fetch(base + '/api/ai/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(invalid) });
    assert.equal(rejected.status, 400);
  } finally { fake.close(); }
});
