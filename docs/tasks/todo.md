# Qoder 主题皮肤插件

## 目标

为 DSH Desktop 的 Web UI 交付一个**树外、零运行时依赖**的主题皮肤插件，把界面观感调成 Qoder（以 Quest 暗色态为基准），不改变任何布局结构与交互逻辑。

- 交付形态：独立插件包，装在 `/Users/xdd/Code/project/self/dsh_plugin`，通过 `plugin_manager install_bundle` 进 `desktop` profile。
- 范围：**纯主题皮肤**。只覆盖设计令牌与少量由 `[data-slot]` 定位的表面细节；不新增面板、不改 AppFrame、不替换任何既有 UI。

## 已核实的事实（方案依据）

| # | 事实 | 来源 |
| --- | --- | --- |
| 1 | 树外 bundle **零构建**可行：包声明 `dsh.bundle.patch` + `dsh.client`，`client.js` 手写调用 `window.__ModuleLoader__.load({id, factory})`，React 等从模块表 `require('react')` 取得 | `packages/preset/agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md` |
| 2 | 安装入口是 `plugin_manager` 的 `install_bundle`，target 为包的绝对路径；**不要**用 shell 复现安装步骤 | 同 1 |
| 3 | 主题寻址面之一：`ui-theme` 的 `--dsw-*` 令牌——165 个 `--dsw-alias-*`，外加字体、elevation、动效、圆角形状令牌 | `packages/client/ui-theme/src/styles/design-platform.css` |
| 4 | 主题寻址面之二：每个 slot 渲染站点都有 `[data-slot="<key>"]` 锚点，源码注释明示这是 *"the addressable seam dynamic styles target"*，且用 `display:contents` 保持布局中性 | `packages/client/ui-renderer/src/client/scoped-slots.tsx:1082` |
| 5 | **静态色阶（`--dsw-static-*`）在亮/暗两个块里是同一套**，只有 alias 映射分主题。因此在 `body[data-ds-dark-theme]` 上重声明色阶即可让该主题下全部 165 个 alias 自动重算 | `design-platform.css` 4–78 / 80–154 / 156–251 / 253–346 |
| 6 | **硬约束：没有圆角语义令牌。** `border-radius` 是 176 个 CSS module 里的字面量（6px×51、8px×46、12px×43…）。全局改圆角只能靠 hashed 类名，不可靠 | `grep border-radius` across `packages/client/**/*.module.css` |
| 7 | 强调色链路：`--dsw-alias-brand-primary` → 主按钮填充 / Switch / Checkbox / Input 聚焦边框 / focus outline；`--dsw-alias-label-primary-foreground` → 主按钮文字。DSH 暗色下该值为近白（`bluish-50`），蓝色仅用于 `link` 与 `state-business-primary` | `design-platform.css:193,290` + 组件 `.module.css` 引用 |
| 8 | 插件首次安装可经 HMR 生效；**替换已装包需重启**才能载入新的 JS 模块代 | SKILL.md |
| 9 | 本会话**无浏览器控制能力**，无法截图验证视觉结果 | 工具列表 |

Qoder 侧取证的证据分级与方法见 `docs/notes/`，色值均来自 qoder.com CSS token 原文（241 个 `--ant-*`）、官方文档源码与截图像素采样，非估算。

## 设计映射（Qoder → DSH）

### 暗色（高保真基准）

| 角色 | DSH 现值 | Qoder 目标值 | 证据 |
| --- | --- | --- | --- |
| 品牌强调色 | `bluish-50` ≈ `#f9fafb`（近白） | **`#27BD51`** | 官方文档 `<Card color="#27BD51">`，CSS fallback `#2adb5c`、截图像素 `#26b440` 三重印证 |
| 强调色上的文字 | `#0f1115` | `#171716` | qoder token 原文 |
| 应用底 / 内容区 | `#151517` | `#0f1012`（内容）· `#000`（最深） | 截图像素采样 |
| 侧栏 / chrome | `#1b1b1c` | `#1a1b1c` | 3 处独立采样 |
| 浮层 / 容器 | `#2c2c2e` | `#171716` 容器 · `#1a1a17` 抬升 | CSS token 原文 |
| 边框 l1 / l2 | `rgba(255,255,255,.06)` / `.12` | `#1d1d1b` / `#2a2926` | CSS token 原文 |
| 文字 primary/secondary/tertiary | `#f9fafb` / `#cfd3d6` / `#adb2b8` | `#eeeeeb` / `#959590` / `#7b7b76` | CSS token 原文（暖偏，非纯白） |
| success / warning / error / info | `green-500` / `amber-500` / `red-400` / — | `#82b591` / `#e5b357` / `#db655c` / `#4d7fe2` | CSS token 原文 |
| 代码字体 | `SF Mono, JetBrains Mono…` | `Menlo, Monaco, Consolas` | Qoder 唯一显式声明的代码栈 |

**Qoder 的反直觉特征（必须还原）**：暗色下侧栏比内容区**更亮**（`#1a1b1c` vs `#0f1012`），与 VS Code 相反；所有表面带微弱暖偏。DSH 现状方向一致（侧栏 `#1b1b1c` > 底色 `#151517`），只需换成暖调并拉开层次。

### 亮色（低保真适配）

qoder.com 的 `[data-theme=light]` token 有原文，但**客户端亮色态无截图支撑**，表面角色映射属推断。按同一套角色关系给值，标注为适配而非还原。

### 签名元素

