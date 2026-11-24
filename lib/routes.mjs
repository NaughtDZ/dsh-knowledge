/**
 * 同源 HTTP 接口。浏览器面板（client.js）直接 fetch 这些地址；
 * 前缀固定为 /plugins/dsh-tavern-knowledge，插件卸载时整段撤销。
 *
 * 这一层只做参数校验与转发，业务都在 engine / retrieval / chat-memory / backup。
 */
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, basename } from 'node:path'
import {
  asObject, errorMessage, pathnameOf, readJsonBody, readRawBody, sameOrigin, sendError, sendJson,
} from './http.js'
import { exportBackup, importBackup, listBackups } from './backup.mjs'
import { ingestChat, listChatSources, forgetChatSource } from './chat-memory.mjs'
import { retrieve } from './retrieval.mjs'

export const ROUTE_PREFIX = '/plugins/dsh-tavern-knowledge'

/** 前端只能改这些设置字段。 */
const CONFIG_KEYS = [
  'endpointBaseUrl', 'embeddingModel', 'apiKey', 'rerankModel', 'rerankEndpoint',
  'chunkSize', 'chunkOverlap', 'defaultTopK', 'stripMarkup',
  'defaultKbIds', 'kbSettings', 'inject',
]

function pickConfig(patch) {
  const out = {}
  for (const key of CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = patch[key]
  }
  return out
}

/** 上传按顺序串行处理，避免多个导入同时打 embedding 服务。 */
function createQueue() {
  let chain = Promise.resolve()
  return (task) => {
    chain = chain.then(task).catch(() => {})
    return chain
  }
}

/**
 * 挂上路由。
 * @param {object} webServer DSH webServer 服务
 * @param {object} deps { engine, dataDir, filesRoot, getBinding, setBinding, getGameInfo }
 * @returns {() => void} 撤销函数
 */
