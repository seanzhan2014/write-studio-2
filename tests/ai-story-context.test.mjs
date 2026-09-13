import assert from "node:assert/strict";
import test from "node:test";

import { selectAiContext } from "../lib/ai-context.ts";

function outline(id, plan, settings = undefined) {
  return { id, title: "", plan, settings, content: "", versions: [], archived: false, chat: { sessions: [], activeSessionId: "" } };
}

test("AI context uses the target chapter's resolved story, character and relationship state", () => {
  const profile = {
    age: "29 岁", appearance: "短发", immutableTraits: "一定验证证据",
  };
  const article = {
    id: "article", title: "潮汐来信", summary: "失序的海港", type: "悬疑", style: "克制", outlineNaming: {},
    storySettings: { location: "雾港", negativeConstraints: "不能用梦解释" },
    characters: [
      { id: "lin", name: "林澈", aliases: ["阿澈"], description: "修理师", profile, archived: false },
      { id: "gu", name: "顾屿", aliases: [], description: "海图员", profile, archived: false },
    ],
    relationships: [{ id: "pair", characterAId: "lin", characterBId: "gu", description: "互不信任" }],
    chapters: [
      { id: "one", title: "第一章", archived: false, settings: { story: {}, characters: {}, relationships: {} }, outlines: [outline("previous", "林澈检查钟表")] },
      { id: "two", title: "第二章", archived: false, settings: {
        story: { location: { value: "旧码头", scope: "ongoing" } },
        characters: {
          lin: { start: { appearance: { value: "披着雨衣", scope: "chapter" } }, end: { age: "30 岁" }, appears: { value: true, scope: "chapter" } },
          gu: { start: {}, end: {}, appears: { value: true, scope: "chapter" } },
        },
        relationships: { pair: { start: { value: "暂时结盟", scope: "chapter" }, end: "公开决裂" } },
      }, outlines: [
        outline("previous-local", "林澈先检查仓库", {
          story: { location: { value: "码头仓库", scope: "ongoing" } },
          characters: { lin: { start: {}, end: { age: "31 岁" } } },
          relationships: {},
        }),
        outline("current", "林澈和顾屿在码头交换线索", {
          story: {
            summary: { value: "两人在涨潮前交换证物", scope: "chapter" },
            style: { value: "急促短句", scope: "chapter" },
          },
          characters: { lin: { start: { appearance: { value: "袖口沾血", scope: "chapter" } }, end: {} } },
          relationships: {},
        }),
      ] },
    ],
  };

  const selected = selectAiContext({ articles: [article] }, "current", "content", { includeCharacters: true, firstAppearanceCharacterIds: ["lin", "gu"] });
  assert.equal(selected.article.summary, "两人在涨潮前交换证物");
  assert.equal(selected.article.location, "码头仓库");
  assert.equal(selected.article.style, "急促短句");
  assert.equal(selected.article.negativeConstraints, "不能用梦解释");
  assert.equal(selected.currentChapter.inheritedFromChapter.title, "第一章");
  assert.equal(selected.characters.find((person) => person.id === "lin").profile.appearance, "袖口沾血");
  assert.equal(selected.characters.find((person) => person.id === "lin").profile.age, "31 岁");
  assert.deepEqual(selected.characters.find((person) => person.id === "lin").endingChanges, { age: "30 岁" });
  assert.deepEqual(selected.relationships[0], { characterA: "林澈", characterB: "顾屿", description: "暂时结盟", endingDescription: "公开决裂" });
});
