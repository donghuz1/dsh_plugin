/**
 * 契约测试：把本插件对 DSH 的每一处字符串与形状假设变成可执行门禁。
 *
 * 存在的理由：DSH 里绝大多数错误是**静默**的。服务键名、provider 字段名、
 * `automatic` 取值、`purpose` 标记、消息形状、`archivedSessionIds` getter——
 * 任何一个写错都不会报错，只会让标题不生成或补跑不生效，而插件本身"看起来
 * 是好的"（fiber active）。这里逐个对照 DSH 源码校验。
 *
 * DSH 源码默认在 ../deepseek-harness，可用 DSH_SOURCE 覆盖。源码不在时相关
 * 用例显式跳过并说明，其余用例（命名一致性、产物同步、patch 语义）照常执行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import vm from 'node:vm'

import { MAX_TITLE_BYTES } from '../src/rule.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_SOURCE = process.env.DSH_SOURCE ?? '/Users/xdd/Code/project/self/deepseek-harness'
// 注意不能用 DSH_PROFILE：那是 DSH 自己的变量，值是 profile 名（如 "desktop"）而不是路径。
const PROFILE_FILE = process.env.DSH_PROFILE_FILE
  ?? join(process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop'), 'cordis.yml')

/** 本插件依赖的 DSH 权威源文件。 */
const SOURCES = {
  titleService: 'packages/session/session-title/src/index.ts',
  titleTypes: 'packages/session/session-title/src/types.ts',
  llmTypes: 'packages/llm/llm/src/types.ts',
  llmRuntime: 'packages/llm/llm/src/index.ts',
  sessions: 'packages/core/session/src/index.ts',
  sessionTypes: 'packages/core/session/src/types.ts',
  workspace: 'packages/workspace/workspace/src/index.ts',
}

const cache = new Map()

/** 读一份 DSH 源码；缺失时跳过当前用例并返回 undefined。 */
async function source(t, key) {
  const path = join(DSH_SOURCE, SOURCES[key])
  if (!existsSync(path)) {
    t.skip(`未找到 DSH 源码（${DSH_SOURCE}），跳过；设 DSH_SOURCE 指向 deepseek-harness 检出目录可启用`)
    return undefined
  }
  if (!cache.has(key)) cache.set(key, await readFile(path, 'utf8'))
  return cache.get(key)
}

/** 当前目录名——三处命名里的第一个。 */
const DIR_NAME = basename(ROOT)

test('目录名、包名、Loader 行 id 三处一致', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')

  assert.equal(pkg.name, `@local/dsh-${DIR_NAME}`, '包名必须是 @local/dsh-<目录名>')
  assert.ok(patch.includes(`id: ${DIR_NAME}`), `cordis.patch.yml 里应有 id: ${DIR_NAME}`)
  assert.ok(patch.includes(pkg.name), `cordis.patch.yml 里应有包名 ${pkg.name}`)
})

test('patch 层禁用内置 provider，并把本插件插进 Loader', async () => {
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')

  // sessionTitle 只接受一个 provider，重复注册抛错（见下一个用例）。不禁用内置
  // 行，本插件的 register() 会把 fiber 打失败——而且是唯一一种"响的"失败。
  assert.match(patch, /- id: session-title-llm\s*\n\s*disabled: true/,
    'patch 必须禁用内置的 session-title-llm 行')
  assert.match(patch, /- insert:/, 'patch 必须含 insert 段')
})

test('Host 入口是函数插件：有 apply、有 inject，且没有 export default', async () => {
  const host = await import('../index.js')

  // 事故 0001：一旦存在 export default，unwrapExports 会取默认导出，整个 ESM
  // 命名空间被丢弃，name/inject/Config 全部静默消失。
  assert.equal(host.default, undefined, '函数插件绝不能有 export default')
  assert.equal(typeof host.apply, 'function')
  assert.equal(host.name, 'session-title-rule')
  assert.deepEqual([...host.inject], ['sessionTitle', 'llm', 'sessions'])
})

test('package.json 声明了 Host 入口与浏览器半区', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

  assert.equal(pkg.exports['.'], './index.js', 'Host 入口必须能被 exports["."] 解析')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
})

test('client.js 的模块 id 等于包名，且与 src 模板逐字节同步', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const source = await readFile(join(ROOT, 'client.js'), 'utf8')
  let registered
  const sandbox = {
    window: { __ModuleLoader__: { load: definition => { registered = definition } } },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  assert.ok(registered, 'client.js 未调用 window.__ModuleLoader__.load')
  assert.equal(registered.id, pkg.name, 'load id 必须等于包名，否则静默不生效')

  const expected = (await readFile(join(ROOT, 'src', 'client.js'), 'utf8'))
    .replaceAll('__PLUGIN_ID__', pkg.name)
  assert.ok(source.includes(expected), 'client.js 与 src/client.js 不同步，请重新 build')
})

