/**
 * Same-origin HTTP API for dsh-knowledge. Registers a single `/knowledge`
 * prefix route on the host web server and dispatches REST sub-routes to the
 * engine. Writes are same-origin-only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { KnowledgeEngine } from './core/engine.ts'
import { asObject, errorMessage, pathnameOf, readJsonBody, readRawBody, sameOrigin, sendError, sendJson } from './http.ts'

/** Structural slice of the host web server route-registration surface. */
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>
  }): () => void
}

/** GET `/knowledge/config`. */
function getConfig(engine: KnowledgeEngine, res: ServerResponse): void {
  sendJson(res, 200, engine.getConfig())
}

/** POST `/knowledge/config/{...}` — body patch, or `test` to probe the endpoint. */
async function postConfig(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse, tail: string): Promise<void> {
  const body = await readJsonBody(req)
  if (tail === 'test') {
    const config = engine.getConfig()
    const probe = body !== undefined && typeof body === 'object' ? asObject(body) : {}
    const endpoint = typeof probe['endpointBaseUrl'] === 'string' && probe['endpointBaseUrl'] !== ''
      ? probe['endpointBaseUrl'] : config.endpointBaseUrl
    const model = typeof probe['embeddingModel'] === 'string' && probe['embeddingModel'] !== ''
      ? probe['embeddingModel'] : config.embeddingModel
    const apiKey = typeof probe['apiKey'] === 'string' ? probe['apiKey'] : config.apiKey
    const started = Date.now()
    try {
      const { embedText } = await import('./core/embed.ts')
      const vector = await embedText({ baseUrl: endpoint, model, apiKey }, 'ping', undefined)
      sendJson(res, 200, { ok: true, dim: vector.length, latencyMs: Date.now() - started, model })
    } catch (error) {
      sendJson(res, 200, { ok: false, error: errorMessage(error), latencyMs: Date.now() - started, model })
    }
    return
  }
  const patch = body === undefined ? {} : asObject(body)
  const config = engine.saveConfig(patch as Record<string, unknown>)
  sendJson(res, 200, config)
}

/** GET `/knowledge/bases`. */
function getBases(engine: KnowledgeEngine, res: ServerResponse): void {
  sendJson(res, 200, engine.listBases())
}

/** POST `/knowledge/bases` — { name, description } create. */
async function postBases(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asObject(await readJsonBody(req))
  const name = typeof body['name'] === 'string' && body['name'].trim() !== '' ? body['name'].trim() : ''
  if (name === '') return sendError(res, 400, 'a name is required')
  const description = typeof body['description'] === 'string' ? body['description'] : ''
  sendJson(res, 200, engine.createBase(name, description))
}

/** POST `/knowledge/bases/delete` — { id }. */
async function deleteBase(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asObject(await readJsonBody(req))
  const id = typeof body['id'] === 'string' ? body['id'] : ''
  if (id === '') return sendError(res, 400, 'an id is required')
  engine.deleteBase(id)
  sendJson(res, 200, { ok: true })
}

/** GET `/knowledge/files?kbId=`. */
function getFiles(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x')
  const kbId = url.searchParams.get('kbId') ?? ''
  if (kbId === '') return sendError(res, 400, 'kbId is required')
  sendJson(res, 200, engine.filesOf(kbId))
}

/** POST `/knowledge/files?name=` — raw file bytes to import. */
async function importFile(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const kbId = url.searchParams.get('kbId') ?? ''
  const name = url.searchParams.get('name') ?? 'upload.bin'
  if (kbId === '') return sendError(res, 400, 'kbId is required')
  const bytes = await readRawBody(req)
  if (bytes.length === 0) return sendError(res, 400, 'empty upload')
  const result = await engine.importFile(kbId, name, bytes)
  sendJson(res, 200, result)
}

/** POST `/knowledge/files/delete` — { fileId }. */
async function deleteFile(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asObject(await readJsonBody(req))
  const id = typeof body['fileId'] === 'string' ? body['fileId'] : ''
  if (id === '') return sendError(res, 400, 'fileId is required')
  engine.deleteFile(id)
  sendJson(res, 200, { ok: true })
}

