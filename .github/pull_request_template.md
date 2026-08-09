## 变更说明

<!-- 简述用户可见结果和风险。 -->

## 验证

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] 相关功能测试
- [ ] `npm run test:ui`

## 响应式界面检查

如果改动涉及菜单、弹窗、抽屉、预览或固定定位元素：

- [ ] 使用了 `MobileActionSheet`、`ScrollableDrawer` 或 `ResponsiveModal`
- [ ] 只声明了一个滚动所有者；滚动链包含 `min-height: 0`
- [ ] 标题、关闭按钮和最后一个操作都可触达
- [ ] 检查了 390×844、320×568、667×375、390×480
- [ ] 测试实际打开了所有受影响的临时交互状态，而非只检查页面初始状态
- [ ] 没有复用桌面侧栏坐标，也没有新增硬编码 `vh` 高度
- [ ] 手机底部操作区考虑了安全区

完整规则见 `docs/mobile-overlay-contract.md`。
