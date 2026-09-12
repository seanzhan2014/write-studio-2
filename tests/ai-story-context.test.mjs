import assert from "node:assert/strict";
import test from "node:test";

import { selectAiContext } from "../lib/ai-context.ts";

function outline(id, plan) {
  return { id, title: "", plan, content: "", versions: [], archived: false, chat: { sessions: [], activeSessionId: "" } };
}

test("AI context uses the target chapter's resolved story, character and relationship state", () => {
  const profile = {
    age: "29 岁", identity: "修理师", appearance: "短发", personality: "谨慎", speechStyle: "短句", abilities: "机械维修",
    mentalState: "戒备", knownInformation: "只知道公开结论", boundaries: "不伤害无辜者", immutableTraits: "一定验证证据",
  };
  const article = {
    id: "article", title: "潮汐来信", summary: "失序的海港", type: "悬疑", style: "克制", outlineNaming: {},
    storySettings: { era: "近未来", location: "雾港", tone: "冷峻", worldRules: "潮汐倒流", negativeConstraints: "不能用梦解释" },
    characters: [
      { id: "lin", name: "林澈", aliases: ["阿澈"], description: "修理师", profile, archived: false },
      { id: "gu", name: "顾屿", aliases: [], description: "海图员", profile: { ...profile, identity: "海图员" }, archived: false },
    ],
    relationships: [{ id: "pair", characterAId: "lin", characterBId: "gu", description: "互不信任" }],
    chapters: [
      { id: "one", title: "第一章", archived: false, settings: { story: {}, characters: {}, relationships: {} }, outlines: [outline("previous", "林澈检查钟表")] },
      { id: "two", title: "第二章", archived: false, settings: {
        story: { location: { value: "旧码头", scope: "ongoing" } },
        characters: {
          lin: { start: { mentalState: { value: "抱有希望", scope: "chapter" }, knownInformation: { value: "知道顾屿仍然活着", scope: "chapter" } }, end: { mentalState: "开始怀疑顾屿" }, appears: { value: true, scope: "chapter" } },
          gu: { start: {}, end: {}, appears: { value: true, scope: "chapter" } },
        },
        relationships: { pair: { start: { value: "暂时结盟", scope: "chapter" }, end: "公开决裂" } },
      }, outlines: [outline("current", "林澈和顾屿在码头交换线索")] },
    ],
  };

  const selected = selectAiContext({ articles: [article] }, "current", "content", { includeCharacters: true, firstAppearanceCharacterIds: ["lin", "gu"] });
  assert.equal(selected.article.location, "旧码头");
  assert.equal(selected.article.negativeConstraints, "不能用梦解释");
  assert.equal(selected.currentChapter.inheritedFromChapter.title, "第一章");
  assert.equal(selected.characters.find((person) => person.id === "lin").profile.knownInformation, "知道顾屿仍然活着");
  assert.equal(selected.characters.find((person) => person.id === "lin").endingChanges.mentalState, "开始怀疑顾屿");
  assert.deepEqual(selected.relationships[0], { characterA: "林澈", characterB: "顾屿", description: "暂时结盟", endingDescription: "公开决裂" });
});
