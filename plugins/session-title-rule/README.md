# session-title-rule

把 DSH 会话标题统一成 `MMDD｜类型｜主题`。

## 命名格式

```
0928｜功能｜新增会话标题插件
```

| 段 | 含义 | 来源 |
| --- | --- | --- |
| `MMDD` | 会话创建时刻的月日 | `session.header.createdAt`（毫秒）转 Asia/Shanghai（UTC+8），**不读** `updatedAt` |
| 类型 | 八选一 | 模型判定，见下表 |
| 主题 | 一句话提炼实际内容 | 模型提炼；不重复项目名（取 `header.cwd` 的 basename），不超过 20 个汉字 |

| 类型 | 判定范围 |
| --- | --- |
| 功能 | 新增页面/功能/组件/接口/表单/流程 |
| 设计 | UI/交互/样式/布局/组件/数据结构/物理模型设计 |
| 修复 | 修 bug/报错/崩溃/接口错误 |
| 优化 | 性能/重构/结构优化/逻辑简化 |
| 发布 | 上线/部署/提交代码/打包/发版 |
| 探索 | 调研/技术选型/方案对比/可行性/咨询 |
| 文档 | 写文档/需求规格/说明/梳理 |
| 研究 | 研究问题/阅读源码/分析原理/安全审查 |

`MMDD` 由插件自己算、自己拼，提示词里**不给日期也不要求日期**——模型的日期算术不可靠。模型只产出「类型｜主题」。

## 边界

| 情形 | 行为 |
| --- | --- |
| 判断不出主题 | 模型输出 `KEEP` → 本次命名作废，**保留原名**（DSH 的 fallback 标题，即首条消息截断），并写一条 warn 日志 |
| 用户手动改过名 | 不改。DSH 的显式改名会 pin 住标题，自动生成不再调度 |
| 子会话 / subagent | 不改（`header.parentSession` 或 `origin === 'subagent'`） |
| 已归档会话 | 不改（补跑时跳过 `workspaceRegistry.archivedSessionIds` 里的 id） |
| 新会话 | 首条用户消息后自动命名一次（provider 的 `automatic: 'first-prompt'`） |
| 已有的活跃会话 | 插件加载时补跑一次 `sessionTitle.refresh()`，使当前会话立即拿到规则标题；只补**还没有规则标题**的，见下 |

### 与规则书的三处差异

1. **`tasks` 表的 `created_at`**：DSH 没有这张表，不适用。
2. **系统自动记录（observer / Claude-Mem）不改**：DSH 没有对应物，不实现。
3. **`selection_side_chat` 不改**：DSH 用 `header.parentSession` / `origin: 'subagent'` 表达同类概念，判定见上表。

## 实现要点

- 插件是**纯 Host 半区**；`client.js` 是一个空壳，只为与仓库「每个插件都有 client.js」的门禁一致，不注册任何 UI 行为。
- 接管标题的唯一途径是 `ctx.sessionTitle.register(provider)`，而该服务**全局只接受一个 provider**。因此 patch 层必须先禁用内置的 `session-title-llm`，否则本插件的 `register()` 会抛错、整个 fiber 失败。
- 插件**不 import 任何 `@deepseek-ai/*`**：从插件目录解析它们会 `MODULE_NOT_FOUND`。与 DSH 的全部接触面是四个服务调用（`sessionTitle` / `llm` / `sessions` / `workspaceRegistry`），所有形状假设由 `test/contract.test.mjs` 对照 DSH 源码校验。
- **辅助调用显式选最低推理档**：`llm.resolveModelInfo()` 取 `reasoning.efforts[0]`，再经 `llm.prepareCall()` 发起请求。省略 `reasoningEffort` 时适配器会落到连接默认值（可能是 high/max），推理 token 会先吃光 64 token 的输出上限，流以 `finish: max-tokens` 结束且没有文本，provider 只能抛错、标题保留 fallback。查询失败或模型不暴露推理能力时不传该字段，交给适配器默认值。
- **辅助消息用无身份的 `RequestUserInput`**（`{ role: 'user', content }`）：该请求不落会话日志，不需要伪造 `Message` id 与 source kind。`prepareCall` 返回的 `prepared.config` 已补齐默认值，`prepared.stream()` 要求传入的 call-config 字段与它逐字段一致。
- 标题字节上限 80（profile 里 `session-title` 行的 `maxTitleBytes`），超出会被服务**静默截断**，所以主题先裁到预算内。
- **输入有 4096 字节预算**，与内置 provider 的 `maxInputBytes` 对齐。全部消息放得下时保持全量输入；首条就超预算时裁成预算内的 UTF-8 前缀；后续消息放不下时停在消息边界。单条首消息实测可达 71KB，现在不会再整条发给标题模型。
- **补跑是幂等的**：每次插件加载都会执行，但只处理还没有规则标题的会话——无标题、DSH 落的 `fallback`、以及别的 provider 命名的（如内置 provider 的英文标题）才重跑；**本插件命名的**与用户改名的都跳过。省略后一条判定就会在每次启动时对所有活跃会话白跑一遍模型，标题还会随模型输出漂移。