export function mountRoutes(webServer, deps) {
  const enqueue = createQueue()

  const handler = async (request, response) => {
    if (!sameOrigin(request)) return sendError(response, 403, 'forbidden')
    const tail = pathnameOf(request).replace(/^\/plugins\/dsh-tavern-knowledge\/?/u, '')
    const segments = tail.split('/').filter(Boolean)
    const method = (request.method ?? 'GET').toUpperCase()
    const url = new URL(request.url ?? '/', 'http://x')

    // ── 总览 ──────────────────────────────────────────────────────────────
    if (method === 'GET' && (tail === '' || tail === 'state')) {
      const config = deps.engine.getConfig()
      return sendJson(response, 200, {
        ok: true,
        dataDir: deps.dataDir,
        filesRoot: deps.filesRoot,
        config,
        bases: deps.engine.listBases(),
        operations: deps.engine.activeOperations(),
        chatSources: listChatSources(deps.engine),
        backups: listBackups({ dataDir: deps.dataDir }),
      })
    }

    // ── 配置 ──────────────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'config') {
      return sendJson(response, 200, deps.engine.getConfig())
    }
    if (method === 'POST' && segments[0] === 'config') {
      const body = asObject(await readJsonBody(request))
      if (segments[1] === 'test') {
        const config = deps.engine.getConfig()
        const endpoint = typeof body.endpointBaseUrl === 'string' && body.endpointBaseUrl !== '' ? body.endpointBaseUrl : config.endpointBaseUrl
        const model = typeof body.embeddingModel === 'string' && body.embeddingModel !== '' ? body.embeddingModel : config.embeddingModel
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey : config.apiKey
        const started = Date.now()
        try {
          const { embedText } = await import('./core/embed.js')
          const vector = await embedText({ baseUrl: endpoint, model, apiKey }, 'ping')
          return sendJson(response, 200, { ok: true, dim: vector.length, latencyMs: Date.now() - started, model })
        } catch (error) {
          return sendJson(response, 200, { ok: false, error: errorMessage(error), latencyMs: Date.now() - started, model })
        }
      }
      const saved = deps.engine.saveConfig(pickConfig(body))
      return sendJson(response, 200, saved)
    }

    // ── 知识库 ────────────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'bases') return sendJson(response, 200, deps.engine.listBases())
    if (method === 'POST' && tail === 'bases') {
      const body = asObject(await readJsonBody(request))
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '') return sendError(response, 400, '需要库名')
      const description = typeof body.description === 'string' ? body.description : ''
      return sendJson(response, 200, deps.engine.createBase(name, description))
    }
    if (method === 'POST' && tail === 'bases/delete') {
      const body = asObject(await readJsonBody(request))
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') return sendError(response, 400, '缺少 id')
      deps.engine.deleteBase(id)
      const config = deps.engine.getConfig()
      const defaults = Array.isArray(config.defaultKbIds) ? config.defaultKbIds.filter(x => x !== id) : []
      deps.engine.saveConfig({ defaultKbIds: defaults })
      return sendJson(response, 200, { ok: true })
    }

    // ── 文件 ──────────────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'files') {
      const kbId = url.searchParams.get('kbId') ?? ''
      if (kbId === '') return sendError(response, 400, '缺少 kbId')
      return sendJson(response, 200, deps.engine.filesOf(kbId))
    }
    if (method === 'POST' && tail === 'files') {
      const kbId = url.searchParams.get('kbId') ?? ''
      const name = url.searchParams.get('name') ?? 'upload.bin'
      if (kbId === '') return sendError(response, 400, '缺少 kbId')
      const bytes = await readRawBody(request)
      if (bytes.length === 0) return sendError(response, 400, '空文件')
      // 立刻回话，导入在后台排队跑，前端用 /operations 看进度。
      enqueue(() => deps.engine.importFile(kbId, name, bytes))
      return sendJson(response, 200, { ok: true, started: true, name, bytes: bytes.length })
    }
    if (method === 'POST' && tail === 'files/delete') {
      const body = asObject(await readJsonBody(request))
      const id = typeof body.fileId === 'string' ? body.fileId : ''
      if (id === '') return sendError(response, 400, '缺少 fileId')
      deps.engine.deleteFile(id)
      return sendJson(response, 200, { ok: true })
    }
    if (method === 'POST' && tail === 'reindex') {
      const body = asObject(await readJsonBody(request))
      const kbId = typeof body.kbId === 'string' ? body.kbId : ''
      if (kbId === '') return sendError(response, 400, '缺少 kbId')
      const operationId = deps.engine.reindexBase(kbId)
      return sendJson(response, 200, { operationId })
    }
    if (method === 'POST' && tail === 'reindex-all') {
      return sendJson(response, 200, { operationId: deps.engine.reindexAll() })
    }

    // ── 进度与停止 ────────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'operations') return sendJson(response, 200, deps.engine.activeOperations())
    if (method === 'POST' && tail === 'operations/stop') {
      const body = asObject(await readJsonBody(request))
      const id = typeof body.operationId === 'string' ? body.operationId : ''
      return sendJson(response, 200, { ok: deps.engine.stopOperation(id) })
    }
    if (method === 'POST' && tail === 'stop') {
      return sendJson(response, 200, { ok: true, stopped: deps.engine.stopAll() })
    }

    // ── 检索 ──────────────────────────────────────────────────────────────
    if (method === 'POST' && tail === 'search') {
      const body = asObject(await readJsonBody(request))
      const query = typeof body.query === 'string' ? body.query : ''
      if (query.trim() === '') return sendError(response, 400, '需要 query')
      const config = deps.engine.getConfig()
      const kbIds = Array.isArray(body.kbIds) && body.kbIds.length > 0
        ? body.kbIds.filter(x => typeof x === 'string')
        : Array.isArray(config.defaultKbIds) ? config.defaultKbIds : deps.engine.listBases().map(b => b.id)
      const result = await retrieve({
        engine: deps.engine, query,
        kbIds,
        topK: typeof body.topK === 'number' ? body.topK : config.defaultTopK,
        minScore: typeof body.minScore === 'number' ? body.minScore : undefined,
        perKb: config.kbSettings,
      })
      return sendJson(response, 200, { ok: true, query, count: result.hits.length, tookMs: result.tookMs, hits: result.hits })
    }

    // ── 本局绑定 ──────────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'inject') {
      const gameId = url.searchParams.get('gameId') ?? ''
      if (gameId === '') return sendError(response, 400, '缺少 gameId')
      return sendJson(response, 200, { ok: true, ...(deps.getLastInject(gameId) ?? {}) })
    }
    if (method === 'GET' && tail === 'binding') {
      const gameId = url.searchParams.get('gameId') ?? ''
      if (gameId === '') return sendError(response, 400, '缺少 gameId')
      const config = deps.engine.getConfig()
      const bound = await deps.getBinding(gameId)
      const defaults = Array.isArray(config.defaultKbIds) ? config.defaultKbIds : []
      const game = await deps.getGameInfo(gameId)
      return sendJson(response, 200, {
        ok: true, gameId, bound, defaults,
        effective: bound !== null ? bound : defaults,
        byDefault: bound === null,
        game,
      })
    }
    if (method === 'POST' && tail === 'binding') {
      const body = asObject(await readJsonBody(request))
      const gameId = typeof body.gameId === 'string' ? body.gameId : ''
      if (gameId === '') return sendError(response, 400, '缺少 gameId')
      const kbIds = body.kbIds === null
        ? null
        : Array.isArray(body.kbIds) ? body.kbIds.filter(x => typeof x === 'string') : null
      await deps.setBinding(gameId, kbIds)
      return sendJson(response, 200, { ok: true, kbIds })
    }

    // ── 对话向量记忆 ──────────────────────────────────────────────────────
    if (method === 'GET' && tail === 'chat/sources') {
      return sendJson(response, 200, listChatSources(deps.engine))
    }
    if (method === 'POST' && tail === 'chat/ingest') {
      const body = asObject(await readJsonBody(request))
      const gameId = typeof body.gameId === 'string' ? body.gameId : ''
      const kbId = typeof body.kbId === 'string' ? body.kbId : ''
      if (gameId === '' || kbId === '') return sendError(response, 400, '需要 gameId 与 kbId')
      const result = await deps.ingestChat({ gameId, kbId, rebuild: body.rebuild === true })
      return sendJson(response, 200, result)
    }
    if (method === 'POST' && tail === 'chat/forget') {
      const body = asObject(await readJsonBody(request))
      const gameId = typeof body.gameId === 'string' ? body.gameId : ''
      if (gameId === '') return sendError(response, 400, '缺少 gameId')
      return sendJson(response, 200, { ok: forgetChatSource(deps.engine, gameId) })
    }

    // ── 备份 ──────────────────────────────────────────────────────────────
    if (method === 'POST' && tail === 'export') {
      const body = await readJsonBody(request)
      const patch = body === undefined ? {} : asObject(body)
      const result = exportBackup({
        engine: deps.engine,
        dataDir: deps.dataDir,
        kbId: typeof patch.kbId === 'string' ? patch.kbId : undefined,
        includeVectors: patch.includeVectors !== false,
        includeRaw: patch.includeRaw !== false,
      })
      return sendJson(response, 200, { ok: true, ...result, name: basename(result.path) })
    }
    if (method === 'GET' && tail === 'backups') {
      return sendJson(response, 200, listBackups({ dataDir: deps.dataDir }))
    }
    if (method === 'GET' && tail === 'download') {
      const name = basename(url.searchParams.get('name') ?? '')
      const path = join(deps.dataDir, 'exports', name)
      let size = 0
      try { size = statSync(path).size } catch { return sendError(response, 404, '备份不存在') }
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(size),
        'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
        'cache-control': 'no-store',
      })
      await pipeline(createReadStream(path), response)
      return
    }
    if (method === 'POST' && tail === 'import') {
      const contentType = String(request.headers['content-type'] ?? '')
      let path = ''
      let cleanup = ''
      if (contentType.startsWith('application/json') && url.searchParams.get('mode') !== 'raw') {
        const body = asObject(await readJsonBody(request))
        if (typeof body.path === 'string' && body.path !== '') path = body.path
        else return sendError(response, 400, '需要备份路径，或直接上传备份文件')
      } else {
        const dir = join(deps.dataDir, 'tmp')
        mkdirSync(dir, { recursive: true })
        cleanup = join(dir, `import-${Date.now()}.json`)
        await pipeline(request, createWriteStream(cleanup))
        path = cleanup
      }
      try {
        const stats = await deps.importBackup({ path })
        return sendJson(response, 200, { ok: true, ...stats })
      } finally {
        if (cleanup !== '') { try { rmSync(cleanup, { force: true }) } catch { /* ignore */ } }
      }
    }

    return sendError(response, 404, 'unknown route')
  }

  const dispose = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (request, response) => {
      Promise.resolve()
        .then(() => handler(request, response))
        .catch((error) => {
          try {
            if (!response.headersSent) sendError(response, 500, errorMessage(error))
            else response.end()
          } catch { /* ignore */ }
        })
    },
  })
  return typeof dispose === 'function' ? dispose : () => {}
}
