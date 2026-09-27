# Demo：会话问候插件 `greeter`

一个可以完整跑通的插件示例。你将做出：

1. 每次会话开始，Host 记一条问候日志；
2. 问候语进入**系统提示词**，模型能感知——**这一条在 GUI 里可验证**；
3. 问候语可由 profile 配置覆盖。

## 为什么这么设计

| 选择 | 理由 |
| --- | --- |
| **纯 Host 半区，没有 `client.js`** | 少一半复杂度。浏览器半区留给下一个插件 |
| **纯 JS，零构建** | 不为工具链分心，先把链路跑通。TS 版见附录 |
| **验证靠系统提示词，不靠日志** | Desktop 里 Host 的 stdout 被 pipe 到 Electron 主进程，打包后从 Finder 启动**看不到**；stderr 只被截留成失败诊断的后缀。所以日志只当教学素材，不当验证手段 |
| **分六个阶段，每阶段有验证点** | DSH 的失败大多是静默的，早一步确认比后面倒查便宜 |

## 前置阅读（约 40 分钟）

- `docs/cordis-tutorial/02-lifecycle-and-effects.zh.md` —— effect 与撤销
- `docs/cordis-tutorial/04-events.zh.md` —— 事件模式
- `docs/cordis-tutorial/05-config.zh.md` —— Config schema
- 本仓库 [DSH 插件系统](../架构/dsh-插件系统.md) 第四、五节 —— 插件形态与运行时

## 已核实的契约

动手前先把这三条钉死，它们的字段名写错不会报错。

### `agent/created`（事件，serial 模式）

