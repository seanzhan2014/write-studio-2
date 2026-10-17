import assert from "node:assert/strict";
import test from "node:test";
import { nextSaveRetry, shouldRetrySave } from "../lib/save-retry.ts";

test("automatic save retries back off, stay bounded and reset for new edits", () => {
  let retry = null;
  let now = 0;
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    retry = nextSaveRetry(retry, "pending", now);
    assert.equal(retry.nextAttemptAt - now, delay);
    assert.equal(shouldRetrySave(retry, "pending", retry.nextAttemptAt - 1), false);
    assert.equal(shouldRetrySave(retry, "pending", retry.nextAttemptAt), true);
    assert.equal(shouldRetrySave(retry, "new edit", now), true);
    now = retry.nextAttemptAt;
  }
  assert.equal(nextSaveRetry(retry, "new edit", now).attempts, 1);
});
