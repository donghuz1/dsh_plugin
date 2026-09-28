/**
 * 纯单元测试：规则层不碰 DSH，可直接对照规则书逐条验证。
 *
 * 与 test/contract.test.mjs 的分工：本文件验证**我们自己的**逻辑正确性；
 * contract.test.mjs 验证**我们对 DSH 的假设**仍然成立。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_TITLE_BYTES,
  SEPARATOR,
  TITLE_TYPES,
  buildTitle,
  isEligibleSession,
  parseModelOutput,
  projectName,
  shanghaiMMDD,
  truncateUtf8,
  utf8Bytes,
} from '../src/rule.js'

test('类型枚举恰为规则书的八类', () => {
  assert.deepEqual(TITLE_TYPES, ['功能', '设计', '修复', '优化', '发布', '探索', '文档', '研究'])
})

test('MMDD 按 Asia/Shanghai（UTC+8）换算，不受机器时区影响', () => {
  // 2026-09-28 10:00:00 +08:00
  assert.equal(shanghaiMMDD(Date.UTC(2026, 8, 28, 2, 0, 0)), '0928')
  // 上海刚跨日：2026-09-28 00:00:00 +08:00 === 2026-09-27 16:00:00Z
  assert.equal(shanghaiMMDD(Date.parse('2026-09-27T16:00:00.000Z')), '0928')
  // 上海跨日前一秒
  assert.equal(shanghaiMMDD(Date.parse('2026-09-27T15:59:59.999Z')), '0927')
})

test('MMDD 补零到四位，跨月与跨年正确', () => {
  assert.equal(shanghaiMMDD(Date.parse('2026-01-05T00:00:00.000Z')), '0105')
  assert.equal(shanghaiMMDD(Date.parse('2025-12-31T16:00:00.000Z')), '0101')
})

test('MMDD 对非法时间戳返回 undefined，而不是编一个日期', () => {
  assert.equal(shanghaiMMDD(undefined), undefined)
  assert.equal(shanghaiMMDD(Number.NaN), undefined)
  assert.equal(shanghaiMMDD('2026-09-28'), undefined)
})

test('项目名取工作目录末段', () => {
  assert.equal(projectName('/Users/xdd/Code/project/self/dsh_plugin'), 'dsh_plugin')
  assert.equal(projectName('/Users/xdd/Code/project/self/dsh_plugin/'), 'dsh_plugin')
  assert.equal(projectName(undefined), undefined)
  assert.equal(projectName(''), undefined)
  assert.equal(projectName('/'), undefined)
})

test('按字节裁剪不劈开码点', () => {
  assert.equal(truncateUtf8('功能设计', 6), '功能')
  assert.equal(truncateUtf8('功能设计', 7), '功能')
  assert.equal(truncateUtf8('abc', 2), 'ab')
  assert.equal(truncateUtf8('abc', 3), 'abc')
  assert.equal(utf8Bytes('功能'), 6)
})

test('组装出的标题格式与字节预算都成立', () => {
  const title = buildTitle('0928', '功能', '新增会话标题插件')
  assert.equal(title, `0928${SEPARATOR}功能${SEPARATOR}新增会话标题插件`)
  assert.equal(utf8Bytes(title), 4 + 3 + 6 + 3 + 24)
})

test('超长主题被裁进服务接受的字节预算内', () => {
  const topic = '这是一个非常长的主题'.repeat(6)
  const title = buildTitle('0928', '功能', topic)
  assert.ok(utf8Bytes(title) <= MAX_TITLE_BYTES, `标题 ${utf8Bytes(title)} 字节超出 ${MAX_TITLE_BYTES}`)
  assert.ok(title.startsWith(`0928${SEPARATOR}功能${SEPARATOR}`))
  assert.ok(topic.startsWith(title.slice(`0928${SEPARATOR}功能${SEPARATOR}`.length)), '必须是主题的前缀，不做改写')
})

test('主题裁空时返回 undefined，交给上层保留原名', () => {
  assert.equal(buildTitle('0928', '功能', ''), undefined)
  assert.equal(buildTitle('0928', '功能', '   '), undefined)
})

test('解析标准输出', () => {
  assert.deepEqual(parseModelOutput('功能｜新增会话标题插件'), {
    kind: 'title', type: '功能', topic: '新增会话标题插件',
  })
})

test('半角竖线同样接受（模型常输出半角）', () => {
  assert.deepEqual(parseModelOutput('修复|登录接口 500'), {
    kind: 'title', type: '修复', topic: '登录接口 500',
  })
})

test('模型自带日期前缀时丢掉日期，不采信模型算的日期', () => {
  assert.deepEqual(parseModelOutput('0928｜功能｜新增插件'), {
    kind: 'title', type: '功能', topic: '新增插件',
  })
  assert.deepEqual(parseModelOutput('1999|优化|重构解析层'), {
    kind: 'title', type: '优化', topic: '重构解析层',
  })
})

test('主题里含竖线时保留完整主题', () => {
  assert.deepEqual(parseModelOutput('文档｜A｜B 的对照表'), {
    kind: 'title', type: '文档', topic: 'A｜B 的对照表',
  })
})

test('KEEP 哨兵（含大小写与包裹）判定为保留原名', () => {
  for (const raw of ['KEEP', 'keep', ' KEEP ', '"KEEP"', '`KEEP`']) {
    assert.deepEqual(parseModelOutput(raw), { kind: 'keep' }, `未识别：${raw}`)
  }
})

test('类型后的括注被剥掉后仍须精确命中八类', () => {
  assert.deepEqual(parseModelOutput('功能（新增页面）｜X'), { kind: 'title', type: '功能', topic: 'X' })
  assert.equal(parseModelOutput('开发（新增页面）｜X').kind, 'invalid')
})

test('类型不在八类之内即判定失败，不猜测', () => {
  for (const raw of ['开发｜新增页面', 'Feature｜add page', '重构｜抽层', '功能']) {
    assert.equal(parseModelOutput(raw).kind, 'invalid', `不该接受：${raw}`)
  }
})

test('多行输出只取第一行非空文本', () => {
  assert.deepEqual(parseModelOutput('\n  功能｜新增插件\n\n说明：这是解释'), {
    kind: 'title', type: '功能', topic: '新增插件',
  })
})

test('空输出与非法输入判定失败', () => {
  assert.equal(parseModelOutput('').kind, 'invalid')
  assert.equal(parseModelOutput('   \n  ').kind, 'invalid')
  assert.equal(parseModelOutput(undefined).kind, 'invalid')
  assert.equal(parseModelOutput('功能｜').kind, 'invalid')
})

test('只有主对话有资格被自动命名', () => {
  assert.equal(isEligibleSession({ id: 'a', createdAt: 0 }), true)
  assert.equal(isEligibleSession({ id: 'a', createdAt: 0, parentSession: 'p' }), false)
  assert.equal(isEligibleSession({ id: 'a', createdAt: 0, origin: 'subagent' }), false)
  assert.equal(isEligibleSession(undefined), false)
  assert.equal(isEligibleSession(null), false)
})
