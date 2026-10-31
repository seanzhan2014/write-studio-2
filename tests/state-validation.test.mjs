import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";

const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, body, headers = {}, method = "POST") {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const state = async () => (await api("/api/state", undefined, {}, "GET")).data;
const outlineOf = data => data.articles[0].chapters[0].outlines.find(outline => outline.id === "outline-current");
function patch(content, versions) {
  const changes = { version: 2, articles: { upsert: [], delete: [] }, chapters: { upsert: [], delete: [] }, outlines: { upsert: [], patch: [], delete: [] }, characters: { upsert: [], delete: [] }, relationships: { upsert: [], delete: [] }, tasks: { upsert: [], delete: [] } };
  changes.outlines.patch.push({ id: "outline-current", articleId: "article-main", chapterId: "chapter-main", content, ...(versions === undefined ? {} : { versions }) });
  return changes;
}

test("state writes reject absent revisions and invalid version references atomically", { skip: !base }, async t => {
  const before = await state();
  const fixture = fullStudioFixture();
  const foreign = fixture.articles[0].chapters[0].outlines[0];
  foreign.versions = [{ id: "foreign-version", name: "另一大纲的版本", content: "外部正文", source: "手动", createdAt: fixture.articles[0].createdAt }];
  assert.equal((await api("/api/state", { data: fixture }, { "If-Match": String(before.revision) }, "PUT")).status, 200);

  await t.test("missing, blank and invalid If-Match are rejected before writing", async () => {
    const initial = await state();
    for (const revision of [undefined, "", " ", "NaN", "-1", "1.5", "9007199254740992"]) {
      const headers = revision === undefined ? {} : { "If-Match": revision };
      assert.equal((await api("/api/state", { data: initial.data }, headers, "PUT")).status, 428);
      assert.equal((await api("/api/state/mutations", { changes: patch({ currentVersionId: null }) }, headers)).status, 428);
    }
    assert.equal((await state()).revision, initial.revision);
  });

  await t.test("full snapshots and patches cannot point to missing or foreign versions", async () => {
    for (const key of ["currentVersionId", "defaultVersionId"]) for (const id of ["missing-version", "foreign-version"]) {
      const initial = await state();
      const data = structuredClone(initial.data);
      outlineOf(data)[key] = id;
      const headers = { "If-Match": String(initial.revision) };
      assert.equal((await api("/api/state", { data }, headers, "PUT")).status, 422);
      assert.equal((await api("/api/state/mutations", { changes: patch({ [key]: id }) }, headers)).status, 422);
      const after = await state();
      assert.equal(after.revision, initial.revision);
      assert.equal(after.databaseVersion, initial.databaseVersion);
      assert.deepEqual(after.data, initial.data);
    }
  });

  await t.test("new versions can be selected in the same save and deletion must clear references", async () => {
    const initial = await state();
    const version = { id: "new-version", name: "新版本", content: "新版本正文", source: "手动", createdAt: new Date().toISOString() };
    const versions = [...outlineOf(initial.data).versions, version];
    const saved = await api("/api/state/mutations", { changes: patch({ currentVersionId: version.id, defaultVersionId: version.id }, versions) }, { "If-Match": String(initial.revision) });
    assert.equal(saved.status, 200);
    assert.equal(outlineOf((await state()).data).currentVersionId, version.id);
    assert.equal((await api("/api/state/mutations", { changes: patch({}, []) }, { "If-Match": String(saved.data.revision) })).status, 422);
    assert.equal((await state()).revision, saved.data.revision);
    const cleared = await api("/api/state/mutations", { changes: patch({ currentVersionId: null, defaultVersionId: null }, []) }, { "If-Match": String(saved.data.revision) });
    assert.equal(cleared.status, 200);
    assert.equal(outlineOf((await state()).data).currentVersionId, null);
  });
});
