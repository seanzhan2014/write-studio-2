import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, mkdtemp, rename, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const DEFAULT_SERVICE_PORT = 3002;
export const DEFAULT_MANAGER_PORT = 3003;

export function buildProduction({ workspace = process.cwd(), onLog = () => {} } = {}) {
  const cli = path.join(workspace, "node_modules", "vinext", "dist", "cli.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "build"], {
      cwd: workspace,
      env: { ...process.env, WRITER_STUDIO_BUILD_TARGET: "local" },
      stdio: "inherit",
      windowsHide: true,
    });
    onLog(`production build started pid=${child.pid ?? "unknown"}`);
    child.once("error", (error) => resolve({ ok: false, message: error.message }));
    child.once("exit", (code, signal) => resolve({
      ok: code === 0,
      message: code === 0 ? "构建完成" : `构建失败（退出码 ${code ?? "null"}${signal ? `，信号 ${signal}` : ""}）`,
    }));
  });
}

export function probePort({ host = "127.0.0.1", port = DEFAULT_SERVICE_PORT, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      finish({ online: true, statusCode: null });
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish({ online: false, statusCode: null, error: "连接超时" });
    });
    socket.on("error", (error) => {
      finish({ online: false, statusCode: null, error: error.message });
    });
  });
}

function isRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function waitForExit(child, timeoutMs) {
  if (!isRunning(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isRunning(child)), timeoutMs);
    child.once("exit", onExit);
  });
}

export class ServiceController {
  constructor({
    workspace = process.cwd(),
    servicePort = Number(process.env.WRITER_STUDIO_PORT ?? DEFAULT_SERVICE_PORT),
    serviceHost = process.env.WRITER_STUDIO_HOST ?? "0.0.0.0",
    probeHost = process.env.WRITER_STUDIO_PROBE_HOST ?? "127.0.0.1",
    managerPort = Number(process.env.WRITER_STUDIO_MANAGER_PORT ?? DEFAULT_MANAGER_PORT),
    managerHost = process.env.WRITER_STUDIO_MANAGER_HOST ?? "127.0.0.1",
    serviceScript = path.join(workspace, "scripts", "dev-server.mjs"),
    command = process.execPath,
    args = [serviceScript],
    env = {},
    stdio = "inherit",
    onLog = () => {},
    rebuild = null,
  } = {}) {
    this.workspace = path.resolve(workspace);
    this.servicePort = servicePort;
    this.serviceHost = serviceHost;
    this.probeHost = probeHost;
    this.managerPort = managerPort;
    this.managerHost = managerHost;
    this.command = command;
    this.args = args;
    this.env = env;
    this.stdio = stdio;
    this.onLog = onLog;
    this.rebuild = rebuild;
    this.child = null;
    this.startedAt = null;
    this.lastExit = null;
    this.lastError = null;
    this.operation = null;
    this.operationPhase = null;
  }

  log(message) {
    this.onLog(message);
  }

  isRunning() {
    return isRunning(this.child);
  }

  async status() {
    const port = await probePort({ host: this.probeHost, port: this.servicePort });
    const managedRunning = this.isRunning();
    const portState = port.online ? "online" : "offline";

    return {
      manager: {
        port: this.managerPort,
        host: this.managerHost,
      },
      service: {
        host: this.serviceHost,
        port: this.servicePort,
        pid: managedRunning ? this.child.pid ?? null : null,
        managed: managedRunning,
        processState: managedRunning ? "running" : "stopped",
        portState,
        state: managedRunning && port.online ? "running" : managedRunning ? "starting" : port.online ? "external" : "stopped",
        portStatusCode: port.statusCode,
        portError: port.online ? null : port.error ?? null,
        startedAt: managedRunning ? this.startedAt : null,
        lastExit: this.lastExit,
        lastError: this.lastError,
      },
      operation: this.operation ? "busy" : "idle",
      operationPhase: this.operationPhase,
      checkedAt: new Date().toISOString(),
    };
  }

  async withOperation(name, action) {
    if (this.operation) return this.operation;
    this.operation = (async () => {
      this.log(`${name} started`);
      try {
        return await action();
      } finally {
        this.log(`${name} finished`);
        this.operation = null;
      }
    })();
    return this.operation;
  }

  async start() {
    return this.withOperation("START", () => this.startInternal("启动"));
  }

  async stop() {
    return this.withOperation("STOP", async () => {
      const child = this.child;
      if (!isRunning(child)) {
        return { ok: true, changed: false, message: "3002 服务已经停止，或不是由本管理服务启动" };
      }
      const stillRunning = await this.stopInternal("stopping");
      return { ok: true, changed: true, message: stillRunning ? "已发送停止命令，进程仍在退出" : "3002 服务已停止" };
    });
  }

