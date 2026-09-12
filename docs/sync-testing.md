# 保存与同步测试

运行 `npm run test:sync` 可执行本组函数、SQLite API 和浏览器回归。`npm test` 也包含这些用例。测试服务器使用 `.test-data` 下按进程隔离的临时 SQLite 数据库，结束后清理。

| 场景 | 测试位置 | 关键断言 |
| --- | --- | --- |
| 缺失、undefined、null、空数组及自动默认值 | `tests/studio-snapshot.test.mjs` | 名称字段规范化一致；JSON 往返不产生修改；空值按字段语义保留 |
| 真实删除及版本选择清空 | `tests/studio-snapshot.test.mjs`、`tests/studio-conflict.test.mjs` | 用户删除不被误补回；并发编辑同一内容仍产生冲突 |
| 连续保存基准推进 | `tests/studio-snapshot.test.mjs` | 每轮保留本机编辑和累积 AI 回复，重复规范化保持稳定 |
| 全量与增量创建、SQLite 保存读回 | `tests/studio-roundtrip.test.mjs` | 客户端快照与读回数据没有持久化差异；原样保存不推进版本号 |
| 旧数据缺字段 | `tests/studio-roundtrip.test.mjs` | 数据库补全后再次读写稳定 |
| AI 回复与旧 revision 保存交错 | `tests/studio-roundtrip.test.mjs`、`tests/ui/studio-lifecycle.spec.ts` | 确实收到 409，再合并重试；本机编辑与回复均保留 |
| 新建文章、大纲后不刷新直接编辑、连续聊天、生成 | `tests/ui/studio-lifecycle.spec.ts` | 经真实界面创建；连续三轮聊天及生成持久化；刷新后仍存在 |
| 新建章节直接聊天 | `tests/ui/studio-lifecycle.spec.ts` | 桌面侧栏创建后不重新加载数据，连续聊天不会误判名称删除 |
| 保存成功但响应晚于 AI 更新 | `tests/ui/studio-lifecycle.spec.ts` | 旧确认不会回退新基准，刷新保留编辑与消息 |
| 保存已落库但响应丢失 | `tests/ui/studio-lifecycle.spec.ts` | 重试收敛，不重复弹窗，刷新保留标题 |
| 保留本机／使用数据库 | `tests/studio-roundtrip.test.mjs`、`tests/ui/studio-lifecycle.spec.ts` | 真实冲突展示双方内容；选择后废弃旧排队保存，保留双方独立字段，允许再次编辑 |

浏览器中的竞态使用请求门闩控制先后顺序，保存、聊天和生成仍经过真实测试服务器。测试会记录短暂出现又消失的冲突弹窗，防止只检查最终一帧而漏测。操作完成后观察超过 800ms 自动保存和 2s 重连检查周期，断言没有新的保存请求、无版本号增长、无重复弹窗。

Vite 文件监听排除 `.test-data`、`test-results` 和 `playwright-report`，避免 Playwright 的 HTML 跟踪快照触发开发服务器自动重载。新建后的完整流程还会校验页面实例标记，防止热重载意外掩盖本机状态问题。专项命令的浏览器产物保存在 `.test-data/sync-ui-results`。

手机和桌面都执行可用的流程。当前新建章节按钮只存在于桌面侧栏，对应手机用例明确跳过。这里列的是本次约定的回归范围，不代表覆盖任意网络故障、所有设备或全部业务功能。

扩展测试时，从界面新建的记录必须保持在同一个页面实例内继续操作；不要提前通过 API 写入完整记录或刷新页面来代替该过程。API 预置完整数据适合已有记录的测试，但会隐藏本机尚未补全字段的状态。
