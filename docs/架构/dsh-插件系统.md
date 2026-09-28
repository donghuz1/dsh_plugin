# DSH 插件系统

面向插件作者的机制说明。以 Desktop 为主线，Web 差异处单独标注。

## 一、三层概念

| 层 | 是什么 | 载体 | 判别字段 |
| --- | --- | --- | --- |
| **profile** | 一个具名组合（`desktop`、`web`、`headless`…），是"启动哪个应用" | `~/.dsh/profiles/<名>/` | `package.json` 的 `dsh.profile.bundles` |
| **bundle** | 一个 patch 层，向 profile 插行/改行/禁用行 | 任意 npm 包 | `package.json` 的 `dsh.bundle.patch` |
| **plugin** | 真正被加载的代码，是 Loader 里的一"行" | 模块（`name` 指向） | `dsh.client`（浏览器半区）/ 无（仅 Host） |

三者解耦：一个 bundle 可以什么都没有，只插别人写的插件的行（MCP 配置包就是这样）；一个插件包也可以不是 bundle。

`dsh.profile` 与 `dsh.bundle` 是互斥的两个角色，一个包不同时是两者。

## 二、profile 目录

| 文件 | 作用 |
| --- | --- |
| `cordis.yml` | Loader 的 include 根，**永远是 `[]`** |
| `cordis.patch.yml` | 用户自己的 patch 层 |
| `package.json` | 树外依赖（pnpm 管）+ `dsh.profile.bundles` |
| `pnpm-workspace.yaml` | pnpm ≥10 从这里读设置 |

`cordis.yml` 恒为 `[]` 有三个原因：所有行都由 patch 的 `insert` 提供；`Include` 需要一个真实文件来锚定 `baseUrl` 到 profile 目录；每次启动重写它，以免 Loader 的树回写把组合结果烘进文件导致下次启动重复插入。

`dsh.profile.bundles` 是**有序层列表**，后面的层覆盖前面的层。只算直接条目，不传递。名字先从 dsh 安装解析、再从 profile 目录解析——所以内置 bundle 永远与运行中的 `dsh` 同版本，pnpm 不管它们。列表里的名字若其 manifest 缺 `dsh.bundle`，是硬错误。

## 三、组合顺序

`packages/boot/app-boot/src/profile-context.ts:63-75` 是唯一真源：

```
1. 各 bundle 的 patch        （dsh.profile.bundles 顺序）
2. profile 的 cordis.patch.yml
3. $DSH_HOME/cordis.patch.yml   ← 机器级，优先级高于 per-profile
4. --patch 文件                 （argv 顺序）
5. 遥测禁用 patch               （最后追加，不可被上层覆盖）
```

### 一条 patch 的语义

- patch **替换目标行的整个 `config`**，绝不深合并。
- `name` 是**断言**不是选择器：不匹配则 warn 并跳过。
- id 未命中 → warn 并跳过（不致命）。只有 overlay 文件本身缺失/不可解析才致命。
- `disabled: null` 等于删键。
- 行序**不承载加载语义**：激活由服务可用性驱动，不由 YAML 顺序驱动。

### 行（`EntryOptions`）与 patch（`PatchOptions`）

```yaml
# 无 id 的 insert：追加到顶层
- insert:
    - id: qoder-theme            # 稳定 id，Loader 据此区分"改配置"与"删+加"
      name: '@local/dsh-qoder-theme'
      disabled: true             # 保留条目但不挂载
      config: { ... }            # 整段替换，不是合并
```

有 `id` 的 `insert` 要求目标存在**且是 group**，行 push 进 `target.config`。

插入的行**立即建入索引**，所以更靠后的层可以配置/禁用更早层插入的行——内置 bundle、profile patch 的覆盖能力都建立在这上面。

## 四、插件形态

`name` 解析成模块后，`Loader.unwrapExports` 做归一化：`exports.default ?? exports`，再处理 esbuild 的 `__esModule` 互操作。

这是**事故 0001 的根因**（见 `docs/postmortem/0001-acp-default-export-drops-inject.md`）：

> 一旦存在 `export default`，归一化就取到那个默认导出，**整个 ESM 命名空间被丢弃**。而 `inject` / `name` / `Config` 是**兄弟命名导出**，于是全部丢失，ACP 完全不可用。

