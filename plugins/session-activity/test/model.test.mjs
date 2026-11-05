/**
 * 纯模型测试：筛选、排序、相对时间、浮层状态机。
 *
 * 这些是「静默失效」的地方：空白会话混进来、running 被 completionUnread
 * 盖掉、自动展开重复触发，界面上都只是多一行或少一行，不会报错。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OPEN_KEY, countTasks, createStore, relativeTime, selectTasks,
} from '../src/model.js'

function row(id, patch = {}) {
  return {
    id,
    title: `会话 ${id}`,
    blank: false,
    running: false,
    updatedAt: 1000,
    ...patch,
  }
}

function listOf(rows) {
  return {
    ids: rows.map(entry => entry.id),
    byId: Object.fromEntries(rows.map(entry => [entry.id, entry])),
    phase: 'ready',
  }
}

function statusesOf(entries) {
  return new Map(Object.entries(entries))
}

/** 内存版 localStorage；`initial` 用来模拟上次开着的偏好。 */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: key => (values.has(key) ? values.get(key) : null),
    set: (key, value) => { values.set(key, value) },
  }
}

test('selectTasks：只收运行中与待查看，跳过空白、subagent、已读完成', () => {
  const list = listOf([
    row('run', { running: true, updatedAt: 5000 }),
    row('done', { updatedAt: 4000 }),
    row('idle', { updatedAt: 3000 }),
    row('blank', { blank: true, running: true }),
    row('child', { origin: 'subagent', running: true }),
  ])
  const statuses = statusesOf({
    run: { running: true, completionUnread: false },
    done: { running: false, completionUnread: true },
    idle: { running: false, completionUnread: false },
    blank: { running: true, completionUnread: false },
    child: { running: true, completionUnread: false },
  })
  const tasks = selectTasks({ list, statuses, currentId: 'done' })
  assert.deepEqual(tasks.running.map(task => task.id), ['run'])
  assert.deepEqual(tasks.unread.map(task => task.id), ['done'])
  assert.equal(tasks.unread[0].current, true)
  assert.equal(tasks.running[0].current, false)
})

test('selectTasks：running 优先于 completionUnread', () => {
  const list = listOf([row('both', { updatedAt: 10 })])
  const statuses = statusesOf({ both: { running: true, completionUnread: true } })
  const tasks = selectTasks({ list, statuses })
  assert.deepEqual(tasks.running.map(task => task.id), ['both'])
  assert.deepEqual(tasks.unread, [])
})

test('selectTasks：组内按 updatedAt 降序', () => {
  const list = listOf([
    row('old', { running: true, updatedAt: 10 }),
    row('new', { running: true, updatedAt: 30 }),
    row('mid', { running: true, updatedAt: 20 }),
  ])
  const statuses = statusesOf({
    old: { running: true },
    new: { running: true },
    mid: { running: true },
  })
  const tasks = selectTasks({ list, statuses })
  assert.deepEqual(tasks.running.map(task => task.id), ['new', 'mid', 'old'])
})

test('selectTasks：状态快照缺行时回退到 list 的 running 字段', () => {
  const list = listOf([row('fallback', { running: true })])
  const tasks = selectTasks({ list, statuses: new Map() })
  assert.deepEqual(tasks.running.map(task => task.id), ['fallback'])
})

test('selectTasks：list 缺失时返回两个空组', () => {
  assert.deepEqual(selectTasks({ list: undefined, statuses: new Map() }), { running: [], unread: [] })
  assert.deepEqual(selectTasks(), { running: [], unread: [] })
})

test('selectTasks：标题缺失时留空串，交给渲染层本地化', () => {
  const list = listOf([row('untitled', { title: undefined, running: true })])
  const tasks = selectTasks({ list, statuses: statusesOf({ untitled: { running: true } }) })
  assert.equal(tasks.running[0].title, '')
  const spaced = listOf([row('spaced', { title: '  项目 A  ', running: true })])
  assert.equal(selectTasks({ list: spaced, statuses: statusesOf({ spaced: { running: true } }) }).running[0].title, '项目 A')
})

test('relativeTime：分档边界与 ui-primitives 一致', () => {
  const now = 100_000_000
  assert.deepEqual(relativeTime(now - 10, now), { unit: 'now', n: 0 })
  assert.deepEqual(relativeTime(now - 60_000, now), { unit: 'minutes', n: 1 })
  assert.deepEqual(relativeTime(now - 3_600_000, now), { unit: 'hours', n: 1 })
  assert.deepEqual(relativeTime(now - 86_400_000, now), { unit: 'days', n: 1 })
  assert.deepEqual(relativeTime(now - 30 * 86_400_000, now), { unit: 'months', n: 1 })
  assert.deepEqual(relativeTime(now - 365 * 86_400_000, now), { unit: 'years', n: 1 })
  assert.deepEqual(relativeTime(now + 5000, now), { unit: 'now', n: 0 }, '未来时间按刚刚处理')
})

