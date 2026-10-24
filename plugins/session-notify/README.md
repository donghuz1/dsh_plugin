# @local/dsh-session-notify

在 DSH 出现以下两类状态时发桌面系统通知，点击通知聚焦窗口并切到对应会话：

| 提醒 | 触发 |
| --- | --- |
| 需要审批 | 某会话出现 `kind === 'approval'` 的 pending interaction |
| 会话完成 | 根会话从运行中变为空闲（一轮结束） |

纯客户端插件：不改 Host 行为、不写会话日志、不加模型上下文、没有配置项。

## 安装

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin/plugins/session-notify
```

目标必须是插件的绝对路径。新装 bundle 可热应用；从 worktree 安装后若移动了插件目录，必须重新安装并重启（客户端模块缓存按路径命中，见仓库 AGENTS.md §六）。

## 行为

- 信号源是 `ctx.uiSession.sessionStatus`，不是 `remote.$on('approval/request')`：后者已被 `ui-approval` 接管并等待用户作答，后注册的观察者收不到。
- 审批按 `pending.key` 去重，一个审批只弹一次；始终提醒。
- 完成提醒只覆盖根会话（跳过 `origin === 'subagent'` 的子会话）；当前正在看且页面聚焦的会话不弹，页面隐藏/失焦时照常弹。
- 通知由渲染层 `Notification` 发出：Desktop 的 Electron 主进程对非 media 权限直接放行，因此 macOS 上直接进系统通知中心；浏览器访问时首次请求授权，拒绝则静默。
- 点击通知：`window.focus()` + `ctx.get('uiWorkspace')?.openSession(sessionId)`（服务缺失或会话已归档时只聚焦）。

## 限制

- 应用完全退出后收不到通知（本插件没有 Host/主进程半区）。
- 完成提醒不区分成功、失败或被中止，统一显示「已完成」。
- 通知正文里的 reason 截断到 200 个字符。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/client.js` | 浏览器半区源码；构建产物模板 |
| `client.js` | 生成物，请勿手改 |
| `build.mjs` | 零依赖构建 + 命名/产物断言 |
| `index.js` | 空 Host `apply`（Loader 行需要可载入条目） |
| `test/plugin.test.mjs` | 在 VM 里跑真实 `client.js`，覆盖去重、完成抑制、点击、权限、卸载 |
| `test/contract.test.mjs` | 对照 DSH 源码校验服务、字段、事件假设 |
| `locale/` · `icon.svg` | 插件管理器的展示元数据 |

## 门禁

```bash
node build.mjs
node --check client.js
node --test 'test/*.test.mjs'
```

契约测试默认读 `../deepseek-harness`（可用 `DSH_SOURCE` 覆盖）；源码不存在时相关用例显式跳过。

## 验证安装

```bash
# 客户端 boot graph 出现本插件
curl -s -N --max-time 3 http://127.0.0.1:52828/plugins/events \
  | grep -o '"id":"@local/dsh-session-notify"[^}]*}'
```

真实通知需要一次审批或一轮会话结束才能观察；当前页面聚焦在本会话时完成提醒会被刻意抑制。
