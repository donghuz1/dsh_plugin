# session-title-rule 发布与分享

## 目标

把 `plugins/session-title-rule` 发布到 GitHub，用固定 tag 指向插件子目录，让其他人通过
`plugin_manager install_bundle` 安装；包名保持 `@local/dsh-session-title-rule`，不引入 npm scope。

## 约束与已确认

- 仓库公开，GitHub 账号 `donghuz1`，本机 SSH 已确认可推送。
- 版本 `1.0.0`，tag `session-title-rule-v1.0.0`。
- 当前 DSH 运行时 `0.2.1-rc.3`；`engines.dsh` 取 `^0.2.1-rc.2`，安装时不满足由 `install_bundle` 拒绝。
- 安装 spec：`git+https://github.com/donghuz1/dsh_plugin.git#session-title-rule-v1.0.0&path:/plugins/session-title-rule`。
- 升级没有原位通道：先 `remove_bundle`，再按新 tag 安装。

## 影响文件清单

- `plugins/session-title-rule/package.json`：`license` / `author` / `keywords` / `repository` / `engines.dsh`
- `plugins/session-title-rule/README.md`：远程安装、本地开发安装、升级命令
- `README.md`：给其他人安装的通用说明
- `LICENSE`：仓库级 MIT
- 本任务文件

## 验收标准

- 插件门禁通过：`build.mjs`、`node --check client.js`、`node --test 'test/*.test.mjs'`。
- 用本地模拟仓库执行 `pnpm add "git+file://…#session-title-rule-v1.0.0&path:/plugins/session-title-rule"` 成功安装，安装后的包名与 `client.js` 的模块 id 一致。
- 推到 GitHub 后，朋友执行 `install_bundle`，`list_plugins` 出现 `session-title-rule` 且 `fiberPhase: active`，新会话标题按 `MMDD｜类型｜主题` 生成。

## 验证与结果

- 插件门禁：60 用例，59 通过、1 跳过（依赖 DSH 源码的契约用例按既有逻辑跳过）。
- 本地模拟：把插件目录复制进临时 git 仓库并打 `session-title-rule-v1.0.0`，用
  `pnpm add "git+file:///tmp/…#session-title-rule-v1.0.0&path:/plugins/session-title-rule"` 安装成功；
  安装后的包名、`client.js` 模块 id、`cordis.patch.yml`、`engines.dsh` 均与仓库一致。
- 待办：在 GitHub 建公开仓库并 push tag；朋友安装后的标题行为待验证。
