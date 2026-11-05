/**
 * 装配测试：在 VM 里跑真实的 `client.js` 产物。
 *
 * 存在理由：侧栏席位名、locale 键、store 的自动展开、行点击跳转，全是
 * **静默失效**的——写错 slot id 只是这一行不出现，写错 openSession 只是点击
 * 没反应，构建期断言覆盖不到。这里用一个够用的假 React（createElement 建树、
 * 延迟执行 effect）直接调用注册进去的组件，把行为变成断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = await readFile(join(ROOT, 'client.js'), 'utf8')
const DEFAULT_OPEN_KEY = 'dsh.session-activity.default-open'

/** 按 `{name}` 占位符插值，模拟 locale 的 Translate。 */
function interpolate(template, params) {
  if (typeof template !== 'string') return ''
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    params !== undefined && Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match
  ))
}

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 假 localStorage：同时提供原生名与模型适配器用的短名。 */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  const storage = {
    values,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) },
    get: key => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
  }
  return storage
}

/**
 * 假 React：createElement 建普通对象树，hook 状态只活在单次渲染里。
 * effect 推迟到组件返回后执行，这样 `ref` 已经指向树节点，和真实 React 的顺序一致。
 */
function fakeReact(button) {
  let hooks = []
  let index = 0
  let pending = []
  return {
    createElement(type, props, ...children) {
      const element = {
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false),
      }
      element.contains = node => node === element || element.children.some(child =>
        child === node || (typeof child === 'object' && child !== null && typeof child.contains === 'function' && child.contains(node)))
      if (props !== undefined && props !== null && props.ref !== undefined && props.ref !== null) {
        props.ref.current = element
        element.closest = selector => (selector === 'button' ? button : null)
      }
      return element
    },
    useState(initial) {
      const slot = index
      index += 1
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next }]
    },
    useRef(initial) {
      const slot = index
      index += 1
      if (!(slot in hooks)) hooks[slot] = { current: initial === undefined ? null : initial }
      return hooks[slot]
    },
    useEffect(effect) { pending.push(effect) },
    useMemo(factory) { return factory() },
    begin() { hooks = []; index = 0; pending = [] },
    flush() {
      const cleanups = []
      for (const effect of pending) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      pending = []
      return cleanups
    },
  }
}

function createButton(onRootClick) {
  const button = {
    attributes: {},
    listeners: new Map(),
    focused: false,
    isConnected: true,
    rect: { top: 120, right: 248, bottom: 152, left: 8, width: 240, height: 32 },
    focus() { button.focused = true },
    addEventListener(type, listener) {
      const list = button.listeners.get(type) ?? []
      button.listeners.set(type, [...list, listener])
    },
    removeEventListener(type, listener) {
      button.listeners.set(type, (button.listeners.get(type) ?? []).filter(item => item !== listener))
    },
    setAttribute(name, value) { button.attributes[name] = String(value) },
    removeAttribute(name) { delete button.attributes[name] },
    getBoundingClientRect() { return { ...button.rect } },
    click() {
      const event = {
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { event.defaultPrevented = true },
        stopPropagation() { event.propagationStopped = true },
      }
      for (const listener of [...(button.listeners.get('click') ?? [])]) listener(event)
      // 模拟 React 17+ 在根容器上的委托监听：被 stopPropagation 拦住就收不到。
      if (!event.propagationStopped && typeof onRootClick === 'function') onRootClick()
      return event
    },
  }
  return button
}

function fakeDocument() {
  const appended = []
  const listeners = new Map()
  return {
    appended,
    listeners,
    body: {},
    head: { appendChild(node) { appended.push(node) } },
    createElement(tag) {
      return {
        tag,
        dataset: {},
        style: {},
        textContent: '',
        removed: false,
        remove() { this.removed = true },
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener))
    },
  }
}

/** 取最近一次注册的某类 document 监听器。 */
function lastListener(document, type) {
  const list = document.listeners.get(type) ?? []
  return list[list.length - 1]
}

function listOf(rows) {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready',
  }
}