test('sessionTitle 服务键名与 provider 契约字段名', async (t) => {
  const src = await source(t, 'titleService')
  if (src === undefined) return

  assert.ok(src.includes("super(ctx, 'sessionTitle')"), '服务键名必须是 sessionTitle')
  for (const method of ['get(session', 'rename(session', 'refresh(session', 'register(provider']) {
    assert.ok(src.includes(method), `sessionTitle 服务缺少方法：${method}`)
  }
  assert.ok(src.includes("this.registration !== undefined"), '必须存在"已注册即抛错"的单一 provider 约束')
  assert.ok(src.includes('is already registered'), '重复注册的错误文本变了，重新确认槽位语义')
})

test('provider 必须返回非空 messageSeqs，且标题经服务归一化', async (t) => {
  const src = await source(t, 'titleService')
  if (src === undefined) return

  assert.ok(src.includes('candidate.messageSeqs.length === 0'),
    '服务会拒绝空 messageSeqs；结果必须带上来源消息 seq')
  assert.ok(src.includes('normalizeSessionTitle(candidate.title, this.config.maxTitleBytes)'),
    '服务会用 maxTitleBytes 归一化标题（超出即静默截断）')
})

test('automatic 的合法取值包含 first-prompt', async (t) => {
  const src = await source(t, 'titleService')
  if (src === undefined) return

  const declaration = /SessionTitleAutomaticMode = ([^\n]+)/.exec(src)
  assert.ok(declaration, '找不到 SessionTitleAutomaticMode 的声明')
  assert.ok(declaration[1].includes("'first-prompt'"),
    `automatic 取值变了：${declaration[1]}；本插件用的是 first-prompt`)
})

test('llm 服务暴露 stream(GenerateOptions)', async (t) => {
  const src = await source(t, 'llmTypes')
  if (src === undefined) return

  const options = /export interface GenerateOptions \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(options, '找不到 GenerateOptions 声明')
  for (const field of ['provider', 'model', 'reasoningEffort', 'messages', 'system', 'maxTokens', 'sessionId', 'purpose', 'signal']) {
    assert.ok(new RegExp(`\\b${field}\\??:`).test(options[1]), `GenerateOptions 缺少字段：${field}`)
  }
  assert.ok(options[1].includes("'session-title'"),
    'purpose 不再接受 session-title；辅助调用会被当成普通请求')
})

test('辅助调用使用无身份的 RequestUserInput（不伪造 Message id 与 source）', async (t) => {
  const src = await source(t, 'llmTypes')
  if (src === undefined) return

  const input = /export interface RequestUserInput \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(input, '找不到 RequestUserInput 声明；辅助调用的消息形状变了')
  assert.ok(input[1].includes("readonly role: 'user'"), 'RequestUserInput.role 变了')
  assert.ok(input[1].includes('readonly content:'), 'RequestUserInput.content 变了')
  assert.ok(input[1].includes('readonly id?: never'), 'RequestUserInput 不应要求 Message id')
  assert.ok(input[1].includes('readonly source?: never'), 'RequestUserInput 不应要求 Message source')

  assert.ok(/export type RequestMessage = Message \| RequestUserInput/.test(src),
    'GenerateOptions.messages 不再接受 RequestUserInput')
})

