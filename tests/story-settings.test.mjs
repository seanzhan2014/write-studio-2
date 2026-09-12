import assert from "node:assert/strict";
import test from "node:test";

import { resolveChapterSettings } from "../lib/story-settings.ts";

function articleFixture() {
  return {
    type: "悬疑",
    style: "克制的近距离叙事",
    storySettings: {
      era: "1998 年",
      location: "雾港",
      tone: "冷峻",
      worldRules: "潮汐每天倒退一分钟",
      negativeConstraints: "不得用梦境解释异常",
    },
    characters: [{
      id: "lin",
      name: "林澈",
      aliases: ["阿澈"],
      description: "修理师",
      archived: false,
      profile: {
        age: "29 岁",
        identity: "修理师",
        appearance: "短发",
        personality: "谨慎",
        speechStyle: "短句",
        abilities: "机械维修",
        mentalState: "戒备",
        knownInformation: "只知道公开事故结论",
        boundaries: "不伤害无辜者",
        immutableTraits: "一定验证证据",
      },
    }],
    relationships: [],
    chapters: [
      { id: "one", title: "第一章", archived: false, settings: {} },
      { id: "two", title: "第二章", archived: false, settings: {
        story: {
          location: { value: "旧码头", scope: "ongoing" },
          tone: { value: "短暂轻松", scope: "chapter" },
        },
        characters: {
          lin: {
            start: { mentalState: { value: "抱有希望", scope: "chapter" } },
            end: { mentalState: "确信有人篡改记录", knownInformation: "知道潮汐记录被改写" },
            appears: { value: true, scope: "chapter" },
          },
        },
        relationships: {},
      } },
      { id: "three", title: "第三章", archived: false, settings: {} },
    ],
  };
}

test("first chapter inherits article settings and character profiles", () => {
  const resolved = resolveChapterSettings(articleFixture(), "one");
  assert.equal(resolved.story.type, "悬疑");
  assert.equal(resolved.story.location, "雾港");
  assert.equal(resolved.characters[0].profile.knownInformation, "只知道公开事故结论");
  assert.equal(resolved.storySources.location.kind, "article");
});

test("chapter-only overrides stay local while ongoing and ending changes propagate", () => {
  const article = articleFixture();
  const current = resolveChapterSettings(article, "two");
  assert.equal(current.story.location, "旧码头");
  assert.equal(current.story.tone, "短暂轻松");
  assert.equal(current.characters[0].profile.mentalState, "抱有希望");
  assert.equal(current.characters[0].endingChanges.knownInformation, "知道潮汐记录被改写");
  assert.equal(current.characters[0].appears, true);

  const next = resolveChapterSettings(article, "three");
  assert.equal(next.story.location, "旧码头");
  assert.equal(next.story.tone, "冷峻");
  assert.equal(next.characters[0].profile.mentalState, "确信有人篡改记录");
  assert.equal(next.characters[0].profile.knownInformation, "知道潮汐记录被改写");
  assert.equal(next.characters[0].appears, undefined);
  assert.deepEqual(next.inheritedFromChapter, { id: "two", title: "第二章" });
});

test("archived chapters are skipped when resolving the active inheritance chain", () => {
  const article = articleFixture();
  article.chapters[1].archived = true;
  const resolved = resolveChapterSettings(article, "three");
  assert.equal(resolved.story.location, "雾港");
  assert.equal(resolved.characters[0].profile.mentalState, "戒备");
  assert.deepEqual(resolved.inheritedFromChapter, { id: "one", title: "第一章" });
});

test("an archived chapter can still display its settings without inheriting from later chapters", () => {
  const article = articleFixture();
  article.chapters[1].archived = true;
  const resolved = resolveChapterSettings(article, "two");
  assert.equal(resolved.chapterId, "two");
  assert.equal(resolved.story.location, "旧码头");
  assert.equal(resolved.story.tone, "短暂轻松");
  assert.deepEqual(resolved.inheritedFromChapter, { id: "one", title: "第一章" });
});
