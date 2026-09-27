#!/usr/bin/env node
/**
 * 从 DSH 源码检出刷新 `dsh-官方文档/` 快照。
 *
 * 为什么是脚本而不是一次性拷贝：上游文档会变，手工拷贝无法复现、也无法判断
 * 快照是否过期。本脚本让「上游路径 → 本地路径」成为可重复的映射。
 *
 * 收录范围 = 两跳：
 *   1. `docs/指南/上手路线.md` 里引用的 DSH 文档（SEEDS，见下）；
 *   2. 这些文档直接链向的、位于 docs/ 内的其他 .zh.md 文档（一跳闭包）。
 * 目的：让教程里点得到的链接尽量不漏，同时把范围限制在有界的 20 余篇。
 *
 * 用法：
 *   node docs/参考/刷新-dsh-官方文档.mjs [--with-english]
 * 环境变量：
 *   DSH_SOURCE  DSH 源码检出目录，默认 ../deepseek-harness（相对本仓库根）
 *
 * 拷贝是**逐字节原样**的：不重写任何链接。这样刷新是一次干净的覆盖，
 * 也随时可以拿本地文件与上游 diff。
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** REPO = dsh_plugin 仓库根（本文件在 docs/参考/ 下，退两级）。 */
const REPO = resolve(HERE, '..', '..')
const OUT = join(HERE, 'dsh-官方文档')
const DSH = resolve(process.env.DSH_SOURCE ?? join(REPO, '..', 'deepseek-harness'))

/** 上手路线.md 引用的文档。改那个文件时同步这里。 */
const SEEDS = [
  'docs/cordis-tutorial/index.zh.md',
  'docs/cordis-tutorial/01-first-plugin.zh.md',
  'docs/cordis-tutorial/02-lifecycle-and-effects.zh.md',
  'docs/cordis-tutorial/03-services.zh.md',
  'docs/cordis-tutorial/04-events.zh.md',
  'docs/cordis-tutorial/05-config.zh.md',
  'docs/cordis-tutorial/06-composition-and-hmr.zh.md',
  'docs/cordis-tutorial/07-into-the-harness.zh.md',
  'docs/cordis-primer.zh.md',
  'docs/event-producer-consumer.zh.md',
  'docs/user/develop/framework/service.zh.md',
  'docs/cookbook/adding-a-remote-api.zh.md',
]

const withEnglish = process.argv.includes('--with-english')

if (!existsSync(join(DSH, 'docs'))) {
  console.error(`找不到 DSH 源码：${DSH}\n用 DSH_SOURCE=<路径> 指定 deepseek-harness 检出目录。`)
  process.exit(1)
}

/** 收集：SEEDS + 它们直接链向的 docs/ 内 .zh.md。 */
const wanted = new Set(SEEDS)
for (const seed of SEEDS) {
  const text = await readFile(join(DSH, seed), 'utf8')
  for (const match of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const link = match[1]
    if (/^https?:|^mailto:/.test(link)) continue
    const target = relative(DSH, resolve(dirname(join(DSH, seed)), link))
    if (!target.startsWith('docs/') || !target.endsWith('.zh.md')) continue
    if (existsSync(join(DSH, target))) wanted.add(target)
  }
}

if (withEnglish) {
  for (const file of [...wanted]) {
    const english = file.replace(/\.zh\.md$/, '.md')
    if (existsSync(join(DSH, english))) wanted.add(english)
  }
}

let bytes = 0
for (const file of [...wanted].sort()) {
  const from = join(DSH, file)
  const to = join(OUT, relative('docs', file))
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to)
  bytes += (await readFile(from)).length
}

// 许可证：MIT 要求保留版权声明。
await cp(join(DSH, 'LICENSE'), join(OUT, 'LICENSE'))

const git = (args) => execFileSync('git', ['-C', DSH, ...args], { encoding: 'utf8' }).trim()
// 「快照可复现」= 被拷贝的源文件都停在某个提交上。
// 只看 docs/ 与 LICENSE：仓库里别处的未跟踪文件（如本地 ignore）不影响快照。
const clean = git(['status', '--porcelain', '--', 'docs', 'LICENSE']) === ''
const stamp = [
  '# 本目录的快照来源',
  '#',
  '# 由 docs/参考/刷新-dsh-官方文档.mjs 生成，请勿手改。',
  '',
  `上游仓库：${DSH}`,
  `上游分支：${git(['rev-parse', '--abbrev-ref', 'HEAD'])}`,
  `上游提交：${git(['rev-parse', 'HEAD'])}`,
  `提交日期：${git(['log', '-1', '--format=%ad', '--date=short'])}`,
  `工作树干净：${clean ? '是（快照可复现）' : '否（含未提交改动，快照不可复现）'}`,
  `文件数：${wanted.size}`,
].join('\n') + '\n'
await writeFile(join(OUT, '版本.txt'), stamp)

console.log(`已刷新 ${wanted.size} 个文件（${(bytes / 1024).toFixed(0)} KB）到 ${relative(REPO, OUT)}/`)
console.log(`上游：${git(['rev-parse', '--short', 'HEAD'])}${clean ? '' : '（工作树不干净！）'}`)
if (!withEnglish) {
  console.log('未包含英文版；需要时加 --with-english（会同时拷贝每篇的 .md 对照，体积约翻倍）')
}
