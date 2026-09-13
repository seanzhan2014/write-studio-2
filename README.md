# Writer Studio 2.1 PoC

## 运行架构

Writer Studio 现在使用 Node.js 原生 SQLite，自托管运行不再依赖 Cloudflare D1、Miniflare、Wrangler 或 `.openai/hosting.json`。默认数据库为 `data/writer-studio.sqlite`；设置 `WRITER_STUDIO_DB_PATH` 可以使用其他绝对或相对路径。

要求 Node.js `>=22.13.0`。Windows 和 Linux 必须分别在目标机器上执行 `npm ci`，不要跨操作系统复制 `node_modules`。

## 日志

`npm run dev` 写入 `logs/dev-3002-*.log`，生产服务写入 `logs/prod-3002-*.log`。服务日志和访问日志按日拆分、保留 30 天，并同时输出到终端。设置 `WRITER_STUDIO_LOG_DIR` 可以修改日志目录。

## Service manager

两个服务统一读取项目根目录的 `writer-studio.env` 配置文件：

```dotenv
WRITER_STUDIO_HOST=0.0.0.0
WRITER_STUDIO_PORT=3002
WRITER_STUDIO_MANAGER_HOST=0.0.0.0
WRITER_STUDIO_MANAGER_PORT=3003
WRITER_STUDIO_SERVICE_MODE=production
WRITER_STUDIO_MANAGER_AUTOSTART=1
```

修改端口后执行 `npm run service`，即可按配置启动管理器和主应用。默认主应用地址为 `http://localhost:3002/`，管理页面为 `http://localhost:3003/`。修改配置需要停止并重新启动管理器；两个端口不能相同。

`npm run dev`（独立开发服务）和 `npm start`（独立生产服务）也读取该文件中的主应用地址与端口。终端已有的环境变量优先于文件配置；如果之前在 PowerShell 中临时设置过端口，可执行 `Remove-Item Env:WRITER_STUDIO_PORT -ErrorAction SilentlyContinue`，再按文件配置启动。

长时间运行时使用 3003 管理服务。首次部署或更新代码后先构建，再启动管理器：

```powershell
npm ci
npm run build
npm run service
```

它默认启动 `dist` 中的 3002 生产服务，并在 `http://127.0.0.1:3003/` 提供启停页面。管理器不会自动执行构建。需要临时让管理器控制开发服务时，可以设置 `WRITER_STUDIO_SERVICE_MODE=development`。

由管理器启动后，也可以在 Writer Studio 的“设置 → 系统与诊断 → 服务控制”中重启服务端；页面会确认操作并自动等待 3002 恢复。独立运行的 `npm run dev` 或 `npm start` 不支持应用内重启。

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
- 手机通过局域网 HTTP 可以联网使用，但浏览器只允许 HTTPS（或本机 `localhost`）启用 Service Worker；要在关闭浏览器后断网重开，需使用 HTTPS 部署或手机信任的本地 HTTPS 证书。

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
- 文章设定集中记录简介、故事发生地点、写作风格和负面约束；类型、时代背景和世界规则可直接写入简介。人物资料集中为人物说明、年龄、外貌和人物底线；
- 章节设定默认继承文章或上一未归档章节，可按字段选择“从本章起”或“仅本章”，并记录章初覆盖、章末变化、人物出场和关系变化；全大纲编辑可直接打开文章与章节设定；
- AI Generate、AI Chat 和 AI Review 使用当前章节解析后的有效设定，正文版本保留生成时设定快照；
- 手机默认大纲首页，支持长按拖动、左滑管理、右滑在下方新增，三点菜单负责其余操作；
- 写作、AI Chat、AI Generate 三个工作标签，正文写作占据主要空间；
- AI Chat 支持每条大纲下的多会话、分支和消息级操作，只引用当前大纲及其之前的全部未归档大纲，不读取之后的大纲；
- AI 回复可保存为候选版本、交给 AI Generate，或经确认并保护当前正文版本后追加到正文；
- 正文 AI Generate 完成后创建不可变版本并自动设为当前正文；大纲内容和章节标题仍在大纲视图生成并预览；
- 800ms 自动保存、`Ctrl/Cmd+S` 手动保存、IndexedDB 离线快照、关闭浏览器后离线恢复、多窗口 revision 冲突处理；
- AI Generate 后台队列、取消、重试、自动更新当前正文及版本历史回退；
- 正文生成支持自动、低、适中、高四档对话密度；控制对白篇幅和出现频率，续写仅作用于新增正文，任务重试沿用创建时的设置；
- SQLite FTS5 派生搜索索引、数据库完整性检查；
- 电脑侧栏支持 240–360px 调整及 56px 折叠，状态保存在轻量浏览器设置中。

## AI Generate 自动审校

