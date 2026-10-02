export function managerPage(serviceMode = "production") {
  const production = serviceMode === "production";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Writer Studio 服务管理</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #f4f6f8; color: #17202a; }
    main { width: min(680px, calc(100% - 32px)); margin: 48px auto; }
    .card { background: white; border: 1px solid #dfe5eb; border-radius: 16px; padding: 24px; box-shadow: 0 8px 28px #1c27330d; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .muted { color: #66727f; font-size: 14px; }
    .status { display: flex; align-items: center; gap: 10px; margin: 24px 0 18px; font-weight: 700; font-size: 18px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: #8996a3; }
    .dot.running { background: #16a36a; box-shadow: 0 0 0 5px #16a36a1c; }
    .dot.starting { background: #e09b21; box-shadow: 0 0 0 5px #e09b211c; }
    .dot.stopped, .dot.external { background: #d14b4b; }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 12px 16px; margin: 0 0 24px; font-size: 14px; }
    dt { color: #66727f; } dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { border: 0; border-radius: 9px; padding: 10px 18px; color: white; background: #2864d7; cursor: pointer; font: inherit; }
    button.secondary { background: #596675; } button.danger { background: #c33f49; }
    button:disabled { opacity: .55; cursor: wait; }
    #message { min-height: 22px; margin-top: 18px; color: #2864d7; font-size: 14px; }
    .foot { margin-top: 16px; color: #8996a3; font-size: 12px; }
    @media (max-width: 500px) { main { margin: 18px auto; } .card { padding: 18px; } dl { grid-template-columns: 108px 1fr; } button { flex: 1 1 30%; } }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>Writer Studio 服务管理</h1>
      <div class="muted">3003 管理服务 · 监测并控制 3002 主服务</div>
      <div class="status"><span id="dot" class="dot"></span><span id="state">读取中…</span></div>
      <dl>
        <dt>主服务地址</dt><dd id="address">—</dd>
        <dt>进程 PID</dt><dd id="pid">—</dd>
        <dt>端口探测</dt><dd id="port">—</dd>
        <dt>启动时间</dt><dd id="started">—</dd>
        <dt>最近检查</dt><dd id="checked">—</dd>
      </dl>
      <div class="actions">
        <button data-action="start">启动 3002</button>
        <button data-action="stop" class="danger">停止 3002</button>
        <button data-action="restart" class="secondary">${production ? "重新构建并重启 3002" : "重启 3002"}</button>
      </div>
      <div id="message" role="status"></div>
      <div class="foot">${production ? "生产模式重启会从当前工作目录重新构建源码；构建失败时恢复旧版本。" : "开发模式只重启进程。"}页面每 2 秒自动刷新。</div>
    </section>
  </main>
  <script>
    const labels = { running: "运行中", starting: "启动中", stopped: "已停止", external: "端口被其他进程占用" };
    const phases = { stopping: "正在停止旧服务…", building: "正在构建最新源码…", starting: "正在启动新版本…", restoring: "构建失败，正在恢复旧版本…" };
    const $ = (id) => document.getElementById(id);
    const setMessage = (text, error = false) => { $("message").textContent = text || ""; $("message").style.color = error ? "#c33f49" : "#2864d7"; };
    let pendingRestart = false;
    async function refresh() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const data = await response.json();
        const service = data.service;
        $("dot").className = "dot " + service.state;
        $("state").textContent = labels[service.state] || service.state;
        $("address").textContent = service.host + ":" + service.port;
        $("pid").textContent = service.pid || "—";
        $("port").textContent = service.portState + (service.portStatusCode ? " (HTTP " + service.portStatusCode + ")" : "");
        $("started").textContent = service.startedAt ? new Date(service.startedAt).toLocaleString() : "—";
        $("checked").textContent = new Date(data.checkedAt).toLocaleTimeString();
        if (pendingRestart && data.operation === "busy") setMessage(phases[data.operationPhase] || "正在重启…");
        if (pendingRestart && data.operation === "idle") {
          setMessage(service.lastError || (service.state === "running" ? "服务已重启并运行" : "重启未完成，请检查服务日志"), Boolean(service.lastError || service.state !== "running"));
          pendingRestart = false;
        }
      } catch (error) { setMessage("无法连接 3003 管理服务", true); }
    }
    async function action(name) {
      document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      setMessage(name === "restart" ? "正在重新构建并重启…" : name === "stop" ? "正在停止…" : "正在启动…");
      try {
        const response = await fetch("/api/" + name, { method: "POST" });
        const data = await response.json();
        if (name === "restart" && data.ok) pendingRestart = true;
        setMessage(data.message || data.error || "操作完成", !data.ok);
      } catch (error) { setMessage("操作失败，请检查 3003 服务日志", true); }
      await refresh();
      document.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
    document.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => action(button.dataset.action)));
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}
