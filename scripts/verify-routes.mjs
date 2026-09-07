/**
 * Integration smoke test of the BUILT host routes against a fake webServer.
 * Verifies that mountKnowledgeRoutes registers the /knowledge prefix route and
 * that requests to /knowledge/bases, /config, /config/test, /health and
 * /search dispatch correctly. Run: node scripts/verify-routes.mjs
 */
import { mountKnowledgeRoutes } from '../lib/routes.js'
import { KnowledgeEngine } from '../lib/core/engine.js'

async function main() {
  const engine = new KnowledgeEngine({ dbPath: 'scratch/verify-routes.sqlite', filesRoot: 'scratch/fixtures-routes' })
  engine.saveConfig({ endpointBaseUrl: 'http://127.0.0.1:1234/v1', embeddingModel: 'text-embedding-bge-m3', rerankModel: '' })
  engine.createBase('接口测试库', 'desc')

  const routes = []
  const disposer = mountKnowledgeRoutes({ register: (route) => { routes.push(route); return () => {} } }, engine)
  if (disposer === undefined) throw new Error('routes not mounted')
  if (routes.length !== 1 || routes[0].kind !== 'prefix' || routes[0].path !== '/knowledge') {
    throw new Error('unexpected routes: ' + JSON.stringify(routes.map(r => ({ kind: r.kind, path: r.path }))))
  }
  const handler = routes[0].handler

  let res = makeRes()
  await handler(makeReq('GET', '/knowledge/bases'), res)
  const bases = JSON.parse(res.body)
  console.log(`GET /knowledge/bases -> ${res.status} bases=[${bases.map(b => b.name).join(',')}]`)

  res = makeRes()
  await handler(makeReq('GET', '/knowledge/config'), res)
  console.log(`GET /knowledge/config -> ${res.status} endpoint=${JSON.parse(res.body).endpointBaseUrl}`)

  res = makeRes()
  await handler(makeReq('POST', '/knowledge/config/test', '{}'), res)
  const probe = JSON.parse(res.body)
  console.log(`POST /knowledge/config/test -> ${res.status} ok=${probe.ok} dim=${probe.dim} latency=${probe.latencyMs}ms`)

  res = makeRes()
  await handler(makeReq('GET', '/knowledge/health'), res)
  console.log(`GET /knowledge/health -> ${res.status} ${JSON.stringify(JSON.parse(res.body))}`)

  res = makeRes()
  await handler(makeReq('POST', '/knowledge/search', JSON.stringify({ query: '测试', workspaceId: 'w' })), res)
  const search = JSON.parse(res.body)
  console.log(`POST /knowledge/search -> ${res.status} count=${search.count}`)

  if (disposer !== undefined) disposer()
  engine.close()
  console.log('OK routes')
}

function makeReq(method, path, body = '') {
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]() {
      let sent = false
      return {
        next: () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: Buffer.from(body) })),
      }
    },
  }
  return req
}
function makeRes() {
  const state = { status: 0, body: '', headers: {} }
  return {
    writeHead(status, headers) { state.status = status; state.headers = headers ?? {} },
    end(payload) { state.body = String(payload) },
    get body() { return state.body },
    get status() { return state.status },
  }
}

main().catch((e) => { console.error('FAILED', e); process.exit(1) })
