/**
 * 契约测试：把本插件对 DSH 的所有假设变成可执行门禁。
 *
 * 存在的理由：`theme.overrideTokens` 只校验值的形状，不校验令牌名。写错一个
 * 令牌名（例如 --dsw-alias-label-primary 拼成 --dsw-alias-label-primry）不会报错，
 * 只会静默不生效——而本插件无法目视验证结果，静默失效就等于无法发现。因此这里
 * 把令牌名对照 DSH 的真实样式表逐个校验。
 *
 * 令牌名合法性需要 DSH 源码（默认 ../deepseek-harness，可用 DSH_SOURCE 覆盖）。
 * 源码不在时该组用例会显式跳过并说明，其余用例（形状、成对、对比度）照常执行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_SOURCE = process.env.DSH_SOURCE ?? '/Users/xdd/Code/project/self/deepseek-harness'
const THEME_STYLES = join(DSH_SOURCE, 'packages/client/ui-theme/src/styles')

/**
 * 以桩执行 client.js，取出插件真实注册的内容并对空上下文跑一次 apply。
 * 走真实执行路径而非正则解析，避免测试与产物形状脱节。
 */
async function loadPlugin() {
  const source = await readFile(join(ROOT, 'client.js'), 'utf8')
  let registered = null
  const sandbox = { window: { __ModuleLoader__: { load: (definition) => { registered = definition } } }, console }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.ok(registered, 'client.js 未调用 window.__ModuleLoader__.load')

  const plugin = registered.factory(() => { throw new Error('本插件不应请求任何模块') })
  let mounted = null
  plugin.apply({
    effect: (fn) => fn(),
    theme: {
      overrideTokens: (layerSource, tokens) => {
        mounted = { layerSource, tokens }
        return () => {}
      },
    },
  })
  assert.ok(mounted, 'apply 未调用 theme.overrideTokens')
  return { registered, plugin, ...mounted }
}

const { registered, plugin, layerSource, tokens } = await loadPlugin()

test('client.js 注册的插件 id 与 package.json 一致', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(registered.id, pkg.name)
  assert.equal(layerSource, pkg.name, 'overrideTokens 的 layer 来源应为本包名')
})

test('插件声明注入 theme 服务，并通过 overrideTokens 一次挂载', () => {
  // Array.from：vm realm 里的数组与本 realm 的 Array.prototype 不同，直接深比会假失败。
  assert.deepEqual(Array.from(plugin.inject), ['theme'])
  assert.ok(Object.keys(tokens).length > 0)
})

test('每个令牌都是 {light, dark} 字符串对（镜像运行时校验）', () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.equal(typeof value, 'object', `${name} 应是对象而非裸字符串`)
    assert.equal(typeof value.light, 'string', `${name}.light 缺失`)
    assert.equal(typeof value.dark, 'string', `${name}.dark 缺失`)
    assert.ok(value.light.length > 0 && value.dark.length > 0, `${name} 有空值`)
  }
})

test('令牌名全部存在于 DSH 的真实样式表中', async (t) => {
  if (!existsSync(THEME_STYLES)) {
    t.skip(`未找到 DSH 源码（${DSH_SOURCE}），跳过令牌名校验；`
      + '设 DSH_SOURCE 指向 deepseek-harness 检出目录可启用')
    return
  }
  const declared = new Set()
  for (const file of await readdir(THEME_STYLES)) {
    if (!file.endsWith('.css')) continue
    const css = await readFile(join(THEME_STYLES, file), 'utf8')
    for (const [name] of css.matchAll(/--[a-zA-Z0-9-]+/g)) declared.add(name)
  }
  const unknown = Object.keys(tokens).filter((name) => !declared.has(name))
  assert.deepEqual(unknown, [],
    `以下令牌在 DSH 中不存在，覆盖将静默失效：\n  ${unknown.join('\n  ')}`)
})

// WCAG 相对亮度与对比度——本插件无法目视验证，对比度是可自动把关的客观指标。
const channel = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  assert.ok(match, `对比度检查只支持纯色 #rrggbb，收到：${hex}`)
  return 0.2126 * channel(parseInt(match[1], 16))
    + 0.7152 * channel(parseInt(match[2], 16))
    + 0.0722 * channel(parseInt(match[3], 16))
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const round = (n) => n.toFixed(2)

test('正文与次级文字在两个调色板下均达到 WCAG AA', () => {
  const cases = {
    dark: {
      bg: tokens['--dsw-static-neutral-bluish-950'].dark,
      text: tokens['--dsw-static-neutral-bluish-50'].dark,
      secondary: tokens['--dsw-static-neutral-bluish-300'].dark,
    },
    light: {
      bg: tokens['--dsw-static-neutral-bluish-00'].light,
      text: tokens['--dsw-static-neutral-bluish-1000'].light,
      secondary: tokens['--dsw-static-neutral-bluish-700'].light,
    },
  }
  for (const [scheme, c] of Object.entries(cases)) {
    assert.ok(contrast(c.text, c.bg) >= 4.5,
      `${scheme} 正文对比度 ${round(contrast(c.text, c.bg))} < 4.5`)
    assert.ok(contrast(c.secondary, c.bg) >= 4.5,
      `${scheme} 次级文字对比度 ${round(contrast(c.secondary, c.bg))} < 4.5`)
  }
})

test('强调色按钮上的文字在两个调色板下均达到 WCAG AA', () => {
  const brand = tokens['--dsw-alias-brand-primary']
  const onBrand = tokens['--dsw-alias-label-primary-foreground']
  for (const scheme of ['light', 'dark']) {
    const ratio = contrast(onBrand[scheme], brand[scheme])
    assert.ok(ratio >= 4.5,
      `${scheme} 强调色上的文字对比度 ${round(ratio)} < 4.5（${onBrand[scheme]} on ${brand[scheme]}）`)
  }
})

test('链接色在两个调色板下均可读', () => {
  const link = tokens['--dsw-alias-link']
  const darkBg = tokens['--dsw-static-neutral-bluish-950'].dark
  const lightBg = tokens['--dsw-static-neutral-bluish-00'].light
  assert.ok(contrast(link.dark, darkBg) >= 4.5,
    `暗色链接对比度 ${round(contrast(link.dark, darkBg))} < 4.5`)
  // 亮色是刻意偏离 Qoder 原值之处：Qoder 亮色链接 #80c776 在白底上仅 2.03:1。
  assert.ok(contrast(link.light, lightBg) >= 4.5,
    `亮色链接对比度 ${round(contrast(link.light, lightBg))} < 4.5 —— 若改回 Qoder 原值 `
    + '#80c776（2.03:1），必须同时放宽此断言并在 README 说明理由')
})
