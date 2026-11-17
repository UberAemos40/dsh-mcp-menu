/**
 * Client half of the MCP server menu.
 *
 * `shell.bottom` is a single seat already owned by the usage bar, so this menu
 * renders into the root-scoped `shell.overlay` layer and pins itself to the
 * same bottom strip, at its left end — the place the bar leaves empty. It is a
 * real overlay, so it declares its own pointer-events and never covers the
 * columns.
 *
 * The chip shows how many servers are live; the panel lists every configured
 * server, paints the active ones green, and drives three Host routes that own
 * the Loader entry table: state, toggle and restart. Switching a server off
 * asks first — that row is shared with every Session, so a stray click must not
 * silently remove another agent's tools.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-menu',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** `react-dom` is part of the browser module table; without it the panel
     *  still renders, it just stays inside the overlay's own box. */
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }

    const NS = 'mcpMenu'
    const STATE_URL = 'mcp-menu/api/state'
    const TOGGLE_URL = 'mcp-menu/api/toggle'
    const RESTART_URL = 'mcp-menu/api/restart'
    const POLL_MS = 20000
    const PANEL_GAP = 8
    const PANEL_MARGIN = 12
    const NOTICE_MS = 2500

    const DICTIONARIES = {
      en: {
        chip: 'MCP',
        title: 'MCP servers',
        activeOf: '{active} of {total} active',
        allOff: 'all off',
        empty: 'No MCP servers configured',
        emptyHint: 'Add a server as a dsh-mcp-client row in the profile config.',
        ready: 'connected',
        active: 'active',
        connecting: 'connecting…',
        error: 'error',
        off: 'off',
        unknown: 'unknown',
        tools: '{n} tools',
        enable: 'Enable',
        disable: 'Disable',
        restart: 'Restart',
        confirmOff: 'Turn {name} off? Its tools disappear for new turns in every session.',
        confirmYes: 'Turn off',
        cancel: 'Cancel',
        refresh: 'Refresh',
        loading: 'reading…',
        unreachable: 'unavailable',
        toggleFailed: 'The switch failed',
        restartFailed: 'The restart failed',
        restartedVia: 'Restarted {name}',
        hint: 'Applies to this profile',
        busy: 'switching…',
      },
      ru: {
        chip: 'MCP',
        title: 'MCP серверы',
        activeOf: 'активно {active} из {total}',
        allOff: 'все выключены',
        empty: 'MCP-серверы не настроены',
        emptyHint: 'Добавьте сервер строкой dsh-mcp-client в конфигурацию профиля.',
        ready: 'подключён',
        active: 'активен',
        connecting: 'подключение…',
        error: 'ошибка',
        off: 'выключен',
        unknown: 'состояние неизвестно',
        tools: '{n} инстр.',
        enable: 'Включить',
        disable: 'Выключить',
        restart: 'Перезапустить',
        confirmOff: 'Выключить {name}? Инструменты исчезнут у новых ходов во всех сессиях.',
        confirmYes: 'Выключить',
        cancel: 'Отмена',
        refresh: 'Обновить',
        loading: 'читаю…',
        unreachable: 'недоступно',
        toggleFailed: 'Не удалось переключить',
        restartFailed: 'Не удалось перезапустить',
        restartedVia: '{name} перезапущен',
        hint: 'Действует для этого профиля',
        busy: 'переключаю…',
      },
    }

    const CSS = `
      .mm-root {
        position: fixed;
        left: 10px;
        bottom: 0;
        height: 28px;
        display: flex;
        align-items: center;
        z-index: 60;
        pointer-events: none;
        box-sizing: border-box;
      }
      .mm-chip {
        all: unset;
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 21px;
        padding: 0 9px;
        box-sizing: border-box;
        border-radius: 999px;
        cursor: pointer;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
        font-size: 11.5px;
        line-height: 1;
        white-space: nowrap;
        transition: background 120ms ease, color 120ms ease;
      }
      .mm-chip:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14)); color: var(--dsw-alias-label-primary); }
      .mm-chip:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .mm-chip[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.16)); color: var(--dsw-alias-label-primary); }
      .mm-chip-label { letter-spacing: 0.04em; font-weight: 600; }
      .mm-chip-count { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); font-weight: 650; }
      .mm-chip-count.mm-quiet { color: var(--dsw-alias-label-secondary); font-weight: 500; }
      .mm-dot {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--dsw-alias-state-idle-primary);
      }
      .mm-dot.mm-ready { background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); }
      .mm-dot.mm-error { background: var(--dsw-alias-state-error-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); }
      .mm-dot.mm-connecting { background: var(--dsw-alias-state-warn-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); }
      .mm-caret { opacity: 0.55; display: inline-flex; }

      .mm-panel {
        position: fixed;
        z-index: 1100;
        box-sizing: border-box;
        width: min(360px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden auto;
        padding: 10px 10px 8px;
        border-radius: var(--dsw-radius-lg, 10px);
        /* Opaque on purpose: the menu surfaces of this theme carry alpha, which
           let the sidebar show through the panel. Base paint + tint keeps it
           solid in both themes without dropping the raised look. */
        background-color: var(--dsw-alias-bg-base, #fff);
        background-image: linear-gradient(
          var(--dsw-alias-bg-layer-1, transparent),
          var(--dsw-alias-bg-layer-1, transparent)
        );
        background-clip: padding-box;
        box-shadow: var(--dsw-elevation-prominent, 0 8px 26px rgba(0, 0, 0, 0.22));
        border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 16px;
        pointer-events: auto;
        isolation: isolate;
      }
      .mm-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 2px 4px 8px;
        color: var(--dsw-alias-label-primary);
      }
      .mm-title { font-weight: 600; letter-spacing: 0.01em; }
      .mm-count { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: 0.8; font-variant-numeric: tabular-nums; }
      .mm-rows { display: flex; flex-direction: column; gap: 2px; }
      .mm-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        padding: 7px 6px;
        border-radius: 8px;
      }
      .mm-row:hover { background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08)); }
      .mm-row.mm-row-confirm { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
      .mm-main { min-width: 0; }
      .mm-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
        font-weight: 550;
      }
      .mm-name.mm-ready { color: var(--dsw-alias-state-success-primary); }
      .mm-name.mm-error { color: var(--dsw-alias-state-error-primary); }
      .mm-sub {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10.5px;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.72;
      }
      .mm-sub.mm-error { color: var(--dsw-alias-state-error-primary); opacity: 0.9; }
      .mm-side { display: inline-flex; align-items: center; gap: 6px; }
      .mm-icon {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        color: var(--dsw-alias-label-secondary);
        background: transparent;
        opacity: 0;
        transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      }
      .mm-row:hover .mm-icon, .mm-icon:focus-visible { opacity: 1; }
      .mm-icon:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.16)); color: var(--dsw-alias-label-primary); }
      .mm-icon:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .mm-icon[disabled] { opacity: 0.25; cursor: not-allowed; }
      .mm-sw {
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        padding: 0;
        position: relative;
        width: 30px;
        height: 17px;
        flex: 0 0 auto;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        background: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.4));
        transition: background 140ms ease, opacity 140ms ease;
      }
      .mm-sw:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .mm-sw[aria-checked="true"] { background: var(--dsw-alias-state-success-primary); }
      .mm-sw[disabled] { opacity: 0.4; cursor: not-allowed; }
      .mm-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
        transition: transform 140ms ease;
      }
      .mm-sw[aria-checked="true"] .mm-knob { transform: translateX(13px); }
      .mm-confirm {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 5px;
      }
      .mm-confirm-text { flex: 1 1 100%; font-size: 10.5px; line-height: 14px; color: var(--dsw-alias-state-warn-primary); }
      .mm-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 4px 1px;
        margin-top: 4px;
        border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
        font-size: 10.5px;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.85;
      }
      .mm-btn {
        appearance: none;
        -webkit-appearance: none;
        border: none;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 20px;
        padding: 0 8px;
        border-radius: 999px;
        cursor: pointer;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
        font-size: 11px;
      }
      .mm-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14)); color: var(--dsw-alias-label-primary); }
      .mm-btn:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .mm-btn[disabled] { opacity: 0.45; cursor: progress; }
      .mm-btn.mm-danger { color: var(--dsw-alias-state-error-primary); }
      .mm-empty { padding: 10px 6px 12px; }
      .mm-empty-title { color: var(--dsw-alias-label-primary); font-weight: 550; margin-bottom: 3px; }
      .mm-empty-hint { font-size: 11px; line-height: 15px; opacity: 0.72; }
      .mm-alert { padding: 6px 6px 0; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
      .mm-notice { padding: 6px 6px 0; font-size: 11px; color: var(--dsw-alias-state-success-primary); }
    `

    const routeUrl = (path) => new URL(path, document.baseURI).toString()
    const format = (template, vars) =>
      String(template).replace(/\{(\w+)\}/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
      )

    /** The strongest level among the servers, for the chip's own dot. */
    const levelOf = (counts, servers) => {
      if (counts.total === 0) return 'idle'
      if (servers.some((server) => server.status === 'error')) return 'error'
      if (servers.some((server) => server.status === 'connecting')) return 'connecting'
      if (counts.active > 0) return 'ready'
      return 'idle'
    }

    const STATUS_CLASS = {
      ready: 'mm-ready',
      error: 'mm-error',
      connecting: 'mm-connecting',
      off: 'mm-off',
      unknown: 'mm-off',
    }

    const STATUS_TEXT = {
      ready: 'ready',
      error: 'error',
      connecting: 'connecting',
      off: 'off',
      unknown: 'unknown',
    }

    /** One server line: state dot, name in its state colour, detail, actions. */
    function ServerRow(props) {
      const { server, t, canToggle, busy, onToggle, onRestart } = props
      const [confirming, setConfirming] = React.useState(false)
      const level = server.status in STATUS_TEXT ? server.status : 'unknown'
      const statusText =
        server.enabled === false
          ? t('off')
          : server.source === 'entry' && level === 'ready'
            ? t('active')
            : t(STATUS_TEXT[level])
      const detail = []
      if (server.transport !== null && server.transport !== undefined) detail.push(server.transport)
      if (server.endpoint !== null && server.endpoint !== undefined) detail.push(server.endpoint)
      if (server.tools !== null && server.tools !== undefined) {
        detail.push(format(t('tools'), { n: server.tools }))
      }
      if (detail.length === 0) detail.push(statusText)
      const failed = server.error !== null && server.error !== undefined && server.enabled !== false
      const checked = server.enabled !== false
      const blocked = canToggle !== true || server.id === null || server.id === undefined
      const label = checked ? t('disable') : t('enable')

      /** A switch-off is asked first: the row is shared with every Session. */
      const clickSwitch = () => {
        if (checked && !confirming) {
          setConfirming(true)
          return
        }
        setConfirming(false)
        onToggle(server, !checked)
      }

      return h(
        'div',
        { className: `mm-row${confirming ? ' mm-row-confirm' : ''}` },
        h('span', { className: `mm-dot ${STATUS_CLASS[level] ?? 'mm-off'}` }),
        h(
          'div',
          { className: 'mm-main' },
          h(
            'div',
            {
              className: `mm-name ${STATUS_CLASS[level] ?? 'mm-off'}`,
              title: `${server.name} · ${statusText}`,
            },
            server.name,
          ),
          h(
            'div',
            {
              className: `mm-sub${failed ? ' mm-error' : ''}`,
              title: failed ? String(server.error) : detail.join(' · '),
            },
            failed ? String(server.error) : detail.join(' · '),
          ),
          confirming
            ? h(
                'div',
                { className: 'mm-confirm' },
                h(
                  'span',
                  { className: 'mm-confirm-text' },
                  format(t('confirmOff'), { name: server.name }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-btn mm-danger',
                    disabled: busy,
                    onClick: () => {
                      setConfirming(false)
                      onToggle(server, false)
                    },
                  },
                  t('confirmYes'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-btn',
                    onClick: () => setConfirming(false),
                  },
                  t('cancel'),
                ),
              )
            : null,
        ),
        h(
          'div',
          { className: 'mm-side' },
          h(
            'button',
            {
              type: 'button',
              className: 'mm-icon',
              title: t('restart'),
              'aria-label': `${t('restart')}: ${server.name}`,
              disabled: blocked || busy || !checked,
              onClick: () => onRestart(server),
            },
            h(
              'svg',
              { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
              h('path', {
                d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5H11',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            ),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            className: 'mm-sw',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': `${label}: ${server.name}`,
            title: blocked ? t('hint') : label,
            disabled: blocked || busy,
            onClick: clickSwitch,
          }, h('span', { className: 'mm-knob' })),
        ),
      )
    }

    function Panel(props) {
      const {
        t,
        body,
        phase,
        panelRef,
        pos,
        busyKey,
        onRefresh,
        onToggle,
        onRestart,
        canToggle,
        failure,
        notice,
      } = props
      const servers = body?.servers ?? []
      const counts = body?.counts ?? { total: 0, active: 0, off: 0 }
      const error = body?.ok === false ? body.error : undefined

      let content
      if (phase === 'loading') {
        content = h('div', { className: 'mm-empty' }, h('div', { className: 'mm-empty-hint' }, t('loading')))
      } else if (error !== undefined) {
        content = h(
          'div',
          { className: 'mm-empty' },
          h('div', { className: 'mm-empty-title' }, t('unreachable')),
          h('div', { className: 'mm-empty-hint' }, String(error?.message ?? '')),
        )
      } else if (servers.length === 0) {
        content = h(
          'div',
          { className: 'mm-empty' },
          h('div', { className: 'mm-empty-title' }, t('empty')),
          h('div', { className: 'mm-empty-hint' }, t('emptyHint')),
        )
      } else {
        content = h(
          'div',
          { className: 'mm-rows' },
          servers.map((server) =>
            h(ServerRow, {
              key: server.key ?? server.name,
              server,
              t,
              canToggle,
              busy: busyKey === (server.id ?? server.key),
              onToggle,
              onRestart,
            }),
          ),
        )
      }

      const summary =
        counts.total === 0
          ? t('allOff')
          : format(t('activeOf'), { active: counts.active, total: counts.total })

      return h(
        'div',
        {
          ref: panelRef,
          className: 'mm-panel',
          role: 'dialog',
          'aria-label': t('title'),
          style: pos === undefined ? { left: 0, bottom: 0, visibility: 'hidden' } : pos,
        },
        h(
          'div',
          { className: 'mm-head' },
          h('span', { className: 'mm-title' }, t('title')),
          h('span', { className: 'mm-count' }, summary),
        ),
        content,
        failure === undefined ? null : h('div', { className: 'mm-alert' }, failure),
        notice === undefined ? null : h('div', { className: 'mm-notice' }, notice),
        body?.ok === false
          ? null
          : h(
              'div',
              { className: 'mm-foot' },
              h('span', null, t('hint')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn',
                  disabled: phase === 'loading',
                  onClick: onRefresh,
                },
                t('refresh'),
              ),
            ),
      )
    }

    function McpMenu(props) {
      const { ctx } = props
      const [phase, setPhase] = React.useState('loading')
      const [body, setBody] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const [busyKey, setBusyKey] = React.useState(undefined)
      const [failure, setFailure] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)
      const [pos, setPos] = React.useState(undefined)
      const chipRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const noticeTimer = React.useRef(null)
      const [, setTick] = React.useState(0)

      const t = ctx.locale.bind(NS)

      /** Repaint on a locale change; the dictionaries are already registered. */
      React.useEffect(() => ctx.locale.subscribe(() => setTick((value) => value + 1)), [ctx])

      React.useEffect(
        () => () => {
          if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        },
        [],
      )

      const flash = React.useCallback((message) => {
        setNotice(message)
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(undefined), NOTICE_MS)
      }, [])

      const pull = React.useCallback(async () => {
        try {
          const response = await fetch(routeUrl(STATE_URL), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const payload = await response.json()
          setBody(payload)
          setPhase('ready')
        } catch (error) {
          setBody({
            ok: false,
            error: { code: 'transport', message: error instanceof Error ? error.message : String(error) },
          })
          setPhase('ready')
        }
      }, [])

      React.useEffect(() => {
        void pull()
        const timer = setInterval(() => void pull(), POLL_MS)
        return () => clearInterval(timer)
      }, [pull])

      /** Sit above the chip, left edges aligned, kept on screen. */
      const measure = React.useCallback(() => {
        const chip = chipRef.current
        if (chip === null) return
        const rect = chip.getBoundingClientRect()
        const width = panelRef.current?.getBoundingClientRect().width ?? 340
        const maxLeft = window.innerWidth - width - PANEL_MARGIN
        const left = Math.max(PANEL_MARGIN, Math.min(rect.left, Math.max(PANEL_MARGIN, maxLeft)))
        setPos({
          left: `${Math.round(left)}px`,
          bottom: `${Math.round(window.innerHeight - rect.top + PANEL_GAP)}px`,
        })
      }, [])

      React.useLayoutEffect(() => {
        if (!open) {
          setPos(undefined)
          return
        }
        measure()
      }, [open, measure])

      React.useEffect(() => {
        if (!open) return
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          const panel = panelRef.current
          const chip = chipRef.current
          const target = event.target
          if (!(target instanceof Node)) return
          if (panel !== null && panel.contains(target)) return
          if (chip !== null && chip.contains(target)) return
          setOpen(false)
        }
        const onViewport = () => {
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('resize', onViewport)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('resize', onViewport)
        }
      }, [open])

      const post = React.useCallback(async (url, payload) => {
        const response = await fetch(routeUrl(url), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        })
        return response.json()
      }, [])

      const toggleServer = React.useCallback(
        async (server, enabled) => {
          const key = server.id ?? server.key
          if (server.id === null || server.id === undefined) return
          setBusyKey(key)
          setFailure(undefined)
          try {
            const payload = await post(TOGGLE_URL, { id: server.id, enabled })
            if (payload?.ok === false) {
              setFailure(payload?.error?.message ?? t('toggleFailed'))
            } else {
              const result = payload?.result
              const application = result?.application
              const applied = application === undefined ? true : application === 'applied'
              if (!applied) setFailure(result?.message ?? result?.nextStep ?? t('toggleFailed'))
              else flash(`${server.name} · ${enabled ? t('enable') : t('disable')}`)
            }
          } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error))
          } finally {
            setBusyKey(undefined)
            void pull()
          }
        },
        [post, pull, t, flash],
      )

      const restartServer = React.useCallback(
        async (server) => {
          const key = server.id ?? server.key
          if (server.id === null || server.id === undefined) return
          setBusyKey(key)
          setFailure(undefined)
          try {
            const payload = await post(RESTART_URL, { id: server.id, name: server.name })
            if (payload?.ok === false) {
              setFailure(payload?.error?.message ?? t('restartFailed'))
            } else {
              flash(format(t('restartedVia'), { name: server.name }))
            }
          } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error))
          } finally {
            setBusyKey(undefined)
            void pull()
          }
        },
        [post, pull, t, flash],
      )

      const servers = body?.servers ?? []
      const counts = body?.counts ?? { total: 0, active: 0, off: 0 }
      const level = levelOf(counts, servers)
      const canToggle = body?.canToggle === true
      const quiet = counts.total === 0

      const panel = open
        ? h(Panel, {
            t,
            body,
            phase,
            panelRef,
            pos,
            busyKey,
            canToggle,
            failure,
            notice,
            onRefresh: () => void pull(),
            onToggle: toggleServer,
            onRestart: restartServer,
          })
        : null

      return h(
        'div',
        { className: 'mm-root' },
        h('style', null, CSS),
        h(
          'button',
          {
            ref: chipRef,
            type: 'button',
            className: 'mm-chip',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': `${t('title')}: ${counts.total === 0 ? t('allOff') : format(t('activeOf'), counts)}`,
            title: `${t('title')} · ${counts.total === 0 ? t('allOff') : format(t('activeOf'), counts)}`,
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: `mm-dot ${level === 'idle' ? '' : `mm-${level}`}` }),
          h('span', { className: 'mm-chip-label' }, t('chip')),
          h(
            'span',
            { className: `mm-chip-count${quiet ? ' mm-quiet' : ''}` },
            `${counts.active}/${counts.total}`,
          ),
          h(
            'span',
            { className: 'mm-caret', 'aria-hidden': true },
            h(
              'svg',
              { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none' },
              h('path', {
                d: 'M4 10l4-4 4 4',
                stroke: 'currentColor',
                strokeWidth: 1.6,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            ),
          ),
        ),
        panel === null
          ? null
          : createPortal === undefined
            ? panel
            : createPortal(panel, document.body),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposeEn = ctx.locale.register(NS, 'en', DICTIONARIES.en)
          const disposeRu = ctx.locale.register(NS, 'ru', DICTIONARIES.ru)
          return () => {
            disposeRu()
            disposeEn()
          }
        }, 'mcp-menu: dictionaries')

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'mcp-menu', order: 5, locale: NS },
            () => h(McpMenu, { ctx }),
          ),
        )
      },
    }
  },
})