function sessionRow(id, patch = {}) {
  return { id, title: `会话 ${id}`, blank: false, running: false, updatedAt: 1000, ...patch }
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (typeof node !== 'object') {
    visit(node)
    return
  }
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function byClass(tree, className) {
  const found = []
  walk(tree, node => {
    if (typeof node !== 'object') return
    const value = node.props?.className
    if (typeof value === 'string' && value.split(/\s+/).includes(className)) found.push(node)
  })
  return found
}

function textOf(node) {
  let text = ''
  walk(node, item => { if (typeof item === 'string') text += item })
  return text
}

/**
 * 造一个只实现本插件所用成员的假 ctx，并完成 apply。
 * @param options - `rows`/`statuses`/`currentId`/`stored` 等测试开关。
 */
function harness(options = {}) {
  const root = { clicks: 0 }
  const button = createButton(() => { root.clicks += 1 })
  const react = fakeReact(button)
  const reactDom = {
    createPortal(children, container) {
      return {
        type: 'portal',
        props: { container },
        children: [children],
        contains: node => children === node || (typeof children.contains === 'function' && children.contains(node)),
      }
    },
  }
  const document = fakeDocument()
  const storage = memoryStorage(options.stored ?? {})
  const sessionsList = observable(options.list ?? listOf(options.rows ?? []))
  const statuses = observable(options.statuses ?? new Map())
  const current = observable({ key: options.currentId })
  const localeState = observable({ active: 'zh', locales: [], revision: 0 })
  const state = { registrations: [], dictionaries: [], effects: [], opened: [], selectedPanels: [] }
  const entries = []

  const ctx = {
    get(name) {
      if (name === 'layout') return { selectPanel: id => state.selectedPanels.push(id) }
      return undefined
    },
    effect(callback, label) {
      const dispose = callback()
      state.effects.push({ label, dispose })
      return dispose
    },
    locale: {
      register(ns, dicts) {
        state.dictionaries.push({ ns, dicts })
        return () => {}
      },
      bind(ns) {
        const dicts = state.dictionaries.find(entry => entry.ns === ns)?.dicts ?? {}
        return (key, params) => interpolate(dicts.zh?.[key], params)
      },
      getSnapshot: localeState.getSnapshot,
      subscribe: localeState.subscribe,
    },
    slots: {
      register(registration, component) {
        const record = { options: registration, component, disposed: false }
        state.registrations.push(record)
        return () => { record.disposed = true }
      },
      inject(key, callback) {
        const dispose = callback()
        state.effects.push({ label: `slots.inject(${key})`, dispose })
        return dispose
      },
    },
    sessions: { list: sessionsList },
    uiSession: { sessionStatus: statuses, adapter: { current } },
    uiWorkspace: {
      openSession(sessionId) { state.opened.push(sessionId) },
    },
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load: entry => entries.push(entry) },
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener() {},
      removeEventListener() {},
    },
    document,
    localStorage: storage,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.equal(entries.length, 1, 'client.js 必须注册且只注册一个插件工厂')
  const plugin = entries[0].factory(name => {
    if (name === 'react') return react
    if (name === 'react-dom') return reactDom
    throw new Error(`未预期的平台模块：${name}`)
  })
  plugin.apply(ctx)

  const views = {
    trigger: { cleanups: [], render() {
      for (const cleanup of views.trigger.cleanups) cleanup()
      react.begin()
      const tree = registrationOf(state, 'sidebar.panellist').component({ size: 16 })
      views.trigger.cleanups = react.flush()
      return tree
    } },
    flyout: { cleanups: [], render() {
      for (const cleanup of views.flyout.cleanups) cleanup()
      react.begin()
      const tree = registrationOf(state, 'shell.overlay').component({})
      views.flyout.cleanups = react.flush()
      return tree
    } },
  }

  return {
    state,
    button,
    root,
    document,
    storage,
    plugin,
    react,
    statuses,
    current,
    views,
    publish(rows, statusMap, currentId) {
      sessionsList.publish(listOf(rows))
      statuses.publish(statusMap ?? new Map())
      current.publish({ key: currentId })
    },
    dispose() {
      for (const effect of [...state.effects].reverse()) {
        if (typeof effect.dispose === 'function') effect.dispose()
      }
    },
  }
}

function registrationOf(state, slotName) {
  const record = state.registrations.find(entry => entry.options.name === slotName)
  assert.ok(record, `必须注册 ${slotName}`)
  return record
}

const DICTIONARY_KEYS = [
  'panel.label', 'panel.title', 'section.running', 'section.unread', 'empty', 'untitled',
  'current', 'defaultOpen', 'defaultOpenHint', 'close', 'open.aria',
  'time.now', 'time.minutes', 'time.hours', 'time.days', 'time.months', 'time.years',
]

test('插件形状：name / inject / 三处席位注册', async () => {
  const harnessed = harness()
  assert.equal(harnessed.plugin.name, 'session-activity')
  assert.deepEqual([...harnessed.plugin.inject], ['slots', 'locale', 'uiSession', 'sessions', 'uiWorkspace'])
  assert.equal(harnessed.state.registrations.length, 3)
  const row = registrationOf(harnessed.state, 'sidebar.panellist')
  assert.equal(row.options.id, 'session-activity')
  assert.equal(row.options.order, -10, '必须排在「新会话」下方的第一位')
  assert.equal(typeof row.options.label, 'function')
  assert.equal(row.options.label(), '任务动态')
  const flyout = registrationOf(harnessed.state, 'shell.overlay')
  assert.equal(flyout.options.id, 'session-activity.flyout')
})

