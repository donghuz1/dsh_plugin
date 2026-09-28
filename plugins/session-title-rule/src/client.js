/**
 * 浏览器半区模板：由 build.mjs 把下面的包名占位符换成 package.json 的真实包名，
 * 产出仓库根目录的 client.js。
 *
 * 本插件的行为全在 Host 半区，客户端不注册任何东西——保留这个半区只是为了与
 * 仓库「每个插件都有 client.js」的门禁一致。刻意保持空实现：不添加任何未被
 * 要求的 UI 行为。
 */
window.__ModuleLoader__.load({
  id: '__PLUGIN_ID__',
  factory(require) {
    return {
      name: 'session-title-rule',
      inject: [],
      apply: function () {},
    };
  },
});
