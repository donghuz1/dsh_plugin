# 经验库

> 按 REQ-ID 和 Task 自动维护。去重，保留最完整版本。

## 领域规则
<!-- 业务规则、计算公式、状态转换、校验规则等 -->

## 技术决策

- **审批/完成提醒观察 `uiSession.sessionStatus`，不要监听 `approval/request`** [REQ-?]：`approval/request` 是 waterfall，`ui-approval` 的监听器接管后等待用户作答、不调用 `next()`，后注册的观察者永远收不到；pending 与 `running` 都在 `sessionStatus` 里。完成提醒比较 `running` 而不是 `completionUnread`（后者只覆盖非主视图）。背景见 [0004 决策笔记](../../plugins/session-notify/docs/notes/2026-10-24-0004-会话提醒走会话状态订阅.md)。

## 踩坑陷阱

- **DSH Desktop 的渲染层 `Notification` 可直接当系统通知** [REQ-?]：Electron 主进程对非 media 权限 `callback(true)`，`dsh-app://` 注册为 secure context，因此不需要 Host/主进程半区。应用退出后收不到通知是渲染层方案的固有边界。
- **从 git worktree 安装的插件，合并删除 worktree 后 profile 的 `link:` 会悬空** [REQ-?]：客户端模块缓存按「specifier + 解析基准」命中，路径变化后必须从主工作树重装并重启；重装、启停、切换 bundle 都不会自己恢复缓存。
