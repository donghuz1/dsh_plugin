/**
 * 纯逻辑：日期换算、模型输出解析、UTF-8 字节预算、会话资格判定。
 *
 * 刻意不 import 任何 `@deepseek-ai/*`：实测从插件目录出发
 * `require.resolve('@deepseek-ai/dsh-llm')` 返回 MODULE_NOT_FOUND，
 * 所以与 DSH 的全部接触面收缩到 index.js 里的 `ctx` 服务调用。
 * 形状假设由 test/contract.test.mjs 对照 DSH 源码逐个校验。
 */

/** 类型枚举，八选一。顺序即规则书里的顺序，提示词直接复用。 */
export const TITLE_TYPES = ['功能', '设计', '修复', '优化', '发布', '探索', '文档', '研究']

/** 命名格式的分隔符：全角竖线。 */
export const SEPARATOR = '｜'

/**
 * 标题的 UTF-8 字节上限。
 *
 * 对应 profile 中 `session-title` 服务的 `maxTitleBytes`（当前 80）。服务对
 * 超长标题是**静默截断**，不报错，所以必须由本插件先裁到预算内。
 */
export const MAX_TITLE_BYTES = 80

/** Asia/Shanghai 相对 UTC 的固定偏移；中国自 1991 年起无夏令时。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 把毫秒时间戳换算成 Asia/Shanghai 的 `MMDD`。
 *
 * 做法是加固定偏移后只取 UTC 字段，因此结果与运行机器的本地时区无关。
 * @param createdAtMs - 会话创建时间的毫秒时间戳（`session.header.createdAt`）。
 * @returns 四字符 `MMDD`；时间戳非法时返回 `undefined`。
 */
export function shanghaiMMDD(createdAtMs) {
  if (!Number.isFinite(createdAtMs)) return undefined
  const shifted = new Date(createdAtMs + SHANGHAI_OFFSET_MS)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${month}${day}`
}

/**
 * 取工作目录的末段作为项目名——主题不应重复它。
 * @param cwd - 会话的绝对工作目录，可为空。
 * @returns 项目名；无法判定时返回 `undefined`。
 */
export function projectName(cwd) {
  if (typeof cwd !== 'string') return undefined
  const trimmed = cwd.replace(/[/\\]+$/, '')
  if (trimmed.length === 0) return undefined
  const segment = trimmed.split(/[/\\]/).pop()
  return segment === undefined || segment.length === 0 ? undefined : segment
}

/**
 * UTF-8 字节数。
 * @param text - 任意文本。
 * @returns 编码后的字节数。
 */
export function utf8Bytes(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 按 UTF-8 字节预算裁剪，且不劈开码点。
 * @param text - 待裁剪文本。
 * @param maxBytes - 正整数字节预算。
 * @returns 预算内最长的码点前缀。
 */
export function truncateUtf8(text, maxBytes) {
  if (utf8Bytes(text) <= maxBytes) return text
  let used = 0
  let output = ''
  for (const character of text) {
    const bytes = utf8Bytes(character)
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * 按命名格式组装标题，并把主题裁进服务接受的字节预算内。
 * @param mmdd - 四字符 `MMDD`。
 * @param type - 已校验的八类之一。
 * @param topic - 模型给出的主题原文。
 * @returns 完整标题；主题被裁空时返回 `undefined`。
 */
export function buildTitle(mmdd, type, topic) {
  const prefix = `${mmdd}${SEPARATOR}${type}${SEPARATOR}`
  const budget = MAX_TITLE_BYTES - utf8Bytes(prefix)
  if (budget <= 0) return undefined
  const trimmed = truncateUtf8(topic.trim(), budget).trimEnd()
  if (trimmed.length === 0) return undefined
  return `${prefix}${trimmed}`
}

/** 模型输出里表示"判断不出主题"的哨兵值。 */
const KEEP_SENTINEL = 'KEEP'

/** 括注后缀（如「功能（新增页面）」）在类型判定前先剥掉。 */
const PARENTHETICAL_SUFFIX = /[（(][^）)]*[）)]?\s*$/u

/**
 * 解析模型返回的一行文本。
 *
 * 宽容之处只有两处，都不引入猜测：剥掉模型可能自带的 `MMDD` 前缀，
 * 以及类型后的括注。除此之外类型必须精确命中八类之一。
 * @param raw - 模型输出的原始文本。
 * @returns `{kind:'title'|'keep'|'invalid'}` 三态判别结果。
 */
export function parseModelOutput(raw) {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: '模型输出不是文本' }
  const line = raw
    .split('\n')
    .map(part => part.trim())
    .find(part => part.length > 0)
  if (line === undefined) return { kind: 'invalid', reason: '模型输出为空' }

  const stripped = line.replace(/^["'`]|["'`]$/g, '').trim()
  if (stripped.toUpperCase() === KEEP_SENTINEL) return { kind: 'keep' }

  const parts = stripped.split(/[｜|]/u).map(part => part.trim())
  // 模型有时会把日期一起输出；日期由插件自己算，这里丢掉它而不是采信。
  if (parts.length >= 3 && /^\d{4}$/u.test(parts[0])) parts.shift()
  if (parts.length < 2) return { kind: 'invalid', reason: '缺少类型或主题' }

  const type = parts[0].replace(PARENTHETICAL_SUFFIX, '').trim()
  if (!TITLE_TYPES.includes(type)) return { kind: 'invalid', reason: `类型不在八类之内：${parts[0]}` }

  const topic = parts.slice(1).join(SEPARATOR).trim()
  if (topic.length === 0) return { kind: 'invalid', reason: '主题为空' }
  return { kind: 'title', type, topic }
}

/**
 * 会话是否应当由本插件命名。
 *
 * 只放行主对话：子会话（有 `parentSession`）与 subagent 会话一律不动。
 * @param header - `session.header`。
 * @returns 是否放行。
 */
export function isEligibleSession(header) {
  if (header === null || typeof header !== 'object') return false
  if (header.parentSession !== undefined) return false
  if (header.origin === 'subagent') return false
  return true
}
