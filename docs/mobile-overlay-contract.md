# 移动端浮层开发契约

本项目的浮层统一使用 `app/ui/overlays.tsx` 提供的三个组件：

- `MobileActionSheet`：三点菜单和成组动作；移动端显示为底部操作面板，桌面端可显示为侧栏附近的菜单。
- `ScrollableDrawer`：需要保留页面上下文的抽屉，例如文章切换、正文版本和 AI 任务。
- `ResponsiveModal`：需要用户集中处理的表单或确认流程；默认在手机上全屏。

## 布局契约

每个浮层都必须符合以下结构：

1. 表面高度不得超过 `100dvh`，并为非全屏浮层保留 `--overlay-safe-gap`。
2. 标题区固定，不参与内容滚动。
3. 内容链路上的每一层都必须设置 `min-height: 0`。
4. 一个浮层只能有一个滚动所有者：
   - 普通内容使用默认的 `scrollMode="body"`；
   - 固定工具栏或底部操作栏使用 `scrollMode="content"`，并在实际滚动节点添加 `data-ui-overlay-scroll`。
5. 移动端底部操作区必须包含 `env(safe-area-inset-bottom)`。
6. 不得在手机样式中复用依赖桌面侧栏宽度、固定 `top/left` 或 `vh` 的定位规则；使用 `dvh` 和统一组件。
7. `ResponsiveModal` 的非全屏形态必须可通过标题栏拖动，并限制在当前视口内；全屏形态固定不移动。标题栏同时支持方向键移动，双击恢复居中。

## 必测视口

涉及浮层、菜单、抽屉或弹窗的改动，至少覆盖：

| 场景 | 视口 |
| --- | --- |
| 常见竖屏 | 390 × 844 |
| 小型竖屏 | 320 × 568 |
| 短横屏 | 667 × 375 |
| 软键盘压缩高度 | 390 × 480 |

测试不能只访问页面初始状态。必须打开本次改动涉及的三点菜单、抽屉、弹窗、预览和二级状态，并确认最后一个操作可通过滚动触达。

## 自动门禁

- `tests/implementation-contract.test.mjs` 阻止业务页面直接使用 Mantine `Modal`/`Drawer`，并检查统一组件和 CSS 契约存在。
- `tests/ui/responsive.spec.ts` 使用四档视口和通用的越界、滚动断言测试真实交互状态。
- `npm run lint`、`npm run build` 和 `npm run test:ui` 是合并前必跑项。

新增无法由这三个组件表达的浮层时，先扩展统一组件；不要在业务页面新增一套独立的 fixed/absolute 高度与滚动实现。
