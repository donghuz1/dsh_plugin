/**
 * 提示词构造。纯函数，无 DSH 依赖。
 *
 * 设计取舍：MMDD 由插件自己算、自己拼，提示词里**不给日期也不要求日期**——
 * 模型的日期算术不可靠，且给了日期反而诱导它输出日期。这里只要它产出
 * 「类型｜主题」，日期前缀由 rule.js 组装。
 */

import { SEPARATOR, TITLE_TYPES, truncateUtf8, utf8Bytes } from './rule.js'

/**
 * user prompt 的 UTF-8 字节上限，与内置标题 provider 的 `maxInputBytes: 4096`
 * 对齐。超过这个预算的请求既可能拖慢标题生成，也会把长会话整段历史发给模型。
 */
export const MAX_INPUT_BYTES = 4096

/** user prompt 的固定前缀；字节预算包含它。 */
const USER_PROMPT_PREFIX = '从下面这个 JSON 数组里的用户消息生成会话标题：\n'

/** 把选中的消息序列化成 user prompt；帧格式只在这里定义。 */
function frame(messages) {
  return `${USER_PROMPT_PREFIX}${JSON.stringify(messages)}`
}

/**
 * 八类判定规则，与规则书逐字对应。
 * 顺序由 {@link TITLE_TYPES} 决定，这里只提供每类的说明文本。
 */
const TYPE_RULES = {
  功能: '新增页面/功能/组件/接口/表单/流程',
  设计: 'UI/交互/样式/布局/组件/数据结构/物理模型设计',
  修复: '修 bug/报错/崩溃/接口错误',
  优化: '性能/重构/结构优化/逻辑简化',
  发布: '上线/部署/提交代码/打包/发版',
  探索: '调研/技术选型/方案对比/可行性/咨询',
  文档: '写文档/需求规格/说明/梳理',
  研究: '研究问题/阅读源码/分析原理/安全审查',
}

/**
 * 构造系统提示词。
 * @param options - 主题长度上限与会话项目名。
 * @returns 送给模型的 system 文本。
 */
export function systemPrompt(options) {
  const { maxTopicChars, project } = options
  const lines = [
    '你在为一个 AI 编程助手的会话起标题。',
    `只输出一行，格式为 <类型>${SEPARATOR}<主题>，不要解释、不要引号、不要 Markdown、不要代码。`,
    '',
    '<类型> 必须从下面八个里选一个（只写这两个字，不加任何修饰）：',
    ...TITLE_TYPES.map(type => `- ${type}：${TYPE_RULES[type]}`),
    '',
    '<主题> 的要求：',
    '- 一句话具体提炼用户实际要做或正在做的事，写到能一眼分辨，不要泛泛而谈',
    `- 不超过 ${maxTopicChars} 个汉字，适合在会话列表里显示`,
    '- 不要写日期（日期由程序另行添加）',
  ]
  if (project !== undefined) {
    lines.push(`- 不要重复项目名「${project}」，也不要写「项目」二字`)
  }
  lines.push('', '如果从消息里无法判断主题，只输出 KEEP。')
  return lines.join('\n')
}

/**
 * 选出预算内实际送进 prompt 的消息。
 *
 * 选择策略是「按顺序装满」：
 * - 全部消息放得下时保持全量输入（短会话行为不变）；
 * - 第一条就超预算时，把它裁到预算内的 UTF-8 前缀，保证标题调用仍有输入；
 * - 后续消息放不下时停在消息边界，不塞半条消息。
 *
 * 返回值同时决定 `messageSeqs`：被丢掉的消息不能算作标题来源。
 *
 * @param messages - 服务给的用户消息快照。
 * @param maxInputBytes - 可选字节上限，默认 {@link MAX_INPUT_BYTES}。
 * @returns 实际进入 prompt 的消息（首条可能是裁短后的副本）。
 */
export function selectMessages(messages, maxInputBytes = MAX_INPUT_BYTES) {
  const selected = []

  for (const [index, message] of messages.entries()) {
    if (utf8Bytes(frame([...selected, message])) <= maxInputBytes) {
      selected.push(message)
      continue
    }
    // 第一条就装不下：裁成预算内最长的 UTF-8 前缀。后续消息装不下则停在边界。
    if (index === 0) {
      const text = typeof message.text === 'string' ? message.text : ''
      let low = 0
      let high = utf8Bytes(text)
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (utf8Bytes(frame([{ ...message, text: truncateUtf8(text, mid) }])) <= maxInputBytes) low = mid
        else high = mid - 1
      }
      if (low > 0) selected.push({ ...message, text: truncateUtf8(text, low) })
    }
    break
  }

  return selected
}

/**
 * 把消息序列化成 user prompt，并保证不超过 `maxInputBytes`。
 *
 * 这样既不会像内置 all-prompts provider 那样因超长直接失败，也不会把
 * 整段历史发给标题模型。
 *
 * @param options - `messages`（服务给的用户消息快照）与可选字节上限。
 * @returns 送给模型的 user 文本。
 */
export function userPrompt(options) {
  return frame(selectMessages(options.messages, options.maxInputBytes))
}
