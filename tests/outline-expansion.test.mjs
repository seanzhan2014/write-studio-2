import assert from "node:assert/strict";
import test from "node:test";
import { outlineSentences, normalizeOutlineExpansion, rebaseOutlineExpansion, resolveOutlineExpansion, validOutlineExpansion, isExpansionMultiplier, isSentenceTargetWords, convertTargetWordsToExpansion, outlineExpansionForEditing, outlineLengthMode, withOutlineLengthMode } from "../lib/outline-expansion.ts";
import { normalizeStudioSettings } from '../lib/studio-settings.ts';
import { selectAiContext } from "../lib/ai-context.ts";
import { duplicateOutlineForImport } from "../lib/data-transfer.ts";
import { fullStudioFixture } from "./fixtures.mjs";

const config = (plan, entries = [], defaultMultiplier) => ({ enabled: true, ...(defaultMultiplier === undefined ? {} : { defaultMultiplier }), marks: entries.map(([index, multiplier]) => ({ ...outlineSentences(plan)[index], multiplier })) });

test('word counts inherit their unit from the previous sentence and mix with multipliers without conversion', () => {
  const plan = '开头。下一句。\n继续。转折。结尾。';
  const sentences = outlineSentences(plan);
  const value = { enabled: true, mode: 'words', marks: [{ ...sentences[1], targetWords: 500 }, { ...sentences[3], multiplier: 2.5 }] };
  const resolved = resolveOutlineExpansion(plan, value, 8, 150);
  assert.deepEqual(resolved.sentences.map(item => [item.targetWords, item.multiplier, item.targetCharacters, item.source]), [
    [150, undefined, 150, 'global'], [500, undefined, 500, 'sentence'], [500, undefined, 500, 'previous'],
    [undefined, 2.5, 5, 'sentence'], [undefined, 2.5, 5, 'previous'],
  ]);
  assert.equal(resolved.estimatedCharacters, 1160);
  value.defaultTargetWords = 200;
  assert.equal(resolveOutlineExpansion(plan, value, 8, 150).sentences[0].source, 'outline');
  assert.equal(resolveOutlineExpansion(plan, value, 8, 150).sentences[0].targetCharacters, 200);
  value.marks[0].targetWords = 600;
  assert.equal(resolveOutlineExpansion(plan, value).sentences[2].targetCharacters, 600);
  assert.equal(resolved.sentences[2].targetCharacters, 500, 'a submitted snapshot is frozen');
});

test('length modes default to total words, honor explicit outline choices and retain values across mode switches', () => {
  assert.equal(normalizeStudioSettings({}).outlineLengthMode, 'target');
  assert.equal(outlineExpansionForEditing('原文。', undefined), undefined);
  assert.equal(outlineLengthMode(outlineExpansionForEditing('原文。', undefined, 'words')), 'words');
  const total = { enabled: false, defaultMultiplier: 12.345678, defaultTargetWords: 456, marks: [] };
  assert.deepEqual(outlineExpansionForEditing('原文。', total, 'words'), total);
  const multiplier = withOutlineLengthMode(total, 'multiplier');
  const words = withOutlineLengthMode(multiplier, 'words');
  const restored = withOutlineLengthMode(withOutlineLengthMode(words, 'target'), 'multiplier');
  assert.equal(words.defaultTargetWords, 456);
  assert.equal(restored.defaultMultiplier, 12.345678, 'switching modes must not convert a previous total');
  assert.equal(outlineLengthMode(restored), 'multiplier');
});