test('locale：中英文都带全部键', async () => {
  const harnessed = harness()
  const dictionary = harnessed.state.dictionaries.find(entry => entry.ns === 'sessionActivity')
  assert.ok(dictionary, '必须注册 sessionActivity 字典')
  for (const key of DICTIONARY_KEYS) {
    assert.equal(typeof dictionary.dicts.zh[key], 'string', `中文缺 ${key}`)
    assert.equal(typeof dictionary.dicts.en[key], 'string', `英文缺 ${key}`)
  }
  assert.equal(harnessed.document.appended.length, 1, '必须插入一份样式')
})

test('侧栏行：挂载到真实按钮上并接管点击（阻止 selectPanel 冒泡）', async () => {
  const harnessed = harness()
  const tree = harnessed.views.trigger.render()
  assert.ok(byClass(tree, 'dsh-sa-glyph').length === 1, 'glyph 必须是 .dsh-sa-glyph')
  assert.equal(harnessed.button.attributes['data-session-activity-trigger'], '')
  assert.equal(harnessed.button.attributes['aria-haspopup'], 'dialog')
  assert.equal(harnessed.button.attributes['aria-expanded'], 'false')
  assert.equal(byClass(tree, 'dsh-sa-badge').length, 0, '没有任务时不显示角标')

  const event = harnessed.button.click()
  assert.equal(event.propagationStopped, true, '必须阻止事件冒泡到 React 根监听')
  assert.equal(harnessed.root.clicks, 0, 'React 根委托监听不能收到这次点击')
  assert.equal(event.defaultPrevented, true)
  const flyout = harnessed.views.flyout.render()
  assert.ok(flyout, '点击后浮层应打开')
  assert.equal(byClass(flyout, 'dsh-sa-empty').length, 1, '没有任务时显示空状态')
})

test('浮层：运行中/待查看两组、跳过空白与 subagent、点击跳会话并关闭', async () => {
  const harnessed = harness()
  const rows = [
    sessionRow('run', { running: true, updatedAt: 5000 }),
    sessionRow('done', { updatedAt: 4000 }),
    sessionRow('idle', { updatedAt: 3000 }),
    sessionRow('blank', { blank: true, running: true }),
    sessionRow('child', { origin: 'subagent', running: true }),
  ]
  const statusMap = new Map([
    ['run', { running: true, completionUnread: false }],
    ['done', { running: false, completionUnread: true }],
    ['idle', { running: false, completionUnread: false }],
    ['blank', { running: true, completionUnread: false }],
    ['child', { running: true, completionUnread: false }],
  ])
  harnessed.publish(rows, statusMap, 'done')
  harnessed.views.trigger.render()
  assert.equal(byClass(harnessed.views.flyout.render(), 'dsh-sa-item').length, 0, '默认不展开')

  harnessed.button.click()
  const flyout = harnessed.views.flyout.render()
  assert.ok(flyout)
  assert.equal(flyout.type, 'portal', '浮层必须 portal 出 shell.overlay 的 stacking context')
  assert.equal(flyout.props.container, harnessed.document.body)
  assert.equal(byClass(flyout, 'dsh-sa-panel')[0].props.id, 'session-activity-panel')
  const style = harnessed.document.appended[0].textContent
  assert.match(style, /z-index: 200/, '必须高于 drawer 的 70/71')
  assert.match(style, /\.dsh-sa-panel \{[^}]*pointer-events: auto/)
  assert.match(harnessed.button.attributes['aria-label'], /\(2\)$/, '可访问名称带上任务数')
  const items = byClass(flyout, 'dsh-sa-item')
  assert.equal(items.length, 2)
  assert.match(textOf(items[0]), /会话 run/)
  assert.match(textOf(items[1]), /会话 done/)
  assert.equal(byClass(flyout, 'dsh-sa-current').length, 1, '当前会话带标记')
  const dots = byClass(flyout, 'dsh-sa-dot').map(dot => dot.props.className)
  assert.equal(dots.filter(value => value.includes('is-running')).length, 1)
  assert.equal(dots.filter(value => value.includes('is-unread')).length, 1)
  const triggerTree = harnessed.views.trigger.render()
  assert.equal(byClass(triggerTree, 'dsh-sa-badge').length, 1, '角标显示总数')
  assert.equal(textOf(byClass(triggerTree, 'dsh-sa-badge')[0]), '2')

  items[1].props.onClick()
  assert.deepEqual(harnessed.state.opened, ['done'])
  assert.equal(harnessed.views.flyout.render(), null, '跳转后关闭浮层')
})

