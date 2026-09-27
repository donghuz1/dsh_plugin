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

| action | 改什么 |
| --- | --- |
| `set_plugin` | `cordis.patch.yml` 里该行的 `disabled`（保留注释与排版） |
| `set_bundle` | `package.json` 的 `dsh.profile.bundles`（启用=追加末尾，禁用=移除） |
| `install_bundle` / `remove_bundle` | 跑 pnpm + 调 `reconcile` 维护 bundle 列表 |

`readOnlyReason: management-required` 有两义：插件行是受保护模块（17 个自保护包，含 plugin-manager 自己）；或 bundle 的某个行是受保护的（则不可关闭）。

内置 bundle 不可移除，因为 `removable = installed && !installation has it`——安装自带的包不在 profile 的 `dependencies` 里，所以 `installed` 恒为 false。

**Desktop profile 由 CLI 独占拒绝**：`dsh --profile desktop` 与 `dsh plugin --profile desktop` 都是硬错误（`profile "desktop" is managed exclusively by the Electron application`）。只能由应用内 Host 管理，它使用 Desktop 自带的 pnpm。

## 九、HMR

- Host 侧每 500ms `statSync` 每个图行的 `client.js`（刻意用轮询：网络挂载无 inotify）。
- 变化 → `rebuilt(id)` 重哈希字节 → 重组合 → SSE `/plugins/events` 推 `rebuilt {id, rev}`。
- 页面侧 `reload()`：作废旧 factory/缓存 → 预取新 generation → 拆旧 fiber 与样式 → 重新物化 → 刷新 fiber。
- bootstrap 包被拒绝替换：`replacing bootstrap module X requires a page reload`。

**替换已安装的包需要重启**（`plugin-manager` 源码分支：同名包已存在即返回 `restart-required` 并跳过 reload）。新装 bundle 可以热应用。

## 十、给插件作者的三条硬约束

1. **函数插件绝不加 `export default`**；服务插件用 `export default class`。混用静默丢元数据。
2. **可选服务一律 `ctx.get(name)`**；`ctx.<name>` 只用于已声明的 `inject`。
3. **令牌名之类的字符串标识不会被运行时校验**——写错只静默失效。用测试对照权威源逐个校验（本仓库的 `test/contract.test.mjs` 就是这么做的）。
