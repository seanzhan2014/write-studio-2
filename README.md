# Writer Studio 2.1 PoC

## 运行架构

Writer Studio 现在使用 Node.js 原生 SQLite，自托管运行不再依赖 Cloudflare D1、Miniflare、Wrangler 或 `.openai/hosting.json`。默认数据库为 `data/writer-studio.sqlite`；设置 `WRITER_STUDIO_DB_PATH` 可以使用其他绝对或相对路径。

要求 Node.js `>=22.13.0`。Windows 和 Linux 必须分别在目标机器上执行 `npm ci`，不要跨操作系统复制 `node_modules`。

## 日志

`npm run dev` 写入 `logs/dev-3002-*.log`，生产服务写入 `logs/prod-3002-*.log`。服务日志和访问日志按日拆分、保留 30 天，并同时输出到终端。设置 `WRITER_STUDIO_LOG_DIR` 可以修改日志目录。

## Service manager

长时间运行时使用 3003 管理服务。首次部署或更新代码后先构建，再启动管理器：

```powershell
npm ci
npm run build
npm run service
```

它默认启动 `dist` 中的 3002 生产服务，并在 `http://127.0.0.1:3003/` 提供启停页面。管理器不会自动执行构建。需要临时让管理器控制开发服务时，可以设置 `WRITER_STUDIO_SERVICE_MODE=development`。

端口是严格固定的：3002 已被占用时会报错，不会自动漂移到 3003。

使用管理器时不要同时运行 `npm run dev` 或 `npm start`，否则会产生管理器无法控制的独立进程。

3003 管理服务和 3002 主服务默认都绑定 `0.0.0.0`，可通过任意本机网卡地址访问。若主机可从公网或不可信网络访问，应使用 Windows 防火墙限制来源，或通过带认证的反向代理保护这两个端口。

3003 没有内置远程认证，任何能连接该端口的人都可以操作 3002。若只需本机访问，可设置 `WRITER_STUDIO_MANAGER_HOST=127.0.0.1`；远程访问时应限制可信来源。

设置 `WRITER_STUDIO_MANAGER_AUTOSTART=0` 可以只启动管理器而不自动启动 3002。停止 3003 时也会停止它启动的 3002。

Windows 检查命令：

```powershell
Get-Content .\logs\prod-3002-service-*.log -Tail 100
Get-Content .\logs\prod-3002-access-*.log -Tail 100
netstat -ano | Select-String ':3002'
```

Linux 检查命令：

```bash
tail -n 100 logs/prod-3002-service-*.log
ss -ltnp | grep ':3002'
```

Writer Studio 是一套面向长篇文章和故事创作者的结构化写作界面。项目在本机运行；电脑和同一局域网内的手机通过本机 `3002` 端口访问同一份 SQLite 数据。

## 启动与访问

```powershell
npm ci
npm run dev
```

- 本机：`http://127.0.0.1:3002/`
- 手机：`http://<本机局域网 IP>:3002/`
- 开发服务固定监听 `0.0.0.0:3002`。
- Windows 防火墙需要允许 Node.js 接受“专用网络”入站连接。

生产模式不带 HMR，必须先构建：

```bash
npm ci
npm run build
npm start
```

Linux systemd 模板位于 `deploy/writer-studio.service.example`。安装时需要修改其中的路径和用户，并确保运行用户可以写入数据库和日志目录。

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
- 正文 AI Generate 完成后创建不可变版本并自动设为当前正文；大纲内容和章节标题仍在大纲视图生成并预览；
- 800ms 自动保存、`Ctrl/Cmd+S` 手动保存、`sessionStorage` 意外恢复、多窗口 revision 冲突处理；
- AI Generate 后台队列、取消、重试、自动更新当前正文及版本历史回退；
- SQLite FTS5 派生搜索索引、数据库完整性检查；
- 电脑侧栏支持 240–360px 调整及 56px 折叠，状态保存在轻量浏览器设置中。

## 数据与安全

- 完整业务数据以服务端 SQLite 为事实源，不长期写入 `localStorage`。
- 未成功保存的当前正文只进入当前标签页的 `sessionStorage` 恢复缓冲。
- OpenAI 兼容模型可以在“设置 → AI 模型”中配置。
- API 密钥不写入浏览器持久化；它使用 `AI_SECRET_KEY` 派生的 AES-GCM 密钥加密后保存在 SQLite。生产环境必须设置稳定、随机的 `AI_SECRET_KEY`，更换该值后需要重新输入已有模型密钥。
- 未配置远程模型时，AI Chat 和 AI Generate 使用本地 PoC 引擎，便于完整体验交互流程。

## 从旧版 D1 迁移

迁移前停止 3002 和 3003，并备份 `.wrangler/state`。当默认目标 `data/writer-studio.sqlite` 尚不存在时，以下命令会自动查找旧版 Miniflare D1 数据库并通过 SQLite `VACUUM INTO` 完整复制：

```bash
npm run db:migrate:d1
```

也可以显式指定：

```bash
npm run db:migrate:d1 -- --source /path/to/legacy.sqlite --target /path/to/writer-studio.sqlite
```

## 开发验证

```powershell
npm run build
npm test
npm run db:generate
```

涉及菜单、抽屉、弹窗或移动端固定定位界面时，必须遵循 [移动端浮层开发契约](docs/mobile-overlay-contract.md)，并完成仓库 PR 模板中的四档视口检查。

主要代码：

- `app/WriterStudioApp.tsx`：界面和交互组合；
- `app/studio-state.tsx`：客户端领域状态、自动保存和冲突恢复；
- `db/schema.ts`：Drizzle 数据表定义；
- `db/sqlite.ts`：Windows/Linux SQLite 连接、事务和路径管理；
- `db/runtime.ts`：数据库初始化、原子快照、全文索引和完整性检查；
- `db/ai.ts`：模型配置、上下文构造、流式 Chat 和 Generate；
- `app/api/`：REST、模型、数据库和 AI 接口。
