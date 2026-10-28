# session-notify 发布与分享

## 目标

把 `plugins/session-notify` 发布到已在 GitHub 的 `donghuz1/dsh_plugin`，用固定 tag 指向插件子目录，
让其他人通过 `plugin_manager install_bundle` 安装；包名保持 `@local/dsh-session-notify`。

## 约束与已确认

- 仓库公开：`https://github.com/donghuz1/dsh_plugin`，`develop` 为默认分支。
- 版本 `1.0.0`，tag `session-notify-v1.0.0`（不复用 session-title-rule 的 tag）。
- 当前 DSH 运行时 `0.2.1-rc.3`；`engines.dsh` 取 `^0.2.1-rc.2`。
- 安装 spec：`git+https://github.com/donghuz1/dsh_plugin.git#session-notify-v1.0.0&path:/plugins/session-notify`。
- 纯客户端插件；新装热应用，移动插件目录后需重装并重启。
- 升级没有原位通道：先 `remove_bundle @local/dsh-session-notify`，再按新 tag 安装。

## 影响文件清单

- `plugins/session-notify/package.json`：`license` / `author` / `keywords` / `repository` / `engines.dsh`
- `plugins/session-notify/README.md`：远程安装、本地开发安装、升级命令；验证改用 `list_plugins`
- 本任务文件

仓库根 `LICENSE` 已覆盖本插件，不新增。

## 验收标准

- 插件门禁通过：`build.mjs`、`node --check client.js`、`node --test 'test/*.test.mjs'`。
- 用公开仓库执行 `pnpm add "git+https://github.com/donghuz1/dsh_plugin.git#session-notify-v1.0.0&path:/plugins/session-notify"` 成功，安装后的包名与 `client.js` 模块 id 一致。
- 朋友执行 `install_bundle` 后 `list_plugins` 出现 `session-notify` 且 `fiberPhase: active`；审批/提问/一轮结束时收到系统通知。

## 验证与结果

（发布后补）
