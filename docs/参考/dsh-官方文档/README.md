# DSH 官方文档快照

上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 文档的中文版快照，拷到本仓库是为了**读文档时不用切项目**。

> 快照版本见 [版本.txt](版本.txt)。**上游是唯一权威**——本目录只是某一时刻的拷贝。

## 怎么来的

由 [`../刷新-dsh-官方文档.mjs`](../刷新-dsh-官方文档.mjs) 生成，**逐字节原样拷贝，不重写任何链接**（这样刷新是一次干净的覆盖，也能随时与上游 diff）。

```bash
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
$NODE docs/参考/刷新-dsh-官方文档.mjs                    # 默认 DSH_SOURCE=../deepseek-harness
$NODE docs/参考/刷新-dsh-官方文档.mjs --with-english     # 同时拷英文对照，体积约翻倍
```

收录范围 = **两跳**：`docs/指南/上手路线.md` 引用的文档，加上它们直接链向的 `docs/` 内 `.zh.md`。

## 读什么

### 先读这四组

| 顺序 | 文档 | 讲什么 |
| --- | --- | --- |
| 1 | [cordis-primer.zh.md](cordis-primer.zh.md) | Cordis 是什么，插件、`ctx`、注册与撤销的总览 |
| 2 | [cordis-tutorial/index.zh.md](cordis-tutorial/index.zh.md) | 七章教程的目录 |
| 2 | [01-first-plugin](cordis-tutorial/01-first-plugin.zh.md) · [02-lifecycle-and-effects](cordis-tutorial/02-lifecycle-and-effects.zh.md) · [03-services](cordis-tutorial/03-services.zh.md) · [04-events](cordis-tutorial/04-events.zh.md) · [05-config](cordis-tutorial/05-config.zh.md) · [06-composition-and-hmr](cordis-tutorial/06-composition-and-hmr.zh.md) · [07-into-the-harness](cordis-tutorial/07-into-the-harness.zh.md) | 从零到进 harness 的完整主线 |
| 3 | [user/develop/framework/service](user/develop/framework/service.zh.md) · [events](user/develop/framework/events.zh.md) | 服务与作用域隔离、事件命名与模式 |
| 4 | [event-producer-consumer.zh.md](event-producer-consumer.zh.md) | 每个事件的声明方 / 分发方 / 监听方矩阵 |

### 需要时再查

| 文档 | 讲什么 |
| --- | --- |
| [cordis-api/context.zh.md](cordis-api/context.zh.md) | `Context` 精确契约 |
| [cookbook/adding-a-remote-api.zh.md](cookbook/adding-a-remote-api.zh.md) | 把 Host 能力暴露给浏览器半区 |
| [user/develop/basic/index](user/develop/basic/index.zh.md) · [tool](user/develop/basic/tool.zh.md) | 开发基本盘、写一个工具 |
| [user/develop/practice/index.zh.md](user/develop/practice/index.zh.md) | 实践索引 |
| [architecture.zh.md](architecture.zh.md) | 系统架构总览 |
| [subsystems/core.zh.md](subsystems/core.zh.md) · [approval.zh.md](subsystems/approval.zh.md) | 子系统参考 |
| [api-gateway.zh.md](api-gateway.zh.md) · [development.zh.md](development.zh.md) · [testing.zh.md](testing.zh.md) | 网关、开发与测试 |

## 已知限制

### 大量交叉链接在本地点不通

快照内共 **616 个相对链接，只有 74 个本地可达**。这是「只拷一部分」的必然结果，不是损坏：

| 死链去向 | 数量 | 说明 |
| --- | --- | --- |
| `../packages/*` 等源码 | 386 | 那是代码不是文档，未收录。想读请去上游检出 |
| 未收录的其他文档 | 136 | 位于第三跳及更远，见下 |
| 每篇顶部的 `[English](xx.md) \| 中文` | 19 | 只收录了中文版，点英文会落空。用 `--with-english` 可补齐 |
| `apps/*` | 1 | 同上，源码 |

**按文件看**，核心阅读路径是健康的：

- Cordis 教程 8 篇：每篇仅 1–3 条死链，基本就是那条英文切换链接；
- 但 [event-producer-consumer.zh.md](event-producer-consumer.zh.md) 有 **335 条**、[subsystems/core.zh.md](subsystems/core.zh.md) 73 条——前者本身就是一张指向源码的生成物矩阵，天然如此，不是快照的锅。

**要更完整**的话有两条路：装英文版（`--with-english`），或者干脆把整个 `docs/` 目录拷过来。后者是一行命令的事，只是会从 292 KB 涨到几 MB。

### 快照会过期

上游文档在变。判断是否过期看 [版本.txt](版本.txt) 里的提交号，与上游 `git log -1` 对比即可；刷新跑一次上面的命令。

### 这里是拷贝，不是改的地方

不要在本目录做修正——下次刷新会被覆盖。发现上游文档有问题，去上游提；发现我们的**指南**有问题，改 `docs/指南/`。

## 许可证

上游为 MIT 许可，Copyright (c) 2026 DeepSeek。原样保留了 [LICENSE](LICENSE)。
