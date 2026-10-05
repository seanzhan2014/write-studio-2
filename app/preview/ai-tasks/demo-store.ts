"use client";

import { useSyncExternalStore } from "react";

export type DemoPhase = "awaiting" | "thinking" | "ready" | "writing" | "completed";
export type DemoReply = { round: number; answers: Record<string, string>; note: string };
export type DemoState = {
  version: 1;
  configuredRounds: number;
  maxRounds: number;
  round: number;
  phase: DemoPhase;
  replies: DemoReply[];
  choices: Record<string, string>;
  replyDraft: string;
  editedPreparation: string;
};
export type DemoQuestion = { id: string; title: string; reason: string; options: Array<{ value: string; title: string; detail: string }> };

const storageKey = "writer-studio-task-interaction-preview-v1";
const initialState: DemoState = { version: 1, configuredRounds: 3, maxRounds: 3, round: 0, phase: "awaiting", replies: [], choices: {}, replyDraft: "", editedPreparation: "" };
let state = initialState;
let loaded = false;
let storageError = "";
const listeners = new Set<() => void>();

function parseState(value: string | null): DemoState | null {
  try {
    const parsed = JSON.parse(value ?? "null") as DemoState | null;
    if (!parsed || parsed.version !== 1 || !["awaiting", "thinking", "ready", "writing", "completed"].includes(parsed.phase)) return null;
    if (![parsed.round, parsed.maxRounds, parsed.configuredRounds].every((n) => Number.isInteger(n) && n >= 0 && n <= 5) || parsed.round > parsed.maxRounds) return null;
    if (!Array.isArray(parsed.replies) || !parsed.replies.every((reply) => reply && typeof reply.note === "string" && reply.answers && typeof reply.answers === "object") || !parsed.choices || typeof parsed.choices !== "object") return null;
    if (typeof parsed.replyDraft !== "string" || typeof parsed.editedPreparation !== "string") return null;
    return parsed;
  } catch { return null; }
}

