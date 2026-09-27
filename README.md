# @local/dsh-qoder-theme

把 DeepSeek Harness 桌面端的 Web UI 观感调成 [Qoder](https://qoder.com/zh)（以 Quest 暗色态为基准）的主题皮肤插件。

不改布局、不改交互，只覆盖设计令牌。

## 安装与启停

本插件是树外 bundle，装在当前 profile（`desktop`）里。安装由 `plugin_manager` 完成，**不要**用 shell 复现安装步骤。

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin
```

启停走同一处：停用即精确撤下本插件叠加的令牌层，界面恢复原生观感。

改动 `client.js` 后需让浏览器载入新的模块代：刷新页面即可；若未生效则重启应用。

## 实现方式

覆盖走 `ctx.theme.overrideTokens(source, tokens)`——DSH 为第三方主题提供的一等公民接口：

- 按来源分层叠加，撤层即还原被覆盖的原值；
- 每个令牌以 `{ light, dark }` 成对给出，运行时会校验值形状（裸字符串会抛错）；
- 落地方式是 `body` 上的内联自定义属性，因此**不存在样式表特异性或加载顺序问题**。

覆盖的是 `--dsw-static-*` 色阶而非 165 个 `--dsw-alias-*` 别名：DSH 的静态色阶在亮/暗块中共用、语义由别名映射决定，所以只改色阶即可让全部别名自动重算。少数被多个角色共用的色阶步骤，在 `alias.*.css` 里单独拆开。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/ramp.dark.css` · `src/ramp.light.css` | 中性色阶与语义色阶，按别名角色指派。两侧令牌集合必须逐个对应 |
| `src/alias.dark.css` · `src/alias.light.css` | 不引用色阶的写死别名、以及共用色阶步骤的冲突点 |
| `src/shared.css` | 与配色无关的令牌（圆角形状、动效曲线），两侧同值 |
| `build.mjs` | 把上述声明编译成 `client.js` 的令牌表，并断言亮/暗成对 |
| `client.js` | 生成物，请勿手改 |
| `test/contract.test.mjs` | 契约门禁 |

## 门禁

```bash
node build.mjs                        # 生成 client.js（会断言令牌亮/暗成对）
node --check client.js                # 语法
node --test 'test/*.test.mjs'         # 契约测试
```

契约测试校验四件事，其中第一件是本插件唯一的静默失效风险：

1. **令牌名全部存在于 DSH 真实样式表**。`overrideTokens` 不校验令牌名，写错不会报错、只会不生效；
2. 每个令牌是 `{ light, dark }` 字符串对；
3. 插件 id 与 `package.json` 一致，且 `overrideTokens` 的 layer 来源为本包名；
4. 关键文字对的 WCAG 对比度达 AA。

令牌名校验需要 DSH 源码，默认取 `../deepseek-harness`，用 `DSH_SOURCE` 覆盖；源码不存在时该组用例显式跳过并说明，其余照常执行。

## 已知限制

- **圆角无法主题化。** DSH 没有圆角语义令牌，`border-radius` 是 176 个 CSS module 里的字面量，只能靠结构选择器硬改。本插件不做，其余圆角保持 DSH 原值。
- **视觉效果未经自动化验证。** 交付环境无浏览器控制能力，无法截图比对；已用契约测试与对比度断言替代，但最终观感需目视确认。
- **亮色为适配而非还原。** Qoder 客户端亮色态无真实截图，取值来自 qoder.com `[data-theme=light]` 的 token 原文，表面角色映射属推断。
- **未注入品牌辉光。** 辉光依赖具体容器的定位上下文，猜测放置位置的风险高于收益，待首次目视确认后在同一插件内补上。

## 色值来源与证据分级

色值取自 qoder.com CSS token 原文（241 个 `--ant-*` 变量，含 `:root` 暗色与 `[data-theme=light]` 亮色两套）、Qoder 官方文档源码、以及 IDE 截图像素采样。取证方法与逐项证据分级见 [Qoder 设计取值与证据分级](docs/证据/qoder-设计取值与证据分级.md)。

两处刻意的偏离，均已在代码注释中标明理由：

| 项 | Qoder 原值 | 本插件取值 | 理由 |
| --- | --- | --- | --- |
| 亮色链接 | `#80c776` | `#2e7d32` | 原值在白底上仅 2.03:1，不可读；取同色系深绿达 5.13:1（AA） |
| 亮色主按钮 | `#80c776` + 白字 | `#27bd51` + 深色字 | 沿用暗色品牌绿保持一致；绿底文字 7.25:1（AAA） |

Qoder 存在两套绿色：IDE 客户端主色 `#27bd51`（官方文档源码 + CSS fallback + 5 张截图像素三重印证）与官网主色 `#6ad86c`（色相差 10°）。本插件采用 IDE 那套。