于是有硬规则（`packages/AGENTS.md`）：

| 形态 | 写法 | `inject`/`Config` 放哪 |
| --- | --- | --- |
| **函数插件** | 命名导出 `name`/`inject`/`Config`/`apply`，**绝不加 `export default`** | 命名导出上 |
| **服务插件** | `export default class X extends Service` | `static` 成员上 |

之所以命名导出能生效：Loader 把**整个 ESM 命名空间对象**当对象形态插件传入（`isApplicable` 认 `typeof .apply === 'function'`），于是 `callback = namespace.apply`，元数据从命名空间上读。

形态校验只有一道硬门：`invalid plugin, expect function or object with an "apply" method, received ${typeof plugin}`。**没有任何机制拒绝混用**——混用是静默丢元数据。

## 五、Cordis 运行时

### 依赖注入

`inject: ['tools']` 是**硬依赖**：服务缺失时 fiber 停在 `PENDING`，不执行 `apply`，**不抛错**；服务消失后依赖方自动卸载，恢复后自动重载。

可选依赖必须用 `ctx.get(name)`（全局 isolate store），**不要**用 `ctx.name`——属性代理沿祖先链解析，未声明 inject 的读会抛 `cannot get property "x" without inject`。

| | `inject: ['x']` + `ctx.x` | `ctx.get('x')` |
| --- | --- | --- |
| 缺失时 | fiber `PENDING`，不执行 | 正常执行，读到 `undefined` |
| 提供方消失 | 自动卸载，恢复后重载 | 无自动反应 |

### effect

`ctx.effect(fn, label)` 的 `fn` 立即执行，返回 disposer（或 promise / 产出多个 disposer 的迭代器）。卸载时**按注册逆序启动，但多个异步 disposer 并发**——拆除必须有序时，放进同一个 disposer 内。

已是 effect 的 API：`ctx.on` / `ctx.once` / `ctx.provide` / `ctx.accessor` / `ctx.mixin` / `ctx.plugin` / `ctx.inject`。
**不是** effect 的：`ctx.set`（只改写自己 provide 的值）。

### 事件五种模式

| 模式 | 语义 |
| --- | --- |
| `emit` | 同步调用，返回值忽略 |
| `parallel` | 并发 await 全部，聚合错误 |
| `serial` | 按序 await，首个 bail 值即停 |
| `bail` | `serial` 的同步版 |
| `waterfall` | 环绕中间件 |

`waterfall` 的最后一个实参是**最内层默认行为**；监听器拿到 `(...args, next)`，`next()` 执行下游。**不调用 `next()` 直接返回 = 短路/否决**——所以纯观察型监听器忘记 `next()` 会静默吞掉所有下游默认行为。

模式由 JSDoc `@mode` 标签声明，三道门禁强制：缺 `@mode` 报错；尾参 `next` 与 `waterfall` 必须互相匹配；每个声明的事件必须有真实分发点。

### Config

`Config` 必须是 Standard Schema（DSH 用 schemastery），普通对象不行。在 `apply` 之前校验，失败抛 `ValidationError` 并把 fiber 置为 `FAILED`。

profile 里 `config:` 块整段替换传入，`!!js` 表达式在该行自己的 fiber context 中惰性求值。

## 六、浏览器半区

### 声明

```json
{
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-theme"]
    }
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `platform` | 唯一消费者是 web：非 `web` 值 = 该行不是 client 行，静默跳过。目前是前向兼容的选择器 |
| `immediately` | 阶段一预取（只注册工厂，不物化） |
| `inject` | **仅信息性**包名边，用于排序与 HMR diff；**不**决定激活 |
| `external` | 超出平台基座的模块请求，参与模块排序 |

硬性前置：必须导出 `./client`；bundle 必须在启动前构建好（`run pnpm run build before launch`）。

### 产物契约

`client.js` 是**经典脚本**，不是 ESM 模块：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-qoder-theme',
  factory(require) {
    return { name: 'qoder-theme', inject: ['theme'], apply(ctx) { /* ... */ } };
  },
});
```

