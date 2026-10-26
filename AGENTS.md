# dsh_plugin — 仓库规则

本仓库是 DSH（DeepSeek Harness）插件的**容器**：一个仓库、多个插件、每个插件一个独立目录。

本文件只写**本仓库特有**的约定。跨项目常驻守则见 `~/.dsh/AGENTS.md`，不在此重复。

## 零、Node 解释器

本仓库不依赖系统 Node（`node` 很可能不在 PATH 上）。先用 DSH 内置解释器定义一个变量，**本节之后的命令都假定 `$NODE` 已存在**：

```bash
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
```

## 一、目录结构

```
dsh_plugin/
├── AGENTS.md                    # 本文件
├── README.md                    # 仓库总览与插件清单
├── docs/                        # 仓库级文档（跨插件的常驻知识）
│   ├── 架构/                    # DSH 机制说明
│   ├── 指南/                    # 上手路线、demo 教程
│   ├── 参考/dsh-官方文档/        # 上游文档快照（生成物，勿手改）
│   └── tasks/                   # 仓库级任务：active/ 在办、done/ 结项
├── tmp/<yy-MM-dd>/              # 临时文件与调研产物（已 gitignore）
└── plugins/
    └── <插件名>/                # 一个插件一个目录
        ├── package.json
        ├── index.js             # Host 半区（无 Host 行为时为空 apply）
        ├── client.js            # 浏览器半区产物（生成物）
        ├── cordis.patch.yml     # 本插件对 profile 的 patch 层
        ├── build.mjs            # 源 -> 产物的构建脚本
        ├── src/
        ├── test/
        ├── README.md
        └── docs/
            ├── notes/           # 本插件的决策笔记
            ├── 证据/            # 本插件的取值/证据
            └── tasks/           # 本插件的任务：active/ 在办、done/ 结项
```

插件放 `plugins/` 之下而非平铺在仓库根：这样「仓库基础设施（`docs/`、`tmp/`）」与「插件」界限明确，规则可机械判定，`plugins/*` 也是干净的 glob。

## 二、硬规则

以下每条都能用命令验证。

### 1. 一个插件一个目录

插件位于 `plugins/<插件名>/`，目录名用 lower-kebab-case。

```bash
ls -d plugins/*/                      # 每个条目必须是一个插件目录
```

### 2. 三处命名必须一致

| 处 | 形式 | 例 |
| --- | --- | --- |
| 目录名 | `<插件名>` | `qoder-theme` |
| npm 包名 | `@local/dsh-<插件名>` | `@local/dsh-qoder-theme` |
| Loader 行 id | `<插件名>` | `qoder-theme` |

```bash
for d in plugins/*/; do n=$(basename "$d");
  grep -q "\"name\": \"@local/dsh-$n\"" "$d/package.json" || echo "包名不符: $n";
  grep -q "id: $n" "$d/cordis.patch.yml" || echo "行 id 不符: $n";
done
```

### 3. 插件目录必须自包含

插件不得引用 `plugins/` 之外的任何路径。判据是把目录单独挪走仍能构建与测试：

```bash
for d in plugins/*/; do
  (cd "$d" && $NODE build.mjs && $NODE --check client.js && $NODE --test 'test/*.test.mjs') || exit 1
done
```

### 4. 每个插件必须零依赖构建与测试

不引入构建期依赖（现有插件用零依赖 Node 脚本）。确需引入时，先落一条决策笔记说明为什么不能用零依赖，再引。

```bash
for d in plugins/*/; do [ -d "$d/node_modules" ] && echo "引入了依赖: $d"; done
```

### 5. `client.js` 是生成物

浏览器半区产物由 `build.mjs` 从 `src/` 产出，必须提交（DSH 启动前需要已构建的产物），但**不得手改**。

```bash
cd plugins/<插件名>
$NODE build.mjs && git diff --quiet -- client.js || echo "client.js 与源不同步，需重新 build"
```

## 三、内容归属

| 内容 | 家 |
| --- | --- |
| 跨插件的常驻知识（DSH 机制、通用约定、可复用的接口说明） | `docs/` |
| **上游 DSH 官方文档的快照** | `docs/参考/dsh-官方文档/`（生成物，勿手改） |
| 插件专属的取值、证据分级、决策笔记、任务 | `plugins/<插件名>/docs/` |
| 仓库级任务（目录调整、约定变更、跨插件工作） | `docs/tasks/active/<YYYY-MM-DD>-<slug>.md`，结项移入 `docs/tasks/done/` |
| 单插件任务 | `plugins/<插件名>/docs/tasks/active/<YYYY-MM-DD>-<slug>.md`，结项移入 `done/` |
| 临时文件、调研产物、推导脚本 | `tmp/<yy-MM-dd>/<中文子目录>/`，插件专属的再加一层插件名 |

一条内容只有一个家，别处只留指向。

### 上游文档快照

`docs/参考/dsh-官方文档/` 是上游中文文档的**逐字节拷贝**，目的是读文档时不用切项目。

