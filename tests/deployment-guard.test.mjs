import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { deployLocal, verifyBuild } from "../scripts/deploy-local.mjs";
import { git, sourceIdentity } from "../scripts/source-identity.mjs";

async function fixture(t) {
  const testRoot = path.resolve(".test-data");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "deployment-guard-"));
  const main = path.join(directory, "main");
  const task = path.join(directory, "task");
  await mkdir(main);
  await git(main, ["init"]);
  await git(main, ["config", "user.name", "Deployment test"]);
  await git(main, ["config", "user.email", "deployment-test@example.invalid"]);
  await git(main, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(main, "app.txt"), "old\n");
  await git(main, ["add", "."]);
  await git(main, ["commit", "-m", "initial"]);
  const previous = await git(main, ["rev-parse", "HEAD"]);
  await git(main, ["worktree", "add", "-b", "codex/deployment-test", task, "HEAD"]);
  await writeFile(path.join(task, "app.txt"), "new\n");
  await git(task, ["commit", "-am", "new version"]);
  const commit = await git(task, ["rev-parse", "HEAD"]);
  let build = { sourceHash: await sourceIdentity(main), target: "local", builtAt: "old" };
  let startedAt = "old";
  let restarts = 0;
  let afterRestart;
  const service = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(build));
  });
  await new Promise(resolve => service.listen(0, "127.0.0.1", resolve));
  const servicePort = service.address().port;
  const manager = http.createServer(async (request, response) => {
    if (request.method === "POST") {
      restarts++;
      build = { sourceHash: await sourceIdentity(main), target: "local", builtAt: "new" };
      startedAt = "new";
      await afterRestart?.();
      response.end(JSON.stringify({ ok: true }));
    } else response.end(JSON.stringify({ service: { managed: true, state: "running", port: servicePort, startedAt, lastError: null }, operation: "idle", operationPhase: null }));
  });
  await new Promise(resolve => manager.listen(0, "127.0.0.1", resolve));
  const config = { workspace: main, managerUrl: `http://127.0.0.1:${manager.address().port}`, serviceUrl: `http://127.0.0.1:${servicePort}` };
  t.after(async () => {
    for (const server of [manager, service]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.equal(path.dirname(path.resolve(directory)), testRoot);
    await rm(directory, { recursive: true, force: true });
  });
  return { main, task, config, commit, previous, get restarts() { return restarts; }, setBuild: value => { build = value; }, afterRestart: callback => { afterRestart = callback; } };
}

test("verification rejects the exact missed-worktree-sync failure without changing either checkout", async t => {
  const f = await fixture(t);
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config, verifyOnly: true }), /主代码目录未同步/);
  assert.equal(await git(f.main, ["rev-parse", "HEAD"]), f.previous);
  assert.equal(f.restarts, 0);
});

test("deployment safely fast-forwards the main checkout and verifies the running build", async t => {
  const f = await fixture(t);
  const result = await deployLocal({ workspace: f.task, config: f.config, commit: f.commit, pollMs: 1 });
  assert.equal(result.verified, true);
  assert.equal(result.commit, f.commit);
  assert.equal(await git(f.main, ["rev-parse", "HEAD"]), f.commit);
  assert.equal(result.sourceHash, await sourceIdentity(f.task));
  assert.equal(f.restarts, 1);
  await deployLocal({ workspace: f.task, config: f.config, verifyOnly: true });
  assert.equal(f.restarts, 1, "verification must not restart the service");
});

test("an HTTP 200 from an old running build cannot pass version verification", async t => {
  const f = await fixture(t);
  await git(f.main, ["merge", "--ff-only", f.commit]);
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config, verifyOnly: true }), /构建版本不匹配/);
  assert.equal(f.restarts, 0);
});

test("a cloud build cannot be mistaken for a local production deployment", () => {
  assert.throws(() => verifyBuild({ target: "sites", sourceHash: "abc" }, "abc"), /构建版本不匹配/);
});

test("a manager reporting restart success cannot conceal the wrong running build", async t => {
  const f = await fixture(t);
  f.afterRestart(() => f.setBuild({ target: "local", sourceHash: "0".repeat(64), builtAt: "old" }));
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config, pollMs: 1 }), /构建版本不匹配/);
  assert.equal(f.restarts, 1);
});

test("an unrelated repository cannot be selected as the main checkout", async t => {
  const f = await fixture(t);
  const other = path.join(path.dirname(f.main), "unrelated");
  await mkdir(other);
  await git(other, ["init"]);
  await assert.rejects(deployLocal({ workspace: f.task, config: { ...f.config, workspace: other } }), /不属于同一 Git 仓库/);
  assert.equal(f.restarts, 0);
});

test("uncommitted work in the main checkout is preserved and blocks deployment", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.main, "app.txt"), "user edit\n");
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config }), /未提交的修改/);
  assert.equal(await readFile(path.join(f.main, "app.txt"), "utf8"), "user edit\n");
  assert.equal(await git(f.main, ["rev-parse", "HEAD"]), f.previous);
  assert.equal(f.restarts, 0);
});

test("divergent commits are never overwritten or force-synchronized", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.main, "app.txt"), "other commit\n");
  await git(f.main, ["commit", "-am", "concurrent work"]);
  const other = await git(f.main, ["rev-parse", "HEAD"]);
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config }), /fast-forward|快进/i);
  assert.equal(await git(f.main, ["rev-parse", "HEAD"]), other);
  assert.equal(f.restarts, 0);
});

test("source changes made during rebuilding invalidate the release", async t => {
  const f = await fixture(t);
  f.afterRestart(() => writeFile(path.join(f.main, "app.txt"), "concurrent edit\n"));
  await assert.rejects(deployLocal({ workspace: f.task, config: f.config, pollMs: 1 }), /未提交的修改/);
  assert.equal(await readFile(path.join(f.main, "app.txt"), "utf8"), "concurrent edit\n");
});

test("source fingerprints survive commit creation and Windows line-ending conversion", async t => {
  const f = await fixture(t);
  const filename = path.join(f.task, "new.txt");
  await writeFile(filename, "one\ntwo\n");
  const beforeCommit = await sourceIdentity(f.task);
  await git(f.task, ["add", "."]);
  await git(f.task, ["commit", "-m", "new source"]);
  assert.equal(await sourceIdentity(f.task), beforeCommit);
  await writeFile(filename, "one\r\ntwo\r\n");
  assert.equal(await sourceIdentity(f.task), beforeCommit);
  await writeFile(filename, "changed\n");
  assert.notEqual(await sourceIdentity(f.task), beforeCommit);
});
