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

/** 默认的模型能力：适配器按偏好顺序给出推理强度，第一档最低。 */
const DEFAULT_EFFORTS = [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }]

/** 造一个只暴露本插件所用成员的假 ctx。 */
function makeCtx(options = {}) {
  const state = {
    provider: undefined,
    disposed: false,
    infoCalls: [],
    preparedConfigs: [],
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
      async resolveModelInfo(provider, model, signal) {
        state.infoCalls.push({ provider, model, signal })
        if (options.resolveModelInfoError !== undefined) throw options.resolveModelInfoError
        return options.modelInfo ?? {
          provider,
          id: model,
          name: model,
          reasoning: { efforts: DEFAULT_EFFORTS },
        }
      },
      async prepareCall(config, signal) {
        state.preparedConfigs.push({ config, signal })
        return {
          config,
          stream(callOptions) {
            state.streamOptions.push(callOptions)
            return streamOf(options.chunks ?? [])
          },
        }
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

  assert.equal(state.infoCalls.length, 1, '必须先查询模型能力再选推理档')
  assert.deepEqual(
    { provider: state.infoCalls[0].provider, model: state.infoCalls[0].model },
    { provider: 'deepseek-official', model: 'deepseek-flash' },
  )

  assert.equal(state.preparedConfigs.length, 1, '必须用 prepareCall 绑定适配器注册')
  const { config, signal } = state.preparedConfigs[0]
  assert.equal(config.provider, 'deepseek-official')
  assert.equal(config.model, 'deepseek-flash')
  assert.equal(typeof config.maxTokens, 'number')
  assert.ok(signal instanceof AbortSignal, '必须把取消信号传给能力解析与准备阶段')

  assert.equal(state.streamOptions.length, 1)
  const options = state.streamOptions[0]
  assert.equal(options.provider, 'deepseek-official')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.purpose, 'session-title', '缺 purpose 会让辅助调用混进主循环请求')
  assert.equal(options.sessionId, 's1')
  assert.ok(options.signal instanceof AbortSignal, '必须把取消信号传下去')
  assert.equal(options.maxTokens, config.maxTokens, 'stream 的 call-config 必须与 prepared.config 一致')

  // 辅助调用不落会话日志，消息用无身份的 RequestUserInput，不伪造 Message id/source。
  assert.deepEqual(options.messages, [{
    role: 'user',
    content: [{ type: 'text', text: userPrompt({ messages: input.messages }) }],
  }])
})

test('显式选择模型支持的最低 reasoning 档，避免推理吃光输出预算', async () => {
  const { ctx, state } = makeCtx({
    modelInfo: {
      provider: 'deepseek-official',
      id: 'deepseek-flash',
      name: 'deepseek-flash',
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }] },
    },
    chunks: [{ type: 'text-delta', text: '功能｜测试' }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  apply(ctx)
  await state.provider.generate(request())

  assert.equal(state.preparedConfigs[0].config.reasoningEffort, 'off',
    '必须取 efforts[0]（适配器偏好顺序的最低档）；不传会落到连接默认的 high/max')
  assert.equal(state.streamOptions[0].reasoningEffort, 'off')
})

test('模型不暴露推理能力时不传 reasoningEffort，避免 UNSUPPORTED_REASONING_EFFORT', async () => {
  const { ctx, state } = makeCtx({
    modelInfo: { provider: 'deepseek-official', id: 'deepseek-flash', name: 'deepseek-flash' },
    chunks: [{ type: 'text-delta', text: '功能｜测试' }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  apply(ctx)
  await state.provider.generate(request())

  assert.equal('reasoningEffort' in state.preparedConfigs[0].config, false)
})

test('模型能力查询失败时降级为适配器默认值，不阻断标题生成', async () => {
  const { ctx, state } = makeCtx({
    resolveModelInfoError: new Error('adapter exploded'),
    chunks: [{ type: 'text-delta', text: '功能｜降级' }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  apply(ctx)
  const result = await state.provider.generate(request())

  assert.equal(result.title, '0928｜功能｜降级')
  assert.equal('reasoningEffort' in state.preparedConfigs[0].config, false)
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
