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
