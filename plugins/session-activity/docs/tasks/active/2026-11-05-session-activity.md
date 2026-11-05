# 侧栏任务动态（session-activity）

## 目标

在左侧栏「新会话」下方增加一行「任务动态」。点它向右展开浮层，列出两类会话：

- **运行中**：`sessionStatus.running === true` 的会话；
- **待查看**：`sessionStatus.completionUnread === true` 的会话（运行结束、主视图还没打开过）。

浮层里点一条即跳到对应会话；同时支持两种初始形态：点击才展开（默认），或在浮层底部打开「默认展开」后每次进入应用自动展开。

## 现状与约束

- 「新会话」按钮下方只有 `sidebar.panellist` 这一处已分配空间的扩展位；每个 entry 被侧栏包成一个按钮，点击默认走 `selectPanel(id)`。
- 浮层没有专属 slot；`shell.overlay` 是框架级浮层（本身 click-through，条目可自行接管指针事件）。
- `uiSession.sessionStatus` 同时给出 `running` 与 `completionUnread`；`completionUnread` 在会话进入主视图（`retainedBy.mainView > 0`）时清除，因此点击跳转即完成「已查看」。
- 客户端插件拿不到 profile 里行的 `config`（client-modules 建 entry 时只传 name），所以「默认展开」用 `localStorage` 持久化，不走插件配置。
- 当前代理无法控制 Desktop 渲染页面（内置浏览器缺 Electron 运行时），视觉验证受限，按插件的注册结果与契约测试证明。

## 方案

### 插件形态

- 纯客户端 bundle：`index.js` 空 `apply`，行为全在 `client.js`。
- Client `inject: ['slots', 'locale', 'uiSession', 'sessions', 'uiWorkspace']`。
- 三处注册：
  - `sidebar.panellist`：`id: session-activity`、`order: -10`（排在「插件」等行之前，即「新会话」正下方）。glyph 内用原生事件在捕获按钮点击后 `stopPropagation`，把这一行变成浮层开关，而不是切主面板。
  - `main`（key `session-activity`）：空占位。`layout.selectPanel` 对未注册的主面板会抛错；占位被渲染时退回会话并打开浮层，兜住任何直接选中本 id 的路径。
  - `shell.overlay`：仅作常驻挂载点；浮层内容 portal 到 `document.body`（`z-index: 200`），按侧栏按钮的 `getBoundingClientRect()` 固定定位到右侧，窄窗 drawer 下不会被遮罩盖住。
  - 三处都用 `ctx.slots.inject` 绑定到 slot 声明生命周期。
- 筛选与排序放在 `src/model.js`（纯函数，可单测）：跳过 `blank`、`origin === 'subagent'`；运行中优先；组内按 `updatedAt` 降序。
- 「默认展开」开关写在浮层底部，状态存 `localStorage`（`dsh.session-activity.default-open`），首次默认关闭。

## 影响文件

```
plugins/session-activity/
├── package.json / cordis.patch.yml / index.js
├── src/model.js          # 纯模型：筛选、排序、相对时间、浮层状态机
├── src/client.js         # 浏览器半区（侧栏行 + 浮层 + 样式）
├── client.js             # 生成物
├── build.mjs             # 零依赖构建 + 命名/产物断言
├── locale/{zh,en}.json / icon.svg
├── test/{model,plugin,contract}.test.mjs
├── README.md
└── docs/
    ├── notes/2026-11-05-0005-任务动态用侧栏面板行加浮层.md
    └── tasks/active/2026-11-05-session-activity.md
```

另更新仓库根 `README.md` 的插件清单。

## 验收标准

- [x] 侧栏「新会话」下方出现「任务动态」行，角标显示运行中 + 待查看总数。
- [x] 点击该行在右侧展开浮层；再次点击或点浮层外/Esc 关闭。
- [x] 浮层分「运行中」「待查看」两组，跳过空会话与 subagent 会话，组内按更新时间倒序。
- [x] 点条目调用 `uiWorkspace.openSession(id)` 并关闭浮层；当前会话带「当前」标记。
- [x] 浮层底部「默认展开」开关可切换并持久化；开启且有任务时，进入应用自动展开。
- [x] 窄窗 drawer 模式（侧栏遮罩 z 70 / 侧栏 z 71）下浮层仍可见：portal 到 body，z-index 200。
- [x] `node build.mjs && node --check client.js && node --test 'test/*.test.mjs'` 全绿，产物可复现。
- [x] `plugin_manager install_bundle` 后 `application: applied`，live `sidebar.panellist` 与 `shell.overlay` 均出现本插件。

