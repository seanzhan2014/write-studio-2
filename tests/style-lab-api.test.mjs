import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";
const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method="GET", data, headers={}) { const response=await fetch(`${baseUrl}${path}`,{method,headers:{"Content-Type":"application/json",...headers},body:data===undefined?undefined:JSON.stringify(data)});const body=await response.json();assert.ok(response.ok,`${response.status}: ${JSON.stringify(body)}`);return body; }

test("learning and model calibration persist, resume and use validated best settings in real generation", async () => {
  const calls=[]; let evaluation=0; let fail=false;
  const config={style:"通俗而克制的叙述",advancedStyle:{voice:"亲近",additional:"模型建议"},generate:{proseControls:{dialogueDensity:"balanced"},advanced:{detailOrganization:"每次呼应产生意义变化",additional:"使用目标作品的事实"}},scenes:[{name:"对白交锋",when:"人物目标存在分歧",instruction:"用停顿与回避推动交流"}],notes:"来源1：短段落与口语对白"};
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(body);
    if(fail){fail=false;res.writeHead(503);res.end("retry this step");return;}
    const system=body.messages[0].content; let result;
    if(body.response_format?.json_schema?.name==="writer_studio_generate_review") result={version:1,sourceDigest:body.messages.at(-1).content.match(/sourceDigest=([a-f0-9]{64})/)?.[1],issues:[]};
    else if(system.includes("风格学习助手")||system.includes("审查并修正候选")||system.includes("合并多篇"))result=config;
    else if(system.includes("大纲整理助手"))result={scenes:[{title:"交接",plan:"两位成年人按约定交还书籍，核对后各自离开。",targetWords:300}]};
    else if(system.includes("写作前准备任务"))result={brief:Object.fromEntries(PREPARATION_SECTIONS.map(([key,title])=>[key,title+"：只按目标大纲写作"])),questions:[]};
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
    fail=true;job=(await api(`/api/style-lab/${job.id}/step`,"POST",{})).job;assert.equal(job.status,"failed");assert.equal(job.phase,"outline");
    job=(await api(`/api/style-lab/${job.id}`,"POST",{action:"retry"})).job;job=await finish(job);
    assert.equal(job.rounds.length,2);assert.equal(job.payload.bestRound,1);assert.equal(job.payload.bestScore,80);
    assert.equal(job.payload.outlines.length,2);assert.equal(job.rounds[1].drafts.length,2);
    article=(await api("/api/state")).data.articles[0];assert.equal(article.storySettings.styleLibrary.calibrations[model.id].configuration.generate.advanced.actionResponse,"动作与观察即时交替");
    assert.equal(article.chapters[0].outlines[1].content,data.articles[0].chapters[0].outlines[1].content,"试写不能替换作品正文");
    const generated=await api("/api/ai/generate","POST",{outlineId:"outline-current",target:"content",model:model.id,advanced:{additional:"本次手动附加"}});
    assert.ok(generated.text);const prompt=calls.at(-1).messages.map(m=>m.content).join("\n");assert.ok(prompt.includes("动作与观察即时交替"));assert.ok(prompt.includes("本次手动附加"));assert.ok(prompt.includes("人工附加"));
    const prepared=calls.find(c=>c.messages[0].content.includes("写作前准备任务"));assert.ok(prepared.messages[1].content.includes("细节组织方式"));
    const reviewed=calls.find(c=>c.response_format?.json_schema?.name==="writer_studio_generate_review");assert.ok(reviewed.messages[1].content.includes("每次呼应产生意义变化"));assert.ok(reviewed.messages[1].content.includes("人工附加"));
  }finally{server.closeAllConnections();server.close();}
});