/** GET `/knowledge/mounts`. */
function getMounts(engine: KnowledgeEngine, res: ServerResponse): void {
  sendJson(res, 200, engine.mounts())
}

/** POST `/knowledge/mounts` — { kbId, workspaceId, enabled, note }. */
async function setMount(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asObject(await readJsonBody(req))
  const kbId = typeof body['kbId'] === 'string' ? body['kbId'] : ''
  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : ''
  if (kbId === '' || workspaceId === '') return sendError(res, 400, 'kbId and workspaceId are required')
  const enabled = body['enabled'] !== false
  const note = typeof body['note'] === 'string' ? body['note'] : ''
  sendJson(res, 200, engine.setMount(kbId, workspaceId, enabled, note))
}

/** POST `/knowledge/search` — { query, kbIds?, workspaceId?, topK?, useRerank? }. */
async function search(engine: KnowledgeEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = asObject(await readJsonBody(req))
  const query = typeof body['query'] === 'string' ? body['query'] : ''
  if (query.trim() === '') return sendError(res, 400, 'query is required')
  const kbIds = Array.isArray(body['kbIds']) ? (body['kbIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
  const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : undefined
  const topK = typeof body['topK'] === 'number' ? body['topK'] : undefined
  const useRerank = typeof body['useRerank'] === 'boolean' ? body['useRerank'] : undefined
  const hits = await engine.search(query, {
    ...kbIds !== undefined && kbIds.length > 0 ? { kbIds } : {},
    ...workspaceId !== undefined && workspaceId !== '' ? { workspaceId } : {},
    ...topK !== undefined && topK > 0 ? { topK: Math.min(Math.floor(topK), 20) } : {},
    ...useRerank !== undefined ? { useRerank } : {},
  })
  sendJson(res, 200, { query, count: hits.length, hits })
}

/** GET `/knowledge/health` — { ok, baseCount, fileCount }. */
function health(engine: KnowledgeEngine, res: ServerResponse): void {
  const bases = engine.listBases()
  const fileCount = bases.reduce((sum, b) => sum + b.fileCount, 0)
  sendJson(res, 200, { ok: true, baseCount: bases.length, fileCount })
}

/**
 * Mount the knowledge API routes on the web server.
 * @returns a disposer removing the routes, or undefined when no web server.
 */
export function mountKnowledgeRoutes(webServer: WebServerLike | undefined, engine: KnowledgeEngine): (() => void) | undefined {
  if (webServer === undefined) return undefined
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!sameOrigin(req)) return sendError(res, 403, 'forbidden')
    try {
      const path = pathnameOf(req)
      const method = (req.method ?? 'GET').toUpperCase()
      const tail = path.replace(/^\/knowledge\/?/u, '')
      const segments = tail.split('/').filter(Boolean)

      if (method === 'GET' && (tail === '' || tail === 'config')) return getConfig(engine, res)
      if (method === 'POST' && segments[0] === 'config') return postConfig(engine, req, res, segments[1] ?? '')
      if (method === 'GET' && tail === 'bases') return getBases(engine, res)
      if (method === 'POST' && tail === 'bases') return postBases(engine, req, res)
      if (method === 'POST' && tail === 'bases/delete') return deleteBase(engine, req, res)
      if (method === 'GET' && tail === 'files') return getFiles(engine, req, res)
      if (method === 'POST' && tail === 'files') return importFile(engine, req, res)
      if (method === 'POST' && tail === 'files/delete') return deleteFile(engine, req, res)
      if (method === 'GET' && tail === 'mounts') return getMounts(engine, res)
      if (method === 'POST' && tail === 'mounts') return setMount(engine, req, res)
      if (method === 'POST' && tail === 'search') return search(engine, req, res)
      if (method === 'GET' && tail === 'health') return health(engine, res)
      return sendError(res, 404, 'unknown knowledge route')
    } catch (error) {
      return sendError(res, 400, errorMessage(error))
    }
  }
  return webServer.register({ kind: 'prefix', path: '/knowledge', handler })
}
