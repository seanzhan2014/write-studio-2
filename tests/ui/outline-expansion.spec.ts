import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import type { StudioData } from "../../lib/studio-types";
import { normalizeAiGenerateOptions } from "../../lib/generate-options";

test("sentence multipliers are independent of text, inherit live and survive editing, saving and generation", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const current = await (await request.get('/api/state')).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.tasks = [];
  data.settings.outlineExpansionMultiplier = 8;
  const outline = data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current')!;
  const plan = '原文写着展开×20。第二句。第三句。第四句。第五句。';
  outline.plan = plan;
  outline.expansion = { enabled: true, marks: [] };
  expect((await request.put('/api/state', { headers: { 'If-Match': String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto('/articles/article-main/outlines/outline-current/generate');
  await expect(page.getByRole('textbox', { name: '正文目标字数', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^第1句，8倍/ })).toBeVisible({ timeout: 20000 });
  const sentence = (index: number) => page.getByRole('button', { name: new RegExp(`^第${index}句，`) });
  async function mark(index: number, multiplier: string) {
    await sentence(index).click();
    await page.getByRole('textbox', { name: '本句倍率', exact: true }).fill(multiplier);
    await page.getByRole('button', { name: '应用倍率', exact: true }).click();
  }
  await mark(2, '25');
  await expect(sentence(3)).toHaveAttribute('aria-label', /^第3句，25倍，跟随前句/);
  await mark(4, '5');
  await mark(2, '30');
  await expect(sentence(3)).toHaveAttribute('aria-label', /^第3句，30倍/);
  await expect(sentence(5)).toHaveAttribute('aria-label', /^第5句，5倍/);
  await page.getByRole('textbox', { name: '大纲默认倍率', exact: true }).fill('3');
  await expect(sentence(1)).toHaveAttribute('aria-label', /^第1句，3倍/);
  // Each control selects exactly one whole sentence; the original ×20 remains ordinary text.
  await sentence(1).click();
  await expect(page.locator('.outline-sentence-quote')).toHaveText('原文写着展开×20。');
  await expect(sentence(1).locator('.outline-multiplier')).toHaveText('×3');
  const copied = await page.locator('.outline-sentence-document').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const clipboardData = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    window.getSelection()!.removeAllRanges();
    return clipboardData.getData('text/plain');
  });
  expect(copied).toBe(plan);
  await page.getByRole('button', { name: '保存大纲', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存大纲', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑大纲文字', exact: true }).click();
  const textarea = page.getByRole('textbox', { name: '生成使用的大纲内容', exact: true });
  await expect(textarea).toHaveValue(plan);
  await textarea.fill('开头新增。' + plan);
  await page.getByRole('button', { name: '完成文字编辑', exact: true }).click();
  await expect(sentence(3)).toHaveAttribute('aria-label', /^第3句，30倍，本句设置/);
  await page.getByRole('button', { name: '保存大纲', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存大纲', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(sentence(3)).toHaveAttribute('aria-label', /^第3句，30倍，本句设置/);
  // Resetting restores a live link to the preceding sentence.
  await sentence(3).click();
  await page.getByRole('button', { name: '恢复跟随前句', exact: true }).click();
  await expect(sentence(4)).toHaveAttribute('aria-label', /^第4句，3倍，跟随前句/);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
    await page.setViewportSize(viewport);
    await sentence(5).click();
    await page.locator('.outline-sentence-settings').getByRole('button', { name: '关闭', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await expect(page.getByRole('button', { name: '恢复跟随前句', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('sentence-multipliers-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/ai/tasks')).json()).tasks[0]?.state, { timeout: 30000 }).toBe('success');
  const task = (await (await request.get('/api/ai/tasks')).json()).tasks[0];
  expect(task.contextOptions.targetWords).toBeUndefined();
  expect(task.contextOptions.promptContext.currentOutline.expansion.sentences.map((item: { multiplier: number }) => item.multiplier)).toEqual([3, 3, 3, 3, 5, 5]);
  const saved = (await (await request.get('/api/state')).json()).data;
  const savedOutline = saved.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === 'outline-current');
  expect(savedOutline.plan).toBe('开头新增。' + plan);
  expect(savedOutline.expansion.marks).toHaveLength(1);
});

test('an empty outline keeps normal typing when sentence mode is enabled', async ({ page, request }) => {
  const current = await (await request.get('/api/state')).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.tasks = [];
  const outline = data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current')!;
  outline.plan = '';
  outline.expansion = { enabled: true, marks: [] };
  expect((await request.put('/api/state', { headers: { 'If-Match': String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto('/articles/article-main/outlines/outline-current/generate');
  const input = page.getByRole('textbox', { name: '生成使用的大纲内容', exact: true });
  await input.pressSequentially('ABC. DEF.');
  await expect(input).toHaveValue('ABC. DEF.');
  await page.getByRole('button', { name: '完成文字编辑', exact: true }).click();
  await expect(page.getByRole('group', { name: '按完整句子设置倍率', exact: true }).getByRole('button')).toHaveCount(2);
});

test('chapter and outline views retain total limits and show exact multipliers only in multiplier mode', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const current = await (await request.get('/api/state')).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.tasks = [];
  data.settings.outlineExpansionMultiplier = 8;
  const outline = data.articles[0].chapters[0].outlines.find(item => item.id === 'outline-current')!;
  outline.plan = '甲乙丙。丁戊己。';
  outline.generateOptions = normalizeAiGenerateOptions({ targetWords: 600 });
  delete outline.expansion;
  expect((await request.put('/api/state', { headers: { 'If-Match': String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  const block = page.locator('[data-continuous-outline-id="outline-current"]');
  for (const route of ['/articles/article-main/chapters/edit-all', '/articles/article-main/outlines/edit-all']) {
    await page.goto(route);
    await expect(block.getByText('整体字数限制 600 字', { exact: true })).toBeVisible();
    await expect(block.getByRole('textbox', { name: '大纲默认倍率', exact: true })).toHaveCount(0);
    await expect(block.getByRole('group', { name: '按完整句子设置倍率', exact: true })).toHaveCount(0);
    await expect(block.getByText('按总字数换算倍率', { exact: true })).toHaveCount(0);
  }
  await block.getByRole('textbox', { name: '大纲内容：当前码头', exact: true }).fill('甲乙丙。丁戊己！');
  await expect.poll(async () => {
    const saved = (await (await request.get('/api/state')).json()).data;
    const item = saved.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === outline.id);
    expect(item.expansion?.enabled).not.toBe(true);
    expect(item.generateOptions.targetWords).toBe(600);
    return item.plan;
  }).toBe('甲乙丙。丁戊己！');
  await page.goto('/articles/article-main/outlines/outline-current/generate');
  await expect(page.getByRole('combobox', { name: '篇幅控制', exact: true })).toHaveValue('总目标字数');
  await expect(page.getByRole('textbox', { name: '正文目标字数', exact: true })).toHaveValue('600 字');
  // A conversion is still available as an explicit generation-page action.
  await page.getByRole('combobox', { name: '篇幅控制', exact: true }).click();
  await page.getByRole('option', { name: '大纲句子倍率', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '篇幅控制', exact: true })).toHaveValue('大纲句子倍率');
  await expect(page.getByRole('textbox', { name: '大纲默认倍率', exact: true })).toHaveValue('100×');
  await page.getByRole('textbox', { name: '大纲默认倍率', exact: true }).fill('12.345678');
  await page.getByRole('button', { name: /^第2句，12\.345678倍/ }).click();
  await page.getByRole('textbox', { name: '本句倍率', exact: true }).fill('25');
  await page.getByRole('button', { name: '应用倍率', exact: true }).click();
  await expect(page.getByRole('button', { name: /^第2句，25倍，本句设置/ })).toBeVisible();
  await page.getByRole('button', { name: '保存大纲', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存大纲', exact: true })).toHaveCount(0);
  for (const route of ['/articles/article-main/chapters/edit-all', '/articles/article-main/outlines/edit-all']) {
    await page.goto(route);
    await expect(block.locator('.outline-expansion-defaults > summary')).toHaveText('精确倍数限制 · 默认 12.345678× · 本大纲设置');
    await expect(block.getByText('整体字数限制 600 字', { exact: true })).toHaveCount(0);
    await expect(block.getByText('按总字数换算倍率', { exact: true })).toHaveCount(0);
  }
  await block.locator(".outline-expansion-defaults > summary").click();
  await expect(block.getByRole('textbox', { name: '大纲默认倍率', exact: true })).toHaveValue('12.345678×');
  await block.getByRole('button', { name: '编辑大纲文字', exact: true }).click();
  await block.getByRole('textbox', { name: '大纲内容：当前码头', exact: true }).fill('甲乙丙。丁戊己！庚辛。');
  await block.getByRole('button', { name: '完成文字编辑', exact: true }).click();
  await expect(block.getByRole('button', { name: /^第3句，25倍，跟随前句/ })).toBeVisible();
  await expect(block.getByRole('textbox', { name: '大纲默认倍率', exact: true })).toHaveValue('12.345678×');
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
    await page.setViewportSize(viewport);
    await block.getByRole('button', { name: /^第2句，25倍/ }).click();
    await block.getByRole('button', { name: '恢复跟随前句', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: info.outputPath('chapter-sentence-multipliers.png'), fullPage: true });
  await block.getByRole('button', { name: '恢复跟随前句', exact: true }).click();
  await expect(block.getByRole('button', { name: /^第3句，12\.345678倍，跟随前句/ })).toBeVisible();
});
