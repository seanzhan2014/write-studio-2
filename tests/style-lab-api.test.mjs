import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";
const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method="GET", data, headers={}) { const response=await fetch(`${baseUrl}${path}`,{method,headers:{"Content-Type":"application/json",...headers},body:data===undefined?undefined:JSON.stringify(data)});const body=await response.json();assert.ok(response.ok,`${response.status}: ${JSON.stringify(body)}`);return body; }

test("style tasks snapshot global defaults, allow per-task overrides and follow article models", async () => {
  const provider = await api("/api/providers", "POST", { name: "learning-defaults", baseUrl: "http://127.0.0.1:9/v1", secret: "test-key" });
  const fixed = await api("/api/models", "POST", { providerId: provider.id, name: "fixed-learning", modelId: "fixed-learning" });
  const other = await api("/api/models", "POST", { providerId: provider.id, name: "article-learning", modelId: "article-learning" });
  const current = await api("/api/state");
  const data = fullStudioFixture(); data.tasks = [];
  data.settings.styleLearningSettings = { model: fixed.id, maxRounds: 5, autoApply: false };
  data.articles[0].aiGenerateSettings.model = other.id;
  data.articles[0].storySettings = { styleLibrary: { references: [{ id: "saved-reference", title: "已有参考文章", text: "两位朋友核对书籍后道别。" }] } };
  await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) });
  const first = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "tune" })).job;
  assert.equal(first.model, fixed.id); assert.equal(first.payload.maxRounds, 5); assert.equal(first.payload.autoApply, false);
  const changed = await api("/api/state");
  changed.data.settings.styleLearningSettings = { model: "", maxRounds: 2, autoApply: true };
  changed.data.articles[0].storySettings.styleLibrary.references[0].title = "修改后的参考文章";
  await api("/api/state", "PUT", { data: changed.data }, { "If-Match": String(changed.revision) });
  const snapshot = (await api(`/api/style-lab/${first.id}`)).job;
  assert.equal(snapshot.payload.maxRounds, 5); assert.equal(snapshot.payload.autoApply, false);
  assert.equal(snapshot.payload.references[0].title, "已有参考文章");
  await api(`/api/style-lab/${first.id}`, "POST", { action: "stop" });
  const override = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "tune", model: fixed.id, maxRounds: 1, autoApply: false })).job;
  assert.equal(override.model, fixed.id); assert.equal(override.payload.maxRounds, 1); assert.equal(override.payload.autoApply, false);
  await api(`/api/style-lab/${override.id}`, "POST", { action: "stop" });
  const following = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "learn" })).job;
  assert.equal(following.model, other.id); assert.equal(following.payload.autoApply, true);
  assert.equal(following.payload.references[0].title, "修改后的参考文章");
  await api(`/api/style-lab/${following.id}`, "POST", { action: "stop" });
});

