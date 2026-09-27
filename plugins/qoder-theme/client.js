/**
 * 生成物 —— 由 `node build.mjs` 从 src/*.css 产出，请勿手改。
 *
 * 契约见 @deepseek-ai/dsh-client-modules：经典脚本、惰性 factory。
 * 主题覆盖走 ctx.theme.overrideTokens —— DSH 为一等公民提供的第三方主题接口：
 * 按来源分层叠加、运行时校验、返回 disposer；落地方式是 body 上的内联自定义
 * 属性，因此不存在样式表特异性或加载顺序问题。
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-qoder-theme",
  factory(require) {
    var SOURCE = "@local/dsh-qoder-theme";
    var TOKENS = {
  "--dsw-static-neutral-bluish-00": {
    "light": "#ffffff",
    "dark": "#ffffff"
  },
  "--dsw-static-neutral-bluish-50": {
    "light": "#fafafa",
    "dark": "#eeeeeb"
  },
  "--dsw-static-neutral-bluish-60": {
    "light": "#f5f5f3",
    "dark": "#f0f0ed"
  },
  "--dsw-static-neutral-bluish-75": {
    "light": "#f2f2f0",
    "dark": "#ededea"
  },
  "--dsw-static-neutral-bluish-100": {
    "light": "#ebebe8",
    "dark": "#dcdcd8"
  },
  "--dsw-static-neutral-bluish-150": {
    "light": "#e9e9e6",
    "dark": "#d5d5d1"
  },
  "--dsw-static-neutral-bluish-200": {
    "light": "#e5e5e2",
    "dark": "#cdcdc9"
  },
  "--dsw-static-neutral-bluish-300": {
    "light": "#d5d5d1",
    "dark": "#959590"
  },
  "--dsw-static-neutral-bluish-400": {
    "light": "#8e8c8b",
    "dark": "#7b7b76"
  },
  "--dsw-static-neutral-bluish-500": {
    "light": "#bcbbba",
    "dark": "#6b6961"
  },
  "--dsw-static-neutral-bluish-600": {
    "light": "#838280",
    "dark": "#61615c"
  },
  "--dsw-static-neutral-bluish-700": {
    "light": "#636261",
    "dark": "#4a4a45"
  },
  "--dsw-static-neutral-bluish-750": {
    "light": "#434340",
    "dark": "#484743"
  },
  "--dsw-static-neutral-bluish-800": {
    "light": "#2e2d2b",
    "dark": "#38362f"
  },
  "--dsw-static-neutral-bluish-850": {
    "light": "#232320",
    "dark": "#2f2e2b"
  },
  "--dsw-static-neutral-bluish-875": {
    "light": "#252422",
    "dark": "#252422"
  },
  "--dsw-static-neutral-bluish-900": {
    "light": "#1a1b1c",
    "dark": "#1a1b1c"
  },
  "--dsw-static-neutral-bluish-950": {
    "light": "#262522",
    "dark": "#0f1012"
  },
  "--dsw-static-neutral-bluish-1000": {
    "light": "#141414",
    "dark": "#171716"
  },
  "--dsw-static-neutral-50": {
    "light": "#f7f7f5",
    "dark": "#f7f7f5"
  },
  "--dsw-static-neutral-200": {
    "light": "#e3e3e0",
    "dark": "#e3e3e0"
  },
  "--dsw-static-neutral-300": {
    "light": "#d5d5d1",
    "dark": "#d5d5d1"
  },
  "--dsw-static-neutral-550": {
    "light": "#6b6961",
    "dark": "#6b6961"
  },
  "--dsw-static-neutral-600": {
    "light": "#57564f",
    "dark": "#57564f"
  },
  "--dsw-static-neutral-700": {
    "light": "#3d3c37",
    "dark": "#3d3c37"
  },
  "--dsw-static-neutral-800": {
    "light": "#2a2926",
    "dark": "#2a2926"
  },
  "--dsw-static-neutral-850": {
    "light": "#232320",
    "dark": "#232320"
  },
  "--dsw-static-deepseek-50": {
    "light": "#eaf7e7",
    "dark": "#1f381f"
  },
  "--dsw-static-deepseek-100": {
    "light": "#ddf2d9",
    "dark": "#264926"
  },
  "--dsw-static-deepseek-200": {
    "light": "#cdecc8",
    "dark": "#cdecc8"
  },
  "--dsw-static-deepseek-300": {
    "light": "#bdf2bb",
    "dark": "#bdf2bb"
  },
  "--dsw-static-deepseek-400": {
    "light": "#75bb6b",
    "dark": "#3ad368"
  },
  "--dsw-static-deepseek-450": {
    "light": "#27bd51",
    "dark": "#27bd51"
  },
  "--dsw-static-deepseek-500": {
    "light": "#80c776",
    "dark": "#1fa344"
  },
  "--dsw-static-deepseek-600": {
    "light": "#1c8c3c",
    "dark": "#1c8c3c"
  },
  "--dsw-static-deepseek-800": {
    "light": "#16301c",
    "dark": "#16301c"
  },
  "--dsw-static-deepseek-900": {
    "light": "#12240f",
    "dark": "#12240f"
  },
  "--dsw-static-green-100": {
    "light": "#eefaf1",
    "dark": "#eefaf1"
  },
  "--dsw-static-green-400": {
    "light": "#8cc7a3",
    "dark": "#9cc4a8"
  },
  "--dsw-static-green-500": {
    "light": "#73b78e",
    "dark": "#82b591"
  },
  "--dsw-static-green-900": {
    "light": "#1c3024",
    "dark": "#1c3024"
  },
  "--dsw-static-amber-100": {
    "light": "#fefbe8",
    "dark": "#fefbe8"
  },
  "--dsw-static-amber-400": {
    "light": "#f4c469",
    "dark": "#efc477"
  },
  "--dsw-static-amber-500": {
    "light": "#efb041",
    "dark": "#e5b357"
  },
  "--dsw-static-amber-600": {
    "light": "#e0a233",
    "dark": "#d9a94e"
  },
  "--dsw-static-amber-900": {
    "light": "#2a231c",
    "dark": "#2a231c"
  },
  "--dsw-static-red-400": {
    "light": "#ea7485",
    "dark": "#db655c"
  },
  "--dsw-static-red-600": {
    "light": "#ec5b56",
    "dark": "#ec5b56"
  },
  "--dsw-alias-brand-primary": {
    "light": "#27bd51",
    "dark": "#27bd51"
  },
  "--dsw-alias-brand-primary-new-colorprimary-new-color": {
    "light": "#27bd51",
    "dark": "#27bd51"
  },
  "--dsw-alias-button-primary-hover": {
    "light": "#3ad368",
    "dark": "#3ad368"
  },
  "--dsw-alias-button-primary-dimmed": {
    "light": "#ddf2d9",
    "dark": "#1f381f"
  },
  "--dsw-alias-label-primary-foreground": {
    "light": "#171716",
    "dark": "#171716"
  },
  "--dsw-alias-state-business-primary": {
    "light": "#3b81e9",
    "dark": "#4d7fe2"
  },
  "--dsw-alias-state-business-tertiary": {
    "light": "#e9f6fe",
    "dark": "#182231"
  },
  "--dsw-alias-button-info-fill": {
    "light": "#3b81e9",
    "dark": "#4d7fe2"
  },
  "--dsw-alias-button-info-hover": {
    "light": "#5a97ee",
    "dark": "#6a97ea"
  },
  "--dsw-alias-link": {
    "light": "#2e7d32",
    "dark": "#87d578"
  },
  "--dsw-alias-border-l1": {
    "light": "rgba(15, 13, 12, 0.06)",
    "dark": "rgba(238, 238, 235, 0.06)"
  },
  "--dsw-alias-border-l2-darkmode-thin": {
    "light": "rgba(15, 13, 12, 0.1)",
    "dark": "rgba(238, 238, 235, 0.06)"
  },
  "--dsw-alias-border-l2": {
    "light": "rgba(15, 13, 12, 0.1)",
    "dark": "rgba(238, 238, 235, 0.12)"
  },
  "--dsw-alias-border-l3": {
    "light": "rgba(15, 13, 12, 0.14)",
    "dark": "rgba(238, 238, 235, 0.16)"
  },
  "--dsw-alias-border-l4": {
    "light": "rgba(15, 13, 12, 0.26)",
    "dark": "rgba(238, 238, 235, 0.2)"
  },
  "--dsw-alias-interactive-bg-hover": {
    "light": "rgba(15, 13, 12, 0.05)",
    "dark": "rgba(238, 238, 235, 0.07)"
  },
  "--dsw-alias-interactive-bg-active": {
    "light": "rgba(15, 13, 12, 0.09)",
    "dark": "rgba(238, 238, 235, 0.12)"
  },
  "--dsw-alias-interactive-bg-hover-accent": {
    "light": "rgba(39, 189, 81, 0.12)",
    "dark": "rgba(39, 189, 81, 0.16)"
  },
  "--dsw-alias-button-tool-bar-fill-invisible": {
    "light": "rgba(31, 31, 31, 0.36)",
    "dark": "rgba(20, 20, 18, 0.36)"
  },
  "--dsw-alias-button-tool-bar-fill": {
    "light": "rgba(84, 82, 74, 0.5)",
    "dark": "rgba(84, 82, 74, 0.5)"
  },
  "--dsw-alias-button-tool-bar-hover": {
    "light": "rgba(84, 82, 74, 0.6)",
    "dark": "rgba(84, 82, 74, 0.6)"
  },
  "--dsw-alias-bg-mask-drop": {
    "light": "rgba(255, 255, 255, 0.7)",
    "dark": "rgba(42, 41, 38, 0.7)"
  },
  "--dsw-alias-bg-overlay": {
    "light": "#e9e9e6",
    "dark": "#1f1f1c"
  },
  "--dsw-specific-bubble": {
    "light": "#eaf7e7",
    "dark": "#1f1f1c"
  },
  "--dsw-specific-input-major": {
    "light": "#ffffff",
    "dark": "#171716"
  },
  "--dsw-specific-sidebar-fill": {
    "light": "#f3f3f3",
    "dark": "#1a1b1c"
  },
  "--dsw-corner-shape": {
    "light": "round",
    "dark": "round"
  },
  "--ds-ease-in-out": {
    "light": "cubic-bezier(0.22, 1, 0.36, 1)",
    "dark": "cubic-bezier(0.22, 1, 0.36, 1)"
  },
  "--ds-transition-duration": {
    "light": "0.18s",
    "dark": "0.18s"
  },
  "--ds-transition-duration-fast": {
    "light": "0.12s",
    "dark": "0.12s"
  },
  "--ds-transition-duration-slow": {
    "light": "0.26s",
    "dark": "0.26s"
  }
};
    return {
      name: 'qoder-theme',
      inject: ['theme'],
      apply: function (ctx) {
        // overrideTokens 返回移除本层的 disposer，交给 ctx.effect 管理：
        // 停用插件即精确撤下本层，恢复被它覆盖的原值。
        ctx.effect(function () {
          return ctx.theme.overrideTokens(SOURCE, TOKENS);
        }, 'qoder-theme: token layer');
      },
    };
  },
});
