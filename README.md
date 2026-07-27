# Writer Studio 2.1 PoC

## Service logging

`npm run dev` now starts the 3002 development service through `scripts/dev-server.mjs`.
The wrapper writes two daily log files and removes matching files older than 30 days:

- `logs/dev-3002-service-YYYY-MM-DD.log`: lifecycle events, startup output, errors, child PID, exit code, and termination signal.
- `logs/dev-3002-access-YYYY-MM-DD.log`: HTTP access lines emitted by Vinext.

Both streams are also mirrored to the terminal.

Useful checks when the port stops responding:

```powershell
Get-Content .\logs\dev-3002-service-*.log -Tail 100
Get-Content .\logs\dev-3002-access-*.log -Tail 100
netstat -ano | Select-String ':3002'
```

Writer Studio 是一套面向长篇文章和故事创作者的结构化写作界面。项目在本机运行，不上传到 OpenAI Sites；电脑和同一局域网内的手机通过本机 `3002` 端口访问同一份 D1/SQLite 数据。

## 启动与访问

```powershell
npm install
npm run dev
```

- 本机：`http://127.0.0.1:3002/`
- 手机：`http://<本机局域网 IP>:3002/`
- 开发服务固定监听 `0.0.0.0:3002`。
- Windows 防火墙需要允许 Node.js 接受“专用网络”入站连接。

当前机器的局域网地址可以用以下命令查看：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -NotLike '127.*'
```

## 主要功能

- 文章、章节、大纲、正文、版本、人物和人物关系管理；
- 手机默认大纲首页，支持长按拖动、左滑管理、右滑在下方新增，三点菜单负责其余操作；
- 写作、AI Chat、AI Generate 三个工作标签，正文写作占据主要空间；
- AI Chat 支持每条大纲下的多会话、分支和消息级操作，只引用当前大纲及其之前的全部未归档大纲，不读取之后的大纲；
- AI 回复可保存为候选版本、交给 AI Generate，或经确认并保护当前正文版本后追加到正文；
- 正文 AI Generate 只生成候选正文版本；大纲内容和章节标题在大纲视图生成并预览；
- 800ms 自动保存、`Ctrl/Cmd+S` 手动保存、`sessionStorage` 意外恢复、多窗口 revision 冲突处理；
- AI Generate 后台队列、取消、重试、候选版本对比和应用；
- SQLite FTS5 派生搜索索引、数据库完整性检查；
- 电脑侧栏支持 240–360px 调整及 56px 折叠，状态保存在轻量浏览器设置中。

## 数据与安全

- 完整业务数据以本地 Cloudflare D1/SQLite 为事实源，不长期写入 `localStorage`。
- 未成功保存的当前正文只进入当前标签页的 `sessionStorage` 恢复缓冲。
- OpenAI 兼容模型可以在“设置 → AI 模型”中配置。
- API 密钥不写入浏览器持久化或 SQLite；当前 PoC 只放在本地服务进程内存中，服务重启后需要重新输入。
- 未配置远程模型时，AI Chat 和 AI Generate 使用本地 PoC 引擎，便于完整体验交互流程。

## 开发验证

```powershell
npm run build
npm test
npm run db:generate
```

主要代码：

- `app/WriterStudioApp.tsx`：界面和交互组合；
- `app/studio-state.tsx`：客户端领域状态、自动保存和冲突恢复；
- `db/schema.ts`：Drizzle 数据表定义；
- `db/runtime.ts`：D1 初始化、原子快照、全文索引和完整性检查；
- `db/ai.ts`：模型配置、上下文构造、流式 Chat 和 Generate；
- `app/api/`：REST、模型、数据库和 AI 接口。
