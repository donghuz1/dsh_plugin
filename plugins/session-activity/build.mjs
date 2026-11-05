/**
 * 把 src/model.js 与 src/client.js 组装成 client.js。
 *
 * 为什么需要构建：经典脚本不能 `import`，纯模型又要能直接被测试 import；
 * 所以模型写在 ESM 里，构建时去掉唯一的 `export { ... }` 再内联进 factory。
 *
 * 同时把命名三处一致（目录名 / 包名 / Loader 行 id）与产物不变量钉死在构建期。
 * 零依赖。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ID_PLACEHOLDER = '__PLUGIN_ID__'
const MODEL_PLACEHOLDER = '/* __MODEL__ */'

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
const template = await readFile(join(ROOT, 'src', 'client.js'), 'utf8')
const model = await readFile(join(ROOT, 'src', 'model.js'), 'utf8')

const dirName = basename(ROOT)
const rowId = pkg.name.replace(/^@local\/dsh-/, '')
if (dirName !== rowId) {
  throw new Error(`目录名 "${dirName}" 与包名推导出的行 id "${rowId}" 不一致`)
}
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('package.json 必须声明 dsh.bundle.patch: ./cordis.patch.yml')
}
if (pkg.dsh?.client?.platform !== 'web') {
  throw new Error('package.json 必须声明 dsh.client.platform: web')
}
if (pkg.exports?.['./client'] !== './client.js') {
  throw new Error('package.json 必须导出 ./client -> ./client.js')
}
if (!patch.includes(`id: ${rowId}`) || !patch.includes(pkg.name)) {
  throw new Error('cordis.patch.yml 必须包含行 id 与包名')
}

const strippedModel = model.replace(/^export \{[^}]*\}\s*$/m, '').trim()
if (/^export\b/m.test(strippedModel)) {
  throw new Error('src/model.js 只能有一个末尾的 export { ... } 语句')
}
if (strippedModel === '') {
  throw new Error('src/model.js 内联后为空')
}

if (!template.includes(ID_PLACEHOLDER)) throw new Error(`src/client.js 里找不到占位符 ${ID_PLACEHOLDER}`)
if (!template.includes(MODEL_PLACEHOLDER)) throw new Error(`src/client.js 里找不到占位符 ${MODEL_PLACEHOLDER}`)
if (/\bexport\s+(default\s+)?(function|const|class|\{)/.test(template)) {
  throw new Error('src/client.js 必须是经典脚本，不能含 ESM export')
}

const indentedModel = strippedModel
  .split('\n')
  .map(line => (line === '' ? '' : `    ${line}`))
  .join('\n')

const generated = template
  .replaceAll(ID_PLACEHOLDER, pkg.name)
  // 占位符独占一行且带缩进；整行替换，避免首行多叠一层缩进。
  .replace(/^[ \t]*\/\* __MODEL__ \*\/[ \t]*$/m, indentedModel)

if (generated.includes(ID_PLACEHOLDER) || generated.includes(MODEL_PLACEHOLDER)) {
  throw new Error('占位符没有被完全替换')
}

// 产物必须真的带上运行时依赖的字符串标识。字符串不校验，写错只会静默失效，
// 所以在构建期逐个确认它们出现在产物里。
for (const marker of [
  'sidebar.panellist', 'shell.overlay', 'sessionStatus', 'completionUnread',
  'adapter', 'openSession', 'dsh.session-activity.default-open', "require('react')", "require('react-dom')",
]) {
  if (!generated.includes(marker)) throw new Error(`client.js 缺少运行时标记：${marker}`)
}

const banner = `/**
 * 生成物 —— 由 \`node build.mjs\` 从 src/client.js + src/model.js 产出，请勿手改。
 */
`
await writeFile(join(ROOT, 'client.js'), banner + generated)
console.log(`client.js 已生成：插件 id ${pkg.name}（行 id ${rowId}，内联模型 ${strippedModel.split('\n').length} 行）`)
