/**
 * 会话提醒：审批 pending 与会话完成时弹桌面系统通知。
 *
 * 生成物 —— 由 `node build.mjs` 从 src/client.js 产出，请勿手改。
 *
 * 为什么订阅 `uiSession.sessionStatus` 而不是 `remote.$on('approval/request')`：
 * `approval/request` 是 waterfall，`ui-approval` 的监听器会接管请求并等待用户
 * 作答（不调用 `next()`），后注册的观察者永远收不到。`sessionStatus` 是
 * `ui-approval` 发布 pending 之后的会话状态投影，覆盖所有会话。
 */
window.__ModuleLoader__.load({
  id: '__PLUGIN_ID__',
  factory() {
    const NS = 'sessionNotify'
    const MAX_REASON = 200

    const zh = {
      approvalTitle: '需要审批',
      approvalBody: '工具 {tool} 正在等待审批。',
      completionTitle: '会话已完成',
      completionBody: '{session} 已结束，点击查看。',
      reasonLine: '原因：{reason}',
      sessionLine: '会话：{title}',
      sessionFallback: '会话 {id}',
    }

    const en = {
      approvalTitle: 'Approval needed',
      approvalBody: '{tool} is waiting for approval.',
      completionTitle: 'Session finished',
      completionBody: '{session} finished. Click to open.',
      reasonLine: 'Reason: {reason}',
      sessionLine: 'Session: {title}',
      sessionFallback: 'Session {id}',
    }

    /** 截断到 max 个 Unicode 码点，避免超长 reason 撑爆通知正文。 */
    function truncate(text, max) {
      const points = Array.from(text)
      return points.length <= max ? text : points.slice(0, max).join('') + '…'
    }

    function shortId(sessionId) {
      return String(sessionId).slice(0, 8)
    }

    /** 会话标题；标题尚未生成时返回 undefined。 */
    function titleOf(sessions, sessionId) {
      const row = sessions.list.getSnapshot().byId[sessionId]
      const title = row === undefined ? undefined : row.title
      return typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined
    }

    function sessionLabel(sessions, t, sessionId) {
      const title = titleOf(sessions, sessionId)
      return title === undefined
        ? t('sessionFallback', { id: shortId(sessionId) })
        : t('sessionLine', { title })
    }

    /** 根会话才发完成通知；subagent 子会话的结束不是一次用户可感知的完成。 */
    function isRootSession(sessions, sessionId) {
      const row = sessions.list.getSnapshot().byId[sessionId]
      if (row === undefined) return false
      return row.origin !== 'subagent' && row.parentSessionId === undefined
    }

    /** 当前页是否正在看这个会话；是则不需要再弹完成通知。 */
    function isWatching(uiSession, sessionId) {
      const adapter = uiSession.adapter
      const current = adapter === undefined ? undefined : adapter.current
      const currentId = current === undefined || current.value === undefined ? undefined : current.value.key
      if (currentId !== sessionId) return false
      if (typeof document === 'undefined') return false
      if (document.visibilityState !== undefined && document.visibilityState !== 'visible') return false
      if (typeof document.hasFocus === 'function') {
        try {
          if (!document.hasFocus()) return false
        } catch (error) {
          // 读不到焦点时按未聚焦处理，宁可多提醒一次。
        }
      }
      return true
    }

    return {
      name: 'session-notify',
      inject: ['uiSession', 'sessions', 'locale'],
      apply(ctx) {
        let disposed = false
        let initialized = false
        let permission
        const seenApprovals = new Set()
        const lastRunning = new Map()
        const sessions = ctx.sessions
        const uiSession = ctx.uiSession

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-notify: dictionaries')
        const t = ctx.locale.bind(NS)

        function permissionGranted() {
          if (typeof Notification === 'undefined') return Promise.resolve(false)
          if (Notification.permission === 'granted') return Promise.resolve(true)
          if (Notification.permission === 'denied') return Promise.resolve(false)
          if (permission !== undefined) return permission
          try {
            permission = Promise.resolve(Notification.requestPermission()).then(
              result => result === 'granted',
              () => false,
            )
          } catch (error) {
            permission = Promise.resolve(false)
          }
          return permission
        }

        function activate(sessionId) {
          try {
            if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus()
          } catch (error) {
            // 聚焦失败不阻断会话跳转。
          }
          const workspace = ctx.get('uiWorkspace')
          if (workspace === undefined || typeof workspace.openSession !== 'function') return
          try {
            workspace.openSession(sessionId)
          } catch (error) {
            // 会话可能已归档或地址不可达。
          }
        }

        function show(title, body, sessionId) {
          if (disposed) return
          permissionGranted().then((granted) => {
            if (!granted || disposed) return
            try {
              const notification = new Notification(title, { body })
              notification.onclick = function onClick() {
                activate(sessionId)
                try {
                  notification.close()
                } catch (error) {
                  // 通知可能已被系统关闭。
                }
              }
            } catch (error) {
              // 通知 API 不可用时静默。
            }
          }, () => {})
        }

        function notifyApproval(sessionId, pending) {
          const parts = [
            t('approvalBody', { tool: pending.toolName }),
            sessionLabel(sessions, t, sessionId),
          ]
          const reason = typeof pending.reason === 'string' ? pending.reason.trim() : ''
          if (reason !== '') parts.push(t('reasonLine', { reason: truncate(reason, MAX_REASON) }))
          show(t('approvalTitle'), parts.join('\n'), sessionId)
        }

        function notifyCompletion(sessionId) {
          const title = titleOf(sessions, sessionId)
          const name = title === undefined ? t('sessionFallback', { id: shortId(sessionId) }) : title
          show(t('completionTitle'), t('completionBody', { session: name }), sessionId)
        }

        function onStatusChange() {
          if (disposed) return
          const snapshot = uiSession.sessionStatus.getSnapshot()
          snapshot.forEach((status, sessionId) => {
            const pending = status.pendingInteraction
            if (pending === undefined || pending.kind !== 'approval' || seenApprovals.has(pending.key)) return
            seenApprovals.add(pending.key)
            notifyApproval(sessionId, pending)
          })
          snapshot.forEach((status, sessionId) => {
            const previous = lastRunning.get(sessionId)
            if (initialized && previous === true && status.running === false
              && isRootSession(sessions, sessionId) && !isWatching(uiSession, sessionId)) {
              notifyCompletion(sessionId)
            }
            lastRunning.set(sessionId, status.running)
          })
          for (const sessionId of lastRunning.keys()) {
            if (!snapshot.has(sessionId)) lastRunning.delete(sessionId)
          }
          initialized = true
        }

        ctx.effect(() => {
          const dispose = uiSession.sessionStatus.subscribe(onStatusChange)
          onStatusChange()
          return () => {
            disposed = true
            dispose()
          }
        }, 'session-notify: session status subscription')
      },
    }
  },
})
