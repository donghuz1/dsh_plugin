/**
 * 装配测试：在 VM 里跑真实的 `client.js` 产物。
 *
 * 存在的理由：通知去重、完成抑制、权限分支、点击跳会话、卸载释放，全是
 * **静默失效**的——写错 `kind`、漏掉 `key`、把 `running` 方向写反、忘记
 * `ctx.effect`，都不会报错，只会让提醒该响时不响或反复响。这里把每一条
 * 变成断言，并直接执行构建产物而不是源码副本。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = await readFile(join(ROOT, 'client.js'), 'utf8')

/** 按 `{name}` 占位符插值，模拟 DSH locale 的 Translate。 */
function interpolate(template, params) {
  if (typeof template !== 'string') return ''
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    params !== undefined && Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match
  ))
}

/** 一份可控的 Notification 假实现；构造出的每条实例都留在 state.instances。 */
function notificationClass(state) {
  return class FakeNotification {
    static permission = state.permission ?? 'granted'

    static requestPermission() {
      state.requests += 1
      if (state.requestThrows === true) throw new Error('permission unavailable')
      return Promise.resolve(state.requestResult ?? 'granted')
    }

    constructor(title, options) {
      this.title = title
      this.body = options?.body
      this.closed = false
      this.onclick = undefined
      state.instances.push(this)
    }

    close() {
      this.closed = true
    }
  }
}

/** 把 client.js 装进新的 VM 上下文，返回其工厂。 */
function loadFactory(notificationState, options = {}) {
  const entries = []
  const sandbox = {
    window: {
      __ModuleLoader__: { load: entry => entries.push(entry) },
      focus() { options.focusCalls?.push(1) },
    },
    console,
  }
  if (options.document !== null) {
    sandbox.document = options.document ?? { visibilityState: 'visible', hasFocus: () => true }
  }
  if (options.noNotification !== true) sandbox.Notification = notificationClass(notificationState)
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.equal(entries.length, 1, 'client.js 必须注册且只注册一个插件工厂')
  return entries[0].factory
}

const flush = () => new Promise(resolve => setImmediate(resolve))

/**
 * 造一个只实现本插件所用成员的假 ctx，并完成 apply。
 * @param options - rows/currentSession/permission/document/noNotification/noWorkspace 等测试开关。
 */