test("learning and model calibration persist, resume and use validated best settings in real generation", async () => {
  const calls=[]; let evaluation=0; let fail=0; let preparations=0; let invalidPreparations=0;
  const config={style:"通俗而克制的叙述",advancedStyle:{voice:"亲近",additional:"模型建议"},generate:{proseControls:{dialogueDensity:"balanced"},advanced:{detailOrganization:"每次呼应产生意义变化",additional:"使用目标作品的事实"}},scenes:[{name:"对白交锋",when:"人物目标存在分歧",instruction:"用停顿与回避推动交流"}],notes:"来源1：短段落与口语对白"};
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(body);
    if(fail>0){fail--;res.writeHead(503);res.end("retry this step");return;}
    const system=body.messages[0].content; let result;
    if(body.response_format?.json_schema?.name==="writer_studio_generate_review") result={version:1,sourceDigest:body.messages.at(-1).content.match(/sourceDigest=([a-f0-9]{64})/)?.[1],issues:[]};
    else if(system.includes("风格学习助手")||system.includes("审查并修正候选")||system.includes("合并多篇"))result=config;
    else if(system.includes("大纲整理助手"))result={scenes:[{title:"交接",plan:"两位成年人按约定交还书籍，核对后各自离开。",targetWords:300}]};
    else if(system.includes("写作前准备任务")){
      preparations++;
      result={brief:Object.fromEntries(PREPARATION_SECTIONS.map(([key,title])=>[preparations===2?title:key,preparations===2?[title,"只按目标大纲写作"]:title+"：只按目标大纲写作"])),questions:[]};
      if(preparations===1||invalidPreparations-->0)result.brief.purpose={text:"模型返回了错误的字段类型"};
    }
    else if(system.includes("风格对照评估助手")){evaluation++;result={scores:Array(5).fill(evaluation===1?10:16),contentScore:95,evidence:"参考叙述偏简洁，生成稿的解释偏多。",suggestions:"让动作与观察自然交替，压缩无新增意义的解释。"};}
    else if(system.includes("针对固定模型校准"))result={...config,generate:{...config.generate,advanced:{...config.generate.advanced,actionResponse:"动作与观察即时交替"}}};
    else result="两人核对好书籍，向对方道别。门外的脚步声渐渐远去。";
    res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({choices:[{finish_reason:"stop",message:{content:typeof result==="string"?result:JSON.stringify(result)}}],usage:{prompt_tokens:10,completion_tokens:20}}));
  });server.listen(0,"127.0.0.1");await once(server,"listening");
  try {
    const provider=await api("/api/providers","POST",{name:"style-test",baseUrl:`http://127.0.0.1:${server.address().port}/v1`,secret:"test-key"});
    const model=await api("/api/models","POST",{providerId:provider.id,name:"style-test",modelId:"style-test",maxInputCharacters:120000});
    const state=await api("/api/state");const data=fullStudioFixture();data.tasks=[];data.settings.generateReviewMaxRounds=1;data.settings.reviewModelMode="inherit";
    data.articles[0].storySettings={location:"目标地点",negativeConstraints:"保留目标事实",advancedStyle:{additional:"人工附加"},styleLibrary:{references:[{id:"reference-one",title:"参考1",text:"两位成年人见面归还书籍。\n他们核对后互相道别。"},{id:"reference-two",title:"参考2",text:"另一段简短的对话。"}],versions:[],calibrations:{},locked:["style.additional"]}};
    await api("/api/state","PUT",{data},{"If-Match":String(state.revision)});
    async function finish(job){for(let i=0;i<50&&job.status!=="completed";i++){job=(await api(`/api/style-lab/${job.id}/step`,"POST",{})).job;assert.notEqual(job.status,"failed",job.error);}assert.equal(job.status,"completed");return (await api(`/api/style-lab/${job.id}`)).job;}
    let job=(await api("/api/style-lab","POST",{articleId:"article-main",kind:"learn",model:model.id})).job;
    await api(`/api/style-lab/${job.id}`,"POST",{action:"pause"});assert.equal((await api(`/api/style-lab/${job.id}/step`,"POST",{})).job.status,"paused");
    job=(await api(`/api/style-lab/${job.id}`,"POST",{action:"resume"})).job;job=await finish(job);
    let article=(await api("/api/state")).data.articles[0];assert.equal(article.style,config.style);assert.equal(article.storySettings.advancedStyle.additional,"人工附加");assert.equal(article.storySettings.styleLibrary.scenes[0].name,"对白交锋");assert.equal(article.storySettings.styleLibrary.versions.length,2);
    assert.ok(calls[0].messages[0].content.includes("情节污染")||calls[0].messages[0].content.includes("情节"));
    job=(await api("/api/style-lab","POST",{articleId:"article-main",kind:"tune",model:model.id,maxRounds:1})).job;
    fail=3;job=(await api(`/api/style-lab/${job.id}/step`,"POST",{})).job;assert.equal(job.status,"failed");assert.equal(job.phase,"outline");
    assert.equal(job.payload.history.filter(event=>event.status==="retrying").length,2);
    job=(await api(`/api/style-lab/${job.id}`,"POST",{action:"retry"})).job;job=await finish(job);
    assert.equal(job.rounds.length,2);assert.equal(job.payload.bestRound,1);assert.equal(job.payload.bestScore,80);
    assert.equal(job.payload.outlines.length,2);assert.equal(job.rounds[1].drafts.length,2);
    article=(await api("/api/state")).data.articles[0];assert.equal(article.storySettings.styleLibrary.calibrations[model.id].configuration.generate.advanced.actionResponse,"动作与观察即时交替");
    assert.equal(article.chapters[0].outlines[1].content,data.articles[0].chapters[0].outlines[1].content,"试写不能替换作品正文");
    const generated=await api("/api/ai/generate","POST",{outlineId:"outline-current",target:"content",model:model.id,advanced:{additional:"本次手动附加"}});
    assert.ok(generated.text);const prompt=calls.at(-1).messages.map(m=>m.content).join("\n");assert.ok(prompt.includes("动作与观察即时交替"));assert.ok(prompt.includes("本次手动附加"));assert.ok(prompt.includes("人工附加"));
    const prepared=calls.find(c=>c.messages[0].content.includes("写作前准备任务"));assert.ok(prepared.messages[1].content.includes("细节组织方式"));
    assert.equal(prepared.response_format.json_schema.name,"writer_studio_writing_preparation");
    assert.ok(prepared.messages[1].content.includes("<output_contract>preparation_json</output_contract>"));
    const repaired=calls.find(c=>c.messages.at(-1).content.includes("preparation_format_repair"));assert.ok(repaired.messages.at(-1).content.includes("brief.purpose"));
    assert.ok(job.rounds[0].drafts[0].brief.includes("只按目标大纲写作"));
    const reviewed=calls.find(c=>c.response_format?.json_schema?.name==="writer_studio_generate_review");assert.ok(reviewed.messages[1].content.includes("每次呼应产生意义变化"));assert.ok(reviewed.messages[1].content.includes("人工附加"));
    // Persist the exact failed preparation step, then retry using the already extracted outlines.
    job=(await api("/api/style-lab","POST",{articleId:"article-main",kind:"tune",model:model.id,maxRounds:1})).job;
    while(job.phase==="outline")job=(await api(`/api/style-lab/${job.id}/step`,"POST",{})).job;
    const outlines=structuredClone(job.payload.outlines);const before=preparations;invalidPreparations=2;
    job=(await api(`/api/style-lab/${job.id}/step`,"POST",{})).job;
    assert.equal(job.status,"failed");assert.equal(job.phase,"prepare");assert.match(job.error,/brief.purpose/);assert.equal(preparations-before,2);
    const diagnostics=job.payload.history.at(-1).diagnostics;
    assert.equal(diagnostics.length,2);assert.match(diagnostics[0].error,/brief.purpose/);
    assert.equal(JSON.parse(diagnostics[1].response).brief.purpose.text,"模型返回了错误的字段类型");
    assert.deepEqual(job.payload.outlines,outlines);
    job=(await api(`/api/style-lab/${job.id}`,"POST",{action:"retry"})).job;job=await finish(job);
    assert.deepEqual(job.payload.outlines,outlines);assert.equal(job.rounds[0].drafts.length,2);
    // Background learning must retain a result when the author edits configuration meanwhile.
    job=(await api("/api/style-lab","POST",{articleId:"article-main",kind:"learn",model:model.id})).job;
    const edited=await api("/api/state");edited.data.articles[0].style="作者在学习期间手动修改的风格";
    await api("/api/state","PUT",{data:edited.data},{"If-Match":String(edited.revision)});
    job=await finish(job);
    assert.equal((await api("/api/state")).data.articles[0].style,"作者在学习期间手动修改的风格");
    assert.match(job.payload.notice,/已改变/);assert.equal(job.payload.autoApplyPending,false);
    await api(`/api/style-lab/${job.id}`,"POST",{action:"apply"});
    assert.equal((await api("/api/state")).data.articles[0].style,config.style);
    job=(await api("/api/style-lab","POST",{articleId:"article-main",kind:"learn",model:model.id,autoApply:false})).job;
    job=await finish(job);assert.ok(!job.payload.applied);assert.equal(job.payload.autoApplyPending,false);
  }finally{server.closeAllConnections();server.close();}
});