function snapshot() {
  if (typeof window !== "undefined" && !loaded) {
    loaded = true;
    try { state = parseState(window.localStorage.getItem(storageKey)) ?? initialState; }
    catch { storageError = "浏览器未允许保存演示进度，本次操作仍可继续。"; }
  }
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    state = parseState(event.newValue) ?? initialState;
    for (const callback of listeners) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function useDemoState() {
  return useSyncExternalStore(subscribe, snapshot, () => initialState);
}

export function updateDemo(change: (current: DemoState) => DemoState) {
  state = change(snapshot());
  try { window.localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { storageError = "演示进度未能保存，请保持此页面打开。"; }
  for (const listener of listeners) listener();
}

export function demoStorageError() { return storageError; }

export function resetDemo() {
  updateDemo((current) => ({ ...initialState, configuredRounds: current.configuredRounds, maxRounds: current.configuredRounds, phase: current.configuredRounds === 0 ? "ready" : "awaiting" }));
}

export function demoQuestions(round: number): DemoQuestion[] {
  if (round === 0) return [
    { id: "discovery", title: "林舟在档案室里，会发现到哪一步？", reason: "这决定他接下来为什么找沈砚，以及对话能有多直接。", options: [
      { value: "suspect", title: "只发现异常，产生怀疑", detail: "留下缺页和旧签名，他还不能确认背叛。" },
      { value: "proof", title: "找到证据，确认有人隐瞒", detail: "他已经知道档案被修改，但还不知道原因。" },
    ] },
    { id: "reader", title: "读者是否比林舟多知道一点？", reason: "人物与读者掌握的信息可以不同，悬念的来源也会改变。", options: [
      { value: "limited", title: "与林舟同步发现", detail: "保持林舟的有限视角，读者一起猜测。" },
      { value: "ahead", title: "给读者一个额外线索", detail: "场景末尾短暂切到沈砚，保留真正动机。" },
    ] },
  ];
  if (round === 1) return [{ id: "confrontation", title: "林舟与沈砚的第一次交锋，应该怎样开始？", reason: "现在信息边界已明确，需要决定人物如何把怀疑转化为行动。", options: [
    { value: "test", title: "用一个细节试探对方", detail: "问起缺页，观察沈砚的反应，矛盾保持克制。" },
    { value: "direct", title: "直接问出档案的问题", detail: "围绕已发现的异常提问，不预先断定对方动机。" },
  ] }];
  return [{ id: `ending-${round}`, title: round === 2 ? "这段故事要在哪个变化上结束？" : "还有什么需要补充或调整？", reason: "确认收束点后，正文可以保持完整，也为下一段留下空间。", options: [
    { value: "clue", title: "留下一条新的调查线索", detail: "沈砚提到旧码头，林舟决定继续核实。" },
    { value: "distance", title: "让两人的信任出现裂缝", detail: "沈砚避开问题，林舟第一次收回了信任。" },
  ] }];
}

export function submitDemoReply() {
  updateDemo((current) => {
    if (current.phase !== "awaiting") return current;
    const questions = demoQuestions(current.round);
    if (!current.replyDraft.trim() && !questions.every((q) => current.choices[q.id])) return current;
    const answers = Object.fromEntries(questions.map((q) => [q.id, current.choices[q.id] ?? "deferred"]));
    return { ...current, phase: "thinking", replies: [...current.replies, { round: current.round + 1, answers, note: current.replyDraft.trim() }], choices: {}, replyDraft: "", editedPreparation: "" };
  });
}

export function finishDemoReply() {
  updateDemo((current) => current.phase !== "thinking" ? current : { ...current, round: current.replies.length, phase: current.replies.length >= current.maxRounds ? "ready" : "awaiting" });
}

export function allDemoAnswers(current: DemoState) {
  return Object.assign({}, ...current.replies.map((reply) => reply.answers)) as Record<string, string>;
}

function latestEnding(answers: Record<string, string>) {
  return Object.entries(answers).reverse().find(([id, value]) => id.startsWith("ending-") && value !== "deferred")?.[1];
}

export function preparationSections(current: DemoState) {
  const answers = allDemoAnswers(current);
  const discovery = answers.discovery === "proof" ? "林舟找到档案被修改的证据，但不知道沈砚的真实动机。" : answers.discovery === "suspect" ? "林舟发现缺页与旧签名，只产生怀疑，不能把猜测当成事实。" : "林舟发现档案异常；是否达到确认程度，等待作者决定。";
  const confrontation = answers.confrontation === "direct" ? "林舟直接询问档案异常，只质疑已发现的事实。" : answers.confrontation === "test" ? "林舟问起缺页，用沈砚的反应核实怀疑。" : "林舟依据当时掌握的信息询问沈砚；交锋方式待决定。";
  const ending = latestEnding(answers) === "distance" ? "沈砚避开关键问题，林舟开始收回信任。" : latestEnding(answers) === "clue" ? "沈砚提到旧码头，林舟决定沿着新线索继续调查。" : "留下进一步调查的空间；具体收束点可在确认前补充。";
  return [
    { title: "核心与作用", text: "林舟进入旧档案室，发现父亲失踪记录中的异常。他与沈砚的关系开始从信任转向试探。" },
    { title: "开头与结尾", text: `雨停后的傍晚，林舟带着钥匙进入档案室。${ending}` },
    { title: "场景推进", text: `打开档案柜 → 核对记录 → 发现异常 → ${confrontation} → 留下新的变化。` },
    { title: "人物目标与行动", text: `林舟想弄清父亲失踪的经过，又不愿轻易怀疑沈砚。${confrontation}沈砚试图保留部分信息，真实理由暂时留白。` },
    { title: "认知与信息边界", text: `${discovery}沈砚知道档案缺页的原因。林舟只有在场景中获得依据之后，才能改变判断。` },
    { title: "视角与信息揭示", text: answers.reader === "ahead" ? "主要跟随林舟；末尾短暂切到沈砚，给读者额外线索。切换时明确场景边界。" : answers.reader === "limited" ? "采用林舟的有限视角。读者与他同步发现线索，不直接进入沈砚的内心。" : "建议采用林舟的有限视角；读者信息范围等待作者决定。" },
    { title: "情绪与关系", text: "林舟从期待转为不安，再试图压住怀疑。通过停顿、避让和行动体现变化，保持两人熟悉而克制的关系。" },
    { title: "事实与约束", text: "时间是雨后的傍晚；人物此前已出场；钥匙由沈砚交给林舟。保留缺页和旧签名，不提前揭晓父亲失踪的原因。" },
    { title: "表现与篇幅", text: "约 1,800 字。重点展开发现异常与人物交锋；环境描写简短，对白留有余地，最后自然收束。" },
  ];
}

export function preparationText(current: DemoState) {
  const sections = preparationSections(current).map((section, index) => `${index + 1}. ${section.title}\n${section.text}`).join("\n\n");
  const notes = current.replies.filter((reply) => reply.note).map((reply) => `第 ${reply.round} 轮：${reply.note}`).join("\n");
  return `${sections}${notes ? `\n\n作者补充\n${notes}` : ""}`;
}

export function demoProse(current: DemoState) {
  const answers = allDemoAnswers(current);
  return `雨在傍晚停了。林舟推开档案室的门，潮气仍贴在墙上。\n\n钥匙是沈砚给他的。那人递过来时只说，旧柜子不好开，别用蛮力。林舟照做了，先往里轻轻推了一下，再转动钥匙。锁舌退开的声音很轻。\n\n父亲的名字在第三册。他一页页翻过去，找到那行熟悉的字，指尖却停在了下一页的边缘。纸张之间露出一截细窄的残茬。\n\n${answers.discovery === "proof" ? "他把日期同借阅单对了一遍。记录改过，借阅人的签名仍在。不是年久失落，有人动过这册档案。" : "少了一页。也许早就遗失了，也许有人取走过。他还没有足够的依据。林舟将册子合上，又重新打开。"}\n\n门口传来脚步声。沈砚停在门框边，没有马上走近。\n\n${answers.confrontation === "direct" ? "“这册记录改过吗？”林舟问。\n\n沈砚看了看他手下的册子。“你看到了什么？”" : "“这本档案，以前就少一页吗？”林舟问得很随意，手却没有离开残破的装订线。\n\n沈砚望向柜子，晚了半拍才说：“旧东西，难免有缺漏。”"}\n\n林舟抬起眼睛。他们认识太久，那半拍停顿比一句否认更让人在意。\n\n${latestEnding(answers) === "distance" ? "他原本想把册子递过去，此刻却收回了手。\n\n“我再看看。”他说。\n\n沈砚点点头。两人之间仍只有几步距离，林舟却觉得，那几步第一次需要自己走过去。" : "“如果你要查那年的事，”沈砚终于说，“可以去旧码头问问。”\n\n林舟把这个地方记在借阅单背面。他没有再追问。眼前的线索还不足以让他判断沈砚，却足够让他知道，明天应该去哪里。"}\n\n${answers.reader === "ahead" ? "林舟离开后，沈砚在门边站了一会儿。他从口袋里拿出一张折过的旧纸，又将它收了回去。" : "门在他身后合上。雨水从檐角落下来，一滴接着一滴。"}`;
}
