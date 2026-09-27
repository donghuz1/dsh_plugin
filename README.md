# dsh_plugin

DSH（DeepSeek Harness）插件的容器仓库：一个仓库、多个插件，每个插件一个独立目录。

规则见 [AGENTS.md](AGENTS.md)。DSH 插件系统的机制说明见 [docs/架构/dsh-插件系统.md](docs/架构/dsh-插件系统.md)。

## 插件清单

| 插件 | 包名 | 作用 |
| --- | --- | --- |
| [qoder-theme](plugins/qoder-theme/README.md) | `@local/dsh-qoder-theme` | 把桌面端 UI 观感调成 [Qoder](https://qoder.com/zh)（Quest 暗色为基准）的主题皮肤，79 个设计令牌 |

## 目录

```
dsh_plugin/
├── AGENTS.md          # 仓库规则（目录、命名、门禁、新增插件的步骤）
├── README.md          # 本文件
├── docs/              # 仓库级文档：跨插件的常驻知识
│   └── 架构/dsh-插件系统.md
├── tmp/               # 临时文件与调研产物（已 gitignore）
└── plugins/
    └── qoder-theme/   # 一个插件一个目录
```

## 门禁

本仓库不依赖系统 Node（`node` 很可能不在 PATH 上）：

```bash
export NODE=~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
```

单插件：

```bash
cd plugins/qoder-theme
$NODE build.mjs
$NODE --check client.js
$NODE --test 'test/*.test.mjs'
```

全仓（提交前跑这个）：

```bash
for d in plugins/*/; do
  (cd "$d" && $NODE build.mjs && $NODE --check client.js && $NODE --test 'test/*.test.mjs') \
    || { echo "门禁失败: $d"; exit 1; }
done
```

## 验证安装

插件装进 profile 后，不依赖目视即可确认产物被正确投递：

```bash
# 1. 读当前 boot graph（client-hmr 的 SSE，无需鉴权）
curl -N --max-time 3 -s http://127.0.0.1:19387/plugins/events | grep -o '"id":"@local/dsh-qoder-theme"[^}]*}'

# 2. 用帧里公布的 url 原样请求：应得 200，内容与本地 client.js 逐字节一致
```

`/plugins` 路由按**含 `rev` 的完整 URL** 精确查表：缺 rev、rev 过期、未公布的组合一律 404，且初始 rev 是每次启动随机生成的 nonce。这是刻意设计，不是故障。

## 安装一个新插件

```
plugin_manager install_bundle /Users/xdd/Code/project/self/dsh_plugin/plugins/<插件名>
```

目标必须是**插件的绝对路径**，不是本仓库根——profile 的 `link:` 指向插件目录。不要用 shell 复现安装步骤。

`desktop` profile 由 Electron 独占，CLI 的 `dsh plugin --profile desktop` 会被硬拒。