test('LlmRuntime 暴露 resolveModelInfo 与 prepareCall（能力解析 + 绑定派发）', async (t) => {
  const src = await source(t, 'llmRuntime')
  if (src === undefined) return

  assert.ok(/async resolveModelInfo\(\s*provider: string,\s*model: string,/.test(src),
    '找不到 LlmRuntime.resolveModelInfo(provider, model, signal)；无法查询推理档')
  assert.ok(/async prepareCall\(config: LlmCallConfig, signal\?: AbortSignal\)/.test(src),
    '找不到 LlmRuntime.prepareCall(config, signal)；能力解析与派发无法绑定到同一次注册')

  const prepared = /export interface PreparedLlmCall \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(prepared, '找不到 PreparedLlmCall 声明')
  assert.ok(prepared[1].includes('readonly config: LlmCallConfig'), 'PreparedLlmCall.config 变了')
  assert.ok(prepared[1].includes('stream(options: GenerateOptions)'), 'PreparedLlmCall.stream 签名变了')
})

test('模型能力暴露有序 reasoning efforts，插件取第一档作为最低档', async (t) => {
  const src = await source(t, 'llmTypes')
  if (src === undefined) return

  const reasoning = /export interface LlmModelReasoningInfo \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(reasoning, '找不到 LlmModelReasoningInfo 声明')
  assert.ok(reasoning[1].includes('efforts: readonly LlmReasoningEffortInfo[]'),
    'reasoning.efforts 的形状变了')
  assert.ok(reasoning[1].includes('defaultEffort?: ReasoningEffortId'),
    'reasoning.defaultEffort 的形状变了')

  const resolved = /export interface LlmResolvedModelInfo[^{]*\{([\s\S]*?)\n\}/.exec(src)
  assert.ok(resolved, '找不到 LlmResolvedModelInfo 声明')
  assert.ok(resolved[1].includes('reasoning?: LlmModelReasoningInfo'),
    'resolveModelInfo 不再返回 reasoning；插件无法选最低推理档')
})

test('finish 终止原因仍区分 stop / tool-calls / max-tokens', async (t) => {
  const src = await source(t, 'llmTypes')
  if (src === undefined) return

  for (const kind of ['stop', 'tool-calls', 'max-tokens']) {
    assert.ok(new RegExp(`'${kind}':\\s*\\{\\s*kind: '${kind}'`).test(src),
      `FinishReason 不再包含 ${kind}；非 stop 的失败处理要重新确认`)
  }
})

test('流式协议仍以 text-delta / finish 暴露文本与终止原因', async (t) => {
  const src = await source(t, 'llmTypes')
  if (src === undefined) return

  assert.ok(/type: 'text-delta';\s*index: number;\s*text: string/.test(src),
    'text-delta 形状变了')
  const finish = /type: 'finish'\s*\n\s*reason: FinishReason/.exec(src)
  assert.ok(finish, 'finish 帧不再带 reason: FinishReason')
  assert.ok(/'stop':\s*\{\s*kind:\s*'stop'\s*\}/.test(src), 'FinishReason 的 stop 判别式变了')
})

test('sessions 服务提供 list() 与 get()', async (t) => {
  const src = await source(t, 'sessions')
  if (src === undefined) return

  assert.ok(src.includes("super(ctx, 'sessions')"), '服务键名必须是 sessions')
  assert.ok(src.includes('list(): Session[]'), 'sessions.list() 的签名变了')
  assert.ok(/get\(id: SessionId\)/.test(src), 'sessions.get() 的签名变了')
})

test('SessionHeader 的字段名：createdAt / cwd / parentSession / origin', async (t) => {
  const src = await source(t, 'sessionTypes')
  if (src === undefined) return

  const header = /export interface SessionHeader \{([\s\S]*?)\n\}/.exec(src)
  assert.ok(header, '找不到 SessionHeader 声明')
  assert.ok(header[1].includes('readonly createdAt: number'), 'createdAt 是 MMDD 的唯一时间来源')
  assert.ok(header[1].includes('readonly cwd?: string'), 'cwd 用于取项目名')
  assert.ok(header[1].includes('readonly parentSession?: SessionId'), 'parentSession 用于判定非主对话')
  assert.ok(header[1].includes("readonly origin?: 'subagent'"), 'origin 用于判定 subagent 会话')
})

test('workspaceRegistry 暴露 archivedSessionIds 用于跳过归档会话', async (t) => {
  const src = await source(t, 'workspace')
  if (src === undefined) return

  assert.ok(/get archivedSessionIds\(\)/.test(src), '归档集合的读取方式变了；补跑会开始覆盖已归档会话')
  assert.ok(src.includes('archiveSession(sessionId: SessionId)'), 'archiveSession 签名变了')
})

test('标题字节预算不超过 profile 中 session-title 的 maxTitleBytes', async (t) => {
  if (!existsSync(PROFILE_FILE)) {
    t.skip(`未找到 profile（${PROFILE_FILE}），设 DSH_PROFILE_FILE 指向 profile 的 cordis.yml 可启用`)
    return
  }
  const yml = await readFile(PROFILE_FILE, 'utf8')
  const limit = /maxTitleBytes:\s*(\d+)/.exec(yml)
  if (limit === null) {
    t.skip('profile 里没有 maxTitleBytes（session-title 行未配置？）')
    return
  }
  assert.ok(MAX_TITLE_BYTES <= Number(limit[1]),
    `本插件按 ${MAX_TITLE_BYTES} 字节组标题，profile 只接受 ${limit[1]} 字节，超出会被静默截断`)
})