- factory 必须惰性、无副作用；运行 bundle 只注册工厂。
- React / ReactDOM / Cordis / store / ui-slots / ui-primitives / ui-dockkit 由**冻结模块表**经注入的 `require` 提供（`PLATFORM_MODULES`）。miss 会抛错。
- 源码级 `import()` 由 tsdown 编译成 `require.async('./client.<name>.js')`。

### 启动链路

```
Host 扫描已启用行 → 读 package.json 的 dsh.client → 组合 WebBootGraph
  → 注入 window.__DSH_BOOT__ → combo 脚本（多包拼接）→ __ModuleLoader__.load 注册工厂
  → bootClient 挂到 Loader → 按需物化
```

`__ModuleLoader__` 先是队列态：只收集 `load()` 调用，直到 `create()` 时才真正建系统。

### bundle 投递

bundle 走 HTTP `/plugins` 路由（**Desktop 也一样**）。但 URL 必须是图里**公布过的那一串**：

```
/plugins/??<包名>/client.js&rev=<rev>      # combo 形式
/plugins/<包名>/client.js?rev=<rev>        # 单资源形式（HMR）
```

`bundleResource` 按**含 `rev` 的完整 pathname+search**做精确查表。缺 rev、rev 过期、未公布的组合一律 **404**（405 给非 GET/HEAD）。这是刻意设计：URL 不可伪造，响应可 immutable 缓存。

初始 rev 是**每次启动随机生成的 nonce**，所以外部无法猜出，只能从 `__DSH_BOOT__`（或 `/plugins/events`）读。

## 七、Desktop 与 Web 的差异

两者**加载同一套插件**——desktop profile 直接复用 web 的 bundle 列表（`dsh-base` + `dsh-web-app`），同一 webserver、同一 client-modules、同一 client-hmr。差别只在**谁提供文档、谁拿注入行**。

| | Web | Desktop |
| --- | --- | --- |
| 文档来源 | Host 的 `/` → `frontend-static` 渲染 index | Electron 从打包 dist 经 `dsh-app://app/` 提供 |
| 注入方式 | `webserver/index-inject` 写进 HTML 文本 | Node IPC `dshDesktopBoot.ready()` → 页面执行 `applyIndexInjections` |
| 认证 | 用户打开带 `token` 的 URL → 303 + Set-Cookie | 主进程用带 token 的 URL 换 cookie，只留在主进程内存 |
| 端口 | 3080 | 19387 |

### Desktop 进程结构

```
Electron 主进程（窗口、菜单、dsh-app:// 协议、cookie、更新）
   └─ spawn 子进程（ELECTRON_RUN_AS_NODE=1）
        └─ apps/desktop-host：runProfile('desktop') → Cordis 树 + webserver + 全部插件
```

插件跑在**子进程**里，不在渲染进程。渲染进程无 Node、`contextIsolation` 开启。

### `dsh-app://` 协议

`apps/desktop/src/main.ts:398-411`：

- `/`、`/index.html`、`/assets/*`、`/favicon.svg`、`/manifest.webmanifest` → 读打包 dist。
- **其它所有路径** → `forwardWebRequest(request, hostUrl, hostCookie)`，即原样 HTTP 转发到 Host 的 loopback 端口并附主进程持有的 cookie。

所以 `dsh-app://app/plugins/...` 与直接请求 Host 的 `/plugins/...` 走的是**同一段服务端代码**。上一轮"Desktop 不走 HTTP 分发 bundle"的结论是错的——当时的 404 只是因为 URL 缺 `rev`。

### 认证

`GET /` 未带凭据返回 401（`authorizeIndex`）。真窗口从不请求 Host 的 `/`：主进程拿 `authenticatedUrl()`（含进程级随机 launch token）换 303 + `Set-Cookie`，cookie 只存主进程内存，由转发时注入；渲染进程拿不到 token 与 cookie。

WebSocket 走另一条头改写钩子，只为归属窗口附 origin/cookie。

## 八、管理面

`plugin_manager`（agent 工具 + Web 侧栏，同一服务）每个 action 都需要 `danger-full-access` 或单次审批。

