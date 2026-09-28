/**
 * 装配测试：用假 ctx 走真实的 apply / generate / 补跑路径。
 *
 * 存在的理由：provider 的注册形状、模型调用参数、返回结果形状、补跑该跳过谁，
 * 全是**静默失效**的——写错 `automatic`、漏掉 `messageSeqs`、把补跑写成覆盖用户
 * 改名，都不会有报错，只会让功能不生效。这里把每一条都变成断言。
 *
 * 假 ctx 只实现本插件真正用到的成员；任何多出来的依赖都会在此暴露。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../index.js'
import { userPrompt } from '../src/prompt.js'

/** 把 chunk 数组包成 llm.stream 需要的异步可迭代对象。 */
async function* streamOf(chunks) {
  for (const chunk of chunks) yield chunk
}

/** 造一个只暴露本插件所用成员的假 ctx。 */
function makeCtx(options = {}) {
  const state = {
    provider: undefined,
    disposed: false,
    streamOptions: [],
    effects: [],
    refreshed: [],
    warnings: [],
  }
  const conversations = options.sessions ?? []

  const ctx = {
    effect(fn, label) {
      const disposer = fn()
      state.effects.push({ label, disposer })
      return disposer
    },
    sessionTitle: {
      register(provider) {
        state.provider = provider
        return () => {
          state.disposed = true
          state.provider = undefined
        }
      },
      get: session => (options.titles ?? new Map()).get(session.id),
      async refresh(session) {
        state.refreshed.push(session.id)
        return undefined
      },
    },
    llm: {
      stream(callOptions) {
        state.streamOptions.push(callOptions)
        return streamOf(options.chunks ?? [])
      },
    },
    sessions: { list: () => conversations },
    logger: { warn: message => state.warnings.push(message) },
    get(name) {
      if (name !== 'workspaceRegistry') return undefined
      return options.workspaceRegistry ?? { archivedSessionIds: options.archived ?? [] }
    },
  }

  return { ctx, state }
}

/** 造一个符合 Session 表面形状的假会话。 */
function session(id, overrides = {}) {
  return {
    id,
    header: { id, createdAt: Date.UTC(2026, 8, 28, 2, 0, 0), cwd: '/Users/xdd/Code/project/self/dsh_plugin', ...overrides },
  }
}

/** 一次正常生成的输入。 */
function request(overrides = {}) {
  return {
    session: session('s1'),
    messages: [{ seq: 1, text: '写一个插件，会话标题按 MMDD｜类型｜主题 生成' }],
    route: { provider: 'deepseek-official', model: 'deepseek-flash' },
    signal: new AbortController().signal,
    ...overrides,
  }
}

test('apply 注册的 provider 形状符合 sessionTitle 契约', () => {
  const { ctx, state } = makeCtx()
  apply(ctx)

  assert.equal(state.provider.id, 'session-title-rule')
  assert.equal(state.provider.automatic, 'first-prompt')
  assert.equal(typeof state.provider.generate, 'function')
})

test('注册的 disposer 被纳入本插件的 effect，停用插件即注销', () => {
  const { ctx, state } = makeCtx()
  apply(ctx)

  const registration = state.effects.find(entry => entry.label.includes('register provider'))
  assert.ok(registration, 'apply 未通过 ctx.effect 持有 register() 的 disposer')
  assert.equal(typeof registration.disposer, 'function')

  registration.disposer()
  assert.equal(state.disposed, true)
  assert.equal(state.provider, undefined)
})

