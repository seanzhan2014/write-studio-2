import assert from "node:assert/strict";
import test from "node:test";

import { resolveChapterSettings } from "../lib/story-settings.ts";

function articleFixture() {
  return {
    type: "悬疑",
    style: "克制的近距离叙事",
    storySettings: {
      location: "雾港",
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
        appearance: "短发",
        immutableTraits: "一定验证证据",
      },
    }],
    relationships: [],
    chapters: [
      { id: "one", title: "第一章", archived: false, settings: {} },
      { id: "two", title: "第二章", archived: false, settings: {
        story: {
          location: { value: "旧码头", scope: "ongoing" },
          style: { value: "本章使用轻快短句", scope: "chapter" },
        },
        characters: {
          lin: {
            start: { appearance: { value: "披着雨衣", scope: "chapter" } },
            end: { age: "30 岁" },
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
  assert.deepEqual(Object.keys(resolved.story), ["location", "style", "negativeConstraints"]);
  assert.equal(resolved.story.location, "雾港");
  assert.deepEqual(Object.keys(resolved.characters[0].profile), ["age", "appearance", "immutableTraits"]);
  assert.equal(resolved.characters[0].profile.immutableTraits, "一定验证证据");
  assert.equal(resolved.storySources.location.kind, "article");
});

test("chapter-only overrides stay local while ongoing and ending changes propagate", () => {
  const article = articleFixture();
  const current = resolveChapterSettings(article, "two");
  assert.equal(current.story.location, "旧码头");
  assert.equal(current.story.style, "本章使用轻快短句");
  assert.equal(current.characters[0].profile.appearance, "披着雨衣");
  assert.equal(current.characters[0].endingChanges.age, "30 岁");
  assert.equal(current.characters[0].appears, true);

  const next = resolveChapterSettings(article, "three");
  assert.equal(next.story.location, "旧码头");
  assert.equal(next.story.style, "克制的近距离叙事");
  assert.equal(next.characters[0].profile.appearance, "短发");
  assert.equal(next.characters[0].profile.age, "30 岁");
  assert.equal(next.characters[0].appears, undefined);
  assert.deepEqual(next.inheritedFromChapter, { id: "two", title: "第二章" });
});

test("archived chapters are skipped when resolving the active inheritance chain", () => {
  const article = articleFixture();
  article.chapters[1].archived = true;
  const resolved = resolveChapterSettings(article, "three");
  assert.equal(resolved.story.location, "雾港");
  assert.equal(resolved.characters[0].profile.age, "29 岁");
  assert.deepEqual(resolved.inheritedFromChapter, { id: "one", title: "第一章" });
});

test("an archived chapter can still display its settings without inheriting from later chapters", () => {
  const article = articleFixture();
  article.chapters[1].archived = true;
  const resolved = resolveChapterSettings(article, "two");
  assert.equal(resolved.chapterId, "two");
  assert.equal(resolved.story.location, "旧码头");
  assert.equal(resolved.story.style, "本章使用轻快短句");
  assert.deepEqual(resolved.inheritedFromChapter, { id: "one", title: "第一章" });
});
