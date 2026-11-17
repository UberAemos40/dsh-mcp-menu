/**
 * Host half of the MCP server menu.
 *
 * The browser cannot read the Loader's entry table nor toggle a row, so this
 * half owns both: it merges the live `mcpManager` view (one record per
 * configured MCP server and its connection state) with the `pluginManager`
 * entry list (which row is enabled, and whether its fiber is mounted), then
 * forwards a switch to `pluginManager.setPluginEnabled`.
 *
 * Two small JSON routes serve the client half:
 *   GET  /mcp-menu/api/state               → { servers, counts }
 *   POST /mcp-menu/api/toggle {id,enabled}
 *
 * Every field is read defensively: a manager view is a live projection, so a
 * missing field degrades one cell of one row instead of the whole menu, and a
 * server the manager does not report is still listed from its Loader row.
 * `?debug=1` returns the scrubbed raw sources so a future shape change can be
 * identified without a rebuild.
 */

/** Route prefix this plugin owns; the client resolves it against the page. */
const ROUTE_PREFIX = '/mcp-menu/api'
const STATE_PATH = '/state'
const TOGGLE_PATH = '/toggle'
const RESTART_PATH = '/restart'
/** Module name of the row that backs one configured MCP server. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'
/** Anything that looks like a credential is scrubbed before it leaves the Host. */
const SECRET_KEY = /header|authoriz|token|secret|password|api[-_]?key|credential|passphrase|\benv\b/i
/** Connection states a manager view may report, normalized for the menu. */
const READY = new Set(['ready', 'connected', 'active', 'online', 'ok', 'running'])
const ERROR = new Set(['error', 'failed', 'failure', 'disconnected', 'unavailable', 'crashed'])
const PENDING = new Set(['connecting', 'starting', 'reconnecting', 'pending', 'initializing'])

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  /** Both services are optional: the menu still lists rows without them. */
  const managerService = () => ctx.get('mcpManager')
  const pluginService = () => ctx.get('pluginManager')

  const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined)

  /** Normalize one manager view's connection state. */
  const statusOf = (view) => {
    const raw = String(view?.status ?? view?.state ?? view?.phase ?? '').toLowerCase()
    if (view?.connected === true) return { status: 'ready', raw: raw || 'connected' }
    if (view?.connected === false && raw === '') return { status: 'off', raw: 'disconnected' }
    if (READY.has(raw)) return { status: 'ready', raw }
    if (ERROR.has(raw)) return { status: 'error', raw }
    if (PENDING.has(raw)) return { status: 'connecting', raw }
    if (raw === 'disabled' || raw === 'stopped' || raw === 'idle') return { status: 'off', raw }
    return { status: 'unknown', raw: raw || undefined }
  }

  const toolsOf = (view) => {
    if (Array.isArray(view?.tools)) return view.tools.length
    for (const key of ['toolCount', 'toolsCount', 'toolTotal']) {
      const value = Number(view?.[key])
      if (Number.isFinite(value)) return value
    }
    return undefined
  }

  const endpointOf = (view) =>
    text(view?.url) ?? text(view?.endpoint) ?? text(view?.address) ?? text(view?.command) ?? text(view?.uri)

  const errorOf = (view) => {
    const value = view?.error
    if (typeof value === 'string') return value === '' ? undefined : value
    return text(value?.message) ?? text(value?.code)
  }

  /** A Loader row that instantiates one MCP server. */
  const isMcpEntry = (info) => {
    const moduleName = String(info?.moduleName ?? '')
    return moduleName === MCP_CLIENT_MODULE || /(^|\/)dsh-mcp-client$/.test(moduleName)
  }

  const entryIdOf = (info) => text(info?.entryId) ?? text(info?.id) ?? text(info?.patchId)

  /** `include:obsidian-mcp` → `obsidian`: the name the config declares. */
  const displayNameOf = (info) => {
    const raw = text(info?.patchId) ?? entryIdOf(info) ?? ''
    const stripped = raw
      .replace(/^include:/, '')
      .replace(/[-_.]mcp$/i, '')
      .replace(/^mcp[-_.]/i, '')
    if (stripped !== '') return stripped
    return text(info?.moduleName) ?? 'mcp'
  }

  /** A mounted, enabled row is as live as this layer can prove on its own. */
  const entryStatus = (info) => {
    if (info?.enabled === false) return 'off'
    return String(info?.fiberPhase ?? '') === 'active' ? 'ready' : 'unknown'
  }

  /** Which entry backs one manager view: an exact id link, then a name match. */
  const pickEntry = (view, entries, used) => {
    const linked = text(view?.entryId) ?? text(view?.pluginId) ?? text(view?.rowId)
    if (linked !== undefined) {
      const hit = entries.find((info) => entryIdOf(info) === linked)
      if (hit !== undefined) return hit
    }
    const name = String(view?.name ?? view?.serverName ?? '')
    if (name === '') return undefined
    const free = entries.filter((info) => !used.has(info))
    const score = (info) => {
      const id = entryIdOf(info) ?? ''
      const display = displayNameOf(info)
      if (id === name || display === name) return 4
      if (id.endsWith(`:${name}`) || id.startsWith(`${name}:`)) return 3
      if (id.includes(name)) return 2
      return 0
    }
    let best
    let bestScore = 0
    for (const info of free) {
      const value = score(info)
      if (value > bestScore) {
        best = info
        bestScore = value
      }
    }
    return best
  }

  /** The whole menu state: one row per server, enabled and live state merged. */
  const snapshot = async (debug) => {
    const manager = managerService()
    const plugins = pluginService()

    let views = []
    if (manager !== undefined && manager !== null && typeof manager.list === 'function') {
      try {
        views = (await manager.list()) ?? []
      } catch {
        views = []
      }
    }

    let infos = []
    if (plugins !== undefined && plugins !== null && typeof plugins.listPlugins === 'function') {
      try {
        infos = (await plugins.listPlugins()) ?? []
      } catch {
        infos = []
      }
    }

    const entries = infos.filter(isMcpEntry)
    const used = new Set()
    const servers = []

    for (const view of Array.isArray(views) ? views : []) {
      const entry = pickEntry(view, entries, used)
      if (entry !== undefined) used.add(entry)
      const { status, raw } = statusOf(view)
      const enabled = entry === undefined ? undefined : entry.enabled !== false
      servers.push({
        key: entryIdOf(entry) ?? displayNameOf(entry) ?? String(view?.name ?? 'mcp'),
        id: entryIdOf(entry) ?? null,
        name: text(view?.name) ?? text(view?.serverName) ?? displayNameOf(entry),
        source: 'manager',
        enabled: enabled ?? null,
        status: enabled === false ? 'off' : status,
        raw: raw ?? null,
        transport: text(view?.transport) ?? text(view?.kind) ?? text(view?.type) ?? null,
        endpoint: endpointOf(view) ?? null,
        tools: toolsOf(view) ?? null,
        error: enabled === false ? null : errorOf(view) ?? null,
      })
    }

    /** A row the manager does not report is still a configured server. */
    for (const entry of entries) {
      if (used.has(entry)) continue
      servers.push({
        key: entryIdOf(entry) ?? String(entry?.moduleName ?? 'mcp'),
        id: entryIdOf(entry) ?? null,
        name: displayNameOf(entry),
        source: 'entry',
        enabled: entry.enabled !== false,
        status: entryStatus(entry),
        raw: text(entry?.fiberPhase) ?? null,
        transport: null,
        endpoint: null,
        tools: null,
        error: null,
      })
    }

    const counts = {
      total: servers.length,
      active: servers.filter((server) => server.status === 'ready').length,
      off: servers.filter((server) => server.status === 'off').length,
    }

    const payload = {
      ok: true,
      servers,
      counts,
      canToggle:
        plugins !== undefined && plugins !== null && typeof plugins.setPluginEnabled === 'function',
      canRestart: manager !== undefined && manager !== null && typeof manager.restart === 'function',
      generatedAt: Date.now(),
    }
    if (debug === true) payload.debug = { views: scrub(views), entries: scrub(entries) }
    return payload
  }

  /** Never let a header, a token or an env block leave the Host. */
  const scrub = (value, depth = 0) => {
    if (depth > 5) return '[depth]'
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => scrub(item, depth + 1))
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, item] of Object.entries(value)) {
        out[key] = SECRET_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1)
      }
      return out
    }
    if (typeof value === 'function') return '[function]'
    return value
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 32 * 1024) {
          resolve(undefined)
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        if (raw === '') return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(undefined)
        }
      })
      req.on('error', () => resolve(undefined))
    })

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  /** A browser stamps `Origin` cross-site; a foreign origin is refused. */
  const foreignOrigin = (req) => {
    const origin = req.headers?.origin
    if (typeof origin !== 'string' || origin === '') return false
    try {
      return new URL(origin).host !== String(req.headers?.host ?? '')
    } catch {
      return true
    }
  }

  /** Flip one server row and report what the Loader actually did. */
  const toggle = async (payload) => {
    const id = text(payload?.id)
    const enabled = payload?.enabled
    if (id === undefined) {
      return { status: 400, body: { ok: false, error: { code: 'bad-request', message: 'id is required' } } }
    }
    if (typeof enabled !== 'boolean') {
      return {
        status: 400,
        body: { ok: false, error: { code: 'bad-request', message: 'enabled must be a boolean' } },
      }
    }
    const plugins = pluginService()
    if (plugins === undefined || plugins === null || typeof plugins.setPluginEnabled !== 'function') {
      return {
        status: 501,
        body: { ok: false, error: { code: 'unsupported', message: 'pluginManager is not available' } },
      }
    }
    try {
      const result = await plugins.setPluginEnabled(id, enabled)
      return { status: 200, body: { ok: true, result: scrub(result) } }
    } catch (error) {
      return {
        status: 500,
        body: {
          ok: false,
          error: {
            code: 'toggle-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }
  }

  /** A plain failure in the route's own shape. */
  const bad = (status, code, message) => ({ status, body: { ok: false, error: { code, message } } })

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Restart one server: the manager's own restart when it knows the server,
   *  otherwise a Loader bounce of that row. A switched-off row is refused, so a
   *  restart can never silently turn a server back on. */
  const restart = async (payload) => {
    const id = text(payload?.id)
    const name = text(payload?.name)
    if (id === undefined) return bad(400, 'bad-request', 'id is required')

    const plugins = pluginService()
    if (plugins === undefined || plugins === null || typeof plugins.listPlugins !== 'function') {
      return bad(501, 'unsupported', 'pluginManager is not available')
    }

    let info
    try {
      info = ((await plugins.listPlugins()) ?? []).find((entry) => entryIdOf(entry) === id)
    } catch (error) {
      return bad(500, 'restart-failed', error instanceof Error ? error.message : String(error))
    }
    if (info === undefined) return bad(404, 'not-found', `No Loader row ${id}`)
    if (info.enabled === false) return bad(409, 'disabled', 'The row is switched off; enable it first')

    const manager = managerService()
    if (manager !== undefined && manager !== null && typeof manager.restart === 'function' && name !== undefined) {
      let known = false
      try {
        const views = (await manager.list()) ?? []
        known = views.some(
          (view) => String(view?.name ?? view?.serverName ?? view?.id ?? '') === name,
        )
      } catch {
        known = false
      }
      if (known) {
        try {
          await manager.restart(name)
          return { status: 200, body: { ok: true, via: 'manager' } }
        } catch {
          // The manager may have lost the server while we looked: bounce the row.
        }
      }
    }

    if (typeof plugins.setPluginEnabled !== 'function') {
      return bad(501, 'unsupported', 'pluginManager cannot reload rows')
    }
    try {
      await plugins.setPluginEnabled(id, false)
      await delay(200)
      await plugins.setPluginEnabled(id, true)
      return { status: 200, body: { ok: true, via: 'loader' } }
    } catch (error) {
      return bad(500, 'restart-failed', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        if (foreignOrigin(req)) {
          send(res, 403, { ok: false, error: { code: 'forbidden', message: 'Request rejected' } })
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sub = url.pathname.startsWith(ROUTE_PREFIX)
          ? url.pathname.slice(ROUTE_PREFIX.length) || STATE_PATH
          : STATE_PATH
        const method = req.method ?? 'GET'
        try {
          if (method === 'GET' || method === 'HEAD') {
            if (sub !== STATE_PATH && sub !== '/') {
              send(res, 404, { ok: false, error: { code: 'not-found', message: 'Unknown method' } })
              return
            }
            send(res, 200, await snapshot(url.searchParams.get('debug') === '1'))
            return
          }
          if (method === 'POST') {
            if (sub !== TOGGLE_PATH && sub !== RESTART_PATH) {
              send(res, 404, { ok: false, error: { code: 'not-found', message: 'Unknown method' } })
              return
            }
            const body = await readBody(req)
            if (body === undefined) {
              send(res, 400, { ok: false, error: { code: 'bad-json', message: 'Malformed JSON body' } })
              return
            }
            const outcome = sub === RESTART_PATH ? await restart(body) : await toggle(body)
            send(res, outcome.status, outcome.body)
            return
          }
          send(res, 405, { ok: false, error: { code: 'method-error', message: 'Method not allowed' } })
        } catch (error) {
          send(res, 500, {
            ok: false,
            error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
          })
        }
      },
    }),
  )
}
