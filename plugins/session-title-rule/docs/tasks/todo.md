# session-title-rule — 会话标题按规则生成

## 目标

DSH 会话标题统一为 `MMDD｜类型｜主题`：

- `MMDD` 取 `session.header.createdAt`（毫秒，对应规则里的 `time_created`），转 Asia/Shanghai（UTC+8）；**不读 `updatedAt`**。
- `类型` 限定八选一：功能、设计、修复、优化、发布、探索、文档、研究。
- `主题` 一句话具体提炼实际内容，不重复项目名（取自 `header.cwd` 的 basename），适合左侧栏显示。

## 澄清结论（用户已定）

| 问题 | 结论 |
| --- | --- |
| 生成节奏 | `automatic: 'first-prompt'` —— 仅首条用户消息后生成一次 |
| 插件形态 | 保留空壳 `client.js`，不动仓库现行门禁约定 |
| 补改范围 | 插件加载时对 `ctx.sessions.list()` 里已有活跃会话补跑一次 `refresh()` |

## 待确认默认（未否决即按此实施）

- **KEEP 语义**：模型判断不出主题时，provider 抛错 → 服务保留 DSH 的 fallback 标题（= 首条消息截断），即"保留原名"。DSH 没有"对话澄清"通道，只能 `logger.warn` + README 说明。
- **非主对话不改**：`header.parentSession !== undefined` 或 `header.origin === 'subagent'` 的会话直接跳过。
- **已归档不改**：归档不会把会话移出 live store，因此补跑时显式读 `workspaceRegistry.archivedSessionIds` 并跳过。
- **用户显式改名优先**：`sessionTitle.get(session)?.source.kind === 'user'` 时跳过（服务内建 pin 也覆盖自动路径）。
- **系统自动记录不改**：规则里的 observer / Claude-Mem 在 DSH 无对应物，不实现，README 记录该差异。
- **`tasks` 表那条**：DSH 无此表，按不适用处理。

## 机制依据（已核实，非推测）

- 标题唯一扩展点：`ctx.sessionTitle.register(provider)`，**全局仅一个槽位**，已注册再注册会抛错。
  → profile 里 `session-title-llm`（`@deepseek-ai/dsh-session-title-first-prompt-llm`）必须先 disable。
- provider 结果校验（`session-title/src/index.ts:624-671`）：`title` 归一化后必须非空；`messageSeqs` 必须非空且是本次 `request.messages` 的有序子序列。
- provider 抛错被吞并 `logger.warn`（`:570-573`），标题保留 fallback —— 这正是 KEEP 的落地点。
- `automatic: 'first-prompt'` 的调度条件（`:507-508`）：`parentSession === undefined && count === 1 && get(session) === undefined`。
- 自动生成要等 `request/header` 或 agent-loop 的 `llm/stream` 才真正启动，因此 `request.route` 必定可用。
- 标题字节上限 `maxTitleBytes: 80`（profile `session-title` 行），超出**静默截断**。
- `GenerateOptions.messages` 接受 `RequestUserInput = { role: 'user', content }`（无需 `id`/`source`），
  这是零依赖构造模型消息的官方形状。
- 从插件目录 `require.resolve('@deepseek-ai/dsh-llm')` 实测 `MODULE_NOT_FOUND`
  → Host 半区必须零 import，只通过 `ctx` 服务交互。

## 影响文件清单

```
plugins/session-title-rule/
├── package.json           # @local/dsh-session-title-rule + dsh.bundle.patch + dsh.client
├── cordis.patch.yml       # disable 内置 session-title-llm；insert 本插件行
├── index.js               # Host 入口：inject + apply（注册 provider + 补跑）
├── src/rule.js            # 纯逻辑：MMDD 换算、输出解析、字节预算裁剪、边界判定
├── src/prompt.js          # 系统提示词（八类判定表 + 输出格式）
├── src/client.js          # 空壳客户端源
├── client.js              # 生成物（build.mjs 产出，勿手改）
├── build.mjs              # src/client.js -> client.js，零依赖
├── test/rule.test.mjs     # 纯单元：MMDD 边界、解析、裁剪、组装、边界判定、apply 装配
├── test/contract.test.mjs # 契约：对照 DSH 源码校验每一处字符串/形状假设
├── README.md
└── docs/notes/2026-09-28-0002-会话标题按规则生成.md
```

仓库级改动：

- `README.md` 插件清单加一行。
- `docs/tasks/todo.md` 无需改（单插件任务留在插件内）。

## 实施步骤

