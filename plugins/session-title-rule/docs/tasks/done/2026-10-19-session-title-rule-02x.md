# 升级：适配 DSH 0.2.x（辅助调用显式选推理档）

## 现象

DSH 升级到 `0.2.1-rc.2` 后，新根会话的首条消息只留下 fallback 标题（首条消息截断），不再出现 `MMDD｜类型｜主题`。会话日志判据：`session/title` 只有 `source.kind=fallback`；补跑 `refresh()` 仍能生成 provider 标题 → provider 契约没变，坏在自动路径的辅助调用。

## 根因（在运行中的 0.2.1 运行时复现）

- 适配器在调用方不传 `reasoningEffort` 时落到连接默认值（本机主请求是 `max`）。
- 辅助调用 `maxTokens=64`，推理 token 先耗光预算 → `finish: max-tokens`、文本为空 → 插件把非 `stop` 一律当失败 → provider 抛错 → 服务保留 fallback。
- 复现方式：headless profile + `--patch` 加载本插件，临时日志显示 `finish={"kind":"max-tokens"}`、`textLen=0`。
- 内置 provider 的规避方式：`prepareCall` + `selectReasoningEffort = model.reasoning.efforts[0].id`。

## 修复

- `index.js`：`resolveModelInfo` 取 `efforts[0]` → 显式 `reasoningEffort` → `prepareCall` / `prepared.stream`；查询失败或模型无推理能力时降级为不传。
- 辅助消息改用无身份 `RequestUserInput`（`{ role, content }`），去掉 `MessageSourceMap` 已不存在的 `plugin` source kind。
- `test/plugin.test.mjs`：假 ctx 改为 `resolveModelInfo` + `prepareCall`，新增「选最低档 / 无推理能力不传 / 查询失败降级」3 条用例。
- `test/contract.test.mjs`：适配新源码的 `MessageBase` / `MessageRoleMap` 形状，新增 `RequestUserInput`、`resolveModelInfo`、`prepareCall`、`reasoning.efforts`、`FinishReason` 契约断言。
- README 与决策笔记 0003 同步。

## Review

| 项 | 命令 / 判据 | 结果 |
| --- | --- | --- |
| 插件门禁 | `build.mjs && --check client.js && --test 'test/*.test.mjs'` | 54 用例 53 通过 / 0 失败 / 1 跳过（跳过项从 profile 的 cordis.yml 取 `maxTitleBytes`；profile 现为空根、配置在 bundle 层，属用例假设过期，非回归；运行包内仍为 `maxTitleBytes: 80`） |
| 契约子集 | `--test test/contract.test.mjs` | 18 用例 17 通过 / 0 失败 / 1 跳过（同上） |
| 端到端（0.2.1 运行时） | headless + `--patch` 加载本插件，发一条首消息 | 标题 `1019｜功能｜撰写春天溪流三百字短文`，`source.kind=provider`、`provider=session-title-rule` |
| 产物同步 | `git diff --quiet -- client.js` | 通过（client.js 未变） |
| Desktop 现场（0.2.1-rc.3） | 2026-10-26 14:15 重启后新建会话并发首条消息 | 15:18:41 标题 `1026｜研究｜检查会话标题插件是否生效`，`source.kind=provider`、`provider=session-title-rule`；前一条 15:18:40 为 fallback，自动路径完整走通 |
| 旧会话恢复（0.2.1-rc.3 运行时） | 10-22 创建、10-26 10:09 恢复后发首条消息 | 自动命名为 `1022｜探索｜理解功能树GROUP层级规则举例`；`MMDD` 取自 `createdAt`，不是恢复日期 |

## 遗留

- Host 半区代码改动需重启 Desktop 才生效；本次 10-24 改完、10-26 14:15 重启后生效，符合预期。
- 契约测试锚定的源码 checkout（`../deepseek-harness`）现为 `0.1.7-rc.2`（9-27），比运行的 `0.2.1-rc.3` 旧，只作静态形状参考；端到端以运行日志为准。
- 未定性观察：2026-10-26 14:56 恢复的 my-agent 根会话（`session-51d1230b`）首条消息为「图片 + 一句话」，标题只留下 fallback。可能是模型输出 `KEEP`（设计即保留原名），也可能是辅助调用失败；Desktop host 不落 logger 输出，无法从会话日志区分。


