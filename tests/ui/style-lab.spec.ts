import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import { normalizeConfiguration } from "../../lib/style-learning";

test("advanced settings stay optional and reference learning saves inputs before starting", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.route("**/api/connectivity", route => route.fulfill({ status: 204 }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [{ id:"style-mock",name:"模拟模型",providerName:"测试",hasSecret:true }] } }));
  const original = await (await request.get("/api/state")).json();
  const data = fullStudioFixture(); data.tasks=[];
  expect((await request.put("/api/state", { headers: { "If-Match":String(original.revision) }, data:{data} })).ok()).toBeTruthy();
  let submitted: Record<string, unknown> | undefined;
  const configuration=normalizeConfiguration({style:"通用风格"});
  const job={ id:"mock-style-job",articleId:"article-main",kind:"learn",status:"completed",phase:"completed",model:"style-mock",createdAt:"now",updatedAt:"now",payload:{base:configuration,best:configuration,candidate:configuration,inputTokens:10,outputTokens:20,outlines:[],analyses:[],references:[],round:0,bestRound:0,bestScore:-1,applied:false},rounds:[] };
  await page.route(/\/api\/style-lab(?:\?.*)?$/, async route=>{
    if(route.request().method()==="POST"){submitted=route.request().postDataJSON();await route.fulfill({json:{job}});}
    else await route.fulfill({json:{jobs:submitted&&route.request().url().includes("articleId=")?[job]:[]}});
  });
  await page.route("**/api/style-lab/mock-style-job", route=>route.fulfill({json:{job}}));
  await page.goto("/articles/article-main/info/basic");
  const style=page.locator("details.writing-advanced").filter({has:page.locator("summary",{hasText:"风格高级设定"})});
  await expect(style).not.toHaveAttribute("open",/.*/);
  await style.locator("summary").click(); await style.getByRole("textbox",{name:"附加",exact:true}).fill("保留有意义的情绪呼应");
  await expect.poll(async()=>(await(await request.get("/api/state")).json()).data.articles[0].storySettings?.advancedStyle?.additional).toBe("保留有意义的情绪呼应");
  await page.goto("/articles/article-main/info/ai-tasks");
  const advanced=page.locator(".article-generate-settings details.writing-advanced");
  await expect(advanced).not.toHaveAttribute("open",/.*/); await advanced.locator("summary").click();
  await advanced.getByRole("textbox",{name:"细节组织方式",exact:true}).fill("重复时产生新的意义");
  await advanced.getByRole("textbox",{name:"附加",exact:true}).fill("对话场景允许自然停顿");
  await expect.poll(async()=>(await(await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings?.advanced?.additional).toBe("对话场景允许自然停顿");
  await advanced.locator("summary").click();
  const lab=page.getByRole("region",{name:"风格学习与微调"});
  await lab.locator("summary").filter({hasText:/^参考文章/}).click();
  await lab.getByRole("button",{name:"粘贴参考文章",exact:true}).click();
  await lab.getByRole("textbox",{name:"参考文章 1 名称",exact:true}).fill("我的参考文章");
  await lab.getByRole("textbox",{name:"参考文章 1 正文",exact:true}).fill("甲停下脚步。\n他想了想，把没说完的话咽了回去。");
  await lab.getByRole("combobox",{name:"学习 / 生成模型",exact:true}).click();await page.getByRole("option",{name:"测试 · 模拟模型",exact:true}).click();
  await lab.getByRole("button",{name:"学习并设定",exact:true}).click();
  await expect.poll(()=>submitted?.kind).toBe("learn");
  const saved=(await(await request.get("/api/state")).json()).data.articles[0];
  expect(saved.storySettings.styleLibrary.references[0].title).toBe("我的参考文章");
  expect(saved.storySettings.advancedStyle.additional).toBe("保留有意义的情绪呼应");
  expect(saved.aiGenerateSettings.advanced.detailOrganization).toBe("重复时产生新的意义");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:testInfo.outputPath("style-lab.png"),fullPage:true});
});

test("learning history is available from the task workspace with pagination, evidence and archive", async ({ page, request }, testInfo) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture(); data.tasks = [];
  await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } });
  const configuration = normalizeConfiguration({ style: "历史成果风格" });
  let archived = false;
  const job = { id: "history-ui", articleId: "article-main", kind: "learn", status: "completed", phase: "completed", model: "model", createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z", payload: { base: configuration, best: configuration, references: [{ id: "ref", title: "历史参考文章", text: "关闭页面以后仍保留的参考原文。" }], outlines: [], analyses: [], inputTokens: 10, outputTokens: 20, bestRound: 0, bestScore: -1, round: 0, applications: [], archived: false }, rounds: [] };
  await page.route(/\/api\/style-lab(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url());
    const history = url.searchParams.get("scope") === "history";
    const filter = url.searchParams.get("filter"), second = url.searchParams.get("page") === "2";
    const show = history && (filter === "archived" ? archived : !archived);
    const jobs = show ? second || filter === "archived" ? [job] : Array.from({ length: 20 }, (_, i) => ({ ...job, id: i ? "history-ui-" + i : job.id })) : [];
    await route.fulfill({ json: { jobs, active: 0, executionMode: "server", total: show ? filter === "archived" ? 1 : 21 : 0, pages: show && filter !== "archived" ? 2 : 1, page: second ? 2 : 1 } });
  });
  await page.route("**/api/style-lab/history-ui", async route => {
    if (route.request().method() === "POST") { archived = true; job.payload.archived = true; }
    await route.fulfill({ json: { job } });
  });
  await page.goto("/articles/article-main/info/ai-tasks");
  await expect(page.getByText("由本机服务在后台执行", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "在 AI 任务中查看学习与微调", exact: true }).click();
  const workspace = page.getByRole("region", { name: "AI 任务工作区", exact: true });
  await expect(workspace.getByRole("button", { name: "学习与微调", exact: true })).toHaveAttribute("aria-pressed", "true");
  const history = workspace.getByRole("region", { name: "学习历史", exact: true });
  await expect(history.getByText("21 条记录", { exact: false })).toBeVisible();
  await history.getByRole("button", { name: "2", exact: true }).click();
  await expect(history.getByRole("button", { name: "查看过程", exact: true })).toHaveCount(1);
  await history.getByRole("button", { name: "查看过程", exact: true }).click();
  await history.locator("summary").filter({ hasText: "参考文章快照" }).click();
  await history.locator("summary").filter({ hasText: /^历史参考文章$/ }).click();
  await expect(history.getByText("关闭页面以后仍保留的参考原文。", { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "归档", exact: true }).first().click();
  await history.getByRole("combobox", { name: "筛选学习历史" }).click();
  await page.getByRole("option", { name: "已归档", exact: true }).click();
  await expect(history.getByText("1 条记录", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("style-history-tasks.png"), fullPage: true });
});