- 独立章节 AI Review 入口暂时隐藏；现有代码和历史版本保留，AI Generate 的生成后审校继续可用。
- 在“文章资料 → 审校规则”逐条管理本文章的审校规则，支持新增、编辑、删除、归档和恢复。默认检查也是普通规则，可独立修改；归档或删除后不再注入审校提示词。
- 新文章会初始化五条默认规则：中英文混用、重复场景、重复人物及事物描写、情节与人物一致性、保留有效内容与有意呼应。旧的整段通用规则原样迁移为一条“原通用 Review 规则”，旧全局预设可按需导入本文章。清空列表后不会补回默认规则。
- 章节 Review 和启用了自动审校的正文生成共用生效规则，在任务创建时保存规则 ID、名称、内容、版本和本次指令快照。修改规则仅影响新任务，历史报告与失败重试沿用原快照。无生效规则且无本次指令时无需审校；生成可将循环次数设为 0。
- 规则随文章复制、导入导出及离线同步保存。复制文章后规则独立管理，历史版本仍保留当时的审校快照。
- AI Generate 的“审校循环次数”默认为 `0`，沿用单次生成。设置为 `1–10` 时，表示最多修正几次；初审不计入修正次数，每次修正后都会复检，包括最后一次。
- “本次 Review 指令”用于此次生成的特殊要求，与文章通用规则一起保存为任务快照。审校和修正沿用本次生成模型，需要配置可用的远程模型。
- 正文生成的目标字数只约束正文篇幅。未手动设置模型输出上限时，初稿与自动审校、修正均使用 65,536 token 的请求上限，为推理和正文共用的输出额度留出空间；填写了模型输出上限时优先使用该值。上限不是实际消耗量，模型以长度超限结束时仍不会保存残稿。
- 流程为初稿 → 问题清单 → 按问题修正 → 复检。问题全部解决时提前停止；达到上限时交付终稿，并在任务详情和正文版本中保留剩余问题与各轮审校报告。
- 每个步骤保存到 SQLite。Node 自托管服务可在关闭页面后继续执行审校任务，生产服务启动时会恢复待执行任务；失败后重新执行会从已保存步骤继续。只有最终稿会创建正文版本，中间稿保存在任务的审校进度中。
- 执行期间人工修改了正文时，终稿保存为候选版本，保留人工编辑的当前正文。模型调用失败不会冒充审校通过，也不会把未复检的稿件设为当前正文。

## 数据与安全

- 完整业务数据以服务端 SQLite/D1 为最终事实源；浏览器在 IndexedDB 中保存最近一次服务端基线和本设备待同步副本，不把业务数据写入 `localStorage`。
- 联网时客户端先用数据库 ID、结构版本和 revision 组成的 ETag 比较版本；一致时服务端返回 `304`，无需传输完整快照。
- 断网时手动编辑会保存到本设备并显示“已保存到本设备”；恢复网络后自动提交。若服务端也修改过同一字段，沿用现有三方合并和冲突选择界面。
- 依赖服务端的操作会先检查浏览器网络状态和轻量连接端点；明确离线时立即提示，浏览器误报在线时最多约 1.2 秒返回，不等待业务请求超时。
- 当前正文编辑草稿同时保存在当前标签页的 `sessionStorage` 和 IndexedDB，用于标签页或浏览器意外关闭后的恢复。
- 离线模式不执行 AI Chat、AI Generate 或其他依赖服务端/模型的任务。
- OpenAI 兼容模型可以在“设置 → AI 模型”中配置。
- API 密钥不写入浏览器持久化；它使用 `AI_SECRET_KEY` 派生的 AES-GCM 密钥加密后保存在 SQLite。生产环境必须设置稳定、随机的 `AI_SECRET_KEY`，更换该值后需要重新输入已有模型密钥。
- 未配置远程模型时，AI Chat 和 AI Generate 使用本地 PoC 引擎，便于完整体验交互流程。
- 每个模型可在编辑窗口开启 `reasoning_effort` 并选择强度，默认关闭。AI Generate（含结构生成）、AI Chat、名称生成及 AI Review 可各自选择沿用模型、不发送参数或指定强度；选择会随任务设置保存。
- API 配置使用 `reasoningEffort`：模型上的 `null` 表示关闭；任务中省略表示沿用模型，`null` 强制不发送，字符串指定强度。实际请求只在启用时携带 `reasoning_effort`，`none` 是明确发送的值。可选值为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，各模型支持范围见 [OpenAI 参数说明](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
- 排队任务在提交时保存实际采用的推理强度，执行、重试及生成后的自动审校／修正沿用该快照；修改模型设置只影响之后提交的任务。模型参数随配置导入、导出和同步保留，旧配置继续默认不发送。

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
npm run test:sync
npm run db:generate
```

`npm run test:sync` 单独运行保存与冲突的通用回归：字段缺失／空值语义、快照规范化、真实 SQLite 往返、创建后直接聊天和生成、延迟／丢失响应、并发修改，以及两种冲突选择后的连续保存。浏览器流程覆盖桌面和手机 Chromium；仅桌面提供的新建章节按钮只在桌面测试。全部用例也会由 `npm test` 自动发现，使用独立测试数据库，不复用本机业务数据。具体覆盖映射见 [保存与同步测试](docs/sync-testing.md)。

涉及菜单、抽屉、弹窗或移动端固定定位界面时，必须遵循 [移动端浮层开发契约](docs/mobile-overlay-contract.md)，并完成仓库 PR 模板中的四档视口检查。

主要代码：

- `app/WriterStudioApp.tsx`：界面和交互组合；
- `app/studio-state.tsx`：客户端领域状态、自动保存和冲突恢复；
- `db/schema.ts`：Drizzle 数据表定义；
- `db/sqlite.ts`：Windows/Linux SQLite 连接、事务和路径管理；
- `db/runtime.ts`：数据库初始化、原子快照、全文索引和完整性检查；
- `db/ai.ts`：模型配置、上下文构造、流式 Chat 和 Generate；
- `app/api/`：REST、模型、数据库和 AI 接口。