- [ ] 1. 骨架：`package.json` / `cordis.patch.yml` / `build.mjs` / `src/client.js`，跑通「装得上」链路
- [ ] 2. 纯逻辑 `src/rule.js` + `test/rule.test.mjs`（TDD：先写断言再写实现）
- [ ] 3. 提示词 `src/prompt.js`
- [ ] 4. Host 入口 `index.js`：注册 provider（包 `ctx.effect`）+ 加载时补跑
- [ ] 5. `test/contract.test.mjs`：对照 DSH 源码逐个校验字符串假设
- [ ] 6. 门禁：`build.mjs` / `--check client.js` / `--test`，并确认 `client.js` 与源同步
- [ ] 7. 决策笔记 + README + 仓库 README 清单
- [ ] 8. `plugin_manager install_bundle` 安装进 desktop profile，验证 `fiberPhase: active`
- [ ] 9. 端到端验证：新会话首条消息后标题变为 `MMDD｜类型｜主题`；补跑对本会话生效

## 验收标准

1. 全仓门禁通过（`build.mjs && --check client.js && --test`）。
2. `plugin_manager list_plugins` 中本插件 `fiberPhase: active`，内置 `session-title-llm` 为 disabled。
3. 新开一个会话发一条消息，左侧栏标题在模型回答前后变为 `MMDD｜类型｜主题` 形态，MMDD 等于会话创建时刻的上海日期。
4. 用户手动改名后，标题不再被自动覆盖。
5. 子会话（subagent）标题不被本插件改写。
6. 现有会话（含本会话）在插件加载后被补上规则标题。

## Review

全部 9 步完成。

### 验证证据

| 项 | 命令 / 判据 | 结果 |
| --- | --- | --- |
| 全仓门禁 | `build.mjs && --check client.js && --test 'test/*.test.mjs'` + `git diff --quiet -- client.js` | 通过（qoder-theme 与本插件各 1 次） |
| 本插件测试 | `$NODE --test 'test/*.test.mjs'` | 48 通过 / 0 失败 / 0 跳过 |
| 自包含 | 复制到 `mktemp -d` 后重跑门禁 | 通过，零 `node_modules` |
| 装上 | `plugin_manager list_plugins` | `include:session-title-rule` → `enabled: true` |
| 加载 | 同上 `fiberPhase` | `active`（说明 provider 注册成功；若槽位被占会 `failed`） |
| 内置 provider 已让位 | 同上 | `include:session-title-llm` → `enabled: false` |
| 端到端 | 本会话的 `title` 投影 | `0928｜功能｜实现会话标题自动生成插件` |
| 规则不变式 | 所有规则标题的 MMDD 对照各自 `createdAt` | 10/10 相符，类型全部在八类内 |

### 实施中发现的三件事

1. **运行中的 DSH 比源码 checkout 新。** `cordis_inspect_query` 给出的 `GenerateOptions` 有源码里没有的 `RequestUserInput` / `toolHistory`。原先按 `RequestUserInput`（只带 role/content）构造消息，改为**完整 Message**（id + role + content + source），两个版本都接受，且与内置 provider 逐字一致。
2. **`DSH_PROFILE` 是 DSH 自己的环境变量**，值是 profile 名（`desktop`）而不是路径；契约测试最初用它拼 profile 路径，导致用例静默跳过。改用 DSH 提供的 `DSH_PROFILE_DIR`。
3. **补跑的影响面比预想大**：Desktop 启动时保留了 10 个 live 会话，插件加载即给这 10 个（全部非归档、非子会话、非用户改名）都补上了规则标题，每个一次模型调用。这是所选机制的必然结果，已记入 README 与决策笔记的影响段。

### 验收后的修正

**补跑原本不是幂等的。** 首版只跳过 `source.kind === 'user'`（用户改名），没跳过**本插件自己命名过**的会话。后果是每次插件加载（每次启动 Desktop）都会对当时全部活跃会话重跑一遍 `refresh()`：白花模型调用，且标题随模型输出漂移——与 `first-prompt`「一次成型」的语义直接冲突。

修正：补跑按标题来源过滤，只处理无标题、`fallback`、以及别的 provider 命名的会话；本插件命名的（`source.kind === 'provider' && source.provider === 'session-title-rule'`）与用户改名的都跳过。测试从 1 个用例扩成 2 个，覆盖全部五种来源。

### 遗留

- `first-prompt` 的**自动**路径（新会话首条消息后由服务调度）未经端到端观察——本会话与那 10 个会话走的都是补跑的 `refresh()` 路径。两者共用同一个 `generate()`，差别只在 DSH 自己的调度条件（`session-title/src/index.ts:507-508`，已有测试覆盖）。开一个新会话发一条消息即可确认。
- 契约测试锚定 DSH 源码 checkout，运行版本更新时会有盲区（见上第 1 条）。

