# 经验库

> 按 REQ-ID 和 Task 自动维护。去重，保留最完整版本。

## 领域规则
<!-- 业务规则、计算公式、状态转换、校验规则等 -->

## 技术决策

- **审批/完成提醒观察 `uiSession.sessionStatus`，不要监听 `approval/request`** [REQ-?]：`approval/request` 是 waterfall，`ui-approval` 的监听器接管后等待用户作答、不调用 `next()`，后注册的观察者永远收不到；pending 与 `running` 都在 `sessionStatus` 里。完成提醒比较 `running` 而不是 `completionUnread`（后者只覆盖非主视图）。背景见 [0004 决策笔记](../../plugins/session-notify/docs/notes/2026-10-24-0004-会话提醒走会话状态订阅.md)。
- **辅助 LLM 调用必须显式传最低 reasoning 档** [REQ-?]：DSH 适配器在省略 `reasoningEffort` 时用连接默认档（本机是 max），几十 token 的辅助调用会先被推理吃光，流以 `max-tokens` 结束且无文本。取 `resolveModelInfo(...).reasoning.efforts[0].id` 传入；查询失败或模型无推理能力时不传。`efforts` 顺序是适配器偏好，不要硬编码 `off`。背景见 [0003 决策笔记](../../plugins/session-title-rule/docs/notes/2026-10-19-0003-标题辅助调用显式选择最低推理档.md)。

## 踩坑陷阱

- **DSH Desktop 的渲染层 `Notification` 可直接当系统通知** [REQ-?]：Electron 主进程对非 media 权限 `callback(true)`，`dsh-app://` 注册为 secure context，因此不需要 Host/主进程半区。应用退出后收不到通知是渲染层方案的固有边界。
- **从 git worktree 安装的插件，合并删除 worktree 后 profile 的 `link:` 会悬空** [REQ-?]：客户端模块缓存按「specifier + 解析基准」命中，路径变化后必须从主工作树重装并重启；重装、启停、切换 bundle 都不会自己恢复缓存。
- **会话标题插件是否生效，以会话日志的 `session/title` 事件为准** [REQ-?]：`source.kind=provider` 且 `provider=session-title-rule` 才是端到端成功；插件 `fiberPhase: active` 只说明注册成功。fallback 不等于失效——归档会话、子会话/subagent、未载入当前进程的会话，以及模型输出 `KEEP` 都会保留原名。
- **契约测试的静态锚点会漂移：profile 配置与 DSH 源码 checkout** [REQ-?]：profile 的 `cordis.yml` 现在只是空根，运行配置由 bundle patch 层合成，从中读 `maxTitleBytes` 会静默跳过；`../deepseek-harness` checkout 也可能落后运行版（0.1.7-rc.2 vs 0.2.1-rc.3）。契约通过不等于行为正确，升级后要补一次真实会话的端到端证据。
- **Host 半区不热更，判断运行版本看进程启动时间与源码 mtime** [REQ-?]：`link:` 安装的插件跑的是工作区文件，但 Host 代码只在应用启动时载入；改了不生效先比较「Desktop 进程启动时间」和「源文件修改时间」，启动时间晚于源码 mtime 才可能载入新代码。重启后还要核对端到端事件，不能只看插件列表。