test('fixed word metadata survives outline edits and rejects invalid, ambiguous or partial sentence controls', () => {
  const plan = '第一句。第二句。';
  const value = { enabled: true, mode: 'words', defaultTargetWords: 250, marks: [{ ...outlineSentences(plan)[1], targetWords: 500 }] };
  assert.equal(validOutlineExpansion(plan, value), true);
  const after = '新增。第一句。第二句话变长。';
  const edited = '第一句。第二句话变长。';
  const rebased = rebaseOutlineExpansion(edited, after, rebaseOutlineExpansion(plan, edited, value));
  assert.equal(rebased.marks[0].targetWords, 500);
  assert.equal(resolveOutlineExpansion(after, rebased).sentences[2].targetCharacters, 500);
  for (const bad of [0, -1, 1.5, 100001, '500', NaN, Infinity]) {
    assert.equal(isSentenceTargetWords(bad), false);
    assert.equal(validOutlineExpansion(plan, { ...value, defaultTargetWords: bad }), false);
    assert.equal(validOutlineExpansion(plan, { ...value, marks: [{ ...value.marks[0], targetWords: bad }] }), false);
  }
  assert.equal(validOutlineExpansion(plan, { ...value, marks: [{ ...value.marks[0], multiplier: 10 }] }), false);
  assert.equal(validOutlineExpansion(plan, { ...value, marks: [{ start: 0, end: 1, text: '第', targetWords: 500 }] }), false);
  const data = fullStudioFixture();
  data.settings.outlineLengthMode = 'words';
  data.settings.outlineExpansionWords = 275;
  const current = data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current');
  assert.equal(selectAiContext(data, current.id, 'content').currentOutline.expansion.sentences[0].targetWords, 275);
  current.expansion = { enabled: false, marks: [] };
  assert.equal(selectAiContext(data, current.id, 'content').currentOutline.expansion, undefined);
});

test("legacy totals convert by outline word count with precise large and fractional multipliers", () => {
  const plan = '甲乙丙。丁戊己。';
  assert.equal(convertTargetWordsToExpansion(plan, 600).defaultMultiplier, 100);
  assert.equal(resolveOutlineExpansion(plan, convertTargetWordsToExpansion(plan, 601)).estimatedCharacters, 601);
  const short = '甲。乙。丙。';
  const large = convertTargetWordsToExpansion(short, 50000);
  assert.equal(large.defaultMultiplier, 16666.666667);
  assert.equal(resolveOutlineExpansion(short, large).estimatedCharacters, 50000);
  const many = '甲。'.repeat(5000);
  const small = convertTargetWordsToExpansion(many, 100);
  assert.equal(small.defaultMultiplier, 0.02);
  assert.equal(resolveOutlineExpansion(many, small).estimatedCharacters, 100, 'round cumulative budgets instead of rounding each tiny sentence to zero');
});

test("conversion preserves explicit sentence settings and cannot divide an empty outline", () => {
  const plan = '第一句。第二句。';
  const marked = config(plan, [[1, 7]], 3);
  assert.deepEqual(outlineExpansionForEditing(plan, marked), marked);
  assert.deepEqual(outlineExpansionForEditing(plan, { ...marked, enabled: false }), { ...marked, enabled: false });
  const converted = convertTargetWordsToExpansion(plan, 600, { ...marked, enabled: false });
  assert.equal(converted.defaultMultiplier, 100);
  assert.deepEqual(converted.marks, marked.marks);
  for (const empty of ['', '  \n', '。！？']) {
    assert.equal(outlineExpansionForEditing(empty, undefined), undefined);
    assert.equal(resolveOutlineExpansion(empty, undefined, 8), undefined);
  }
  assert.equal(convertTargetWordsToExpansion(plan, 0).defaultMultiplier, undefined);
});

test("sentence boundaries preserve quotes, decimals, original markers and unpunctuated paragraphs", () => {
  const plan = '他说：“展开 ×20。”\n价钱是3.5元，记作[10x]；继续说明！ Really? 最后一句';
  assert.deepEqual(outlineSentences(plan).map(item => item.text), ['他说：“展开 ×20。”', '价钱是3.5元，记作[10x]；继续说明！', 'Really?', '最后一句']);
  assert.equal(resolveOutlineExpansion(plan, config(plan), 7).sentences.every(item => item.multiplier === 7), true);
  assert.equal(normalizeOutlineExpansion(plan, config(plan)).marks.length, 0);
});

