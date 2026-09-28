/**
 * Host 半区：接管 DSH 会话标题生成，输出 `MMDD｜类型｜主题`。
 *
 * 与 DSH 的接触面只有四个服务：`sessionTitle`（注册 provider）、`llm`（辅助
 * 模型调用）、`sessions`（补跑已有会话）、`workspaceRegistry`（可选，读归档
 * 集合）。不 import 任何 `@deepseek-ai/*`：从插件目录解析它们会 MODULE_NOT_FOUND，
 * 而服务调用不需要那些类型。所有形状假设由 test/contract.test.mjs 对照 DSH
 * 源码校验。
 *
 * 失败即保留原名：provider 抛错会被 sessionTitle 服务吞掉并保留它自己落的
 * fallback 标题（首条消息截断），这正是规则书里「无法判断主题时保留原名」的
 * 落地点——DSH 的 provider 契约要求返回非空标题，没有第二种表达方式。
 */
import { randomUUID } from 'node:crypto'

import {
  buildTitle,
  isEligibleSession,
  parseModelOutput,
  projectName,
  shanghaiMMDD,
} from './src/rule.js'
import { systemPrompt, userPrompt } from './src/prompt.js'

/** 插件导出的 name，只用于 fiber 诊断；行 id 与包名由 package.json 决定。 */
export const name = 'session-title-rule'

/** 硬依赖：缺任一个 apply 都不会执行（fiber 停在 PENDING，不报错）。 */
export const inject = ['sessionTitle', 'llm', 'sessions']

/** 记入标题来源的 provider 身份。 */
const PROVIDER_ID = 'session-title-rule'

/**
 * 自动生成节奏：只在首条用户消息后生成一次。
 *
 * `first-prompt` 的调度条件由服务决定——根会话、恰一条人工消息、且当前无标题
 * （session-title/src/index.ts:507-508），因此子会话天然不会被自动命名。
 */
const AUTOMATIC = 'first-prompt'

/** 主题汉字上限；配合 rule.js 的字节预算，保证整条标题不被服务静默截断。 */
const MAX_TOPIC_CHARS = 20

/** 一行标题的输出上限。 */
const MAX_OUTPUT_TOKENS = 64

/** 端到端超时，避免辅助调用拖住标题。 */
const TIMEOUT_MS = 30_000

/**
 * 注册唯一标题 provider，并给进程里已有的会话补跑一次。
 * @param ctx - 暴露 sessionTitle / llm / sessions 的上下文。
 */
export function apply(ctx) {
  // register() 的 disposer 建立在 sessionTitle 自己的 fiber 上；必须显式纳入
  // 本插件的 effect，否则插件停用后 provider 仍然占着槽位。
  ctx.effect(
    () => ctx.sessionTitle.register({
      id: PROVIDER_ID,
      automatic: AUTOMATIC,
      generate: request => generateTitle(ctx, request),
    }),
    'session-title-rule: register provider',
  )
  backfill(ctx)
}

/**
 * 为一条会话生成规则标题。
 * @param ctx - 暴露 llm 的上下文。
 * @param request - 服务给出的会话、消息快照、路由与取消信号。
 * @returns 标题、来源消息 seq，以及实际使用的模型路由。
 */
async function generateTitle(ctx, request) {
  const { session, messages, route } = request
  const header = session.header
  if (!isEligibleSession(header)) throw new Error('非主对话，保留原名')
  if (route === undefined) throw new Error('会话还没有模型路由，保留原名')
  if (messages.length === 0) throw new Error('没有可提炼的用户消息，保留原名')

  const mmdd = shanghaiMMDD(header.createdAt)
  if (mmdd === undefined) throw new Error('会话创建时间不可用，保留原名')

  const text = await callModel(ctx, request, {
    system: systemPrompt({
      maxTopicChars: MAX_TOPIC_CHARS,
      project: projectName(header.cwd),
    }),
    user: userPrompt({ messages }),
  })

  const parsed = parseModelOutput(text)
  if (parsed.kind === 'keep') throw new Error('模型判断不出主题（KEEP），保留原名')
  if (parsed.kind === 'invalid') throw new Error(`模型输出不合规：${parsed.reason}`)

  const title = buildTitle(mmdd, parsed.type, parsed.topic)
  if (title === undefined) throw new Error('主题被裁空，保留原名')

  return { title, messageSeqs: messages.map(message => message.seq), model: route }
}

/**
 * 发起一次辅助模型调用并拼回文本。
 *
 * 消息构造成**完整 Message**（id + role + content + source），与 DSH 内置标题
 * provider 的形状逐字一致。不用更新的 `RequestUserInput`（只带 role/content）：
 * 那个形状只在较新的 DSH 版本里存在，完整 Message 两版都接受。
 * @param ctx - 暴露 llm 的上下文。
 * @param request - 提供路由、会话 id 与取消信号。
 * @param prompts - system 与 user 文本。
 * @returns 模型输出的原始文本。
 */
async function callModel(ctx, request, prompts) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)])
  let text = ''
  let finish
  for await (const chunk of ctx.llm.stream({
    provider: request.route.provider,
    model: request.route.model,
    messages: [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompts.user }],
      source: { kind: 'plugin', plugin: PROVIDER_ID },
    }],
    system: prompts.system,
    maxTokens: MAX_OUTPUT_TOKENS,
    sessionId: request.session.id,
    purpose: 'session-title',
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish === undefined) throw new Error('模型流没有终止帧')
  if (finish.kind !== 'stop') {
    const detail = finish.kind === 'error' || finish.kind === 'aborted' ? `：${finish.failure.message}` : ''
    throw new Error(`模型未正常结束（${finish.kind}）${detail}`)
  }
  return text
}

/**
 * 给进程里已有的活跃会话补跑一次命名。
 *
 * 存在的理由：`first-prompt` 只在首条消息那一刻调度，历史会话的消息早就过去了，
 * 只有显式 `refresh()` 才能补上。
 *
 * 跳过三类会话，顺序即优先级：
 * 1. 非主对话——子会话与 subagent 一律不动；
 * 2. 已归档；
 * 3. 已经有标题且不该被覆盖的：用户显式改名（`user`），以及**本插件此前已命名**
 *    的（`provider` 且 provider id 是自己）。后者不可省：补跑每次插件加载都会执行，
 *    不认自己的成果就会在每次启动时重跑模型，标题还会随模型输出漂移。
 *    `fallback` 与本插件之外来源的标题仍要补——那正是要用规则标题替换的对象。
 * @param ctx - 暴露 sessions / sessionTitle / workspaceRegistry 的上下文。
 */
function backfill(ctx) {
  const archived = archivedSessionIds(ctx)
  for (const session of ctx.sessions.list()) {
    if (!isEligibleSession(session.header)) continue
    if (archived.has(session.id)) continue
    const source = ctx.sessionTitle.get(session)?.source
    if (source?.kind === 'user') continue
    if (source?.kind === 'provider' && source.provider === PROVIDER_ID) continue
    void ctx.sessionTitle.refresh(session).catch(error => {
      ctx.logger.warn(`session-title-rule: 会话 ${session.id} 未命名：${String(error)}`)
    })
  }
}

/**
 * 读已归档会话的 id 集合。
 *
 * `workspaceRegistry` 是可选服务；它的 `archivedSessionIds` 是 getter，state 尚未
 * 加载时会抛错。补跑是尽力而为，两种情况都按"没有归档"处理。
 * @param ctx - 上下文。
 * @returns 已归档会话 id 集合。
 */
function archivedSessionIds(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return new Set()
  try {
    const ids = registry.archivedSessionIds
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}