1. **品牌绿氛围辉光**：`radial-gradient(ellipse, rgba(42,219,92,.08), transparent 70%)` + `blur(40px)`，置于会话空态顶部。这是最容易识别的「Qoder 味」。
2. **暖调分层背景** + 发丝描边（`#1d1d1b`）。
3. **玻璃凸起质感**：`inset 0 0 1px 1px hsla(0,0%,100%,.4)` + 内阴影，配 `480ms cubic-bezier(.22,1.35,.36,1)` 过冲弹性。
4. **Agent 活动行层级**：靠缩进 + 字号递减 + 左侧 1px 竖线建立，而非加粗或高对比色。
5. **用户消息右对齐实心气泡**（`--dsw-specific-bubble`），助手消息仍为通栏富文本。

## 方案

### 覆盖策略：改色阶，不改 165 个别名

利用事实 5，在主题作用域内重声明 `--dsw-static-neutral-bluish-*`（暖调 Qoder 阶梯）与 `--dsw-static-deepseek-*`（绿色阶梯），让全部 alias 自动重算；再单独补上不引用色阶的硬编码别名（`border-l1..l4`、各类 mask、`interactive-bg-*`、`button-tool-bar-*`）与强调色。

选择器与特异性（必须压过 `ui-theme`，且不依赖样式表顺序）：

- 亮色：`html body { … }`（0,0,2 > 0,0,1）
- 暗色：`html body[data-ds-dark-theme] { … }`（0,1,2 > 0,1,1）

### 几何与细节：只用 `[data-slot]`，不碰 hashed 类名

受事实 6 限制，圆角不做全局改写。仅对少数 `[data-slot]` 锚点做局部处理（如 composer 卡片圆角、辉光容器、活动行缩进）。所有用到的 slot key 由**测试对照真实 slot 清单**校验，杜绝写错名字静默失效。

### 文件组织

CSS 是本插件的实质内容，因此以 `.css` 为源、由零依赖 Node 脚本内联进 `client.js`（`client.js` 为生成物）。替代方案是把 CSS 写成 JS 模板字符串（无需构建，但失去语法高亮与独立校验），此处取可维护性。

## 影响文件清单

```
dsh_plugin/
├── package.json           # dsh.bundle.patch + dsh.client（immediately，inject ui-theme）
├── cordis.patch.yml       # insert 一行客户端插件
├── client.js              # 生成物：__ModuleLoader__ bootstrap + 内联 CSS
├── build.mjs              # 零依赖：拼接 src/*.css → client.js
├── src/
│   ├── ramp.dark.css      # 暗色色阶（暖调 + 绿）
│   ├── ramp.light.css     # 亮色色阶
│   ├── alias.dark.css     # 暗色硬编码别名 + 强调色
│   ├── alias.light.css    # 亮色硬编码别名 + 强调色
│   └── surfaces.css       # [data-slot] 定位的细节与签名元素
├── test/
│   └── contract.test.mjs  # 令牌名/slot 名对照真实 DSH 校验
├── README.md
└── docs/
    ├── tasks/todo.md      # 本文件
    └── notes/             # 决策笔记
```

不修改 DSH 源码仓库中的任何文件。

## 实施步骤

- [ ] 0. git：`main` 初始提交 → `develop` → 切 `feature/qoder-theme`
- [ ] 1. 最小可安装骨架（package.json / patch / client.js / build.mjs）先装一版**原样皮肤**，确认链路通（`application: applied` + client 模块出现在页面）
- [ ] 2. 建 `test/contract.test.mjs`：解析 DSH 的 `design-platform.css` 与 slot 清单，校验本插件引用的每个令牌名与 slot 名真实存在
- [ ] 3. 暗色色阶 + 硬编码别名 + 强调色（主要工作量）
- [ ] 4. 亮色适配
- [ ] 5. `surfaces.css`：辉光、composer、活动行、气泡、动效曲线
- [ ] 6. 全量门禁：跑 contract 测试、重建、重装、确认服务端产物含新 CSS
- [ ] 7. 文档：README + 决策笔记（含 Qoder 取证方法与证据分级）
- [ ] 8. review 段与经验沉淀

## 验收标准

1. `node build.mjs` 通过，`node --check client.js` 通过。
2. `test/contract.test.mjs` 全绿：所有引用的 `--dsw-*` 令牌名与 `[data-slot]` key 均在真实 DSH 中存在（防静默失效）。
3. `plugin_manager` 返回 `application: applied`；`@local/dsh-qoder-theme` 出现在客户端的已加载模块中。
4. 服务端 `GET /plugins` 相关产物包含本插件基于 Qoder 色值的样式（可 curl 验证）。
5. **视觉结果由用户在 GUI 中确认**——本会话无浏览器控制能力，我方不做也无法做截图验证；此限制须在交付说明中明示。
6. 停用插件后界面恢复原生观感，无残留样式（`ctx.effect` 清理正确）。

## 风险与不做的事

| 项 | 说明 |
| --- | --- |
| 圆角无法全局主题化 | 事实 6。仅对 `[data-slot]` 锚点局部处理，接受其余保持 DSH 原值 |
| 视觉验证缺位 | 事实 9。以契约测试 + 产物检查代替，剩余风险由用户目视确认 |
| 迭代需重启 | 事实 8。首次安装可 HMR 生效；后续替换包体需重启 |
| hashed 类名不稳定 | 全程不使用，只用令牌与 `[data-slot]` |
| 不做 | 不新增面板/设置页；不改布局；不改任何交互逻辑；不做多主题切换器（启用/停用走插件管理器） |
