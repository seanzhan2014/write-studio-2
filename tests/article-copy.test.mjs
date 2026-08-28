import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ARTICLE_COPY_OPTIONS, duplicateArticleForCopy, suggestArticleCopyTitle } from "../lib/data-transfer.ts";
import { fullStudioFixture } from "./fixtures.mjs";

function sourceArticle() {
  const fixture = fullStudioFixture();
  const article = fixture.articles[0];
  const chapter = article.chapters[0];
  const outline = chapter.outlines.find((item) => item.id === "outline-current");
  chapter.nameVersions = [
    { id: "name-chapter-default", title: chapter.title, source: "manual", createdAt: article.createdAt },
    { id: "name-chapter-candidate", title: "候选章节名", source: "ai", createdAt: article.createdAt },
  ];
  chapter.defaultNameVersionId = "name-chapter-default";
  outline.nameVersions = [
    { id: "name-outline-default", title: outline.title, source: "manual", createdAt: outline.updatedAt },
    { id: "name-outline-candidate", title: "候选大纲名", source: "ai", createdAt: outline.updatedAt },
  ];
  outline.defaultNameVersionId = "name-outline-default";
  outline.versions = [
    { id: "version-current", name: "当前正文", content: "当前版本正文", source: "手动", createdAt: outline.updatedAt, taskId: "source-task", outlineSnapshot: { title: outline.title, plan: outline.plan } },
    { id: "version-default", name: "默认正文", content: "指定的默认版本正文", source: "AI Generate", createdAt: outline.updatedAt, taskId: "source-task", outlineSnapshot: { title: outline.title, plan: outline.plan } },
  ];
  outline.currentVersionId = "version-current";
  outline.defaultVersionId = "version-default";
  return article;
}

function outlineByTitle(article, title) {
  return article.chapters.flatMap((chapter) => chapter.outlines).find((outline) => outline.title === title);
}

test("suggests incrementing article copy titles", () => {
  assert.equal(suggestArticleCopyTitle("潮汐", ["潮汐"]), "潮汐（副本）");
  assert.equal(suggestArticleCopyTitle("潮汐", ["潮汐", "潮汐（副本）"]), "潮汐（副本 2）");
});

test("default article copy keeps the selected default content and default names only", () => {
  const source = sourceArticle();
  const copied = duplicateArticleForCopy(source, { ...DEFAULT_ARTICLE_COPY_OPTIONS, title: "严格测试文章（副本）" }, [source.title]);
  const sourceOutline = outlineByTitle(source, "当前码头");
  const copiedOutline = outlineByTitle(copied, "当前码头");

  assert.notEqual(copied.id, source.id);
  assert.equal(copied.title, "严格测试文章（副本）");
  assert.equal(copied.summary, "");
  assert.equal(copied.type, "");
  assert.equal(copied.style, source.style);
  assert.equal(copied.chapters.length, source.chapters.length);
  assert.equal(copied.characters.length, source.characters.length);
  assert.equal(copied.relationships.length, source.relationships.length);
  assert.notEqual(copied.chapters[0].id, source.chapters[0].id);
  assert.deepEqual(copied.chapters[0].nameVersions, []);
  assert.equal(copied.chapters[0].defaultNameVersionId, null);
  assert.notEqual(copiedOutline.id, sourceOutline.id);
  assert.equal(copiedOutline.content, "指定的默认版本正文");
  assert.equal(copiedOutline.versions.length, 1);
  assert.equal(copiedOutline.currentVersionId, copiedOutline.versions[0].id);
  assert.equal(copiedOutline.defaultVersionId, copiedOutline.versions[0].id);
  assert.equal(copiedOutline.versions[0].taskId, undefined);
  assert.deepEqual(copiedOutline.nameVersions, []);
  assert.equal(copiedOutline.defaultNameVersionId, null);
  assert.equal(copiedOutline.chat.sessions.length, 1);
  assert.deepEqual(copiedOutline.chat.sessions[0].messages, []);
  assert.equal(copiedOutline.state, "saved");

  const characterIds = new Set(copied.characters.map((character) => character.id));
  assert.ok(characterIds.has(copied.relationships[0].characterAId));
  assert.ok(characterIds.has(copied.relationships[0].characterBId));
  assert.ok(copied.characters.every((character) => !source.characters.some((item) => item.id === character.id)));
});

test("complete article copy keeps all selected histories while rekeying references", () => {
  const source = sourceArticle();
  const copied = duplicateArticleForCopy(source, {
    ...DEFAULT_ARTICLE_COPY_OPTIONS,
    title: "完整副本",
    contentVersions: "all",
    nameVersions: "all",
    includeMetadata: true,
    includeChat: true,
  });
  const sourceOutline = outlineByTitle(source, "当前码头");
  const copiedOutline = outlineByTitle(copied, "当前码头");

  assert.equal(copied.summary, source.summary);
  assert.equal(copied.type, source.type);
  assert.equal(copiedOutline.versions.length, 2);
  assert.notEqual(copiedOutline.currentVersionId, copiedOutline.defaultVersionId);
  assert.ok(copiedOutline.versions.every((version) => version.taskId === undefined));
  assert.ok(copiedOutline.versions.every((version) => !sourceOutline.versions.some((sourceVersion) => sourceVersion.id === version.id)));
  assert.equal(copiedOutline.nameVersions.length, 2);
  assert.ok(copiedOutline.nameVersions.every((version) => !sourceOutline.nameVersions.some((sourceVersion) => sourceVersion.id === version.id)));
  assert.equal(copiedOutline.chat.sessions.length, sourceOutline.chat.sessions.length);
  assert.equal(copiedOutline.chat.activeSessionId, copiedOutline.chat.sessions[0].id);
  assert.equal(copiedOutline.chat.sessions[0].messages.length, sourceOutline.chat.sessions[0].messages.length);
  assert.ok(copiedOutline.chat.sessions.every((session) => session.draft === "" && session.lastReadMessageId === null));
  assert.ok(copiedOutline.chat.sessions.every((session) => !sourceOutline.chat.sessions.some((sourceSession) => sourceSession.id === session.id)));
  assert.ok(copiedOutline.chat.sessions.flatMap((session) => session.messages).every((message) => !sourceOutline.chat.sessions.flatMap((session) => session.messages).some((sourceMessage) => sourceMessage.id === message.id)));
});

test("copy options can omit article structures, people and style", () => {
  const source = sourceArticle();
  const copied = duplicateArticleForCopy(source, {
    ...DEFAULT_ARTICLE_COPY_OPTIONS,
    title: "空白模板",
    includeStructure: false,
    includeContent: false,
    includeCharacters: false,
    includeStyle: false,
  });
  assert.deepEqual(copied.chapters, []);
  assert.deepEqual(copied.characters, []);
  assert.deepEqual(copied.relationships, []);
  assert.equal(copied.style, "");
  assert.equal(copied.lastOutlineId, "");
});