## 安装

要求 DSH `^0.2.1-rc.2`（见 `package.json` 的 `engines.dsh`）；不满足时 `install_bundle` 会拒绝安装并回滚。

从 GitHub 安装已发布版本（其他人用这条）：

```
plugin_manager install_bundle "git+https://github.com/donghuz1/dsh_plugin.git#session-title-rule-v1.0.0&path:/plugins/session-title-rule"
```

本地开发安装（传插件目录的绝对路径）：

```
plugin_manager install_bundle <插件目录绝对路径>
```

`desktop` profile 由 Electron 独占，CLI 的 `dsh plugin --profile desktop` 会被硬拒。

升级：DSH 没有原位升级，先 `plugin_manager remove_bundle @local/dsh-session-title-rule`，再按新 tag 安装。

## 验证

```bash
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
cd plugins/session-title-rule
$NODE build.mjs                 # 生成 client.js
$NODE --check client.js
$NODE --test 'test/*.test.mjs'  # 纯单元 + 契约
```

装进 profile 后：

1. `plugin_manager list_plugins` → 本行 `fiberPhase: active`，`include:session-title-llm` 为 `enabled: false`。
2. 新开一个会话发一条消息，左侧栏标题应变成 `MMDD｜类型｜主题`，`MMDD` 等于会话创建时刻的上海日期。
3. 本会话（插件加载时已存在）应在加载后立刻拿到规则标题。

### 没生效时按这四层查

| 层 | 判据 | 不通过的含义 |
| --- | --- | --- |
| 装上了吗 | `list_plugins` 里有没有本行 | 安装失败或 `dsh.bundle.patch` 路径不对 |
| 加载了吗 | 该行 `fiberPhase` | `failed` → 多半是内置 provider 没被禁用（重复注册抛错） |
| 注册进去了吗 | `cordis_inspect_query` platform=host provider=Service method=listService → `sessionTitle` | 服务在但 provider 没生效 |
| 行为对吗 | 首条消息后的左侧栏标题 | 看会话日志里的 warn：`session-title-rule: 会话 <id> 未命名：<原因>` |

常见 warn 原因：模型输出 `KEEP`（判断不出主题）、类型不在八类内、会话尚无模型路由、模型流以 `max-tokens` 结束（说明推理档没选对，检查 `reasoning.efforts` 是否为空）。

## 已知局限

- **契约测试锚定 DSH 源码 checkout**（`DSH_SOURCE`，默认 `../deepseek-harness`），而运行中的 DSH 可能比它更新。源码不在时相关用例显式跳过。端到端行为仍以装进 profile 后的实际效果为准；本插件只用两边都存在的 API（`resolveModelInfo` / `prepareCall` / `RequestUserInput`）。
- `MMDD` 只表达月日，不含年份——与规则书一致。
- 主题长度上限（20 汉字）与字节预算（80）在 `src/rule.js`、`index.js` 里是常量；若把 profile 的 `maxTitleBytes` 调小，需同步调小，否则标题会被服务静默截断（契约测试会先拦下来）。
- 输入预算按「从最早的消息开始装满」分配：极长会话只把前段放进标题调用，结尾上下文不参与判定，主题可能偏早期。