## 风险与限制

- 侧栏行语义被复用：该 entry 本应指向一个主面板，本插件拦截点击改为浮层。若 DSH 改动 `PanelRow` 的事件结构，插件会退化为「点开后主面板空白」，需要随上游调整。
- 浮层坐标依赖 DOM 测量；侧栏折叠/窗口缩放时通过 `ResizeObserver` + `resize` 重算。
- 客户端插件无法读 profile 配置，因此「默认展开」只存在浏览器 localStorage，换设备/清缓存后回到默认关闭。
- Desktop 页面视觉需用户现场确认；代理侧以 live slot 注册与测试为准。

## Review

### 改动文件

- 新增 `plugins/session-activity/`：`package.json`、`cordis.patch.yml`、`index.js`、`src/model.js`、`src/client.js`、`client.js`（生成物）、`build.mjs`、`locale/{zh,en}.json`、`icon.svg`、`README.md`、`docs/notes/2026-11-05-0005-任务动态复用侧栏面板行加浮层.md`、本任务文件。
- 仓库根 `README.md`：插件清单新增一行。

### 验证

| 项 | 命令 / 判据 | 结果 |
| --- | --- | --- |
| 单插件构建 | `node build.mjs` | 通过，生成 740 行 `client.js`；重复构建 sha1 不变 |
| 语法 | `node --check client.js` | 通过 |
| 单插件测试 | `node --test 'test/*.test.mjs'` | 39 用例 / 39 通过：契约 13、模型 17、装配 9（含 portal / inject / 焦点回归） |
| 全仓门禁 | `for d in plugins/*/` 构建 + 语法 + 测试 | qoder-theme / session-activity / session-notify / session-title-rule 全绿 |
| 安装 | `plugin_manager install_bundle .../plugins/session-activity` | `application: applied`、`changed: true`、`warnings: []` |
| live 侧栏注册 | `cordis_inspect_query` client/Slots `sidebar.panellist` | `registrant: session-activity`、`order: -10`、`active: true`；排在 `plugins(0)` 之前 |
| live 浮层注册 | `cordis_inspect_query` client/Slots `shell.overlay` | `id: session-activity.flyout`、`order: 30`、`active: true` |
| live 主面板占位 | `cordis_inspect_query` client/Slots `main` | `key: session-activity`、`active: true` |
| 独立复核 | teammate `plugin-reviewer` 只读复核 | 4 条发现：drawer z-index（已修为 portal+z200）、inject/主面板兜底（已改为 slots.inject）、测试自欺（已补根委托模拟/portal/焦点断言）、a11y（已补计数标签与焦点归还） |
| boot graph | `GET http://127.0.0.1:60591/plugins/events` | 出现 `@local/dsh-session-activity`，5 条 inject 边与 `immediately: true` 正确 |
| 产物投递 | 按 graph 的 `rev` 请求 combo URL | HTTP 200，前缀与本地 `client.js` 逐字节一致（服务端仅追加 sourceMappingURL） |

### 遗留

- 代理侧没有浏览器控制（内置浏览器缺 Electron 运行时），侧栏行外观、浮层贴边、深浅色需用户现场确认。
- 窄窗 drawer 的层级依据运行时分发的 `ui-layout` CSS 校验（遮罩 z 70 / 侧栏 z 71，本插件 portal 到 body 后 z 200）；真实窄窗观感仍需现场确认。
- 侧栏入口复用了 `sidebar.panellist` 的「点击切主面板」语义，靠拦截 click 改成浮层；上游改 PanelRow 结构时契约测试会先失败。
- 「更多」菜单选中本 id 的路径靠空 `main` 占位补救；上游若改成别的菜单机制，需重新确认 `selectPanel` 的目标仍能落到占位上。
- 默认展开偏好只在当前浏览器 localStorage。
- 插件按 worktree 路径装进 profile；合并回主工作树后需从主工作树重新安装并重启。