```
(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal })
: undefined | Promise<undefined>

SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

官方描述里有两条**必须遵守**的警告：

> Listeners run in order and are awaited before creation resolves. AgentLoop holds queued input until all listeners finish. **A throw or rejection fails creation and skips later listeners.** Disposal retains the scope and session until dispatch settles; **listeners must not await `agent.whenIdle()` or their own owner's disposal.**

翻译成行动：**这个监听器里自己兜住异常**，且不要做异步等待。

### `ctx.systemPrompt.section(section)`

```
section(section: PromptSection): () => void
PromptSection = { name, order, text: string | ((ctx) => string), interpolate?, complete? }
```

返回 effect disposer，插件卸载时段落自动撤销。`order` 需为有限数，同一层内 `name` 不得重复。

DSH 的段落 order 表（`SECTION_ORDERS`）：`-1000` 身份 → `0` 人格前缀 → `500` plan 策略 → … → `9900` 结构化输出。**取 100**，落在 `0` 与 `500` 之间的空档，不撞任何现有段落。

### 服务与依赖

`ctx.systemPrompt` 需要硬依赖 `inject: ['systemPrompt']`。**缺了它 `apply` 根本不会执行**（fiber 停在 `PENDING`，不报错）。

`Config` 必须是 Standard Schema。DSH 用 schemastery，且已验证树外插件可以 `import z from '@deepseek-ai/schemastery'`（解析经 `$DSH_HOME/profiles/node_modules`）。

## 目录与文件

```
plugins/greeter/
├── package.json
├── cordis.patch.yml
├── index.js
├── README.md
└── test/contract.test.mjs
```

注意**没有 `dsh.client`、没有 `client.js`**——纯 Host 插件不需要浏览器半区。

---

# 阶段 1 · 最小骨架

**目标**：确认「装上了」。这一步不写任何逻辑。

## 1.1 `plugins/greeter/package.json`

```json
{
  "name": "@local/dsh-greeter",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "会话开始时问候的示例插件",
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

## 1.2 `plugins/greeter/cordis.patch.yml`

```yaml
# 本插件对 profile 的 patch 层：插入一行 Host 插件。
- insert:
    - id: greeter
      name: '@local/dsh-greeter'
```

**三个名字必须对得上**（阶段 5 会写成测试断言它们）：

| 位置 | 值 |
| --- | --- |
| 目录名 | `greeter` |
| 包名 | `@local/dsh-greeter` |
| 行 `id` | `greeter` |
| 行 `name` | `@local/dsh-greeter` |

## 1.3 `plugins/greeter/index.js`

```js
/** greeter —— 会话问候示例插件（Host 半区）。本阶段只验证链路，暂无逻辑。 */

export const name = 'greeter'

export function apply(ctx) {
  ctx.logger.info('[greeter] 已加载')
}
```

## 1.4 安装

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin/plugins/greeter
```

## 1.5 验证 ✅

**① 安装结果**：应返回 `"application": "applied"`，且 `enabled: true`。

**② 行进了 Loader**：

```
cordis_inspect_query platform=host provider=Config method=listConfigs input={"name":"@local/dsh-greeter"}
```

期望看到：

```json
{ "id": "include:greeter", "patchId": "greeter", "name": "@local/dsh-greeter", "status": "absent" }
```

`status: "absent"` 表示该行没有声明 Config schema——本阶段正常。

**③ 没有激活警告**：如果装完什么都没发生，DSH 只会往 stderr 写一行 `dsh: warning: 1 entry did not activate`，你在界面上看不到。所以**看到 ②** 才说明真的装上了。

<details>
<summary>卡住了？</summary>

- `ambiguous-install` → 同名包已存在。先 `remove_bundle @local/dsh-greeter` 再装。
- 装完 ② 查不到行 → 看 `dsh_plugin/plugins/greeter/package.json` 的 `dsh.bundle.patch` 路径对不对，`cordis.patch.yml` 是不是顶层 YAML **数组**。
- 一切正常但日志没输出 → 正常，见开头关于 stdout 的说明。

</details>

---

# 阶段 2 · 系统提示词段落（第一个可见成果）

**目标**：让模型能感知问候语。这是整个 demo 里**唯一能在 GUI 里直接验证**的产出。

## 2.1 改 `index.js`

```js
import z from '@deepseek-ai/schemastery'

export const name = 'greeter'

// 硬依赖：ctx.systemPrompt 需要它。
// 缺了这个服务，apply 根本不会执行（fiber 停在 PENDING，不抛错）。
export const inject = ['systemPrompt']

export const Config = z.object({
  greeting: z.string().default('你好'),
})

export function apply(ctx, config) {
  // section() 返回 effect disposer，插件卸载时段落自动撤销。
  // order 取 100：位于 DEPLOYMENT_PERSONA_PREFIX(0) 与 PLAN_POLICY(500) 之间的空档。
  ctx.systemPrompt.section({
    name: 'greeter',
    order: 100,
    text: `每次回答的开头先回一句「${config.greeting}」，然后再处理我的请求。`,
  })
}
```

## 2.2 重新安装

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin/plugins/greeter
```

## 2.3 验证 ✅

**新开一个会话**，随便问一句（比如「今天天气怎么样」）。

期望：模型回答的**开头出现「你好」**。

如果模型没照做，换个问法确认段落确实进去了：

> 你的系统提示词里有没有一条以「每次回答的开头先回一句」开头的段落？原样复述它。

期望：模型原样复述出你配置的问候语。

<details>
<summary>卡住了？</summary>

- 模型没反应 → 先确认 `inject` 里有 `systemPrompt`。漏了它 `apply` 不执行，而且**没有任何报错**。
- 段落没进提示词 → `name` 是否与别的段落重名？同层重名会抛错（这条是响的，会在激活警告里出现）。
- 想让改动立刻生效而不用重装 → `cordis.patch.yml` 是被 HMR 监视的，但**改代码需要重装**；改配置见阶段 4。

</details>

---

# 阶段 3 · 订阅会话开始事件

**目标**：学会事件订阅，以及 serial 事件的注意事项。

## 3.1 在 `apply` 里追加监听

```js
  // ── 会话开始 ──────────────────────────────────────────────────────
  // agent/created 是 serial 事件：监听器会被逐个 await，且
  // **抛错或 reject 会让 agent 创建失败、并跳过后续监听器**。
  // 所以这里自己兜住异常——问候出问题绝不该拖垮会话创建。
  ctx.on('agent/created', (payload) => {
    try {
      ctx.logger.info(
        `[greeter] 会话开始：${payload.agent.id}（来源：${payload.source}）`,
      )
    } catch (error) {
      ctx.logger.warn('[greeter] 写日志失败，已忽略', error)
    }
  })
```

## 3.2 验证 ✅

**诚实说明**：这一步的产出进 Host 日志，打包后的 Desktop 里看不到。它的价值是**示范语法**，以及为后面做真正的 per-session 副作用（预热缓存、写审计、给会话打标）打基础。

可验证的部分是**它没有把东西弄坏**：

1. 重装后**新开会话仍然正常**——模型照常回答，且开头仍有「你好」。
2. 如果会话创建失败，说明监听器抛了异常。这正是上面 `try/catch` 要防的。

想真看到日志，用开发模式启动（`pnpm run dev:desktop`），Host 的 stdout 会进终端。

<details>
<summary>这里最容易犯的错</summary>

- **写成 `async` 并且 await 了禁用的东西**。事件描述明确写了不得 await `agent.whenIdle()` 或自己 owner 的 disposal——会死锁。
- **不兜异常**。`serial` 的派发实现没有 try/catch，异常直接冒泡，代价是会话创建失败。

</details>

---

# 阶段 4 · 加配置

**目标**：学会配置链路——**bundle 提供行，profile 覆盖配置**。

## 4.1 扩 `Config`

```js
export const Config = z.object({
  greeting: z.string().default('你好'),
  logSessions: z.boolean().default(true),
})
```

## 4.2 在 profile 里覆盖

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`，**追加**一段（放在文件末尾即可）：

```yaml
- id: greeter
  config:
    greeting: '嗨，又见面了'
    logSessions: false
```

要点：

- 这是**覆盖**，不是合并——`config` 整段替换。没写的键会回到 schema 默认值。
- profile 的 patch 在所有 bundle 层**之后**应用，所以它能覆盖 bundle 里插入的行。
- `id` 要对上——这正是「行 id 是稳定身份」的用处。

## 4.3 验证 ✅

保存后**不必重装**：profile 的 patch 文件被 HMR 监视，组合会自动重组。

再开一个新会话，期望模型开头说的是**「嗨，又见面了」**。

如果没生效，重启应用一次再试。

<details>
<summary>为什么配置能热生效而代码不能</summary>

HMR 监视的是 profile 的 patch 文件与 manifest（`packages/boot/hmr`），配置变化触发 fiber 重启、段落按新配置重新注册。而**已安装包的 JS 代码需要重启进程**才能载入新的模块代——这是 Loader 的模块缓存决定的。

</details>

---

# 阶段 5 · 契约测试

**目标**：把「字符串假设」变成可执行断言。这是本仓库的硬要求，也是 DSH 插件唯一值得认真写测试的地方。

## 5.1 `plugins/greeter/test/contract.test.mjs`

```js
/**
 * 契约测试：把本插件对 DSH 的字符串假设对照权威源逐个校验。
 *
 * 为什么需要：事件名、服务名、段落名写错都不会报错，只会静默失效。
 *
 * 这是**文本级**检查（读源码正则提取），够用且零依赖。
 * 需要 DSH 源码，默认 ../deepseek-harness，可用 DSH_SOURCE 覆盖；
 * 源码不存在时该组用例显式跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH = process.env.DSH_SOURCE ?? '/Users/xdd/Code/project/self/deepseek-harness'

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
const source = await readFile(join(ROOT, 'index.js'), 'utf8')

const PLUGIN = 'greeter'

test('目录名 / 包名 / 行 id / 行 name 四者一致', () => {
  assert.equal(pkg.name, `@local/dsh-${PLUGIN}`)
  assert.match(patch, new RegExp(`id:\\s*${PLUGIN}\\b`), '行 id 不匹配目录名')
  assert.ok(patch.includes(`name: '${pkg.name}'`), '行 name 不等于包名')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
})

test('plugin 导出的 name 与目录名一致', () => {
  assert.match(source, new RegExp(`export const name = '${PLUGIN}'`))
})

test('没有 export default（会静默丢弃 inject/Config/name）', () => {
  assert.doesNotMatch(source, /export\s+default/, '函数插件绝不能有 default export')
})

test('订阅的每个事件名都存在于 DSH 源码', async (t) => {
  if (!existsSync(join(DSH, 'packages'))) {
    t.skip(`未找到 DSH 源码（${DSH}），设 DSH_SOURCE 可启用`)
    return
  }
  // 事件声明散落在各包的 declare module Events 里，全仓扫一遍
  const declared = new Set()
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.ts')) {
        const text = await readFile(full, 'utf8')
        for (const [, name] of text.matchAll(/^\s*'([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+)'\s*\(/gm)) {
          declared.add(name)
        }
      }
    }
  }
  await walk(join(DSH, 'packages'))

  const subscribed = [...source.matchAll(/ctx\.on\(\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(subscribed.length > 0, '没有提取到任何 ctx.on 订阅，检查写法')
  const unknown = subscribed.filter((name) => !declared.has(name))
  assert.deepEqual(unknown, [], `以下事件名在 DSH 中不存在，静默失效：\n  ${unknown.join('\n  ')}`)
})

test('段落 order 不与 DSH 的中心段落表冲突', async (t) => {
  if (!existsSync(join(DSH, 'packages'))) {
    t.skip(`未找到 DSH 源码（${DSH}）`)
    return
  }
  const registry = await readFile(
    join(DSH, 'packages/core/system-prompt/src/index.ts'),
    'utf8',
  )
  const block = /const SECTION_ORDERS = \{([\s\S]*?)\n\}/.exec(registry)
  assert.ok(block, '未能定位 SECTION_ORDERS')
  const used = [...block[1].matchAll(/:\s*(-?\d+)/g)].map((m) => Number(m[1]))

  const mine = [...source.matchAll(/order:\s*(-?\d+)/g)].map((m) => Number(m[1]))
  assert.ok(mine.length > 0, '没有提取到 order')
  for (const value of mine) {
    assert.ok(Number.isFinite(value), `order 必须是有限数，收到 ${value}`)
    assert.ok(!used.includes(value), `order ${value} 与 DSH 已有段落冲突，换一个空档`)
  }
})
```

## 5.2 跑测试

```bash
cd plugins/greeter
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
$NODE --test 'test/*.test.mjs'
```

期望：全部通过。

**顺手验证测试本身有效**：把 `index.js` 里的 `agent/created` 改成 `agent/createdX`，重跑——应该失败并指出这个名字不存在。**不会失败的测试没有价值。**

---

# 阶段 6 · README 与提交

## 6.1 `plugins/greeter/README.md`

写清四件事：这个插件做什么、怎么装、怎么配置、已知限制（比如日志在打包 Desktop 里不可见）。

## 6.2 提交前跑全仓门禁

```bash
cd /Users/xdd/Code/project/self/dsh_plugin
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
for d in plugins/*/; do
  (cd "$d" && $NODE --check index.js && $NODE --test 'test/*.test.mjs') \
    || { echo "门禁失败: $d"; exit 1; }
done
```

然后按本仓库的 commit 规范提交：`feat: 新增 greeter 示例插件`。

---

# 最终验证清单

全部做完后逐条确认：

- [ ] `plugin_manager` 返回 `application: applied`
- [ ] `include:greeter` 出现在 Host 的 Config 目录
- [ ] 新开会话，模型回答开头有问候语
- [ ] 改 `greeting` 配置后，问候语随之改变
- [ ] 契约测试全绿，且故意改错事件名能失败
- [ ] 停用 bundle 后问候语消失（验证 effect 撤销）
- [ ] 全仓门禁通过

最后一条尤其值得做：**停用后能干净地消失**，说明 `ctx.systemPrompt.section()` 返回的 disposer 被正确交给了 Cordis。

---

# 排错

| 症状 | 原因 |
| --- | --- |
| 装完什么都没发生 | 缺 Host 入口，或 `dsh.bundle.patch` 路径不对。**只写 stderr，界面看不到** → 用阶段 1 的 Config 目录检查法 |
| `apply` 完全没执行 | 声明的 `inject` 服务不存在 → fiber 停在 `PENDING`，不报错 |
| 段落没进提示词 | `inject` 里漏了 `systemPrompt`；或段落 `name` 与现有重名 |
| 会话创建失败 | `agent/created` 监听器抛了异常 → 必须自己兜住 |
| 改配置没生效 | 确认写的是 profile 的 `cordis.patch.yml` 且 `id` 对得上；仍不行就重启 |
| 改代码没生效 | 已安装包的 JS 需要重启进程才能换模块代 |
| 重装后插件消失了 | 移动过插件目录 → 客户端模块缓存按 specifier 缓存，重启才清 |

更全的「症状 → 原因」表见 [DSH 插件系统](../架构/dsh-插件系统.md) 第十二节。

---

# 做完之后可以往哪走

按兴趣选一条，都是在这个 demo 上长出来的：

1. **让它可见给人看** → 加浏览器半区：`dsh.client` + `client.js`，把问候渲染成一个 slot 组件。参考 `plugins/qoder-theme`。
2. **换成工具** → 把问候做成一个 `ctx.tools.register()` 的工具，模型可以主动调用。
3. **做成钩子** → `ctx.on('tools/pre-execute', ...)` 拦工具调用做审计（记得 `next()`）。
4. **做 per-session 的东西** → 在 `agent/created` 里用该会话的作用域注册（scope-local），而不是全局注册。

---

# 附录：改用 TypeScript

零构建的代价是没有类型。想写 TS 需要加一步编译：

1. 装 `typescript`，`index.ts` → `tsc` 产出 `index.js`（ESM）。
2. `package.json` 的 `exports["."]` 指向编译产物，`dsh.bundle.patch` 不变。
3. 加 `build` 脚本，并在提交前确保产物已更新。

DSH 的类型从 `@deepseek-ai/cordis` 等包来（`import type { Context } from '@deepseek-ai/cordis'`），并且大量使用 `declare module` 接口合并来给 `ctx` 和事件加类型：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent/created'(this: unknown, payload: {
      agent: { id: string }
      source: 'startup' | 'resume' | 'clear' | 'compact'
    }): undefined | Promise<undefined>
  }
}
```

**建议先把 JS 版跑通再加 TS。** 第一遍的目标是链路，不是类型——两件事一起学，出错时你分不清是链路问题还是编译问题。
