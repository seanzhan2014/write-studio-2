import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";

test("person photos support mobile iteration, adoption, comparison and persistent drafts", async ({ page, request }, info) => {
  test.setTimeout(60000);
  const original = await (await request.get("/api/state")).json();
  const fixture = fullStudioFixture();
  fixture.articles[0].illustrationSettings = { stylePreset: "ink", promptLanguage: "zh", resolution: "" };
  await request.put("/api/state", { headers: { "If-Match": String(original.revision) }, data: { data: fixture } });
  const jobs: any[] = []; let submissions = 0;
  const model = { id: "portrait-model", name: "参考图模型", modelId: "example/edit", providerId: "image-service", providerName: "图像服务", adapterKind: "openai-compatible", hasSecret: true, metadata: { source: "provider", inputModalities: ["text", "image"], outputModalities: ["image"], supportedParameters: { image_urls: { referenceImage: true, maxImages: 3 } } } };
  await page.route("**/api/models", route => route.fulfill({ json: { models: [model] } }));
  await page.route("**/api/ai/character-photos**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      if (url.searchParams.has("dispatch")) return route.continue();
      const response = await route.fetch(); const data = await response.json();
      return route.fulfill({ response, json: { ...data, jobs, providers: [] } });
    }
    const body = route.request().postDataJSON();
    if (body.action !== "generate") return route.continue();
    submissions++;
    const current = await (await request.get("/api/state")).json();
    const person = current.data.articles[0].characters[0];
    const snapshot = { draft: body.draft, prompt: body.draft.prompt, stylePreset: "anime", styleSource: "本次指定", person: { name: person.name, age: "20", appearance: "短发" }, references: person.photos.photos.filter((p: any) => body.draft.referenceIds.includes(p.id)), model: { ...model, baseUrl: "https://images.example/v1", timeoutMs: 1000 } };
    const id = `candidate-${submissions}`;
    person.photos.photos.push({ ...person.photos.photos[0], id, name: `候选 ${submissions}`, status: "candidate", source: "generated", createdAt: new Date().toISOString(), experimentId: body.draft.experimentId, generation: { ...snapshot, referenceIds: body.draft.referenceIds } });
    const saved = await request.patch(`/api/characters/${person.id}`, { headers: { "If-Match": String(current.revision) }, data: { photos: person.photos } });
    expect(saved.ok()).toBeTruthy();
    jobs.unshift({ id: body.requestId + "-0", characterId: person.id, characterName: person.name, state: "success", snapshot, photoId: id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: "" });
    await new Promise(resolve => setTimeout(resolve, 300));
    return route.fulfill({ json: { jobs: [jobs[0]] } });
  });
  await page.goto("/articles/article-main/info/characters");
  await page.locator(".character-card").first().getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑人物", exact: true });
  await dialog.getByRole("tab", { name: "照片", exact: true }).click();
  await expect(dialog.getByText("为人物建立照片相册", { exact: true })).toBeVisible();
  await dialog.getByLabel("上传人物参考照片", { exact: true }).setInputFiles({ name: "正面.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(dialog.locator(".photo-card")).toHaveCount(1);
  await dialog.locator(".photo-card-preview").first().click();
  await dialog.getByRole("button", { name: "设为主图并加入相册", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "当前主图", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "返回照片", exact: true }).first().click();
  const mobile = info.project.name.startsWith("mobile");
  if (mobile) await dialog.locator(".photo-bottom-actions").getByRole("button", { name: "生成照片", exact: true }).click();
  await dialog.getByLabel("角色照片图像模型", { exact: true }).selectOption(model.id);
  await expect(dialog.locator(".photo-style-status")).toContainText("跟随文章 · 国风水墨");
  await dialog.getByLabel("本次照片风格", { exact: true }).selectOption("anime");
  await dialog.getByLabel("角色照片画面要求", { exact: true }).fill("保持五官，微笑，浅色外套");
  await dialog.locator(".photo-generate-button").dblclick();
  await expect.poll(() => submissions).toBe(1);
  await expect(dialog.locator(".photo-attempt")).toHaveCount(1);
  await dialog.getByLabel("角色照片画面要求", { exact: true }).fill("下一轮改成侧面，保留原有衣服");
  if (mobile) await dialog.locator(".photo-bottom-actions").getByRole("button", { name: "查看照片与候选", exact: true }).click();
  await expect(dialog.locator(".photo-card")).toHaveCount(1);
  await dialog.getByRole("checkbox", { name: "对比 候选 1", exact: true }).check();
  await dialog.getByRole("button", { name: /^相册/ }).click();
  await dialog.getByRole("checkbox", { name: "对比 正面.png", exact: true }).check();
  await dialog.getByRole("button", { name: "对比 2/2", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "照片对比" })).toBeVisible();
  if (mobile) {
    await expect(dialog.locator(".photo-ab-switch")).toBeVisible();
    await dialog.locator(".photo-ab-switch button").last().click();
    await expect(dialog.getByAltText("对比 B：正面.png", { exact: true })).toBeVisible();
  } else expect(await dialog.locator(".photo-compare-images figure").count()).toBe(2);
  await dialog.getByLabel("对比缩放", { exact: true }).selectOption("2");
  await dialog.screenshot({ path: `.test-data/character-photo-compare-${info.project.name}.png` });
  await dialog.getByRole("button", { name: "返回照片", exact: true }).first().click();
  await dialog.getByRole("button", { name: /^候选/ }).click();
  await dialog.locator(".photo-card-preview").first().click();
  await dialog.getByRole("button", { name: "设为主图并加入相册", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].characters[0].photos.photos.filter((p: any) => p.status === "approved").length).toBe(2);
  await dialog.getByRole("button", { name: "以此图修改", exact: true }).click();
  await expect(dialog.getByAltText("修改底图", { exact: true })).toBeVisible();
  await dialog.getByLabel("角色照片画面要求", { exact: true }).fill("换成夜景，脸不要改变");
  await expect(dialog.getByText("草稿已保存", { exact: true })).toBeVisible();
  await dialog.screenshot({ path: `.test-data/character-photo-generate-${info.project.name}.png` });
  const bounds = await dialog.evaluate(el => ({ width: el.scrollWidth, client: el.clientWidth }));
  expect(bounds.width).toBeLessThanOrEqual(bounds.client + 1);
  await page.reload();
  await page.locator(".character-card").first().getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.getByRole("tab", { name: "照片", exact: true }).click();
  if (mobile) await dialog.locator(".photo-bottom-actions").getByRole("button", { name: "生成照片", exact: true }).click();
  await expect(dialog.getByLabel("角色照片画面要求", { exact: true })).toHaveValue("换成夜景，脸不要改变");
  await expect(dialog.getByAltText("修改底图", { exact: true })).toBeVisible();
  if (mobile) {
    await dialog.getByLabel("角色照片画面要求", { exact: true }).focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 400 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(dialog).toHaveAttribute("data-photo-keyboard", "true");
    const footer = await dialog.locator(".photo-bottom-actions").boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(401);
    await page.evaluate(() => { delete (window.visualViewport as any).height; window.visualViewport!.dispatchEvent(new Event("resize")); });
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 400 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await expect(dialog.locator(".photo-bottom-actions")).toBeVisible();
      const box = await dialog.evaluate(el => ({ width: el.scrollWidth, client: el.clientWidth }));
      expect(box.width).toBeLessThanOrEqual(box.client + 1);
    }
  }
  await expect(page.getByRole("dialog", { name: "处理保存冲突" })).toHaveCount(0);
});
