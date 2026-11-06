/**
 * 任务动态的纯模型：会话快照 → 运行中 / 待查看 / 今日三组，以及浮层的开关状态机。
 *
 * 单独成文件有两个原因：
 * 1. client.js 是经典脚本，不能 import；build.mjs 会把本文件内联进产物。
 * 2. 测试直接 import 本文件，覆盖筛选、排序、相对时间与自动展开，不必在
 *    VM 里搭 React。
 */

/** 「默认展开」偏好的 localStorage 键。 */
const DEFAULT_OPEN_KEY = 'dsh.session-activity.default-open'

/** 会话标题；宿主投影缺失时返回空串，由渲染层本地化成「未命名会话」。 */
function titleOf(row) {
  return typeof row.title === 'string' ? row.title.trim() : ''
}

/** 两个时间戳是否落在本地日历的同一天（用日期分量比较，避开 DST 与月末边界）。 */
function isSameLocalDay(at, now) {
  const left = new Date(at)
  const right = new Date(now)
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/**
 * 把会话列表与状态快照筛成三组。
 *
 * 互斥优先级：运行中 > 待查看 > 今日。同一会话只出现一次——运行中/待查看是
 * 待处理项，今日是「今天碰过、已看过」的回看区。空白会话（新会话占位）与
 * subagent 子会话不进入任务列表——它们不是用户要回去接着看的根任务。
 * @param input - `list` 为 ctx.sessions.list 快照，`statuses` 为 sessionStatus 快照，`currentId` 为当前会话 id，`now` 为本地时间基准（缺省 Date.now()）。
 * @returns 三组任务行，组内按 updatedAt 降序。
 */
function selectTasks(input) {
  const list = input === undefined || input === null ? undefined : input.list
  const statuses = input === undefined || input === null ? undefined : input.statuses
  const currentId = input === undefined || input === null ? undefined : input.currentId
  const now = input !== undefined && input !== null && typeof input.now === 'number'
    ? input.now
    : Date.now()
  const running = []
  const unread = []
  const today = []
  if (list === undefined || list === null || list.byId === undefined || list.byId === null) {
    return { running, unread, today }
  }
  const ids = Array.isArray(list.ids) ? list.ids : Object.keys(list.byId)
  for (const id of ids) {
    const row = list.byId[id]
    if (row === undefined || row === null) continue
    if (row.blank === true) continue
    if (row.origin === 'subagent') continue
    // 用鸭子类型而不是 instanceof Map：测试跨 VM realm 时 Map 构造器不是同一个。
    const status = statuses !== undefined && statuses !== null && typeof statuses.get === 'function'
      ? statuses.get(id)
      : undefined
    const isRunning = status !== undefined && status.running !== undefined
      ? status.running === true
      : row.running === true
    const isUnread = status !== undefined && status.completionUnread === true
    const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : 0
    const isToday = !isRunning && !isUnread && isSameLocalDay(updatedAt, now)
    if (!isRunning && !isUnread && !isToday) continue
    const task = {
      id,
      title: titleOf(row),
      cwd: typeof row.cwd === 'string' ? row.cwd : '',
      updatedAt,
      current: id === currentId,
    }
    if (isRunning) running.push(task)
    else if (isUnread) unread.push(task)
    else today.push(task)
  }
  const byRecent = (left, right) => right.updatedAt - left.updatedAt
  running.sort(byRecent)
  unread.sort(byRecent)
  today.sort(byRecent)
  return { running, unread, today }
}

/** 相对时间分档；阈值与 ui-primitives 的 relativeTime 保持一致。 */
function relativeTime(at, now) {
  const MINUTE = 60000
  const HOUR = 3600000
  const DAY = 86400000
  const diff = Math.max(0, now - at)
  if (diff < MINUTE) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MINUTE) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** 待处理条目总数（运行中 + 待查看），用于侧栏行角标与默认展开判定；今日只回看，不计入。 */
function countTasks(tasks) {
  return tasks.running.length + tasks.unread.length
}

/**
 * 目录的紧凑展示：保留末尾两段，前面用 … 省略。
 * 完整路径留给 title，供悬停查看。
 * @param path - 会话的 cwd。
 * @returns 可展示的短路径；空路径返回空串。
 */
function shortPath(path) {
  if (typeof path !== 'string' || path === '') return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path === '/' ? '/' : ''
  const parts = trimmed.split(/[\\/]+/).filter(part => part !== '')
  if (parts.length === 0) return ''
  if (parts.length <= 2) return parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

function sameRect(left, right) {
  return left.top === right.top && left.left === right.left
    && left.right === right.right && left.bottom === right.bottom
    && left.width === right.width && left.height === right.height
}

function sameTasks(left, right) {
  const sameGroup = (a, b) => {
    const first = Array.isArray(a) ? a : []
    const second = Array.isArray(b) ? b : []
    if (first.length !== second.length) return false
    for (let index = 0; index < first.length; index += 1) {
      const one = first[index]
      const two = second[index]
      if (one.id !== two.id || one.title !== two.title || one.cwd !== two.cwd
        || one.updatedAt !== two.updatedAt || one.current !== two.current) return false
    }
    return true
  }
  return sameGroup(left.running, right.running)
    && sameGroup(left.unread, right.unread)
    && sameGroup(left.today, right.today)
}

/**
 * 浮层状态机：任务数据、锚点、开关与「默认展开」偏好。
 * storage 依赖注入，测试不需要 localStorage。
 * @param options - `storage`（get/set）与首次运行的 `defaultOpen`。
 * @returns 只读快照 + 动作；每次变更后通知订阅者。
 */
function createStore(options) {
  const settings = options === undefined || options === null ? {} : options
  const storage = settings.storage
  const stored = storage === undefined ? undefined : storage.get(DEFAULT_OPEN_KEY)
  let state = {
    open: false,
    defaultOpen: stored === '1' || (stored !== '0' && settings.defaultOpen === true),
    tasks: { running: [], unread: [], today: [] },
    currentId: undefined,
    anchor: null,
    focus: false,
    autoTried: false,
    userActed: false,
  }
  const listeners = new Set()
  let triggerElement = null
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const maybeAutoOpen = () => {
    if (state.autoTried || !state.defaultOpen || state.userActed || state.open) return
    if (state.anchor === null || countTasks(state.tasks) === 0) return
    state = { ...state, open: true, focus: false, autoTried: true }
    emit()
  }
  return {
    get: () => state,
    /** 记下侧栏行按钮，供关闭时归还焦点；不进入快照，不触发渲染。 */
    setTrigger(element) {
      triggerElement = element === undefined ? null : element
    },
    /** 把焦点还给侧栏行按钮（仅键盘/关闭按钮路径调用）。 */
    focusTrigger() {
      if (triggerElement === null) return
      if (triggerElement.isConnected === false) return
      if (typeof triggerElement.focus === 'function') triggerElement.focus()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setTasks(tasks, currentId) {
      // 兼容只有两组的历史调用；缺组按空数组处理，组件永远拿到三组。
      const next = {
        running: tasks !== undefined && tasks !== null && Array.isArray(tasks.running) ? tasks.running : [],
        unread: tasks !== undefined && tasks !== null && Array.isArray(tasks.unread) ? tasks.unread : [],
        today: tasks !== undefined && tasks !== null && Array.isArray(tasks.today) ? tasks.today : [],
      }
      if (sameTasks(state.tasks, next) && state.currentId === currentId) return
      state = { ...state, tasks: next, currentId }
      emit()
      maybeAutoOpen()
    },
    setAnchor(anchor) {
      if (state.anchor !== null && sameRect(state.anchor, anchor)) return
      state = { ...state, anchor }
      emit()
      maybeAutoOpen()
    },
    toggle() {
      const open = !state.open
      state = { ...state, open, focus: open, userActed: true, autoTried: true }
      emit()
    },
    open() {
      if (state.open) return
      state = { ...state, open: true, focus: false, autoTried: true, userActed: true }
      emit()
    },
    close() {
      if (!state.open) return
      state = { ...state, open: false, focus: false, autoTried: true }
      emit()
    },
    setDefaultOpen(value) {
      const next = value === true
      if (next === state.defaultOpen) return
      state = { ...state, defaultOpen: next }
      if (storage !== undefined) storage.set(DEFAULT_OPEN_KEY, next ? '1' : '0')
      emit()
    },
  }
}

export { DEFAULT_OPEN_KEY, countTasks, createStore, relativeTime, selectTasks, shortPath }