test("the ordinary task entry shows failed calibrations in all tasks by default", async ({ page, request }, testInfo) => {
  const current = await (await request.get("/api/state")).json(), data = fullStudioFixture(); data.tasks = [];
  await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } });
  const configuration = normalizeConfiguration({ style: "原风格" });
  const jobs = Array.from({ length: 3 }, (_, i) => ({ id: `failed-calibration-${i}`, articleId: "article-main", kind: "tune", status: "failed", phase: "generate", model: "model", error: "模拟上游失败，等待处理", createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", payload: { base: configuration, best: configuration, references: [], outlines: [], analyses: [], inputTokens: 10, outputTokens: 20, bestRound: 0, bestScore: -1, round: 1 } }));
  await page.route(/\/api\/style-lab(?:\?.*)?$/, route => {
    const history = new URL(route.request().url()).searchParams.get("scope") === "history";
    return route.fulfill({ json: { jobs: history ? jobs : [], active: 0, failed: 3, total: 3, pages: 1, page: 1, executionMode: "server" } });
  });
  await page.goto("/articles/article-main/outlines");
  await page.getByRole("button", { name: "AI 任务", exact: true }).click();
  const workspace = page.getByRole("region", { name: "AI 任务工作区", exact: true });
  await expect(workspace.getByRole("button", { name: "全部任务", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(workspace.getByText("风格微调", { exact: true })).toHaveCount(3);
  await expect(workspace.getByText("模拟上游失败，等待处理", { exact: true })).toHaveCount(3);
  await expect(workspace.getByText("3 个任务需要处理", { exact: true })).toBeVisible();
  await expect(workspace.getByText("暂无 AI 任务", { exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "生成与对话", exact: true }).click();
  await expect(workspace.getByRole("region", { name: "学习历史", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "学习与微调", exact: true }).click();
  await expect(workspace.getByText("风格微调", { exact: true })).toHaveCount(3);
  await expect(workspace.getByRole("button", { name: "学习与微调", exact: true })).toContainText("3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await workspace.getByRole("button", { name: "全部任务", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("all-tasks-calibration.png"), fullPage: true });
});

test("unqualified calibration keeps diagnostics visible and offers no configuration to apply", async ({ page, request }) => {
  const current = await (await request.get("/api/state")).json(), data = fullStudioFixture(); data.tasks = [];
  await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } });
  const configuration = normalizeConfiguration({ style: "原风格" });
  const job = { id: "unqualified", articleId: "article-main", kind: "tune", status: "completed", phase: "completed", model: "model", createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", rounds: [], payload: { base: configuration, best: configuration, references: [], outlines: [], analyses: [], inputTokens: 10, outputTokens: 20, bestRound: 0, bestScore: -1, round: 1, history: [{ at: "2026-10-22T00:00:00Z", status: "retrying", phase: "generate", retry: 1, error: "上游临时不可用", diagnostics: { requestId: "failed-generation", provider: "mock-provider" } }] } };
  await page.route(/\/api\/style-lab(?:\?.*)?$/, route => route.fulfill({ json: { jobs: [job], active: 0, total: 1, pages: 1, page: 1, executionMode: "server" } }));
  await page.route("**/api/style-lab/unqualified", route => route.fulfill({ json: { job } }));
  await page.goto("/articles/article-main/info/ai-tasks");
  await page.getByRole("button", { name: "在 AI 任务中查看学习与微调", exact: true }).click();
  const workspace = page.getByRole("region", { name: "AI 任务工作区", exact: true });
  const history = workspace.getByRole("region", { name: "学习历史", exact: true });
  await expect(history.getByText("未达标", { exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "应用结果", exact: true })).toHaveCount(0);
  await history.getByRole("button", { name: "查看过程", exact: true }).click();
  await expect(history.getByText("尚无达标结果", { exact: false })).toBeVisible();
  await expect(history.getByRole("button", { name: "导出成果配置", exact: true })).toHaveCount(0);
  await history.locator("summary").filter({ hasText: /^运行历史$/ }).click();
  await expect(history.getByText("第 1 次重试", { exact: false })).toBeVisible();
  await history.locator("summary").filter({ hasText: /^响应诊断$/ }).click();
  await expect(history.getByText("failed-generation", { exact: false })).toBeVisible();
});
