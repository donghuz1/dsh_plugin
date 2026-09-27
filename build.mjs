/**
 * 把 src/*.css 里的令牌声明编译成 client.js 中的令牌表。
 *
 * 为什么需要这一步：DSH 的主题 API 收的是
 *   `Record<tokenName, { light: string, dark: string }>`
 * ——每个令牌必须成对给出两个调色板的值（值是裸字符串会抛教学错误）。
 * CSS 是这个令牌表的可读源；本脚本负责转成 API 需要的形状，并断言
 * 亮/暗两侧令牌集合逐个对应，缺一侧就报错，而不是让它在运行时静默失效。
 *
 * 零依赖。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC = join(ROOT, 'src')

const PLUGIN_ID = '@local/dsh-qoder-theme'

/** 层名 -> 该层包含的文件，按声明顺序解析（后者覆盖前者）。 */
const LAYERS = {
  light: ['ramp.light.css', 'alias.light.css'],
  dark: ['ramp.dark.css', 'alias.dark.css'],
}
/** 与调色板无关的令牌：同值写入两侧。 */
const SHARED = ['shared.css']

const DECLARATION = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g

/** 去掉 CSS 注释后抽取全部自定义属性声明。 */
async function declarations(file) {
  const raw = await readFile(join(SRC, file), 'utf8')
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Map()
  for (const [, name, value] of css.matchAll(DECLARATION)) {
    found.set(name, value.trim().replace(/\s+/g, ' '))
  }
  if (found.size === 0) throw new Error(`src/${file} 没有解析出任何令牌声明`)
  return found
}

const perLayer = {}
for (const [layer, files] of Object.entries(LAYERS)) {
  perLayer[layer] = new Map()
  for (const file of files) {
    for (const [name, value] of await declarations(file)) {
      perLayer[layer].set(name, value)
    }
  }
}

const shared = new Map()
for (const file of SHARED) {
  for (const [name, value] of await declarations(file)) shared.set(name, value)
}

// 断言亮/暗对称：任一令牌只在一侧出现就报错，因为 API 要求成对。
const asymmetric = []
for (const name of new Set([...perLayer.light.keys(), ...perLayer.dark.keys()])) {
  const inLight = perLayer.light.has(name)
  const inDark = perLayer.dark.has(name)
  if (inLight !== inDark) asymmetric.push(`${name}（只有${inLight ? '亮色' : '暗色'}侧）`)
}
if (asymmetric.length > 0) {
  throw new Error(
    `令牌未成对，主题 API 要求每个令牌同时给出 light 与 dark：\n  ${asymmetric.join('\n  ')}`,
  )
}

const tokens = {}
for (const [name, light] of perLayer.light) {
  tokens[name] = { light, dark: perLayer.dark.get(name) }
}
for (const [name, value] of shared) {
  tokens[name] = { light: value, dark: value }
}

const out = `/**
 * 生成物 —— 由 \`node build.mjs\` 从 src/*.css 产出，请勿手改。
 *
 * 契约见 @deepseek-ai/dsh-client-modules：经典脚本、惰性 factory。
 * 主题覆盖走 ctx.theme.overrideTokens —— DSH 为一等公民提供的第三方主题接口：
 * 按来源分层叠加、运行时校验、返回 disposer；落地方式是 body 上的内联自定义
 * 属性，因此不存在样式表特异性或加载顺序问题。
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory(require) {
    var SOURCE = ${JSON.stringify(PLUGIN_ID)};
    var TOKENS = ${JSON.stringify(tokens, null, 2)};
    return {
      name: 'qoder-theme',
      inject: ['theme'],
      apply: function (ctx) {
        // overrideTokens 返回移除本层的 disposer，交给 ctx.effect 管理：
        // 停用插件即精确撤下本层，恢复被它覆盖的原值。
        ctx.effect(function () {
          return ctx.theme.overrideTokens(SOURCE, TOKENS);
        }, 'qoder-theme: token layer');
      },
    };
  },
});
`

await writeFile(join(ROOT, 'client.js'), out)
console.log(
  `client.js 已生成：${Object.keys(tokens).length} 个令牌 `
  + `（亮/暗成对 + ${shared.size} 个共享），${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)} KB`,
)