| action | `target` 是什么 | 改什么 |
| --- | --- | --- |
| `list_plugins` / `list_bundles` | — | 只读；`list_plugins` 每行给出 `enabled` 与 `fiberPhase` |
| `set_plugin` | **`entryId`**，形如 `include:<行id>` | `cordis.patch.yml` 里该行的 `disabled`（保留注释与排版） |
| `set_bundle` | bundle 包名 | `package.json` 的 `dsh.profile.bundles`（启用=追加末尾，禁用=移除） |
| `install_bundle` / `remove_bundle` | bundle 包名或安装 spec | 跑 pnpm + 调 `reconcile` 维护 bundle 列表 |

`set_plugin` 的 target 是 **`entryId`（`include:<行id>`）而不是行 id**。传行 id 会得到 `unknown-plugin`——源码按 `item.entryId === id` 精确匹配（`plugin-manager/src/index.ts:305`）。

`readOnlyReason: management-required` 有两义：插件行是受保护模块（17 个自保护包，含 plugin-manager 自己）；或 bundle 的某个行是受保护的（则不可关闭）。

内置 bundle 不可移除，因为 `removable = installed && !installation has it`——安装自带的包不在 profile 的 `dependencies` 里，所以 `installed` 恒为 false。

**Desktop profile 由 CLI 独占拒绝**：`dsh --profile desktop` 与 `dsh plugin --profile desktop` 都是硬错误（`profile "desktop" is managed exclusively by the Electron application`）。只能由应用内 Host 管理，它使用 Desktop 自带的 pnpm。

## 九、HMR

- Host 侧每 500ms `statSync` 每个图行的 `client.js`（刻意用轮询：网络挂载无 inotify）。
- 变化 → `rebuilt(id)` 重哈希字节 → 重组合 → SSE `/plugins/events` 推 `rebuilt {id, rev}`。
- 页面侧 `reload()`：作废旧 factory/缓存 → 预取新 generation → 拆旧 fiber 与样式 → 重新物化 → 刷新 fiber。
- bootstrap 包被拒绝替换：`replacing bootstrap module X requires a page reload`。

**替换已安装的包需要重启**（`plugin-manager` 源码分支：同名包已存在即返回 `restart-required` 并跳过 reload）。新装 bundle 可以热应用。

**Host 半区的 JS 不在监控范围内**：HMR 只轮询每个图行的 `client.js`，改 `index.js` 不触发任何重载；重装同名包、切换启停也不重建模块代。Host 逻辑改完必须重启进程才生效——客户端插件能热更，Host 插件不能。

## 十、给插件作者的四条硬约束

1. **函数插件绝不加 `export default`**；服务插件用 `export default class`。混用静默丢元数据。
2. **可选服务一律 `ctx.get(name)`**；`ctx.<name>` 只用于已声明的 `inject`。
3. **令牌名之类的字符串标识不会被运行时校验**——写错只静默失效。用测试对照权威源逐个校验（本仓库的 `test/contract.test.mjs` 就是这么做的）。
4. **`apply` 里的回填/补跑必须幂等**——它每次插件加载都会执行。只处理「还没有本插件产物」的对象，并显式识别自己的产物（如标题的 `source.kind === 'provider' && source.provider === <自己的 id>`）。认不出自己的产物，就会在每次启动时重复付出代价，还会覆盖或漂移既有结果。

## 十一、四个身份字符串

插件里有四个名字，含义不同，最容易搞混：

| 名称 | 例 | 说明 |
| --- | --- | --- |
| **包名** | `@local/dsh-qoder-theme` | 模块 specifier，也是浏览器 factory 的 `id` |
| **行 `id`** | `qoder-theme` | Loader 树里的稳定身份，patch 靠它定位。可自由取名 |
| **行 `name`** | `@local/dsh-qoder-theme` | 要 `import` 什么。**必须等于包名**，或是文件路径 |
| **插件导出的 `name`** | `qoder-theme` | 可选，只用于 fiber 诊断 |

必须守住的不变式：

```
行 name  ==  包名  ==  __ModuleLoader__.load({ id }) 的 id
```

错了不会报错，只会静默不生效——用契约测试断言它。

## 十二、四层诊断：插件生效了吗

「生效」是四件不同的事。混在一起查会卡住；分开查，每层都有明确判据。

