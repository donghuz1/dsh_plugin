/**
 * 提示词构造。纯函数，无 DSH 依赖。
 *
 * 设计取舍：MMDD 由插件自己算、自己拼，提示词里**不给日期也不要求日期**——
 * 模型的日期算术不可靠，且给了日期反而诱导它输出日期。这里只要它产出
 * 「类型｜主题」，日期前缀由 rule.js 组装。
 */

import { SEPARATOR, TITLE_TYPES } from './rule.js'

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
 * 构造用户消息。
 *
 * 把消息包成 JSON 而不是直接拼接：这是 DSH 内置标题 provider 的做法，
 * 用户文本里的任何字符都无法伪装成结构分隔符。
 * @param options - 供提炼的人消息快照。
 * @returns 送给模型的 user 文本。
 */
export function userPrompt(options) {
  return `从下面这个 JSON 数组里的用户消息生成会话标题：\n${JSON.stringify(options.messages)}`
}
