# 会话提醒插件（session-notify）

## 目标

DSH 的两类状态变化需要在桌面弹系统通知（Desktop 的 Electron 渲染层 `Notification`；浏览器访问时即浏览器通知）：

1. **需要审批**：某会话出现 `kind === 'approval'` 的 pending interaction 时提醒。
2. **会话完成**：根会话从运行中变为空闲（一轮结束）时提醒。

点击通知聚焦应用并切到对应会话。

不做 IM 推送（用户 2026-10-24 明确收窄）。

## 现状与约束

- 审批 pending 只出现在两处：`ui-approval` 的 composer takeover，以及 `uiSession` 的 `pendingInteraction`（侧栏状态）。没有系统通知。
- 会话完成只有侧栏/工作区行的状态，没有系统通知。
- **审批不能用 `ctx.remote.$on('approval/request')` 做观察**：该 waterfall 已被 `ui-approval` 的监听器接管（等待用户作答，不调用 `next()`），后注册的监听器永远收不到。
- 可靠信号是 `uiSession.sessionStatus`：它同时提供 `pendingInteraction` 与 `running`/`completionUnread`，且覆盖所有会话（侧栏的「等待审批」「已完成」就来自它）。
- 通知权限：Desktop 主进程的 `setPermissionRequestHandler` 对非 media 权限直接放行；`dsh-app://` 注册为 `secure: true`。浏览器访问时首次需授权，拒绝则静默。
- 通知依赖页面存活；应用完全退出后收不到（Host/主进程通知不在本期范围）。

## 方案

### 插件形态

- 纯客户端 bundle：`index.js` 空 `apply`（沿用 qoder-theme 形态），行为全部在 `client.js`。
- `dsh.client`: `platform: web`、`immediately: true`、包名排序边（ui-session / locale / session-controller / ui-workspace）。
- Client 插件 `inject: ['uiSession', 'sessions', 'locale']`；`uiWorkspace` 用 `ctx.get` 可选读取。

### 通知行为

1. `apply` 内注册 locale 字典（zh/en），取 `t`。
2. 订阅 `ctx.uiSession.sessionStatus`，每次快照：
   - **审批**：遍历 `pendingInteraction`，`kind === 'approval'` 且 `key` 未见 → 通知一次；`key` 只记一次。
   - **完成**：维护上一轮 `running` 值；`true → false` 且满足以下全部条件才通知：
     - 会话在 `ctx.sessions.list` 中存在，且不是 subagent（`origin !== 'subagent'`、无 `parentSessionId`）；
     - 不是「当前正在看」的会话：`sessionId !== ctx.uiSession.adapter.current.value.key`，或页面不可见/失去焦点。
   - 首帧只初始化 `running`，不补发完成通知。
3. 通知内容：
   - 审批：标题 `需要审批`，正文含工具名、会话标题（缺失用短 session id）、reason（截断 200 字）。
   - 完成：标题 `会话已完成`，正文含会话标题。
4. 权限：`granted` 直接弹；`default` 首次调用 `requestPermission()` 后弹；`denied`/API 缺失静默。
5. 点击：`window.focus()`；若 `ctx.get('uiWorkspace')` 存在，`openSession(sessionId)`（try/catch 吞错）。
6. 订阅与字典均在 `ctx.effect` 内注册，插件卸载即释放。
7. 不监听 Host 事件、不改会话日志、不写模型上下文、不新增配置项。

## 影响文件

```
plugins/session-notify/
├── package.json              # 命名三处一致；dsh.bundle.patch + dsh.client；locale/icon 导出
├── cordis.patch.yml          # insert 行
├── index.js                  # 空 Host apply
├── src/client.js             # 模板（占位符由 build.mjs 替换）
├── client.js                 # 生成物，提交
├── build.mjs                 # 零依赖构建 + 命名/产物断言
├── icon.svg
├── locale/zh.json
├── locale/en.json
├── test/plugin.test.mjs      # VM 内跑 client.js：审批/完成/去重/抑制/点击/权限/卸载
├── test/contract.test.mjs    # 对照 DSH 源码校验服务/字段/事件假设
├── README.md
└── docs/
    ├── notes/2026-10-24-0004-会话提醒走会话状态订阅.md
    └── tasks/active/2026-10-24-session-notify.md
```