- **不要在这个目录里做修正**——下次刷新会覆盖。上游文档有问题去上游提；我们的指南有问题改 `docs/指南/`。
- 收录范围 = `docs/指南/上手路线.md` 引用的文档 + 它们直接链向的 `docs/` 内 `.zh.md`（两跳）。
- 快照会过期。判断是否过期看目录里的 `版本.txt`，与上游 `git log -1` 对比。

```bash
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
$NODE docs/参考/刷新-dsh-官方文档.mjs                    # DSH_SOURCE 默认 ../deepseek-harness
$NODE docs/参考/刷新-dsh-官方文档.mjs --with-english     # 同时拷英文对照
```

改 `docs/指南/上手路线.md` 的引用时，同步更新刷新脚本里的 `SEEDS`。

## 四、决策笔记编号

编号**跨插件全局递增**，这样 `git log --grep "note:NNNN"` 在全仓唯一。

文件名：`YYYY-MM-DD-NNNN-<短标题>.md`，放在 `docs/notes/`（跨插件）或 `plugins/<名>/docs/notes/`（单插件）。

取下一个可用编号：

```bash
find docs plugins -path '*/notes/*' -name '*.md' -exec basename {} \; \
  | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}' | cut -d- -f4 | sort -n | tail -1
```

五段模板（背景 / 决策 / 理由 / 替代方案 / 影响）缺一不可，见全局守则。

## 五、门禁

单插件：

```bash
cd plugins/<插件名>
$NODE build.mjs                 # 生成 client.js（含插件自己的不变量断言）
$NODE --check client.js         # 语法
$NODE --test 'test/*.test.mjs'  # 契约测试

# 产物与源同步（在插件目录里跑）
$NODE build.mjs && git diff --quiet -- client.js || echo "client.js 与源不同步，需重新 build"
```

全仓（提交前跑这个）：

```bash
for d in plugins/*/; do
  (cd "$d" && $NODE build.mjs && $NODE --check client.js && $NODE --test 'test/*.test.mjs') \
    || { echo "门禁失败: $d"; exit 1; }
done
```

## 六、安装进 profile

安装一律走 `plugin_manager`，**不要**用 shell 复现安装步骤：

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin/plugins/<插件名>
```

要点：

- 目标必须是**插件的绝对路径**，不是仓库根。profile 的 `link:` 指向这里。
- `desktop` profile 由 Electron 独占，CLI 的 `dsh plugin --profile desktop` 会被硬拒。
- 新装 bundle 可热应用；**替换同名包需要重启**才能载入新的 JS 模块代。
- **移动插件目录后必须重启应用。** 客户端模块注册表按「模块 specifier + 解析基准」缓存包元数据直到进程重启，且缓存无条件命中。当包名（specifier）没变而磁盘路径变了，缓存里仍是旧的 `clientPath`，该插件会从 boot graph 里消失——**重装、切换启停、切换 bundle 都不恢复**。
  实测：把旧路径临时补回即可让插件重新出现，证明卡点就是这份缓存。所以目录调整的正确收尾是重启应用，而不是留一个旧路径的符号链接。
- 装完的验证路径见 `README.md` 的「验证安装」一节。

## 七、新增一个插件

1. 建目录 `plugins/<插件名>/`。
2. 写下最少的可安装文件（骨架见下），确认命名符合第二节第 2 条。
3. 用 `plugin_manager install_bundle` 装进 profile，先确认链路通，再填内容。
4. 建 `test/` 里的契约测试：把插件对 DSH 的**每一处字符串假设**（令牌名、slot 名、事件名…）对照权威源逐个校验。
5. 门禁跑通后提交；`client.js` 一并提交。

最小骨架：

```
plugins/<插件名>/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # - insert: [{ id: <插件名>, name: '@local/dsh-<插件名>' }]
├── index.js              # export function apply() {}   （无 Host 行为时）
├── client.js             # 由 build.mjs 产出
├── build.mjs
├── src/
├── test/
└── README.md
```

`client.js` 是经典脚本，不是 ESM 模块：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-<插件名>',
  factory(require) {
    return { name: '<插件名>', inject: ['<服务>'], apply(ctx) { /* ... */ } };
  },
});
```

三条最容易踩的坑，详见 `docs/架构/dsh-插件系统.md`：

1. 函数插件**绝不加 `export default`**——会静默丢掉 `inject`/`name`/`Config`。
2. 可选服务一律 `ctx.get(name)`，不要用 `ctx.<name>`。
3. 字符串标识（令牌名、slot 名）不会被运行时校验，写错只静默失效——必须用契约测试兜住。

## 八、分支与提交

- 分支模型沿用全局守则的 GitFlow。本仓库实际约定：`feature/*` 从 `develop` 切出，完成后合回 `develop`；`main` 只收发布。
- commit 格式 `<type>: <描述>`，type 取 `feat`/`fix`/`refactor`/`docs`/`test`/`chore`/`perf`。
- 决策笔记对应的提交在 subject 尾部标 `[note:NNNN]`。
