import assert from "node:assert/strict";
import test from "node:test";

test("generation endpoints return a JSON 400 for malformed and non-object input", async () => {
  const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
  assert.ok(base);
  for (const path of ["/api/ai/generate", "/api/ai/generate-stream", "/api/ai/tasks"]) {
    for (const body of ["{", "null", "[]", '"text"']) {
      const response = await fetch(base + path, { method: "POST", body, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } });
      assert.equal(response.status, 400, `${path}: ${body}`);
      assert.equal(typeof (await response.json()).error, "string");
    }
  }
});
