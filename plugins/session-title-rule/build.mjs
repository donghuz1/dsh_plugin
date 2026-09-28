/**
 * 把 src/client.js 模板里的包名占位符换成 package.json 的真实包名，产出 client.js。
 *
 * 为什么要这一步：`__ModuleLoader__.load({ id })` 的 id 必须等于包名（DSH 靠它
 * 对应 boot graph 的条目），手抄一遍包名必然漂移。让包名只有一个来源
 * （package.json），并在构建期断言三处命名一致。
 *
 * 零依赖。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PLACEHOLDER = '__PLUGIN_ID__'

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const template = await readFile(join(ROOT, 'src', 'client.js'), 'utf8')
const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')

// AGENTS.md §二.2：目录名、包名、Loader 行 id 三处必须一致。行 id 由包名推导
// （@local/dsh-<插件名> → <插件名>），这里在构建期把三者的关系钉死。
const dirName = basename(ROOT)
const rowId = pkg.name.replace(/^@local\/dsh-/, '')
if (dirName !== rowId) {
  throw new Error(`目录名 "${dirName}" 与包名推导出的行 id "${rowId}" 不一致`)
}
if (!patch.includes(`id: ${rowId}`)) {
  throw new Error(`cordis.patch.yml 里找不到行 id: ${rowId}`)
}
if (!patch.includes(pkg.name)) {
  throw new Error(`cordis.patch.yml 里找不到包名 ${pkg.name}`)
}
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`src/client.js 里找不到占位符 ${PLACEHOLDER}`)
}

const generated = template.replaceAll(PLACEHOLDER, pkg.name)
if (generated.includes(PLACEHOLDER)) {
  throw new Error(`${PLACEHOLDER} 没有被完全替换`)
}

const banner = `/**
 * 生成物 —— 由 \`node build.mjs\` 从 src/client.js 产出，请勿手改。
 */
`
await writeFile(join(ROOT, 'client.js'), banner + generated)
console.log(`client.js 已生成：插件 id ${pkg.name}（行 id ${rowId}）`)
