/**
 * 会话提醒：任何等待用户处理的 pending interaction 与一轮结束时弹桌面系统通知。
 *
 * 生成物 —— 由 `node build.mjs` 从 src/client.js 产出，请勿手改。
 *
 * 为什么订阅 `uiSession.sessionStatus` 而不是 `remote.$on('approval/request')`：
 * `approval/request` 是 waterfall，`ui-approval` 的监听器会接管请求并等待用户
 * 作答（不调用 `next()`），后注册的观察者永远收不到。`sessionStatus` 是
 * `ui-approval` / `ui-user-questions` 发布 pending 之后的会话状态投影，覆盖
 * 审批、提问、计划确认以及未来域新增的 pending kind；未知 kind 用通用文案。
 *
 * 完成提醒只说「本轮已结束」：`sessionStatus` 只有 running 布尔，不暴露
 * `turn/end.reason`，无法在不引入会话事件流的前提下区分成功、失败与中止。
 */
window.__ModuleLoader__.load({
  id: '__PLUGIN_ID__',
  factory() {
    const NS = 'sessionNotify'
    const MAX_REASON = 200

    const zh = {
      approvalTitle: '需要审批',
      approvalBody: '工具 {tool} 正在等待审批。',
      questionTitle: '需要你的回答',
      questionBody: '{question}',
      questionMore: '另有 {count} 个问题。',
      planReviewTitle: '计划等待确认',
      planReviewBody: '计划已提交，等待你确认。',
      interactionTitle: '需要你的操作',
      interactionBody: '会话中有一步操作在等你处理。',
      completionTitle: '本轮已结束',
      completionBody: '{session} 的这一轮已结束，点击查看。',
      reasonLine: '原因：{reason}',
      sessionLine: '会话：{title}',
      sessionFallback: '会话 {id}',
    }

    const en = {
      approvalTitle: 'Approval needed',
      approvalBody: '{tool} is waiting for approval.',
      questionTitle: 'Your input is needed',
      questionBody: '{question}',
      questionMore: '{count} more questions.',
      planReviewTitle: 'Plan awaiting approval',
      planReviewBody: 'A plan is ready for your confirmation.',
      interactionTitle: 'Action needed',
      interactionBody: 'A step in this session is waiting for you.',
      completionTitle: 'Turn finished',
      completionBody: '{session} finished this turn. Click to open.',
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

    /** 取第一个问题的正文；形状不合法时返回 undefined，交给通用文案。 */
    function firstQuestion(pending) {
      if (!Array.isArray(pending.questions)) return undefined
      const question = pending.questions[0]
      if (question === null || typeof question !== 'object') return undefined
      const text = typeof question.question === 'string' ? question.question.trim() : ''
      return text === '' ? undefined : truncate(text, MAX_REASON)
    }

    /** 根会话才发完成通知；subagent 子会话的结束不是一次用户可感知的完成。 */
    function isRootSession(sessions, sessionId) {
      const row = sessions.list.getSnapshot().byId[sessionId]
      if (row === undefined) return false
      return row.origin !== 'subagent' && row.parentSessionId === undefined
    }

    /** 当前页是否正在看这个会话；是则 pending 与完成都不需要再弹。 */
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
        const seenInteractions = new Set()
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

        /**
         * 按 pending.kind 选文案；未知 kind 用通用文案，避免未来域新增的
         * 等待态被静默漏掉。审批正文仍带工具名与 reason，提问带首个问题，
         * 计划确认只提示「等待确认」，不把整段计划塞进通知。
         */
        function notifyInteraction(sessionId, pending) {
          let title
          const parts = []
          if (pending.kind === 'approval') {
            title = t('approvalTitle')
            const tool = typeof pending.toolName === 'string' && pending.toolName !== '' ? pending.toolName : undefined
            // toolName 在契约里必填；形状异常时退回通用文案，不拼出半句话。
            parts.push(tool === undefined ? t('interactionBody') : t('approvalBody', { tool }))
            const reason = typeof pending.reason === 'string' ? pending.reason.trim() : ''
            if (reason !== '') parts.push(t('reasonLine', { reason: truncate(reason, MAX_REASON) }))
          } else if (pending.kind === 'question') {
            title = t('questionTitle')
            const question = firstQuestion(pending)
            parts.push(question === undefined ? t('interactionBody') : t('questionBody', { question }))
            const count = Array.isArray(pending.questions) ? pending.questions.length : 0
            if (count > 1) parts.push(t('questionMore', { count: count - 1 }))
          } else if (pending.kind === 'plan-review') {
            title = t('planReviewTitle')
            parts.push(t('planReviewBody'))
          } else {
            title = t('interactionTitle')
            parts.push(t('interactionBody'))
          }
          parts.push(sessionLabel(sessions, t, sessionId))
          show(title, parts.join('\n'), sessionId)
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
            if (pending === undefined || seenInteractions.has(pending.key)) return
            // 先记为已见再判断是否在看：你正盯着这张卡片时不该弹系统通知，
            // 之后切走也不该补弹一条已经看过的提醒。
            seenInteractions.add(pending.key)
            if (isWatching(uiSession, sessionId)) return
            notifyInteraction(sessionId, pending)
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