test('countTasks：两组相加', () => {
  assert.equal(countTasks({ running: [{ id: 'a' }], unread: [{ id: 'b' }, { id: 'c' }] }), 3)
})

test('store：默认关闭，toggle 打开并请求焦点，再 toggle 关闭', () => {
  const store = createStore({ storage: memoryStorage(), defaultOpen: false })
  assert.equal(store.get().open, false)
  store.toggle()
  assert.equal(store.get().open, true)
  assert.equal(store.get().focus, true)
  store.toggle()
  assert.equal(store.get().open, false)
  assert.equal(store.get().focus, false)
})

test('store：open 幂等，不抢焦点', () => {
  const store = createStore({ storage: memoryStorage() })
  store.open()
  store.open()
  assert.equal(store.get().open, true)
  assert.equal(store.get().focus, false)
})

test('store：setDefaultOpen 写入 localStorage，下次创建时读回', () => {
  const storage = memoryStorage()
  const store = createStore({ storage, defaultOpen: false })
  store.setDefaultOpen(true)
  assert.equal(storage.get(DEFAULT_OPEN_KEY), '1')
  assert.equal(createStore({ storage }).get().defaultOpen, true)
  store.setDefaultOpen(false)
  assert.equal(storage.get(DEFAULT_OPEN_KEY), '0')
  assert.equal(createStore({ storage }).get().defaultOpen, false)
})

test('store：无存储时 setDefaultOpen 只改内存态', () => {
  const store = createStore({ defaultOpen: false })
  store.setDefaultOpen(true)
  assert.equal(store.get().defaultOpen, true)
})

test('store：默认展开 = 偏好开启 + 有任务 + 有锚点，缺一不展开', () => {
  const noAnchor = createStore({ storage: memoryStorage({ [DEFAULT_OPEN_KEY]: '1' }) })
  noAnchor.setTasks({ running: [{ id: 'a', title: '', updatedAt: 1, current: false }], unread: [] })
  assert.equal(noAnchor.get().open, false, '没有锚点不展开')
  noAnchor.setAnchor({ top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 })
  assert.equal(noAnchor.get().open, true, '锚点到达后自动展开')

  const noTasks = createStore({ storage: memoryStorage({ [DEFAULT_OPEN_KEY]: '1' }) })
  noTasks.setAnchor({ top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 })
  assert.equal(noTasks.get().open, false, '没有任务不展开')

  const closedPreference = createStore({ storage: memoryStorage(), defaultOpen: false })
  closedPreference.setAnchor({ top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 })
  closedPreference.setTasks({ running: [{ id: 'a', title: '', updatedAt: 1, current: false }], unread: [] })
  assert.equal(closedPreference.get().open, false, '偏好关闭时保持点击展开')
})

test('store：自动展开只发生一次，用户关掉后不再弹回', () => {
  const store = createStore({ storage: memoryStorage({ [DEFAULT_OPEN_KEY]: '1' }) })
  const anchor = { top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 }
  store.setAnchor(anchor)
  store.setTasks({ running: [{ id: 'a', title: '', updatedAt: 1, current: false }], unread: [] })
  assert.equal(store.get().open, true)
  store.close()
  assert.equal(store.get().open, false)
  store.setTasks({ running: [{ id: 'b', title: '', updatedAt: 2, current: false }], unread: [] })
  assert.equal(store.get().open, false, '已试过自动展开，不再弹回')
})

test('store：用户在数据到达前手动开过，自动展开不再介入', () => {
  const store = createStore({ storage: memoryStorage({ [DEFAULT_OPEN_KEY]: '1' }) })
  store.toggle()
  store.close()
  store.setAnchor({ top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 })
  store.setTasks({ running: [{ id: 'a', title: '', updatedAt: 1, current: false }], unread: [] })
  assert.equal(store.get().open, false)
})

test('store：订阅者在任务/开关变化时收到通知，退订后不再收到', () => {
  const store = createStore({ storage: memoryStorage() })
  let calls = 0
  const unsubscribe = store.subscribe(() => { calls += 1 })
  store.setTasks({ running: [], unread: [] }, undefined)
  assert.equal(calls, 0, '空任务不变不通知')
  store.setTasks({ running: [{ id: 'a', title: '', updatedAt: 1, current: false }], unread: [] }, undefined)
  assert.equal(calls, 1)
  store.toggle()
  assert.equal(calls, 2)
  unsubscribe()
  store.toggle()
  assert.equal(calls, 2)
})

test('store：相同锚点不重复通知（避免 ResizeObserver 抖动）', () => {
  const store = createStore({ storage: memoryStorage() })
  let calls = 0
  store.subscribe(() => { calls += 1 })
  const anchor = { top: 10, left: 10, right: 100, bottom: 20, width: 90, height: 10 }
  store.setAnchor(anchor)
  store.setAnchor({ ...anchor })
  assert.equal(calls, 1)
})