test('默认展开：偏好开启且有任务时自动出现，底部开关可关掉并持久化', async () => {
  const harnessed = harness({ stored: { [DEFAULT_OPEN_KEY]: '1' } })
  harnessed.publish(
    [
      sessionRow('run', { running: true, updatedAt: 5000 }),
      sessionRow('done', { updatedAt: 4000 }),
    ],
    new Map([
      ['run', { running: true }],
      ['done', { running: false, completionUnread: true }],
    ]),
  )
  harnessed.views.trigger.render()
  const flyout = harnessed.views.flyout.render()
  assert.ok(flyout, '偏好开启时自动展开')
  assert.equal(byClass(flyout, 'dsh-sa-item').length, 2)

  const pref = byClass(flyout, 'dsh-sa-pref')[0]
  assert.equal(pref.props['aria-checked'], 'true')
  pref.props.onClick()
  assert.equal(harnessed.storage.get(DEFAULT_OPEN_KEY), '0', '开关必须写入 localStorage')
  // 重新渲染后读回关闭态。
  const reopened = harnessed.views.flyout.render()
  assert.equal(byClass(reopened, 'dsh-sa-pref')[0].props['aria-checked'], 'false')
})

test('直接 selectPanel 本 id 时走主面板占位：退回会话并打开浮层', async () => {
  const harnessed = harness()
  harnessed.publish(
    [sessionRow('run', { running: true, updatedAt: 5000 })],
    new Map([['run', { running: true }]]),
  )
  const shell = harnessed.views.trigger
  shell.render()
  const fallback = registrationOf(harnessed.state, 'main')
  assert.equal(fallback.options.key, 'session-activity')
  harnessed.react.begin()
  assert.equal(fallback.component({}), null, '占位不渲染任何内容')
  harnessed.react.flush()
  assert.deepEqual(harnessed.state.selectedPanels, ['conversation'], '必须把主面板退回会话')
  const flyout = harnessed.views.flyout.render()
  assert.ok(flyout, '占位被选中时打开浮层')
})

test('标题为空时用「未命名会话」；相对时间走 locale', async () => {
  const harnessed = harness()
  harnessed.publish(
    [sessionRow('untitled', { title: undefined, running: true, updatedAt: Date.now() })],
    new Map([['untitled', { running: true }]]),
  )
  harnessed.views.trigger.render()
  harnessed.button.click()
  const flyout = harnessed.views.flyout.render()
  const item = byClass(flyout, 'dsh-sa-item')[0]
  assert.equal(byClass(item, 'dsh-sa-item-title')[0].children[0], '未命名会话')
  assert.equal(byClass(item, 'dsh-sa-item-meta')[0].children[0], '刚刚')
})

test('卸载：effect disposer 全部可调用，样式被移除', async () => {
  const harnessed = harness()
  const style = harnessed.document.appended[0]
  harnessed.dispose()
  assert.equal(style.removed, true)
  for (const registration of harnessed.state.registrations) {
    assert.equal(registration.disposed, true)
  }
})

test('关闭行为：点外部或 Esc 关闭，点侧栏行自身交给 toggle', async () => {
  const harnessed = harness({ stored: { [DEFAULT_OPEN_KEY]: '1' } })
  harnessed.publish(
    [sessionRow('run', { running: true, updatedAt: 5000 })],
    new Map([['run', { running: true }]]),
  )
  harnessed.views.trigger.render()
  assert.ok(harnessed.views.flyout.render(), '偏好开启时自动展开')

  // 点侧栏行自身：document 监听器必须放行，不在这里关闭。
  const triggerTarget = { closest: selector => (selector === '[data-session-activity-trigger]' ? harnessed.button : null) }
  lastListener(harnessed.document, 'pointerdown')({ target: triggerTarget })
  assert.ok(harnessed.views.flyout.render(), '点侧栏行自身不关闭')
  harnessed.button.click()
  assert.equal(harnessed.views.flyout.render(), null, '再由侧栏行自身 toggle 关闭')

  // 再打开，点外部关闭。
  harnessed.button.click()
  assert.ok(harnessed.views.flyout.render())
  lastListener(harnessed.document, 'pointerdown')({ target: { closest: () => null } })
  assert.equal(harnessed.views.flyout.render(), null, '点浮层外关闭')

  // 再打开，Esc 关闭并把焦点还给侧栏行。
  harnessed.button.click()
  assert.ok(harnessed.views.flyout.render())
  harnessed.button.focused = false
  lastListener(harnessed.document, 'keydown')({ key: 'Escape' })
  assert.equal(harnessed.views.flyout.render(), null, 'Esc 关闭')
  assert.equal(harnessed.button.focused, true, 'Esc 关闭后焦点回到侧栏行')

  // 再打开，点关闭按钮同样归还焦点。
  harnessed.button.click()
  const opened = harnessed.views.flyout.render()
  harnessed.button.focused = false
  byClass(opened, 'dsh-sa-close')[0].props.onClick()
  assert.equal(harnessed.views.flyout.render(), null)
  assert.equal(harnessed.button.focused, true, '关闭按钮也归还焦点')
})