test('生成成功时返回规则标题、来源 seq 与实际使用的模型路由', async () => {
  const { ctx, state } = makeCtx({
    chunks: [
      { type: 'text-delta', text: '功能｜' },
      { type: 'text-delta', text: '新增会话标题插件' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  apply(ctx)
  const result = await state.provider.generate(request())

  assert.equal(result.title, '0928｜功能｜新增会话标题插件')
  assert.deepEqual(result.messageSeqs, [1])
  assert.deepEqual(result.model, { provider: 'deepseek-official', model: 'deepseek-flash' })
})

test('模型调用带上辅助调用标记、会话 id 与取消信号', async () => {
  const { ctx, state } = makeCtx({
    chunks: [
      { type: 'text-delta', text: '优化｜重构解析层' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  apply(ctx)
  const input = request()
  await state.provider.generate(input)

  assert.equal(state.streamOptions.length, 1)
  const options = state.streamOptions[0]
  assert.equal(options.provider, 'deepseek-official')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.purpose, 'session-title', '缺 purpose 会让辅助调用混进主循环请求')
  assert.equal(options.sessionId, 's1')
  assert.ok(options.signal instanceof AbortSignal, '必须把取消信号传下去')
  assert.equal(typeof options.maxTokens, 'number')

  // 消息必须是完整 Message 形状（含 id 与 source），与 DSH 内置标题 provider 一致。
  assert.equal(options.messages.length, 1)
  const [message] = options.messages
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0, 'Message.id 不能为空')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'session-title-rule' })
  assert.deepEqual(message.content, [{ type: 'text', text: userPrompt({ messages: input.messages }) }])
})

test('system 提示词列出全部八个类型，并要求不重复项目名', async () => {
  const { ctx, state } = makeCtx({
    chunks: [{ type: 'finish', reason: { kind: 'stop' } }],
  })
  apply(ctx)
  await state.provider.generate(request()).catch(() => {})

  const system = state.streamOptions[0].system
  for (const type of ['功能', '设计', '修复', '优化', '发布', '探索', '文档', '研究']) {
    assert.ok(system.includes(type), `system 提示词缺类型：${type}`)
  }
  assert.ok(system.includes('dsh_plugin'), 'system 提示词应告知项目名，以免主题重复它')
  assert.ok(system.includes('KEEP'), 'system 提示词应给出判断不出主题时的哨兵值')
})

test('模型判断不出主题（KEEP）时抛错，交给服务保留原名', async () => {
  const { ctx, state } = makeCtx({ chunks: [{ type: 'text-delta', text: 'KEEP' }, { type: 'finish', reason: { kind: 'stop' } }] })
  apply(ctx)
  await assert.rejects(() => state.provider.generate(request()), /保留原名/)
})

test('模型类型不合规时抛错，不猜测', async () => {
  const { ctx, state } = makeCtx({
    chunks: [{ type: 'text-delta', text: '开发｜随便写点什么' }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  apply(ctx)
  await assert.rejects(() => state.provider.generate(request()), /输出不合规/)
})

test('模型流出现 error 终止帧时抛错', async () => {
  const { ctx, state } = makeCtx({
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '额度不足', code: 'quota' } } }],
  })
  apply(ctx)
  await assert.rejects(() => state.provider.generate(request()), /额度不足/)
})

test('子会话直接跳过，且不发起模型调用', async () => {
  const { ctx, state } = makeCtx()
  apply(ctx)
  await assert.rejects(
    () => state.provider.generate(request({ session: session('child', { parentSession: 'parent' }) })),
    /非主对话/,
  )
  assert.equal(state.streamOptions.length, 0, '子会话不该消耗一次模型调用')
})

test('没有模型路由时不猜测，直接抛错保留原名', async () => {
  const { ctx, state } = makeCtx()
  apply(ctx)
  await assert.rejects(() => state.provider.generate(request({ route: undefined })), /保留原名/)
})

test('补跑只刷新还没有规则标题的会话', () => {
  const fallback = session('fallback')
  const legacy = session('legacy')
  const named = session('named')
  const pinned = session('pinned')
  const { ctx, state } = makeCtx({
    sessions: [session('plain'), fallback, legacy, named, pinned],
    titles: new Map([
      // DSH 落的 fallback（首条消息截断）——正是要用规则标题替换的对象。
      [fallback.id, { source: { kind: 'fallback' } }],
      // 别的 provider 命名的（如内置 provider 的英文标题）——同样该被替换。
      [legacy.id, { source: { kind: 'provider', provider: 'session-title-first-prompt-llm' } }],
      // 本插件此前已命名——不重跑，否则每次启动都白跑一遍模型，标题还会漂移。
      [named.id, { source: { kind: 'provider', provider: 'session-title-rule' } }],
      // 用户显式改名——不动。
      [pinned.id, { source: { kind: 'user' } }],
    ]),
  })
  apply(ctx)

  assert.deepEqual(state.refreshed, ['plain', 'fallback', 'legacy'])
})

test('补跑跳过非主对话与已归档会话', () => {
  const child = session('child', { parentSession: 'root' })
  const subagent = session('subagent', { origin: 'subagent' })
  const archivedSession = session('archived')
  const { ctx, state } = makeCtx({
    sessions: [session('plain'), child, subagent, archivedSession],
    archived: ['archived'],
  })
  apply(ctx)

  assert.deepEqual(state.refreshed, ['plain'])
})

test('workspaceRegistry 缺席时补跑照常进行（归档集合按空处理）', () => {
  const { ctx, state } = makeCtx({ sessions: [session('plain')], workspaceRegistry: undefined })
  const originalGet = ctx.get
  ctx.get = name => (name === 'workspaceRegistry' ? undefined : originalGet(name))
  apply(ctx)

  assert.deepEqual(state.refreshed, ['plain'])
})

test('补跑失败只记警告，不影响插件本身', async () => {
  const failing = session('failing')
  const { ctx, state } = makeCtx({ sessions: [failing] })
  ctx.sessionTitle.refresh = async () => { throw new Error('storage down') }
  apply(ctx)
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(state.warnings.length, 1)
  assert.match(state.warnings[0], /failing/)
})
