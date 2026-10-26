/**
 * 契约测试：把本插件对 DSH 的每一处字符串与形状假设变成可执行门禁。
 *
 * 存在的理由：客户端插件的服务名、pending 字段、状态字段、locale API 都是
 * **静默失效**的——写错 `kind`、把 `sessionStatus` 拼成 `sessionStatuses`、
 * 用 `openSession` 之外的导航方法，都不会报错，只会让提醒不出现。这里逐个
 * 对照 DSH 源码校验。
 *
 * 注意：源码默认在 /Users/xdd/Code/project/self/deepseek-harness（与
 * session-title-rule 的契约测试一致）；本机运行时是 0.2.1-rc.3、源码检出是
 * 0.1.7-rc.2。源码缺失时相关用例显式跳过，其余用例照常执行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR_NAME = basename(ROOT)
const DSH_SOURCE = process.env.DSH_SOURCE ?? '/Users/xdd/Code/project/self/deepseek-harness'

/** 本插件依赖的 DSH 权威源文件。 */
const SOURCES = {
  uiSession: 'packages/client/ui-session/src/client/index.ts',
  uiApprovalContract: 'packages/client/ui-approval/src/client/contract/slots.ts',
  uiApproval: 'packages/client/ui-approval/src/client/index.ts',
  uiQuestionsContract: 'packages/client/ui-user-questions/src/client/contract/slots.ts',
  uiQuestions: 'packages/client/ui-user-questions/src/client/index.ts',
  uiWorkspace: 'packages/client/ui-workspace/src/client/navigation.ts',
  locale: 'packages/client/locale/src/client/index.ts',
  sessionLineage: 'packages/api/session-controller/src/client/sessions/lineage.ts',
}

const cache = new Map()

/** 读一份 DSH 源码；缺失时跳过当前用例并返回 undefined。 */
async function source(t, key) {
  const path = join(DSH_SOURCE, SOURCES[key])
  if (!existsSync(path)) {
    t.skip(`未找到 DSH 源码（${DSH_SOURCE}），跳过；设 DSH_SOURCE 指向 deepseek-harness 检出目录可启用`)
    return undefined
  }
  if (!cache.has(key)) cache.set(key, await readFile(path, 'utf8'))
  return cache.get(key)
}

test('目录名、包名、Loader 行 id 三处一致', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')

  assert.equal(pkg.name, `@local/dsh-${DIR_NAME}`, '包名必须是 @local/dsh-<目录名>')
  assert.match(patch, new RegExp(`id: ${DIR_NAME}\\b`), 'patch 行 id 必须等于目录名')
  assert.ok(patch.includes(pkg.name), 'patch 必须引用包名')
})

test('manifest：客户端半区、导出与零依赖', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.dependencies, undefined, '本插件必须零依赖')
  assert.equal(pkg.devDependencies, undefined, '本插件必须零依赖')
})

test('client.js 是生成物且带上真实包名', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const client = await readFile(join(ROOT, 'client.js'), 'utf8')
  assert.match(client, /^\/\*\*\n \* 生成物/, 'client.js 必须带生成物横幅')
  assert.match(client, /__ModuleLoader__\.load\(\{/)
  assert.ok(client.includes(`id: '${pkg.name}'`), 'loader id 必须等于包名')
  assert.ok(!client.includes('__PLUGIN_ID__'), '占位符必须被完全替换')
  for (const marker of ['sessionStatus', 'pendingInteraction', 'running', 'Notification', 'uiWorkspace']) {
    assert.ok(client.includes(marker), `client.js 必须使用 ${marker}`)
  }
})

test('locale 资源带 meta.title / meta.description', async () => {
  for (const locale of ['zh', 'en']) {
    const value = JSON.parse(await readFile(join(ROOT, 'locale', `${locale}.json`), 'utf8'))
    assert.equal(typeof value.meta?.title, 'string')
    assert.ok(value.meta.title.length > 0)
    assert.equal(typeof value.meta?.description, 'string')
    assert.ok(value.meta.description.length > 0)
  }
})

test('icon 是有效 SVG 且不超过 256 KiB', async () => {
  const icon = await readFile(join(ROOT, 'icon.svg'))
  assert.ok(icon.byteLength < 256 * 1024)
  assert.match(icon.toString('utf8'), /^<svg[\s>]/)
  assert.match(icon.toString('utf8'), /<\/svg>\s*$/)
})

test('契约：uiSession 暴露 sessionStatus / adapter.current / pendingInteraction', async (t) => {
  const text = await source(t, 'uiSession')
  if (text === undefined) return
  assert.match(text, /readonly sessionStatus: HostObservable<SessionStatusSnapshot>/)
  assert.match(text, /readonly adapter: SlotScopeAdapter/)
  assert.match(text, /current: this\.current/)
  assert.match(text, /pendingInteraction: SessionPendingInteraction/)
  assert.match(text, /completionUnread: boolean/)
})

test('契约：approval 的 pending 形状是 kind/key/toolName/reason/sessionId', async (t) => {
  const text = await source(t, 'uiApprovalContract')
  if (text === undefined) return
  assert.match(text, /readonly kind: 'approval'/)
  assert.match(text, /readonly key: string/)
  assert.match(text, /readonly toolName: string/)
  assert.match(text, /readonly reason/)
  assert.match(text, /constructor\(readonly sessionId: SessionId/)
})

test('契约：ui-approval 会接管 approval/request 并发布 pending', async (t) => {
  const text = await source(t, 'uiApproval')
  if (text === undefined) return
  assert.match(text, /registerPendingInteraction<PendingApproval>/)
  assert.match(text, /ctx\.remote\.\$on\('approval\/request'/)
})

test('契约：question / plan-review 的 pending 形状是 kind/key/questions', async (t) => {
  const text = await source(t, 'uiQuestionsContract')
  if (text === undefined) return
  assert.match(text, /readonly kind: 'question' \| 'plan-review'/)
  assert.match(text, /readonly key: string/)
  assert.match(text, /readonly questions: readonly AskUserQuestionItem\[\]/)
})

test('契约：ui-user-questions 会接管 user-questions/request 并发布 pending', async (t) => {
  const text = await source(t, 'uiQuestions')
  if (text === undefined) return
  assert.match(text, /registerPendingInteraction<PendingQuestion>/)
  assert.match(text, /ctx\.remote\.\$on\('user-questions\/request'/)
})

test('契约：uiWorkspace.openSession 存在', async (t) => {
  const text = await source(t, 'uiWorkspace')
  if (text === undefined) return
  assert.match(text, /openSession\(target: SessionTarget\): void/)
})

test('契约：locale 支持 register(ns, dicts) 与 bind(ns)', async (t) => {
  const text = await source(t, 'locale')
  if (text === undefined) return
  assert.match(text, /register\(ns: string, localeOrDicts/)
  assert.match(text, /bind\(ns: string\): Translate/)
})

test('契约：会话列表摘要带 title', async (t) => {
  const text = await source(t, 'sessionLineage')
  if (text === undefined) return
  assert.match(text, /export interface TitledSessionSummary extends SessionSummary/)
  assert.match(text, /interface TitledSessionSummary[\s\S]{0,200}title/)
})
