/**
 * user prompt 的输入预算测试。
 *
 * 存在的理由：标题 provider 的输入直接来自会话消息；长首消息（实测 71KB）
 * 会把标题调用拖慢、多花钱，甚至 30s 超时后只剩 fallback。这里把预算、
 * 截断边界和 JSON 安全性钉成断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_INPUT_BYTES, selectMessages, userPrompt } from '../src/prompt.js'

const PREFIX = '从下面这个 JSON 数组里的用户消息生成会话标题：\n'
const bytes = text => Buffer.byteLength(text, 'utf8')

/** 剥掉固定前缀并解析 JSON，顺带校验前缀没有被改掉。 */
function payload(prompt) {
  assert.ok(prompt.startsWith(PREFIX), 'user prompt 前缀必须稳定')
  return JSON.parse(prompt.slice(PREFIX.length))
}

test('短会话：全部消息原样进入 prompt', () => {
  const messages = [
    { seq: 1, text: '写一个插件' },
    { seq: 2, text: '标题用 MMDD｜类型｜主题' },
  ]
  const prompt = userPrompt({ messages })
  assert.deepEqual(payload(prompt), messages)
  assert.ok(bytes(prompt) <= MAX_INPUT_BYTES)
})

test('首条超预算：裁到预算内，保留前缀且不劈开码点', () => {
  const text = '标'.repeat(6000) // 18 KB UTF-8
  const prompt = userPrompt({ messages: [{ seq: 1, text }] })
  assert.ok(bytes(prompt) <= MAX_INPUT_BYTES, 'prompt 必须落在 4096 字节内')

  const [message] = payload(prompt)
  assert.equal(message.seq, 1)
  assert.ok(message.text.length > 0, '至少要保留一段可用文本')
  assert.ok(text.startsWith(message.text), '保留的必须是原文前缀')
  assert.ok(!message.text.includes('\uFFFD'), '截断不得劈开码点')
})

test('后续消息装不下：停在消息边界，不塞半条', () => {
  const input = [
    { seq: 1, text: '第一条' },
    { seq: 2, text: 'x'.repeat(10000) },
  ]
  const prompt = userPrompt({ messages: input })
  assert.ok(bytes(prompt) <= MAX_INPUT_BYTES)
  const messages = payload(prompt)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].text, '第一条')

  // selectMessages 是 messageSeqs 的唯一来源：被丢掉的消息不能算作标题来源。
  assert.deepEqual(selectMessages(input).map(message => message.seq), [1])
})

test('JSON 特殊字符不会撑破预算，解析仍然合法', () => {
  const text = '"\\\n\t'.repeat(4000)
  const prompt = userPrompt({ messages: [{ seq: 7, text }] })
  assert.ok(bytes(prompt) <= MAX_INPUT_BYTES)

  const [message] = payload(prompt)
  assert.equal(message.seq, 7)
  assert.ok(message.text.length > 0)
  assert.ok(text.startsWith(message.text))
})

test('空消息列表返回合法 JSON 数组', () => {
  const prompt = userPrompt({ messages: [] })
  assert.ok(bytes(prompt) <= MAX_INPUT_BYTES)
  assert.deepEqual(payload(prompt), [])
})
