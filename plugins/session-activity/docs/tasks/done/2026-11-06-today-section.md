# 任务动态增加「今日」区域

## 目标

浮层从两组扩成三组：**运行中**、**待查看**、**今日**。

- 今日 = `updatedAt` 落在本地日历今天、且既不在运行中也不在待查看的根会话；
- 三组互斥，同一会话只出现一次；
- 角标与「默认展开」的判定仍只统计运行中 + 待查看（今日是回看区，不算待处理）。

## 现状与约束

- `selectTasks` 只返回 `{running, unread}`，组件按两组渲染；store 的初始值、`sameTasks`、`countTasks` 也都是两组假设。
- 没有配置项，分组规则写在模型里；「今日」只能用本地时间判定，不能依赖 Host 的时区配置。
- 浮层打开期间可能跨过零点，今日分组需要自己滚动更新，不能只靠会话事件触发。
- `sessions.list` 不含归档标记，归档会话与现状一样不做二次过滤。

## 方案

- `src/model.js`：
  - 新增 `isSameLocalDay(at, now)`，用 `getFullYear/getMonth/getDate` 比较本地日期分量，避开 DST 与月末边界；
  - `selectTasks(input)` 接收可选的 `now`（缺省 `Date.now()`），按「运行中 > 待查看 > 今日」互斥分流；
  - store 初始 tasks 增加 `today: []`，`sameTasks` 比较三组，`setTasks` 对缺组做空数组归一；
  - `countTasks` 保持运行中 + 待查看，不把今日算进角标/自动展开。
- `src/client.js`：
  - 浮层按运行中、待查看、今日顺序渲染第三组；
  - 空状态判定改为三组全空；
  - 控制器给 `selectTasks` 传 `now: Date.now()`，并加 60s 定时重算，跨零点自动换组。
- 测试：模型覆盖今日边界、互斥、排序、缺省 now、store 归一与今日更新；VM 装配测试覆盖第三组渲染与旧会话排除。

## 影响文件

```
plugins/session-activity/
├── src/model.js
├── src/client.js
├── client.js                  # 生成物
├── test/model.test.mjs
├── test/plugin.test.mjs
├── README.md
├── package.json               # description
├── locale/{zh,en}.json        # meta.description
└── docs/
    ├── notes/2026-11-05-0005-任务动态复用侧栏面板行加浮层.md
    └── tasks/active/2026-11-06-today-section.md
```

另更新仓库根 `README.md` 的插件清单描述。

## 验收标准

- [x] 浮层按「运行中 → 待查看 → 今日」顺序渲染三组，组内按更新时间降序。
- [x] 今日只收今天更新过、且不在运行中/待查看的根会话；昨天更新、空白会话、subagent 不列入。
- [x] 三组互斥，同一会话只出现一次。
- [x] 只有今日条目时也显示列表（不显示空状态）；角标仍显示运行中 + 待查看数量。
- [x] 跨零点一分钟内今日组自动换组（控制器 60s 重算）。
- [x] `node build.mjs && node --check client.js && node --test 'test/*.test.mjs'` 全绿，产物可复现。
- [x] 安装路径下的 bundle 已更新（HMR 生效），live slot 仍 active。

## 风险与限制

- 今日组可能较长（一天里看过的会话都算），当前不设上限，靠浮层滚动。
- 归档会话没有过滤，和运行中/待查看的现状一致。
- 今日边界按浏览器本地时区；跨时区使用同一份数据时以客户端时区为准。
- 定时重算每分钟一次，零点后最迟一分钟内换组。

## Review

### 改动文件

- `src/model.js`：`isSameLocalDay`；`selectTasks` 三组互斥分流 + 可注入 `now`；store 三组初始值/归一/比较；`countTasks` 仍只算前两组。
- `src/client.js`：第三组渲染、三组全空的空状态、控制器传 `now` 并 60s 重算；字典新增 `section.today`，空态文案改为「今天还没有会话动态」。
- `client.js`：重新构建的生成物。
- `test/model.test.mjs`、`test/plugin.test.mjs`：今日边界/互斥/排序/缺省 now/store 归一/第三组渲染。
- `README.md`（插件与仓库根）、`package.json` 描述、`locale/{zh,en}.json`、0005 决策笔记同步。
- 本任务文件。

### 验证

| 项 | 命令 / 判据 | 结果 |
| --- | --- | --- |
| 构建 | `node build.mjs` | 通过，793 行 `client.js`；重复构建 sha1 不变（`264abf88…`） |
| 语法 | `node --check client.js` | 通过 |
| 单插件测试 | `node --test 'test/*.test.mjs'` | 46 用例 / 46 通过：契约 13、模型 23、装配 10 |
| 全仓门禁 | 4 个插件构建 + 语法 + 测试 | 全绿 |
| live 投递 | 当前 GUI `:49889` 的 boot graph → bundle | HTTP 200，含 `section.today`，前缀与本地逐字节一致 |
| live 注册 | `cordis_inspect_query` `sidebar.panellist` | `session-activity` 仍 active |
| 视觉 | 代理侧无浏览器控制 | 用户现场确认三组顺序与今日条目可用 |

### 遗留

- 今日组不设上限，一天内看过的会话多时靠浮层滚动。
- 归档会话未单独过滤（与运行中/待查看现状一致）。
- 时区按浏览器本地时区；跨零点最迟一分钟换组。
- 当前分支已发布：`feature/session-activity-today` 合入 `develop`，tag `session-activity-v0.2.0` 推送。

### 结项

2026-11-06：用户确认可用；版本升至 `0.2.0`，合入 `develop` 并推送，打 tag `session-activity-v0.2.0`，任务文件移入 `done/`。
