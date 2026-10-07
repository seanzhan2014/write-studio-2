import http from "node:http";
import { once } from "node:events";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";

export async function preparationModelServer() {
  const control = { calls: [], invalid: 0, gate: null, ask: true };
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const preparing = body.messages[0].content.includes("写作前准备任务");
    control.calls.push({ kind: preparing ? "prepare" : "write", body });
    if (control.gate) await control.gate;
    const content = preparing ? control.invalid-- > 0 ? "{invalid" : JSON.stringify({
      brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, `${title}：按作者已选择的方向准备。人物仅知道前文给出的事实，不知道档案被修改的真实动机。未决项留白。`])),
      questions: control.ask ? [{ id: "discovery", title: "人物在此处了解到哪一步？", reason: "影响下一步行动及悬念。", options: [{ id: "suspect", label: "只发现异常", description: "只产生怀疑，继续核实。" }, { id: "proof", label: "找到明确证据", description: "确认记录被修改，不断言原因。" }] }] : [],
    }) : "作者确认后的正文。\n\n他停在档案柜前，决定先核实线索。";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 12, completion_tokens: 24 } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { control, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
