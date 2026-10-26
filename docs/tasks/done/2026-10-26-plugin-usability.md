# 插件实用性改进：通知覆盖全部等待态、标题输入预算

## 目标

- `session-notify`：任意 `pendingInteraction`（`approval` / `question` / `plan-review` / 未知 kind）都提醒；当前会话可见且聚焦时统一抑制；完成文案不再谎报成功。
- `session-title-rule`：user prompt 加 4096 字节预算，并让 `messageSeqs` 只报实际进入 prompt 的消息。
- 边界：`qoder-theme` 不动；标题八类枚举与规则书不动。

## 验收标准

- 全仓门禁：每个插件 `build + --check + --test` 通过；`session-notify` 29/29，`session-title-rule` 59 通过 / 1 跳过，`qoder-theme` 7/7。
- 真实 72,539 字节首消息 → user prompt ≤ 4096 字节（实测 4,095 字节），保留 UTF-8 前缀且不劈码点。
- `client.js` 由 `build.mjs` 生成；重跑 build 产物哈希不变。
- 文档、契约测试、插件元数据与新行为一致。

## 澄清结论

- 用户要求直接动手：不起 worktree、不新开分支；改动在当前工作树完成，结项时补 feature 分支与提交。
- `qoder-theme` 不动；标题八类枚举属于用户规则书，本次不改。
- 完成提醒无法从 `sessionStatus` 取得 `turn/end.reason`，接受「本轮已结束」这一中性文案。

## 方案

- **通知覆盖**：订阅 `ctx.uiSession.sessionStatus`，遍历任意 `pendingInteraction`；按 `pending.key` 去重；`approval` 带工具名与 reason，`question` 带首个问题与剩余数量，`plan-review` 只提示等待确认，未知 kind 用通用文案。无 `turn/end.reason` 可用，完成文案改为「本轮已结束」。
- **聚焦抑制**：pending 与完成共用 `isWatching`；先把 key 记为已见再判断是否在看，避免切走后补弹已看过的提醒。
- **标题预算**：与内置 provider 的 `maxInputBytes: 4096` 对齐；按消息顺序装满，首条超预算裁成预算内 UTF-8 前缀，后续消息放不下停在边界；`messageSeqs` 用选择结果，不把被丢掉的历史算作来源。
- **影响文件**：`plugins/session-notify/{src/client.js,client.js,test/*,README.md,package.json,locale/*,docs/notes/0004}`、`plugins/session-title-rule/{src/prompt.js,index.js,test/*,README.md}`、仓库 `README.md`。
- **风险**：契约测试仍锚 0.1.7-rc.2 源码对 0.2.1-rc.3 运行时；补跑仍会重试未归档的 KEEP/失败会话；长会话输入只取前段，结尾不参与判定；通知在 Cmd+Q 后收不到。

## 任务

- [x] `session-notify` 覆盖 question / plan-review / 未知 kind，并统一聚焦抑制。
- [x] 完成文案改为「本轮已结束」，更新 README、元数据与决策笔记。
- [x] 补齐 VM 测试与契约测试（`PendingQuestion` 形状、`user-questions/request` 事件源）。
- [x] `session-title-rule` 加 4096 字节预算；`messageSeqs` 只报实际进入 prompt 的消息。
- [x] 新增 prompt 预算测试与 messageSeqs 装配测试。
- [x] 全仓门禁与产物确定性校验。

## 结果（review）

### 改动文件

- 通知：`plugins/session-notify/src/client.js`、`client.js`（生成物）、`test/plugin.test.mjs`、`test/contract.test.mjs`、`README.md`、`package.json`、`locale/{zh,en}.json`、`docs/notes/2026-10-24-0004-会话提醒走会话状态订阅.md`。
- 标题：`plugins/session-title-rule/src/prompt.js`、`index.js`、`test/prompt.test.mjs`（新增）、`test/plugin.test.mjs`、`README.md`。
- 仓库：`README.md` 的插件清单行。

### 验证

| 命令 / 判据 | 结果 |
| --- | --- |
| 全仓 `build + --check + --test` | `qoder-theme` 7/7、`session-notify` 29/29、`session-title-rule` 59 通过 / 1 跳过 |
| 72,539 字节首消息的 prompt 预算 | 4,095 字节 ≤ 4,096，前缀完整、无 U+FFFD |
| `build.mjs` 重跑后 `client.js` 哈希 | 两个插件均不变 |
| `git diff --check` | 通过 |

### 提交

- `ffa71a2` feat: 会话提醒覆盖全部等待态并修正完成文案 [note:0004]
- `3f0f3c0` fix: 标题生成输入加 4096 字节预算并修正来源 seq
- `3634e5c` Merge branch 'feature/plugin-usability' into develop

### 经验沉淀

- 更新 2 条：`sessionStatus` 提醒覆盖全部 pending kind；渲染层 `Notification` 的 macOS 权限边界。
- 新增 4 条：标题输入 4096 字节预算、完成文案只能中性、`messageSeqs` 来源必须与实际 prompt 一致、`profile.bundles` 才是启用判据。
- 经验库条目沿用 `[REQ-?]` 占位，待补齐 REQ-ID。

### 遗留

- 标题补跑仍会对未归档的 KEEP/失败会话每次启动重试；本次未改，避免扩大范围。
- 输入预算按「从最早消息开始装满」分配，极长会话的结尾不参与标题判定。
- 通知在应用完全退出（Cmd+Q）后收不到；失败/中止只能显示「本轮已结束」。
- 契约测试仍锚定 `0.1.7-rc.2` 源码对 `0.2.1-rc.3` 运行时；后续可把 `DSH_SOURCE` 指到与运行版本一致的源码。
- 八类标题分类存在语义重叠（功能/设计、探索/研究），未在本次调整，留给规则书 owner 确认。