| 层 | 问题 | 判据 | 不通过的含义 |
| --- | --- | --- | --- |
| 1 | **装上了吗** | `list_plugins` 里有没有你的行 | 没有 → 安装没成功，或 `dsh.bundle.patch` 路径不对 |
| 2 | **加载了吗**（`apply` 跑过没） | 该行的 `fiberPhase` | 见下表 |
| 3 | **注册的东西进去了吗** | 按插件类型不同，见下 | 插件是好的，但你注册的东西没被采纳 |
| 4 | **行为符合预期吗** | 肉眼看 / 问模型 | 前三层都对，问题在使用侧 |

### 第 2 层：`fiberPhase` 是权威判据

```
plugin_manager action=list_plugins  →  找你那行的 fiberPhase
```

| `fiberPhase` | 含义 | 下一步 |
| --- | --- | --- |
| `active` | 加载成功，`apply` 已执行 | 往下查第 3、4 层 |
| `pending` | 缺依赖服务，`apply` **没执行** | 检查 `inject` 里列的服务是否真的存在——这条不报错 |
| `loading` | 正在执行 `apply` | 卡住说明 `apply` 里有 await 没返回 |
| `failed` | `apply` 抛错，或 `Config` 校验失败 | 是少数会响的错误 |
| `null` | 没有活 fiber | 该行被禁用（`enabled: false`），或模块根本没解析成功 |

真实观测样本：

```json
{"entryId":"include:qoder-theme","moduleName":"@local/dsh-qoder-theme","enabled":true,"fiberPhase":"active"}
{"entryId":"include:ui-schedule","enabled":false,"fiberPhase":null}
```

GUI 里也能看：**设置 → 插件 → 插件列表**。

### 第 3 层：按插件类型验证注册结果

| 插件类型 | 判据 |
| --- | --- |
| **客户端插件** | `curl -N --max-time 3 -s http://127.0.0.1:19387/plugins/events`，boot graph 的 `entries` 里应有它，且 `url` 请求得到 200 与逐字节一致的产物 |
| **工具插件** | `cordis_inspect_query` platform=host provider=Tool method=listTools，应出现你的工具名 |
| **服务插件** | `cordis_inspect_query` platform=host provider=Service method=listService，应出现你的服务键 |
| **事件 / 提示词 / 主题令牌 / provider 注册** | 没有通用探测点，只能靠第 4 层；单例槽位类注册另有信号——槽位被占时注册抛错，该行 `fiberPhase` 会是 `failed` |

### 关键判断

**第 2 层 `active` 但第 4 层没反应，问题一定不在「插件没生效」，而在「你注册的东西没被用到」。**

这两类问题原因完全不同：前者查 `inject` / 模块解析 / 包结构，后者查事件名、slot key、令牌名有没有写错（都不报错）。先分清是哪一类，能省掉大量时间。

## 十三、症状 → 原因

DSH 里绝大多数错误是静默的，这张表按"你看到什么"倒查。

| 症状 | 原因 | 为什么难发现 |
| --- | --- | --- |
| 插件装了但完全没反应 | 函数插件加了 `export default`，命名空间被 `unwrapExports` 丢弃 | 静默丢 `inject`/`name`/`Config`（真实事故 0001） |
| 插件装了但完全没反应 | 缺 Host 入口文件（`exports["."]` / `main` 不可解析） | **非致命**：只写一行 stderr 警告，Desktop 界面上看不到 |
| 插件装了但完全没反应 | 漏了 `dsh.client.platform: "web"` | 该行不被认作 client 行，静默跳过 |
| 浏览器半区不加载 | `exports["./client"]` 缺失 | 这条是**响的**：扫描时直接抛错 |
| 启动失败 | `client.js` 未构建 | `MissingClientBundleError`，提示 run build |
| `apply` 里什么都没跑 | 声明的 `inject` 服务不存在 | fiber 停在 `PENDING`，不执行也不抛错 |
| 抛 `cannot get property "x" without inject` | 用 `ctx.x` 读未声明的服务 | 属性代理沿祖先链解析，与全局 store 不同 |
| 下游行为全消失 | `waterfall` 监听器忘记调用 `next()` | 不调即否决，静默短路 |
| 插件停用后有残留 | 资源没包在 `ctx.effect()` 里 | 只有 Cordis API 建立的注册会自动撤销 |
| 样式 / UI 不生效 | 令牌名、slot 名写错 | 字符串标识不做运行时校验 |
| 重装 / 切启停后插件从 boot graph 消失 | 移动了插件目录，包名没变 | 客户端模块注册表按 specifier 缓存元数据，**只有重启进程才清** |

