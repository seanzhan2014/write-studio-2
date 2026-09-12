import assert from "node:assert/strict";
import test from "node:test";
import * as conflict from "../app/studio-conflict.mjs";
import { fullStudioFixture } from "./fixtures.mjs";
import { normalizeStudioData, durableSnapshot, serializeDurable, diffStudioData, isStudioChangesEmpty } from "./studio-test-runtime.mjs";

function newChapterFixture() {
  const data = normalizeStudioData(fullStudioFixture());
  // The createChapter/createOutline actions add records before normalization.
  const outline = structuredClone(fullStudioFixture().articles[0].chapters[0].outlines[0]);
  outline.id = "outline-new";
  data.articles[0].chapters.push({ id: "chapter-new", title: "未命名章节", archived: false, outlines: [outline] });
  return data;
}

test("new chapter snapshots use the same name fields as saved and hydrated state", () => {
  const local = newChapterFixture();
  const before = structuredClone(local);
  const snapshot = durableSnapshot(local);
  const chapter = snapshot.articles[0].chapters.at(-1);
  assert.equal(chapter.nameVersions[0].title, "未命名章节");
  assert.equal(chapter.defaultNameVersionId, "name-current:chapter-new");
  assert.equal(chapter.outlines[0].defaultNameVersionId, "name-current:outline-new");
  assert.equal(serializeDurable(local), serializeDurable(normalizeStudioData(local)));
  assert.deepEqual(durableSnapshot(snapshot), snapshot);
  assert.deepEqual(local, before, "snapshot preparation must not change live UI state");
});

test("repeated AI Chat updates do not treat missing local name fields as a deletion", () => {
  const local = newChapterFixture();
  const base = durableSnapshot(normalizeStudioData(local));
  for (let turn = 1; turn <= 3; turn += 1) {
    const server = structuredClone(base);
    const serverChapter = server.articles[0].chapters.at(-1);
    // SQLite synthesizes/persists the current name using its row timestamp.
    serverChapter.nameVersions[0].createdAt = `2026-09-07T13:24:2${turn}.665Z`;
    serverChapter.outlines[0].nameVersions[0].createdAt = serverChapter.nameVersions[0].createdAt;
    serverChapter.outlines[0].chat.sessions[0].messages.push({ id: `reply-${turn}`, role: "assistant", text: `回复 ${turn}` });
    local.articles[0].chapters.at(-1).outlines[0].plan = `本机大纲 ${turn}`;
    const pending = durableSnapshot(local);
    const result = conflict.mergeStudioConflict(base, pending, server);
    assert.deepEqual(result.conflicts, []);
    const mergedChapter = result.merged.articles[0].chapters.at(-1);
    assert.equal(mergedChapter.nameVersions[0].createdAt, serverChapter.nameVersions[0].createdAt);
    assert.equal(mergedChapter.outlines[0].plan, `本机大纲 ${turn}`);
    assert.equal(mergedChapter.outlines[0].chat.sessions[0].messages.at(-1).text, `回复 ${turn}`);
    const resolved = conflict.resolveStudioConflict(base, pending, server, "server");
    assert.deepEqual(conflict.mergeStudioConflict(server, durableSnapshot(resolved), server).conflicts, []);
  }
});

test("canonical snapshots preserve actual name-version deletion and concurrent edit conflicts", () => {
  const base = durableSnapshot(newChapterFixture());
  base.articles[0].chapters.at(-1).nameVersions.push({ id: "candidate", title: "候选章节名", source: "ai", createdAt: "2026-09-07T13:00:00.000Z" });
  const local = structuredClone(base);
  local.articles[0].chapters.at(-1).nameVersions.pop();
  const unchanged = conflict.mergeStudioConflict(base, durableSnapshot(local), base);
  assert.deepEqual(unchanged.conflicts, []);
  assert.equal(unchanged.merged.articles[0].chapters.at(-1).nameVersions.length, 1);

  const server = structuredClone(base);
  server.articles[0].chapters.at(-1).nameVersions.at(-1).title = "其他设备修改的候选名";
  assert.equal(conflict.mergeStudioConflict(base, durableSnapshot(local), durableSnapshot(server)).conflicts.length, 1);
  local.articles[0].chapters.at(-1).outlines[0].plan = "本机编辑";
  server.articles[0].chapters.at(-1).outlines[0].plan = "其他设备编辑";
  assert.ok(conflict.mergeStudioConflict(base, durableSnapshot(local), durableSnapshot(server)).conflicts.some((item) => item.path.endsWith(".plan")));
});

