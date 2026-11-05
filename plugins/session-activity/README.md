# @local/dsh-session-activity

在左侧栏「新会话」下方加一行「任务动态」，点它向右展开一个浮层，列出需要回去看的会话：

| 分组 | 判据 |
| --- | --- |
| 运行中 | `uiSession.sessionStatus` 里 `running === true` 的根会话 |
| 待查看 | `completionUnread === true` 的会话：运行结束、主视图还没打开过 |

点任意一条调用 `uiWorkspace.openSession(id)` 跳到对应会话；打开后 `completionUnread` 自动清除。纯客户端插件：不改 Host 行为、不写会话日志、不加模型上下文。

## 安装

要求 DSH `^0.2.1-rc.2`（见 `package.json` 的 `engines.dsh`）。插件注入 5 个客户端服务，版本过旧会缺服务而不加载。

从 GitHub 安装已发布版本（其他人用这条）：

```
plugin_manager install_bundle "git+https://github.com/donghuz1/dsh_plugin.git#session-activity-v0.1.0&path:/plugins/session-activity"
```

本地开发安装（传插件目录的绝对路径）：

```
plugin_manager install_bundle <插件目录绝对路径>
```

新装 bundle 可热应用；替换同名包或移动插件目录后需要重启应用（客户端模块缓存按路径命中，见仓库 AGENTS.md §六）。

升级：DSH 没有原位升级，先 `plugin_manager remove_bundle @local/dsh-session-activity`，再按新 tag 安装。

## 行为

- 席位是 `sidebar.panellist`，`order: -10`：排在「插件」「自动化任务」等全局面板行之前，落点正好在「新会话」正下方。
- 侧栏把每个 panellist entry 包成一个按钮，点击默认 `selectPanel(id)`。本插件在 glyph 挂载时找到这个按钮，用原生 click 监听先截住事件（`stopPropagation`），把这一行变成浮层开关；`aria-expanded` / `aria-haspopup` 会同步。
- 浮层把 `shell.overlay` 当作常驻挂载点，内容 portal 到 `document.body`（`z-index: 200`），因此窄窗 drawer 模式下（遮罩 70 / 侧栏 71）也不会被压在后面。按侧栏按钮的 rect 固定定位到右侧。
- 浮层不会因为切换会话（点列表条目或在侧栏换会话）而收起，方便连着跳转；关闭方式是再点一次侧栏行、按 Esc 或点右上角 ×。窄窗抽屉收起、触发器离屏时自动收起。
- 可访问性：侧栏行的 `aria-label` 带上任务数，`aria-haspopup` / `aria-expanded` / `aria-controls` 指向浮层；Esc 或关闭按钮关闭后焦点回到侧栏行。
- 数据订阅 `sessions.list` + `uiSession.sessionStatus` + `uiSession.adapter.current`，会话起止/标题/目录变化即时反映；空白会话与 `origin: 'subagent'` 的子会话不列入。
- 每条显示会话标题、目录（末尾两段，完整路径在悬停提示里；没有 `cwd` 时显示「无目录」）、相对时间与「当前」标记。
- `layout.selectPanel` 对未注册的主面板 key 会抛错，而侧栏「更多」的条目由 `sidebar.panellist.actions` 的注册者决定，是否列出本 id 不由本插件控制。为兜住任何直接 `selectPanel('session-activity')` 的路径（包括侧栏 click 拦截失效），插件注册一个空的 `main` 占位（key `session-activity`）：占位被渲染时立即把主面板退回会话并展开浮层，不留下空白页或控制台错误。
- 三处席位都用 `ctx.slots.inject` 绑定到声明生命周期：某一处暂缺/晚声明不会拖垮其余注册。
- 浮层底部「默认展开」开关持久化在 localStorage 的 `dsh.session-activity.default-open`：开启后，进入应用且存在任务时自动展开；默认关闭即「点击才展开」。
- 点条目只跳转、不收起浮层；打开会话后该会话的 `completionUnread` 被清除，会从「待查看」里消失。
- 客户端插件拿不到 profile 里插件行的 `config`（client-modules 建 entry 时只传 name），所以偏好只能放在 localStorage，不提供 profile 配置项。

## 限制

- 复用了「panellist 行」这个席位：它本应切换主面板，本插件把点击改成浮层。若 DSH 改动 `ui-sidebar` 的 PanelRow 事件结构，点击会落到 `main` 占位，最终仍打开浮层，但会闪一下主面板。
- 浮层 portal 的 `z-index: 200` 依赖抽屉层仍在 70/71；上游若把抽屉层级抬到 200 以上，需要同步调整。
- 「默认展开」只存在当前浏览器的 localStorage，换设备/清缓存后回到默认关闭。
- 「默认展开」只在有任务时展开；没有任务时保留侧栏行与 0 角标，不弹空浮层。
- 浮层坐标依赖 DOM 测量；侧栏折叠、窗口缩放通过 `ResizeObserver` + `resize` 重算。
- 没有 Host 半区，也没有视觉回归测试：真实页面渲染仍需人工确认。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/model.js` | 纯模型：筛选、排序、相对时间、浮层状态机；构建时内联进产物 |
| `src/client.js` | 浏览器半区源码：侧栏行、浮层、CSS、服务订阅 |
| `client.js` | 生成物，请勿手改 |
| `build.mjs` | 零依赖构建 + 命名/产物断言 |
| `index.js` | 空 Host `apply`（Loader 行需要可载入条目） |
| `test/model.test.mjs` | 纯模型单测（不依赖 VM/React） |
| `test/plugin.test.mjs` | 在 VM 里跑真实 `client.js`，覆盖席位注册、点击接管、浮层开关、默认展开、跳会话、关闭 |
| `test/contract.test.mjs` | 对照 DSH 源码校验 slot / 服务 / 字段假设 |
| `locale/` · `icon.svg` | 插件管理器的展示元数据 |

## 门禁

```bash
node build.mjs
node --check client.js
node --test 'test/*.test.mjs'
```

契约测试默认读 `../deepseek-harness`（可用 `DSH_SOURCE` 覆盖）；源码不存在时相关用例显式跳过。

## 验证安装

```
plugin_manager install_bundle <插件目录绝对路径>     # application: applied
```

无浏览器控制时，用只读 inspect 确认三处注册：

```json
// cordis_inspect_query → client / Slots / listSubTree { root: "sidebar.panellist" }
{ "registrant": "session-activity", "id": "session-activity", "order": -10, "active": true }

// cordis_inspect_query → client / Slots / listSubTree { root: "main" }
{ "registrant": "session-activity", "key": "session-activity", "active": true }

// cordis_inspect_query → client / Slots / listSubTree { root: "shell.overlay" }
{ "registrant": "session-activity", "id": "session-activity.flyout", "order": 30, "active": true }
```

真实视觉效果（行位置、浮层贴边、深浅色）需要打开侧栏现场确认。