async function harness(options = {}) {
  const listeners = new Set()
  let snapshot = new Map()
  const effects = []
  const notifications = { permission: options.permission ?? 'granted', instances: [], requests: 0, requestResult: options.requestResult, requestThrows: options.requestThrows }
  const localeRegistrations = []
  const focusCalls = []
  const opened = []
  const rows = options.rows ?? {}

  const locale = {
    register(ns, value) {
      localeRegistrations.push({ ns, value })
      return () => {}
    },
    bind(ns) {
      const dict = localeRegistrations.find(entry => entry.ns === ns)?.value.zh ?? {}
      return (key, params) => interpolate(dict[key], params)
    },
  }

  const ctx = {
    effect(fn, label) {
      const disposer = fn()
      effects.push({ label, disposer })
      return disposer
    },
    get(name) {
      if (name !== 'uiWorkspace' || options.noWorkspace === true) return undefined
      return { openSession: sessionId => opened.push(sessionId) }
    },
    locale,
    sessions: {
      list: { getSnapshot: () => ({ byId: rows }) },
    },
    uiSession: {
      adapter: { current: { value: options.currentSession === undefined ? {} : { key: options.currentSession } } },
      sessionStatus: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  }

  const factory = loadFactory(notifications, {
    document: options.document,
    noNotification: options.noNotification,
    focusCalls,
  })
  const plugin = factory()
  plugin.apply(ctx)

  return {
    plugin,
    notifications,
    localeRegistrations,
    focusCalls,
    opened,
    effects,
    publish(next) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    dispose() {
      for (const effect of effects) effect.disposer?.()
    },
  }
}

/** 构造一份 sessionStatus 快照。 */
function statusMap(entries) {
  return new Map(Object.entries(entries))
}

test('插件导出形状：name / inject / 只在 apply 里注册', async () => {
  const h = await harness()
  assert.equal(h.plugin.name, 'session-notify')
  assert.deepEqual([...h.plugin.inject], ['uiSession', 'sessions', 'locale'])
  const dict = h.localeRegistrations.find(entry => entry.ns === 'sessionNotify')
  assert.ok(dict, '必须注册 sessionNotify 字典')
  for (const key of [
    'approvalTitle', 'approvalBody', 'questionTitle', 'questionBody', 'questionMore',
    'planReviewTitle', 'planReviewBody', 'interactionTitle', 'interactionBody',
    'completionTitle', 'completionBody', 'reasonLine', 'sessionLine', 'sessionFallback',
  ]) {
    assert.ok(dict.value.zh[key], `中文缺 ${key}`)
    assert.ok(dict.value.en[key], `英文缺 ${key}`)
  }
})

test('审批：每个 key 只弹一次，正文含工具、会话标题与原因', async () => {
  const h = await harness({ rows: { s1: { title: '修复登录' } }, currentSession: 's2' })
  const pending = { kind: 'approval', key: 'approval:1', toolName: 'bash', reason: 'escalate sandbox' }
  h.publish(statusMap({ s1: { running: false, pendingInteraction: pending } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  const [notification] = h.notifications.instances
  assert.equal(notification.title, '需要审批')
  assert.match(notification.body, /bash/)
  assert.match(notification.body, /修复登录/)
  assert.match(notification.body, /escalate sandbox/)

  h.publish(statusMap({ s1: { running: false, pendingInteraction: { ...pending } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1, '同一个 key 不得重复提醒')

  h.publish(statusMap({ s1: { running: false, pendingInteraction: { ...pending, key: 'approval:2' } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 2, '新审批必须再次提醒')
})

test('提问：question pending 也弹，正文含首个问题与会话标题', async () => {
  const h = await harness({ rows: { s1: { title: '登录方案' } }, currentSession: 's2' })
  const pending = {
    kind: 'question',
    key: 'question:1',
    questions: [{ id: 'q1', question: '选 A 还是 B？' }, { id: 'q2', question: '要不要保留旧接口？' }],
  }
  h.publish(statusMap({ s1: { running: false, pendingInteraction: pending } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  assert.equal(h.notifications.instances[0].title, '需要你的回答')
  assert.match(h.notifications.instances[0].body, /选 A 还是 B？/)
  assert.match(h.notifications.instances[0].body, /另有 1 个问题/)
  assert.match(h.notifications.instances[0].body, /登录方案/)

  h.publish(statusMap({ s1: { running: false, pendingInteraction: { ...pending } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1, '同一个 key 不得重复提醒')
})

test('计划确认：plan-review pending 也弹', async () => {
  const h = await harness({ rows: { s1: { title: '重构计划' } }, currentSession: 's2' })
  const pending = {
    kind: 'plan-review',
    key: 'question:2',
    questions: [{ id: 'q', question: '批准这份计划吗？', detail: '# 计划' }],
  }
  h.publish(statusMap({ s1: { running: false, pendingInteraction: pending } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  assert.equal(h.notifications.instances[0].title, '计划等待确认')
  assert.match(h.notifications.instances[0].body, /重构计划/)
})

test('未知 pending kind 用通用文案提醒，不漏', async () => {
  const h = await harness({ rows: { s1: { title: '任务' } }, currentSession: 's2' })
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'team-task', key: 'team:1' } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  assert.equal(h.notifications.instances[0].title, '需要你的操作')
})

test('pending：当前会话可见且聚焦时不弹，隐藏/失焦时照常弹', async () => {
  const focused = await harness({
    rows: { s1: { title: '当前会话' } },
    currentSession: 's1',
    document: { visibilityState: 'visible', hasFocus: () => true },
  })
  focused.publish(statusMap({
    s1: { running: false, pendingInteraction: { kind: 'question', key: 'question:1', questions: [{ question: '继续吗？' }] } },
  }))
  await flush()
  assert.equal(focused.notifications.instances.length, 0, '提问：看着当前会话时不弹')

  focused.publish(statusMap({
    s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:9', toolName: 'bash' } },
  }))
  await flush()
  assert.equal(focused.notifications.instances.length, 0, '审批：看着当前会话时也不弹')

  const hidden = await harness({
    rows: { s1: { title: '当前会话' } },
    currentSession: 's1',
    document: { visibilityState: 'hidden', hasFocus: () => true },
  })
  hidden.publish(statusMap({
    s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } },
  }))
  await flush()
  assert.equal(hidden.notifications.instances.length, 1)
})

test('审批：reason 截断到 200 码点', async () => {
  const h = await harness({ rows: { s1: { title: 't' } } })
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash', reason: 'x'.repeat(500) } } }))
  await flush()
  assert.ok(h.notifications.instances[0].body.includes('x'.repeat(200) + '…'))
  assert.ok(!h.notifications.instances[0].body.includes('x'.repeat(201)))
})

test('审批：标题缺失时回落到短 session id', async () => {
  const h = await harness()
  h.publish(statusMap({ 'abcdefgh-1234': { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  assert.match(h.notifications.instances[0].body, /会话 abcdefgh/)
})

test('一轮结束：根会话 running true→false 弹一次', async () => {
  const h = await harness({ rows: { s1: { title: '长任务' } }, currentSession: 's2' })
  h.publish(statusMap({ s1: { running: true } }))
  await flush()
  assert.equal(h.notifications.instances.length, 0, '运行开始不弹')

  h.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  assert.equal(h.notifications.instances[0].title, '本轮已结束')
  assert.match(h.notifications.instances[0].body, /长任务/)

  h.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1, '持续空闲不得重复提醒')
})

test('完成：首帧就是 false 时不补发', async () => {
  const h = await harness({ rows: { s1: { title: '旧会话' } } })
  h.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(h.notifications.instances.length, 0)
})

test('完成：subagent 子会话不弹', async () => {
  const subagent = await harness({ rows: { child: { title: '子会话', origin: 'subagent' } } })
  subagent.publish(statusMap({ child: { running: true } }))
  subagent.publish(statusMap({ child: { running: false } }))
  await flush()
  assert.equal(subagent.notifications.instances.length, 0)

  const child = await harness({ rows: { child: { title: '子会话', parentSessionId: 'parent' } } })
  child.publish(statusMap({ child: { running: true } }))
  child.publish(statusMap({ child: { running: false } }))
  await flush()
  assert.equal(child.notifications.instances.length, 0)
})

test('完成：当前会话聚焦/可见时抑制，隐藏或失焦时提醒', async () => {
  const focused = await harness({
    rows: { s1: { title: '当前会话' } },
    currentSession: 's1',
    document: { visibilityState: 'visible', hasFocus: () => true },
  })
  focused.publish(statusMap({ s1: { running: true } }))
  focused.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(focused.notifications.instances.length, 0)

  const hidden = await harness({
    rows: { s1: { title: '当前会话' } },
    currentSession: 's1',
    document: { visibilityState: 'hidden', hasFocus: () => true },
  })
  hidden.publish(statusMap({ s1: { running: true } }))
  hidden.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(hidden.notifications.instances.length, 1)

  const blurred = await harness({
    rows: { s1: { title: '当前会话' } },
    currentSession: 's1',
    document: { visibilityState: 'visible', hasFocus: () => false },
  })
  blurred.publish(statusMap({ s1: { running: true } }))
  blurred.publish(statusMap({ s1: { running: false } }))
  await flush()
  assert.equal(blurred.notifications.instances.length, 1)
})

test('点击通知：聚焦窗口并打开对应会话', async () => {
  const h = await harness({ rows: { s1: { title: '会话' } } })
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'edit' } } }))
  await flush()
  const notification = h.notifications.instances[0]
  notification.onclick()
  assert.equal(h.focusCalls.length, 1)
  assert.deepEqual(h.opened, ['s1'])
  assert.equal(notification.closed, true)
})

test('点击通知：uiWorkspace 缺失时只聚焦', async () => {
  const h = await harness({ rows: { s1: { title: '会话' } }, noWorkspace: true })
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'edit' } } }))
  await flush()
  h.notifications.instances[0].onclick()
  assert.equal(h.focusCalls.length, 1)
})

test('权限：denied 静默；default 只请求一次；API 缺失不抛', async () => {
  const denied = await harness({ rows: { s1: { title: 't' } }, permission: 'denied' })
  denied.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  assert.equal(denied.notifications.instances.length, 0)
  assert.equal(denied.notifications.requests, 0)

  const prompt = await harness({
    rows: { s1: { title: 't' } },
    permission: 'default',
    requestResult: 'default',
  })
  prompt.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  prompt.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:2', toolName: 'bash' } } }))
  await flush()
  assert.equal(prompt.notifications.instances.length, 0)
  assert.equal(prompt.notifications.requests, 1, '权限只请求一次')

  const missing = await harness({ rows: { s1: { title: 't' } }, noNotification: true })
  missing.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  assert.equal(missing.notifications.instances.length, 0)

  const throwing = await harness({ rows: { s1: { title: 't' } }, permission: 'default', requestThrows: true })
  throwing.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  assert.equal(throwing.notifications.instances.length, 0)
})

test('卸载：取消订阅后不再提醒', async () => {
  const h = await harness({ rows: { s1: { title: 't' } } })
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash' } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
  h.dispose()
  h.publish(statusMap({ s1: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:2', toolName: 'bash' } } }))
  await flush()
  assert.equal(h.notifications.instances.length, 1)
})
