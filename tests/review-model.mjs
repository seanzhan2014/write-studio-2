import http from "node:http";
import { once } from "node:events";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";
import { scenePlanFixture } from "./scene-plan-fixture.mjs";

const unescape = (value) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");

export async function reviewModelServer({ generationReasoningTokens = 0 } = {}) {
  /** @type {{ mode: string, failReviews: number, gate: Promise<void> | null, calls: Array<{ kind: string, body: Record<string, unknown> }>, drafts: string[] }} */
  const control = { mode: "pass", failReviews: 0, gate: null, calls: [], drafts: [] };
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const prompt = body.messages.at(-1).content;
    const schema = body.response_format?.json_schema?.name;
    const kind = body.messages[0].content.includes("写作准备稿质量检查任务") ? "check" : body.messages[0].content.includes("写作前准备任务") ? "prepare" : schema === "writer_studio_generate_review" ? "review" : schema === "writer_studio_chapter_review" ? "revise" : "generate";
    control.calls.push({ kind, body });
    if (kind !== "generate" && control.gate) await control.gate;
    if (kind === "review" && control.failReviews > 0) {
      control.failReviews--;
      response.writeHead(503);
      response.end("temporary review outage");
      return;
    }
    const digest = prompt.match(/sourceDigest=([a-f0-9]{64})/)?.[1];
    let content;
    if (kind === "prepare") content = JSON.stringify({ brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, `${title}：保持雨后场景及人物资料，未决项留白。`])), plan: scenePlanFixture(), questions: [] });
    else if (kind === "check") content = JSON.stringify({ issues: [] });
    else if (kind === "generate") content = "她十七岁。\n\n窗外的雨停了。";
    else {
      const blocks = [...prompt.matchAll(/<block id="([^"]+)">([\s\S]*?)<\/block>/g)];
      const text = blocks.map((match) => unescape(match[2])).join("");
      if (kind === "review") {
        const fixed = control.mode === "pass" && text.includes("十八岁");
        const issues = control.mode === "clean" ? [] : [{ id: "P001", rule: "年龄须与人物资料一致", description: "人物年龄应为十八岁", evidence: fixed ? "十八岁" : "十七岁", suggestion: "把十七岁修正为十八岁", status: fixed ? "resolved" : "open", reason: fixed ? "当前稿已经改为十八岁，与设定一致" : "当前稿仍与人物设定不符" }];
        content = JSON.stringify({ version: 1, sourceDigest: digest, issues });
      } else {
        control.drafts.push(text);
        content = JSON.stringify({ version: 1, chapterId: prompt.match(/chapterId=([^;、]+)/)?.[1], sourceDigest: digest, edits: [{ outlineId: prompt.match(/current_draft outline_id="([^"]+)"/)?.[1] ?? prompt.match(/<outline id="([^"]+)"/)?.[1], fromBlockId: blocks[0][1], toBlockId: blocks[0][1], replacement: control.mode === "limit" ? unescape(blocks[0][2]) : unescape(blocks[0][2]).replace("十七岁", "十八岁"), ruleIds: [prompt.match(/<rule id="([^"]+)"/)?.[1] ?? "additional"] }] });
      }
    }
    // Some providers reason by default, even without a reasoning_effort field.
    // Their output budget must cover thinking as well as the visible draft.
    const reasoningTokens = kind === "generate" ? generationReasoningTokens : 0;
    const truncated = (kind === "generate" && control.mode === "truncated") || (Number.isFinite(body.max_tokens) && body.max_tokens < reasoningTokens + 5);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: truncated ? "length" : "stop", message: { content: truncated ? "她" : content } }], usage: { prompt_tokens: 10, completion_tokens: truncated ? body.max_tokens : reasoningTokens + 5, completion_tokens_details: { reasoning_tokens: Math.min(reasoningTokens, body.max_tokens ?? Infinity) } } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { control, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, close() { server.closeAllConnections(); server.close(); } };
}