  async restart() {
    return this.withOperation("RESTART", async () => {
      if (this.rebuild) return this.rebuildAndRestart();
      if (this.isRunning()) await this.stopInternal("restarting");
      return this.startInternal("重启");
    });
  }

  async waitForReady(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.isRunning()) {
      if ((await probePort({ host: this.probeHost, port: this.servicePort, timeoutMs: 500 })).online) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  async rebuildAndRestart() {
    const output = path.join(this.workspace, "dist");
    const staging = await mkdtemp(path.join(this.workspace, ".writer-studio-restart-"));
    const backup = path.join(staging, "dist");
    let backedUp = false;
    let preserveBackup = false;
    let failure = "";
    try {
      this.operationPhase = "stopping";
      if (this.isRunning() && await this.stopInternal("rebuilding")) {
        this.lastError = "3002 未能停止，构建未开始";
        return { ok: false, changed: false, code: "STOP_FAILED", message: this.lastError };
      }
      try {
        await access(output);
        await rename(output, backup);
        backedUp = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      this.operationPhase = "building";
      const built = await this.rebuild();
      if (!built?.ok) throw new Error(built?.message || "构建失败");
      await access(path.join(output, "server", "index.js"));

      this.operationPhase = "starting";
      const started = await this.startInternal("重启");
      if (!started.ok || !(await this.waitForReady())) throw new Error(started.ok ? "新版本未能在 3002 就绪" : started.message);
      this.log("production build deployed and 3002 is ready");
      return { ok: true, changed: true, message: "已重新构建最新源码并重启 3002", pid: this.child?.pid ?? null };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      this.log(`production rebuild failed: ${failure}`);
      this.operationPhase = "restoring";
      if (this.isRunning()) await this.stopInternal("restoring");
      try {
        // output is the fixed generated build directory under this.workspace.
        await rm(output, { recursive: true, force: true });
        let restoredOld = false;
        if (backedUp) {
          await rename(backup, output);
          backedUp = false;
          const restored = await this.startInternal("恢复");
          if (!restored.ok || !(await this.waitForReady())) throw new Error("旧版本未能恢复运行");
          restoredOld = true;
        }
        this.lastError = `${failure}；${restoredOld ? "已恢复旧版本" : "没有可恢复的旧构建"}`;
        return { ok: false, changed: true, code: "BUILD_FAILED", message: this.lastError };
      } catch (restoreError) {
        preserveBackup = backedUp;
        this.lastError = `${failure}；恢复失败：${restoreError instanceof Error ? restoreError.message : restoreError}${backedUp ? `。旧构建备份：${backup}` : `。旧构建位于：${output}`}`;
        return { ok: false, changed: true, code: "RESTORE_FAILED", message: this.lastError };
      }
    } finally {
      this.operationPhase = null;
      if (!preserveBackup) await rm(staging, { recursive: true, force: true }).catch((error) => this.log(`build backup cleanup failed: ${error.message}`));
    }
  }

  async stopInternal(reason = "stopping") {
    const child = this.child;
    if (!isRunning(child)) return false;
    this.log(`${reason}: stopping 3002 child pid=${child.pid ?? "unknown"}`);
    if (process.platform === "win32" && child.pid) {
      try {
        await execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch (error) {
        this.log(`taskkill returned an error: ${error?.message ?? error}`);
        if (isRunning(child)) child.kill();
      }
    } else {
      child.kill("SIGTERM");
      await waitForExit(child, 10000);
      if (isRunning(child)) child.kill("SIGKILL");
    }
    await waitForExit(child, 5000);
    return isRunning(child);
  }

  async startInternal(actionName = "启动") {
    if (this.isRunning()) return { ok: true, changed: false, message: "3002 服务已经在运行" };
    const port = await probePort({ host: this.probeHost, port: this.servicePort });
    if (port.online) {
      this.lastError = `端口 ${this.servicePort} 已被其他进程占用，未启动新的服务`;
      return { ok: false, changed: false, code: "PORT_IN_USE", message: this.lastError };
    }

    this.lastError = null;
    const child = spawn(this.command, this.args, {
      cwd: this.workspace,
      env: {
        ...process.env,
        ...this.env,
        WRITER_STUDIO_HOST: this.serviceHost,
        WRITER_STUDIO_PORT: String(this.servicePort),
      },
      stdio: this.stdio,
      windowsHide: true,
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
    this.lastExit = null;
    this.log(`3002 child started pid=${child.pid ?? "unknown"}`);
    child.once("error", (error) => {
      this.lastError = error.message;
      this.log(`3002 child error: ${error.stack ?? error.message}`);
    });
    child.once("exit", (code, signal) => {
      this.lastExit = { at: new Date().toISOString(), code, signal };
      this.log(`3002 child exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (this.child === child) {
        this.child = null;
        this.startedAt = null;
      }
    });
    return { ok: true, changed: true, message: `3002 服务${actionName}命令已发送`, pid: child.pid ?? null };
  }
}