### 怎么自查

1. **看有没有激活警告**：`dsh: warning: N entry did not activate`，逐行给出 `行id (模块): 原因`。
2. **看 boot graph**：`curl -N --max-time 3 -s http://127.0.0.1:19387/plugins/events`（client-hmr 的 SSE，无需鉴权）。确认你的插件在不在、`inject`/`immediately` 对不对。
3. **看产物是否可取**：用 graph 里公布的 `url` 原样请求，与本地产物逐字节比对。
4. **查 API 而不是猜**：`cordis_inspect_list` → `cordis_inspect_query` 读 Service / Event / Config / Slots / Theme 的确切契约。

## 十四、纯 Host 插件

本仓库第一个无浏览器半区的插件是 `plugins/session-title-rule/`（注册会话标题 provider）。它的形态与 client 插件不同。

### 声明

`package.json` 只需 `dsh.bundle.patch`；`exports["."]` 指向 Host 入口，不写 `dsh.client`：

```json
{
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

patch 层可以 disable 别的行——这是接管**单例槽位**类服务的唯一途径（例如 `sessionTitle` 全局只接受一个 provider，已注册再注册直接抛错）：

```yaml
- id: session-title-llm     # 目标行的 id（不是包名）
  disabled: true
- insert:
    - id: <插件名>
      name: '@local/dsh-<插件名>'
```

### 依赖边界：插件目录解析不到内置包

插件被 `link:` 进 profile 后，Node 从**插件真实路径**解析模块，够不到 profile 的 `node_modules`：

```bash
$NODE -e "require.resolve('@deepseek-ai/dsh-llm',{paths:['<插件目录>']})"   # MODULE_NOT_FOUND
```

所以 Host 插件**零 import**：全部通过 `ctx` 服务交互（`ctx.llm.stream()`、`ctx.sessionTitle.register()`…）。代价是类型没了，形状假设要靠 `test/contract.test.mjs` 对照权威源钉死。

`ctx.effect(fn, label)` 里 `fn` 的返回值才是本插件的 disposer——别的服务（如 `sessionTitle.register()`）返回的 disposer 挂在它自己的 fiber 上，必须显式收进自己的 effect，否则插件停用后注册项仍占着槽位。

### 权威源：运行中的 DSH 优先于源码 checkout

`cordis_inspect_query` 读的是**运行进程**的契约；`DSH_SOURCE` 指向的 checkout 可能落后或领先于它。实测差异：运行时契约有 `GenerateOptions.messages: RequestMessage[]`（含 `RequestUserInput`），源码 checkout 只有 `Message[]`。

推论：

- 写代码时**取两版都接受的形状**（如完整 `Message`，而不是只在某一版存在的 `RequestUserInput`）。
- 契约测试锚定源码 checkout 有盲区；源码不在时相关用例跳过即可，别把它当成运行版本的证据。

### 环境变量：`DSH_PROFILE` 不是路径

| 变量 | 内容 |
| --- | --- |
| `DSH_PROFILE` | profile **名**（如 `desktop`），不是目录 |
| `DSH_PROFILE_DIR` | profile 目录的绝对路径 |
| `DSH_HOME` | `~/.dsh` |
| `DSH_SESSION_ID` | 当前会话 id |

测试脚本里拼 profile 路径要用 `DSH_PROFILE_DIR`；拿 `DSH_PROFILE` 当路径会得到一个不存在的相对目录，`existsSync` 静默返回 false，用例悄悄跳过。

<!-- 更新记录：2026-09-28, 新增「纯 Host 插件」一节（半区声明、依赖边界、权威源、环境变量）, §十四 -->
<!-- 更新记录：2026-09-28, HMR 节补充 Host 半区不热重载；硬约束增补「回填必须幂等」, §九 · §十 -->