const absent = Symbol("absent");
const optionalForms = [["absent", absent], ["undefined", undefined], ["null", null], ["empty", []]];
for (const kind of ["chapter", "outline"]) {
  for (const [label, value] of optionalForms) {
    test(`${kind} missing/default name fields normalize without phantom changes: ${label}`, () => {
      const local = newChapterFixture();
      const chapter = local.articles[0].chapters.at(-1);
      const entity = kind === "chapter" ? chapter : chapter.outlines[0];
      if (value === absent) delete entity.nameVersions;
      else entity.nameVersions = value;
      if (label === "absent") delete entity.defaultNameVersionId;
      else entity.defaultNameVersionId = label === "undefined" ? undefined : null;
      const pending = durableSnapshot(local);
      const reloaded = durableSnapshot(JSON.parse(JSON.stringify(normalizeStudioData(local))));
      assert.ok(isStudioChangesEmpty(diffStudioData(pending, reloaded)));
      assert.deepEqual(conflict.mergeStudioConflict(reloaded, pending, reloaded).conflicts, []);
      assert.deepEqual(durableSnapshot(reloaded), reloaded);
    });
  }
}

for (const [label, value] of optionalForms) {
  test(`optional empty collections and defaults survive JSON transport: ${label}`, () => {
    const data = fullStudioFixture();
    const outline = data.articles[0].chapters[0].outlines[0];
    for (const key of ["nameVersions", "excellentFragments", "versions"]) {
      if (value === absent) delete outline[key];
      else outline[key] = value;
    }
    for (const key of ["manualExcellent", "titleGenerationPending", "generateInstruction"]) {
      if (value === absent) delete outline[key];
      else outline[key] = label === "null" ? null : undefined;
    }
    const once = durableSnapshot(data);
    const twice = durableSnapshot(JSON.parse(JSON.stringify(once)));
    assert.ok(isStudioChangesEmpty(diffStudioData(once, twice)));
    assert.deepEqual(once, twice);
    assert.equal(once.articles[0].chapters[0].outlines[0].manualExcellent, false);
  });
}

test("explicit null version selection and empty candidate collections are user edits", () => {
  const base = durableSnapshot(fullStudioFixture());
  const outline = base.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
  outline.currentVersionId = "version-manual";
  outline.defaultVersionId = "version-manual";
  const local = structuredClone(base);
  const changed = local.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
  changed.currentVersionId = null;
  changed.defaultVersionId = null;
  changed.nameVersions = [];
  const diff = diffStudioData(base, durableSnapshot(local));
  const patch = diff.outlines.patch.find((item) => item.id === changed.id);
  assert.equal(patch.content.currentVersionId, null);
  assert.equal(patch.content.defaultVersionId, null);
  assert.equal(durableSnapshot(local).articles[0].chapters[0].outlines.find((item) => item.id === changed.id).versions.length, 1);
});

test("unrelated edits and AI replies converge across successive save baselines", () => {
  let base = durableSnapshot(newChapterFixture());
  for (let turn = 1; turn <= 4; turn += 1) {
    const local = structuredClone(base);
    local.articles[0].summary = `本机简介 ${turn}`;
    const server = structuredClone(base);
    const outline = server.articles[0].chapters.at(-1).outlines[0];
    outline.chat.sessions[0].messages.push({ id: `reply-${turn}`, role: "assistant", text: `回复 ${turn}`, createdAt: `2026-09-07T13:00:0${turn}.000Z` });
    const result = conflict.mergeStudioConflict(base, durableSnapshot(local), durableSnapshot(server));
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.articles[0].summary, `本机简介 ${turn}`);
    assert.equal(result.merged.articles[0].chapters.at(-1).outlines[0].chat.sessions[0].messages.length, turn);
    base = durableSnapshot(result.merged);
    assert.ok(isStudioChangesEmpty(diffStudioData(base, durableSnapshot(JSON.parse(JSON.stringify(base))))));
  }
});
