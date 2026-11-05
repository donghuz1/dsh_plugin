/**
 * 契约测试：把本插件对 DSH 的每一处字符串与形状假设变成可执行门禁。
 *
 * 客户端插件的 slot 名、服务字段、组件挂载方式都是**静默失效**的——写错
 * `sidebar.panellist`、少写 `completionUnread`、误以为面板行点击可以直接
 * 换成自己的行为，都不会报错。这里逐个对照 DSH 源码校验；源码检出缺失时
 * 显式跳过，其余用例照常执行。
 *
 * 源码默认在 /Users/xdd/Code/project/self/deepseek-harness（与仓库其他插件
 * 一致），可用 DSH_SOURCE 覆盖。注意这份检出可能落后于运行中的 DSH：
 * 2026-11-05 的运行时是 0.2.2-rc.1，源码检出 0.1.7-rc.2；本插件依赖的接口
 * 已用运行中 Host 分发的 client bundle 逐项比对过，这里对源码只断言稳定形状
 * （slot 名、服务字段、注册路径），避免绑定某一版的 JSX 写法。
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
  sidebarContract: 'packages/client/ui-sidebar/src/client/contract/slots.ts',
  sidebarRoot: 'packages/client/ui-sidebar/src/client/SidebarRoot.tsx',
  layout: 'packages/client/ui-layout/src/client/index.ts',
  layoutService: 'packages/client/ui-layout/src/client/service.ts',
  appFrame: 'packages/client/ui-layout/src/client/AppFrame.tsx',
  appFrameCss: 'packages/client/ui-layout/src/client/AppFrame.module.css',
  uiSession: 'packages/client/ui-session/src/client/index.ts',
  sessionsContract: 'packages/api/session-controller/src/client/contract/sessions.ts',
  sessionService: 'packages/api/session-controller/src/client/sessions/service.ts',
  navigation: 'packages/client/ui-workspace/src/client/navigation.ts',
  locale: 'packages/client/locale/src/client/index.ts',
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
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'src/client.js', 'src/model.js', 'build.mjs', 'locale/*.json', 'icon.svg']) {
    assert.ok(pkg.files.includes(required), `files 必须包含 ${required}`)
  }
})

test('client.js 是生成物且带上真实包名与运行时标记', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const client = await readFile(join(ROOT, 'client.js'), 'utf8')
  assert.match(client, /^\/\*\*\n \* 生成物/, 'client.js 必须带生成物横幅')
  assert.match(client, /__ModuleLoader__\.load\(\{/)
  assert.ok(client.includes(`id: '${pkg.name}'`), 'loader id 必须等于包名')
  assert.ok(!client.includes('__PLUGIN_ID__'), 'id 占位符必须被完全替换')
  assert.ok(!client.includes('__MODEL__'), '模型占位符必须被完全替换')
  assert.ok(!/^\s*export\s/m.test(client), 'client.js 是经典脚本，不能残留 ESM export')
  for (const marker of [
    'sidebar.panellist', 'shell.overlay', 'sessionStatus', 'completionUnread',
    'adapter', 'openSession', 'dsh.session-activity.default-open', "require('react')",
  ]) {
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

test('契约：sidebar.panellist 是 list 席位，owner 传 size 与 active', async (t) => {
  const contract = await source(t, 'sidebarContract')
  if (contract === undefined) return
  assert.match(contract, /['"]sidebar\.panellist['"]\s*:\s*\{\s*kind:\s*'list'/)
  const owner = contract.match(/interface SidebarPanelIconOwnerProps \{[\s\S]*?\n\}/)
  assert.ok(owner, 'SidebarPanelIconOwnerProps 必须存在')
  assert.match(owner[0], /size: number/)
  assert.match(owner[0], /active: boolean/)
})

test('契约：侧栏把 entry 包进按钮，点击走 selectPanel(id)', async (t) => {
  const root = await source(t, 'sidebarRoot')
  if (root === undefined) return
  assert.match(root, /renderSlot\('sidebar\.panellist'/, '面板行必须把 glyph 渲染进 sidebar.panellist')
  assert.match(root, /selectPanel\(id\)/, '面板行按钮点击最终必须调用 selectPanel(id)')
})

test('契约：main 是 keyed 席位，selectPanel 对未注册主面板抛错', async (t) => {
  const layout = await source(t, 'layout')
  const service = await source(t, 'layoutService')
  if (layout === undefined || service === undefined) return
  assert.match(layout, /['"]main['"]\s*:\s*\{\s*kind:\s*'keyed'/, '必须存在 keyed 的 main 席位')
  assert.match(service, /selectPanel\(panelId: MainPanelId \| null\): void/)
  assert.match(service, /is not registered/, '未注册的主面板会让 selectPanel 抛错，插件必须注册 main 占位')
})

test('契约：shell.overlay 是 click-through 的全局浮层', async (t) => {
  const layout = await source(t, 'layout')
  const frame = await source(t, 'appFrame')
  const css = await source(t, 'appFrameCss')
  if (layout === undefined || frame === undefined || css === undefined) return
  assert.match(layout, /['"]shell\.overlay['"]\s*:\s*\{\s*kind:\s*'list'/)
  assert.match(frame, /renderSlot\('shell\.overlay'/)
  assert.match(css, /\.overlayLayer \{[^}]*pointer-events:\s*none/)
  assert.match(css, /\.overlayLayer > \* \{[^}]*pointer-events:\s*auto/)
})

test('契约：uiSession 暴露 sessionStatus、running、completionUnread 与 adapter.current', async (t) => {
  const uiSession = await source(t, 'uiSession')
  if (uiSession === undefined) return
  assert.match(uiSession, /readonly sessionStatus: HostObservable<SessionStatusSnapshot>/)
  assert.match(uiSession, /readonly running: boolean \| undefined/)
  assert.match(uiSession, /readonly completionUnread: boolean/)
  assert.match(uiSession, /adapter: SlotScopeAdapter/)
  assert.match(uiSession, /current: this\.current/)
})

test('契约：sessions.list 快照含 id/title/blank/origin/running/updatedAt', async (t) => {
  const contract = await source(t, 'sessionsContract')
  const service = await source(t, 'sessionService')
  if (contract === undefined || service === undefined) return
  assert.match(contract, /readonly list: ObservableSnapshot<SessionListState>/)
  const summary = service.match(/export interface SessionSummary \{[\s\S]*?\n\}/)
  assert.ok(summary, 'SessionSummary 必须存在')
  for (const field of ['id: SessionId', 'title?: string', "origin?: 'subagent'", 'running: boolean', 'blank: boolean', 'updatedAt: number']) {
    assert.ok(summary[0].includes(field), `SessionSummary 缺少 ${field}`)
  }
  const listState = service.match(/export interface SessionListState \{[\s\S]*?\n\}/)
  assert.ok(listState, 'SessionListState 必须存在')
  assert.match(listState[0], /ids: SessionId\[\]/)
  assert.match(listState[0], /byId: Record<SessionId, SessionSummary>/)
})

test('契约：uiWorkspace.openSession 存在', async (t) => {
  const navigation = await source(t, 'navigation')
  if (navigation === undefined) return
  assert.match(navigation, /openSession\(target: SessionTarget\): void/)
})

test('契约：locale 支持 register(ns, dicts) 与 bind(ns)', async (t) => {
  const locale = await source(t, 'locale')
  if (locale === undefined) return
  assert.match(locale, /register\(ns: string, localeOrDicts/)
  assert.match(locale, /bind\(ns: string\): Translate/)
})