test("multipliers follow the previous sentence across paragraphs, then outline, then global, without multiplication", () => {
  const plan = '第一句。第二句。\n第三句。第四句。第五句。';
  const value = config(plan, [[1, 30], [3, 5]], 10);
  assert.deepEqual(resolveOutlineExpansion(plan, value, 100).sentences.map(item => item.multiplier), [10, 30, 30, 5, 5]);
  value.marks[0].multiplier = 20;
  assert.deepEqual(resolveOutlineExpansion(plan, value, 100).sentences.map(item => item.multiplier), [10, 20, 20, 5, 5]);
  delete value.defaultMultiplier;
  assert.deepEqual(resolveOutlineExpansion(plan, value, 7).sentences.map(item => item.multiplier), [7, 20, 20, 5, 5]);
  value.marks = value.marks.filter(mark => mark.multiplier !== 5);
  assert.deepEqual(resolveOutlineExpansion(plan, value, 7).sentences.map(item => item.multiplier), [7, 20, 20, 20, 20]);
});

test("only complete sentences accept valid custom multipliers", () => {
  const plan = '完整的一句话。';
  assert.equal(validOutlineExpansion(plan, config(plan, [[0, 2.5]])), true);
  for (const value of [0, -1, NaN, Infinity, 0.0000001, 100001, '10']) assert.equal(isExpansionMultiplier(value), false);
  assert.equal(validOutlineExpansion(plan, { enabled: true, marks: [{ start: 0, end: 1, text: '完', multiplier: 10 }] }), false);
  assert.equal(resolveOutlineExpansion(plan, { ...config(plan), enabled: false }), undefined);
});

test("sentence marks track edits and splits, clear on conflicting merges, and never attach to replacement text", () => {
  const before = '门开了，她站起来。后一句。';
  const marked = config(before, [[0, 30], [1, 5]]);
  const after = '门打开了，她站起来。后一句。';
  const edited = rebaseOutlineExpansion(before, after, marked);
  assert.equal(edited.marks[0].text, '门打开了，她站起来。');
  assert.equal(edited.marks[1].text, '后一句。');
  const split = '门开了。她站起来。后一句。';
  assert.deepEqual(resolveOutlineExpansion(split, rebaseOutlineExpansion(before, split, marked)).sentences.map(item => item.multiplier), [30, 30, 5]);
  const merged = before.replace('。后', '，后');
  assert.equal(rebaseOutlineExpansion(before, merged, marked).marks.length, 0);
  assert.equal(rebaseOutlineExpansion(before, '完全替换。', marked).marks.length, 0);
  const deleted = '后一句。';
  assert.deepEqual(resolveOutlineExpansion(deleted, rebaseOutlineExpansion(before, deleted, marked)).sentences.map(item => item.multiplier), [5]);
});

test("insertions before a mark and duplicate sentences keep their own position", () => {
  const before = '相同句子。相同句子。';
  const after = '插入句。' + before;
  const next = rebaseOutlineExpansion(before, after, config(before, [[1, 40]], 3));
  assert.deepEqual(resolveOutlineExpansion(after, next).sentences.map(item => item.multiplier), [3, 3, 40]);
});

test("context snapshots freeze effective values and outline copies retain independent metadata", () => {
  const data = fullStudioFixture();
  data.settings.outlineExpansionMultiplier = 8;
  const outline = data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current');
  outline.plan = '看到原文×100。继续前进。';
  outline.expansion = config(outline.plan, [[1, 2.5]]);
  const selected = selectAiContext(data, outline.id, 'content');
  assert.deepEqual(selected.currentOutline.expansion.sentences.map(item => item.multiplier), [8, 2.5]);
  data.settings.outlineExpansionMultiplier = 50;
  outline.expansion.marks[0].multiplier = 100;
  assert.deepEqual(selected.currentOutline.expansion.sentences.map(item => item.multiplier), [8, 2.5]);
  const copied = duplicateOutlineForImport(outline);
  copied.expansion.marks[0].multiplier = 7;
  assert.equal(outline.expansion.marks[0].multiplier, 100);
  assert.equal(selectAiContext(data, outline.id, 'chat').currentOutline.expansion, undefined);
});
