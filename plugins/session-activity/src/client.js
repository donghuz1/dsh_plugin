/**
 * 任务动态：侧栏「新会话」下方一行，点击向右展开运行中 / 待查看会话清单。
 *
 * 两个席位：
 * - `sidebar.panellist` 是「新会话」下方唯一已分配空间的扩展位。侧栏会把每个
 *   entry 包成一个按钮，点击默认 `selectPanel(id)`；本插件在 glyph 挂载时找到
 *   这个按钮，用原生 click 监听先于 React 根监听截住事件，把点击改成开关浮层。
 *   （为什么不用主面板：需求要的是侧栏旁的小列表，不是整页切换。）
 * - `shell.overlay` 是框架级浮层，天然不会被侧栏滚动容器裁切；浮层按侧栏按钮
 *   的 rect 固定定位到右侧。
 *
 * 数据：`uiSession.sessionStatus` 给出 running 与 completionUnread，打开会话即
 * 清除 completionUnread（主视图 retain），所以点击跳转本身就完成「已查看」。
 */
window.__ModuleLoader__.load({
  id: '__PLUGIN_ID__',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')

    const NS = 'sessionActivity'
    /** 浮层容器 id，供侧栏行的 aria-controls 指向。 */
    const PANEL_ID = 'session-activity-panel'

    const zh = {
      'panel.label': '任务动态',
      'panel.title': '任务动态',
      'section.running': '运行中',
      'section.unread': '待查看',
      empty: '没有正在运行或待查看的任务',
      untitled: '未命名会话',
      current: '当前',
      'defaultOpen': '默认展开',
      'defaultOpenHint': '开启后，打开应用时自动展开这个列表',
      close: '关闭',
      'open.aria': '跳到会话：{title}',
      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'time.months': '{n} 个月前',
      'time.years': '{n} 年前',
    }

    const en = {
      'panel.label': 'Task activity',
      'panel.title': 'Task activity',
      'section.running': 'Running',
      'section.unread': 'Finished',
      empty: 'No running or unseen tasks',
      untitled: 'Untitled session',
      current: 'Current',
      'defaultOpen': 'Open by default',
      'defaultOpenHint': 'Show this list automatically when the app starts',
      close: 'Close',
      'open.aria': 'Open session: {title}',
      'time.now': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'time.months': '{n} mo ago',
      'time.years': '{n} y ago',
    }

    /* __MODEL__ */

    /**
     * localStorage 适配器；无 localStorage、隐私模式或配额异常时退化为内存态，
     * 不影响浮层本身工作。
     */
    function createStorage() {
      try {
        if (typeof localStorage === 'undefined') return undefined
        const probe = '__dsh_session_activity_probe__'
        localStorage.setItem(probe, '1')
        localStorage.removeItem(probe)
        return {
          get: key => localStorage.getItem(key),
          set: (key, value) => localStorage.setItem(key, value),
        }
      } catch (error) {
        return undefined
      }
    }

    /** 订阅一个 ObservableSnapshot，返回当前快照；组件卸载即退订。 */
    function useObservable(source) {
      const [snapshot, setSnapshot] = React.useState(() => source.getSnapshot())
      React.useEffect(() => {
        let alive = true
        const update = () => {
          if (alive) setSnapshot(source.getSnapshot())
        }
        update()
        const dispose = source.subscribe(update)
        return () => {
          alive = false
          dispose()
        }
      }, [source])
      return snapshot
    }

    /** 订阅插件内 store；store 的 get 返回稳定快照对象。 */
    function useStore(store) {
      const [state, setState] = React.useState(() => store.get())
      React.useEffect(() => store.subscribe(() => setState(store.get())), [store])
      return state
    }

    /** 浮层打开期间每分钟刷新一次「x 分钟前」。 */
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 60000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /** 相对时间文案。 */
    function relativeLabel(now, updatedAt, t) {
      const { unit, n } = relativeTime(updatedAt, now)
      return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
    }

    const CSS = `
.dsh-sa-glyph { position: relative; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
.dsh-sa-glyph.is-open { color: var(--dsw-alias-brand-primary); }
.dsh-sa-glyph svg { display: block; }
.dsh-sa-badge {
  position: absolute; top: -5px; right: -8px; box-sizing: border-box;
  min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 8px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground);
}
.dsh-sa-badge.is-running { background: var(--dsw-alias-state-success-primary); }
.dsh-sa-panel {
  position: fixed; z-index: 200; box-sizing: border-box; pointer-events: auto;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
  font-size: 12px; line-height: 1.45; user-select: none;
}
.dsh-sa-head {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-sa-title { font-size: 13px; font-weight: 600; }
.dsh-sa-total { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh-sa-close {
  margin-left: auto; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-sa-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-sa-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px; }
.dsh-sa-section + .dsh-sa-section { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-sa-section-head {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px 2px;
  color: var(--dsw-alias-label-secondary); font-size: 11px;
}
.dsh-sa-section-count { font-variant-numeric: tabular-nums; }
.dsh-sa-list { margin: 0; padding: 0; list-style: none; }
.dsh-sa-item {
  box-sizing: border-box; width: 100%; margin: 0; padding: 7px 8px; border: 0; border-radius: 8px;
  display: flex; align-items: flex-start; gap: 8px; text-align: left;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.dsh-sa-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-sa-dot { flex: none; width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; }
.dsh-sa-dot.is-running {
  background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent);
  animation: dsh-sa-pulse 1.6s ease-in-out infinite;
}
.dsh-sa-dot.is-unread { background: var(--dsw-alias-brand-primary); }
.dsh-sa-item-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dsh-sa-item-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--dsw-alias-label-primary);
}
.dsh-sa-item-meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dsh-sa-current { color: var(--dsw-alias-brand-primary); }
.dsh-sa-empty { padding: 18px 12px; text-align: center; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sa-foot {
  flex: none; display: flex; align-items: center;
  padding: 4px 8px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-sa-pref {
  box-sizing: border-box; width: 100%; margin: 0; padding: 4px 4px; border: 0; border-radius: 6px;
  display: flex; align-items: center; gap: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer;
}
.dsh-sa-pref:hover { color: var(--dsw-alias-label-primary); }
.dsh-sa-switch {
  position: relative; flex: none; margin-left: auto; width: 26px; height: 14px; border-radius: 7px;
  background: var(--dsw-alias-border-l2); transition: background 0.15s ease;
}
.dsh-sa-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
  transition: transform 0.15s ease;
}
.dsh-sa-switch.is-on { background: var(--dsw-alias-brand-primary); }
.dsh-sa-switch.is-on::after { transform: translateX(12px); }
@keyframes dsh-sa-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) {
  .dsh-sa-dot.is-running { animation: none; }
  .dsh-sa-switch, .dsh-sa-switch::after { transition: none; }
}
`

    /** 触发图标的 SVG（心跳线 = 有任务在动）。 */
    function TriggerIcon(size) {
      return React.createElement('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, React.createElement('path', { d: 'M3 12h4l2.5-5 4 10 2.5-5h5' }))
    }

    /**
     * 造出两个组件：侧栏行 glyph 与浮层。
     * @param ctx - 客户端插件上下文（用到 uiWorkspace.openSession）。
     * @param store - createStore 产物。
     * @param t - locale 绑定后的翻译函数。
     */
    function createComponents(ctx, store, t) {
      function Trigger(props) {
        const state = useStore(store)
        const localeSnapshot = useObservable(ctx.locale)
        const nodeRef = React.useRef(null)
        React.useEffect(() => {
          const glyph = nodeRef.current
          if (glyph === null || glyph === undefined) return undefined
          const button = typeof glyph.closest === 'function' ? glyph.closest('button') : null
          if (button === null) return undefined
          const measure = () => {
            const rect = button.getBoundingClientRect()
            store.setAnchor({
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            })
            // 窄窗抽屉收起时侧栏被平移到屏幕左外；锚点离屏就收起浮层。
            if (rect.right <= 0 && store.get().open) store.close()
          }
          measure()
          store.setTrigger(button)
          button.setAttribute('aria-haspopup', 'dialog')
          const onClick = event => {
            event.preventDefault()
            event.stopPropagation()
            measure()
            store.toggle()
          }
          const onTransitionEnd = event => {
            if (event.propertyName === 'transform') measure()
          }
          button.addEventListener('click', onClick)
          // 侧栏折叠/展开是 transform 过渡；transitionend 冒泡到 document。
          document.addEventListener('transitionend', onTransitionEnd)
          window.addEventListener('resize', measure)
          const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined
          if (observer !== undefined) observer.observe(button)
          return () => {
            button.removeEventListener('click', onClick)
            button.removeAttribute('aria-haspopup')
            button.removeAttribute('aria-expanded')
            button.removeAttribute('aria-controls')
            store.setTrigger(null)
            document.removeEventListener('transitionend', onTransitionEnd)
            window.removeEventListener('resize', measure)
            if (observer !== undefined) observer.disconnect()
          }
        }, [])
        const total = countTasks(state.tasks)
        React.useEffect(() => {
          const glyph = nodeRef.current
          const button = glyph === null || glyph === undefined || typeof glyph.closest !== 'function'
            ? null
            : glyph.closest('button')
          if (button === null) return
          button.setAttribute('aria-expanded', state.open ? 'true' : 'false')
          // 角标在 aria-hidden 的 glyph 里，屏幕阅读器听不到；把数量并进可访问名称。
          button.setAttribute('aria-label', total > 0 ? `${t('panel.label')} (${total})` : t('panel.label'))
          if (state.open) button.setAttribute('aria-controls', PANEL_ID)
          else button.removeAttribute('aria-controls')
        }, [state.open, total, localeSnapshot.revision])
        const running = state.tasks.running.length > 0
        const size = typeof props.size === 'number' ? props.size : 16
        return React.createElement('span', {
          ref: nodeRef,
          className: state.open ? 'dsh-sa-glyph is-open' : 'dsh-sa-glyph',
          'aria-hidden': 'true',
        },
        TriggerIcon(size),
        total > 0
          ? React.createElement('span', {
            className: running ? 'dsh-sa-badge is-running' : 'dsh-sa-badge',
          }, total > 99 ? '99+' : String(total))
          : null)
      }

      function openSession(sessionId) {
        try {
          ctx.uiWorkspace.openSession(sessionId)
        } catch (error) {
          // 会话可能已归档或地址不可达；保持浮层可用即可。
        }
      }

      function TaskRow(task, kind, now) {
        const title = task.title === '' ? t('untitled') : task.title
        return React.createElement('li', { key: task.id },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-sa-item',
            title,
            'aria-label': t('open.aria', { title }),
            onClick: () => {
              // 切换会话不收起浮层：用户可以连着点下一个任务。
              openSession(task.id)
            },
          },
          React.createElement('span', {
            className: kind === 'running' ? 'dsh-sa-dot is-running' : 'dsh-sa-dot is-unread',
            'aria-hidden': 'true',
          }),
          React.createElement('span', { className: 'dsh-sa-item-main' },
            React.createElement('span', { className: 'dsh-sa-item-title' }, title),
            React.createElement('span', { className: 'dsh-sa-item-meta' },
              relativeLabel(now, task.updatedAt, t),
              task.current
                ? React.createElement('span', { className: 'dsh-sa-current' }, t('current'))
                : null))))
      }

      function Section(kind, titleKey, items, now) {
        if (items.length === 0) return null
        return React.createElement('section', { key: kind, className: 'dsh-sa-section' },
          React.createElement('div', { className: 'dsh-sa-section-head' },
            React.createElement('span', null, t(titleKey)),
            React.createElement('span', { className: 'dsh-sa-section-count' }, String(items.length))),
          React.createElement('ul', { className: 'dsh-sa-list' },
            items.map(task => TaskRow(task, kind, now))))
      }

      /**
       * 「更多」菜单（以及任何绕过侧栏行点击的路径）选中本插件 id 时的落点。
       *
       * layout.selectPanel 对未注册的 main key 会抛错，所以本插件必须有一个
       * `main` 占位：它被渲染时立即退回会话并展开浮层，用户看不到空白主面板，
       * 也不会留下控制台错误。
       */
      function PanelFallback() {
        React.useEffect(() => {
          const layout = ctx.get('layout')
          if (layout !== undefined && typeof layout.selectPanel === 'function') {
            try {
              layout.selectPanel('conversation')
            } catch (error) {
              // 组合里没有 conversation 主面板时保持原面板，只展开浮层。
            }
          }
          store.open()
        }, [])
        return null
      }

      function Flyout() {
        const state = useStore(store)
        const localeSnapshot = useObservable(ctx.locale)
        const panelRef = React.useRef(null)
        const now = useNow(state.open)
        React.useEffect(() => {
          if (!state.open) return undefined
          const onKeyDown = event => {
            if (event.key !== 'Escape') return
            store.close()
            store.focusTrigger()
          }
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [state.open])
        React.useEffect(() => {
          const panel = panelRef.current
          if (state.open && state.focus && panel !== null && panel !== undefined
            && typeof panel.focus === 'function') panel.focus()
        }, [state.open, state.focus])
        const anchor = state.anchor
        if (!state.open || anchor === null) return null
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const width = Math.min(328, viewportWidth - 24)
        const left = Math.max(8, Math.min(anchor.right + 10, viewportWidth - width - 8))
        const top = Math.max(8, Math.min(anchor.top - 6, viewportHeight - 160))
        const maxHeight = Math.max(180, viewportHeight - top - 12)
        const total = countTasks(state.tasks)
        const hasTasks = total > 0
        const panel = React.createElement('div', {
          ref: panelRef,
          id: PANEL_ID,
          className: 'dsh-sa-panel',
          role: 'dialog',
          'aria-label': t('panel.title'),
          'aria-modal': 'false',
          tabIndex: -1,
          'data-locale': localeSnapshot.active,
          style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${maxHeight}px` },
        },
        React.createElement('div', { className: 'dsh-sa-head' },
          React.createElement('span', { className: 'dsh-sa-title' }, t('panel.label')),
          total > 0 ? React.createElement('span', { className: 'dsh-sa-total' }, String(total)) : null,
          React.createElement('button', {
            type: 'button',
            className: 'dsh-sa-close',
            'aria-label': t('close'),
            title: t('close'),
            onClick: () => {
              store.close()
              store.focusTrigger()
            },
          }, React.createElement('svg', {
            viewBox: '0 0 16 16',
            width: 12,
            height: 12,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            'aria-hidden': 'true',
          }, React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8' })))),
        React.createElement('div', { className: 'dsh-sa-body' },
          hasTasks
            ? [
              Section('running', 'section.running', state.tasks.running, now),
              Section('unread', 'section.unread', state.tasks.unread, now),
            ]
            : React.createElement('div', { className: 'dsh-sa-empty' }, t('empty'))),
        React.createElement('div', { className: 'dsh-sa-foot' },
          React.createElement('button', {
            type: 'button',
            role: 'switch',
            className: 'dsh-sa-pref',
            'aria-checked': state.defaultOpen ? 'true' : 'false',
            title: t('defaultOpenHint'),
            onClick: () => store.setDefaultOpen(!state.defaultOpen),
          },
          React.createElement('span', null, t('defaultOpen')),
          React.createElement('span', {
            className: state.defaultOpen ? 'dsh-sa-switch is-on' : 'dsh-sa-switch',
            'aria-hidden': 'true',
          }))))
        // 浮层挂到 body：shell.overlay 层 z-index 20，窄窗 drawer 的遮罩/侧栏是
        // 70/71，留在层里会被压在遮罩后面。portal 出去才能盖住 drawer。
        return ReactDOM.createPortal(panel, document.body)
      }

      return { Flyout, PanelFallback, Trigger }
    }

    return {
      name: 'session-activity',
      inject: ['slots', 'locale', 'uiSession', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-activity: dictionaries')
        const t = ctx.locale.bind(NS)
        const store = createStore({ storage: createStorage(), defaultOpen: false })
        const { Flyout, PanelFallback, Trigger } = createComponents(ctx, store, t)

        // 侧栏行：order 小于「插件」等全局面板行，落点正好在「新会话」下方。
        // 三处席位都用 slots.inject 绑到声明生命周期：相邻席位缺失/晚声明时
        // 各自独立，不会一处失败拖垮其余注册。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'session-activity',
          order: -10,
          label: () => t('panel.label'),
        }, Trigger))

        // 主面板占位：接住任何直接 selectPanel('session-activity') 的路径，然后
        // 退回会话 + 打开浮层。没有它，layout.selectPanel 会因主面板未注册抛错。
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'session-activity',
        }, PanelFallback))

        // 浮层：框架级浮层只提供一个常驻挂载点，内容 portal 到 body。
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-activity.flyout',
          order: 30,
        }, Flyout))

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.pluginCss = 'session-activity'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'session-activity: styles')

        ctx.effect(() => {
          const sessions = ctx.sessions
          const uiSession = ctx.uiSession
          const refresh = () => {
            const list = sessions.list.getSnapshot()
            const statuses = uiSession.sessionStatus.getSnapshot()
            const current = uiSession.adapter.current.getSnapshot()
            const currentId = current === undefined || current === null ? undefined : current.key
            store.setTasks(selectTasks({ list, statuses, currentId }), currentId)
          }
          const disposers = [
            sessions.list.subscribe(refresh),
            uiSession.sessionStatus.subscribe(refresh),
            uiSession.adapter.current.subscribe(refresh),
          ]
          refresh()
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'session-activity: live session state')
      },
    }
  },
})