另更新仓库根 `README.md` 的插件清单。

## 验收标准

- [x] 审批：每个审批 key 只弹一条；`plan-review` 等其他 pending 不弹。
- [x] 完成：根会话 `running true→false` 弹一条；subagent 会话不弹；当前会话且页面聚焦时不弹；页面隐藏/失焦时弹。
- [x] 通知含工具名/会话信息；点击聚焦并切到该会话（`uiWorkspace` 可用时）；`uiWorkspace` 缺失不报错。
- [x] `Notification` 缺失或 `denied` 时静默，不影响插件加载。
- [x] 订阅/字典在插件卸载后释放（测试断言 disposer 被调用）。
- [x] 契约测试覆盖：`uiSession.sessionStatus`、`pendingInteraction.kind==='approval'` 与字段、`running`/`completionUnread`、`sessions.list.byId` 标题形状、`uiSession.adapter.current`、`uiWorkspace.openSession`、locale `register/bind`、三处命名、`client.js` 与源同步。
- [ ] 单插件门禁与全仓门禁全绿。
- [x] `plugin_manager install_bundle` 后 `application: applied`，boot graph 出现 `@local/dsh-session-notify`。
- [x] 真实审批/完成通知经用户现场确认可用。

## 风险与限制

- 应用完全退出后无通知（无 Host/主进程半区）。
- 浏览器访问且用户拒绝通知权限时只剩侧栏状态。
- 完成通知按「一轮结束」触发：失败、被中止也会弹，文案用「已完成」不区分结果。
- 通知文案中 reason 由工具提供，可能是长文本，截断到 200 字。
- 插件从 worktree 安装时 profile 的 `link:` 指向 worktree；**合并后必须从主工作树重新安装并重启**（路径变化会命中客户端模块缓存，见 AGENTS.md §六）。
- 工作树基于 develop HEAD，不含主工作树里未提交的 tasks/active 重构；任务文件按新约定放在 `docs/tasks/active/`。

## Review

### 改动文件

- 新增 `plugins/session-notify/`：`package.json`、`cordis.patch.yml`、`index.js`、`src/client.js`、`client.js`（生成物）、`build.mjs`、`locale/{zh,en}.json`、`icon.svg`、`README.md`、`docs/notes/2026-10-24-0004-会话提醒走会话状态订阅.md`、本任务文件。
- 仓库根 `README.md`：插件清单新增一行。

### 验证

| 项 | 命令 / 判据 | 结果 |
| --- | --- | --- |
| 单插件构建 | `node build.mjs` | 通过，生成 `client.js` |
| 语法 | `node --check client.js` | 通过 |
| 单插件测试 | `node --test 'test/*.test.mjs'` | 24 用例 / 24 通过 / 0 失败 |
| 产物同步 | `git add` 后 `node build.mjs && git diff --exit-code -- client.js` | 通过 |
| 安装 | `plugin_manager install_bundle .../plugins/session-notify` | `application: applied`、`changed: true`、warnings 空 |
| boot graph | `curl -sN http://127.0.0.1:52828/plugins/events` | 出现 `@local/dsh-session-notify`，四个 inject 边与 `immediately: true` 正确 |
| 产物投递 | 按 graph 的 `rev` 请求 combo URL | 与本地 `client.js` 逐字节一致（服务端仅追加 sourceMappingURL） |
| 全仓门禁 | `for d in plugins/*/` | `qoder-theme`、本插件通过；`session-title-rule` 的既有契约用例失败 |
| 真实通知 | 用户现场触发审批/完成 | 用户确认可用（弹窗与点击跳回） |

### 遗留

- 全仓门禁的 `session-title-rule` 失败是 worktree 基线（`develop@b25b7f0`）缺少主工作树里未提交的修复，与本插件无关；合并前需先落地那份改动。
- profile 的 `link:` 指向 worktree；**合并后必须从主工作树重新安装并重启**，否则客户端模块缓存仍指向旧路径。
- 代理无法控制 Desktop 渲染页面；实际弹窗与点击跳回已由用户现场确认。若后续页面未热加载新插件，刷新一次即可。
- 完成提醒按 `running true→false` 触发，失败/中止也会提醒；如噪音过大，后续再加过滤配置。
