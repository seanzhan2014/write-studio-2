import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { git, sourceIdentity } from "./source-identity.mjs";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function clean(workspace) {
  requireValue(!(await git(workspace, ["status", "--porcelain"])), `未提交的修改：${workspace}。停止发布，不覆盖现有文件。`);
}

async function commonDirectory(workspace) {
  return realpath(path.resolve(workspace, await git(workspace, ["rev-parse", "--git-common-dir"])));
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  requireValue(response.ok, `${url} 返回 HTTP ${response.status}`);
  return response.json();
}

export function verifyBuild(build, expectedHash) {
  requireValue(build?.target === "local" && build?.sourceHash === expectedHash,
    `3002 构建版本不匹配：期望 ${expectedHash.slice(0, 12)}，实际 ${build?.sourceHash?.slice(0, 12) ?? "未知"}。服务可连接不代表发布成功。`);
  return build;
}

export async function deployLocal({ workspace, config, commit, verifyOnly = false, timeoutMs = 180_000, pollMs = 1500, onLog = () => {} }) {
  const target = await realpath(config.workspace);
  const source = await realpath(workspace);
  const manager = new URL(config.managerUrl);
  const service = new URL(config.serviceUrl);
  requireValue([manager, service].every(url => ["http:", "https:"].includes(url.protocol) && !url.username && !url.password), "发布地址必须是无凭据的 HTTP(S) 地址");
  const comparable = value => process.platform === "win32" ? value.toLowerCase() : value;
  requireValue(comparable(await commonDirectory(source)) === comparable(await commonDirectory(target)), "主代码目录与当前工作目录不属于同一 Git 仓库，停止同步");
  await clean(source);
  await clean(target);
  const head = await git(source, ["rev-parse", "HEAD"]);
  commit ??= head;
  requireValue(/^[a-f0-9]{40}$/.test(commit) && commit === head, "必须发布当前干净工作目录的完整提交 SHA");
  const expectedHash = await sourceIdentity(source);
  let status = await json(new URL("/api/status", manager));
  requireValue(status.service?.managed && status.service.port === Number(service.port || (service.protocol === "https:" ? 443 : 80)), "3003 没有管理配置中的主服务端口，停止发布");
  requireValue(status.operation === "idle", "3003 正在执行其他操作，停止发布");
  if (!verifyOnly && await git(target, ["rev-parse", "HEAD"]) !== commit) {
    onLog(`安全同步 ${commit.slice(0, 12)} → ${target}`);
    await git(target, ["merge", "--ff-only", commit]);
  }
  const verifySource = async () => {
    await clean(source);
    await clean(target);
    requireValue(await git(source, ["rev-parse", "HEAD"]) === commit, "发布过程中工作目录提交发生变化");
    requireValue(await git(target, ["rev-parse", "HEAD"]) === commit, "主代码目录未同步到目标提交");
    requireValue(await sourceIdentity(source) === expectedHash && await sourceIdentity(target) === expectedHash, "两个代码目录的实际内容不一致，停止发布");
  };
  await verifySource();
  let build;
  if (verifyOnly) {
    requireValue(status.service.state === "running", "3002 当前未运行");
    build = verifyBuild(await json(new URL("/api/system/build", service)), expectedHash);
  } else {
    const previousStart = status.service.startedAt;
    const accepted = await json(new URL("/api/restart", manager), { method: "POST" });
    requireValue(accepted.ok, accepted.message || "3003 拒绝重新构建");
    const deadline = Date.now() + timeoutMs;
    let phase;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      status = await json(new URL("/api/status", manager));
      if (status.operationPhase !== phase) { phase = status.operationPhase; onLog(`3003：${phase ?? status.operation}`); }
      if (status.operation !== "idle") continue;
      requireValue(!status.service.lastError, status.service.lastError);
      requireValue(status.service.state === "running" && status.service.startedAt !== previousStart, "3003 未启动新的服务进程");
      build = verifyBuild(await json(new URL("/api/system/build", service)), expectedHash);
      break;
    }
    requireValue(build, "本机发布核验失败：等待 3003 完成构建超时");
  }
  await verifySource();
  return { verified: true, commit, sourceHash: expectedHash, serviceUrl: service.origin, builtAt: build.builtAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.every((arg, index) => arg === "--verify-only" || arg === "--commit" || args[index - 1] === "--commit"), "仅支持 --verify-only 和 --commit <完整 SHA>");
    requireValue(!args.includes("--commit") || /^[a-f0-9]{40}$/.test(args[args.indexOf("--commit") + 1] ?? ""), "--commit 后必须提供完整提交 SHA");
    const workspace = process.cwd();
    const config = JSON.parse(await readFile(path.join(workspace, ".openai", "deployment.json"), "utf8"));
    const result = await deployLocal({ workspace, config: config.local, commit: args.includes("--commit") ? args[args.indexOf("--commit") + 1] : undefined, verifyOnly: args.includes("--verify-only"), onLog: console.log });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`发布未完成：${error.message}`);
    process.exitCode = 1;
  }
}
