/**
 * Verify the built `knowledge_search` tool registers against a fake tools
 * registry, and that the host plugin `apply` runs against a real cordis
 * Context with a fake webServer. Run: node scripts/verify-tool.mjs
 */
import { registerKnowledgeTool } from '../lib/tool.js'
import { KnowledgeEngine } from '../lib/core/engine.js'

async function main() {
  // 1) Tool registration shape.
  const engine = new KnowledgeEngine({ dbPath: 'scratch/verify-tool.sqlite', filesRoot: 'scratch/fixtures-tool' })
  engine.saveConfig({ endpointBaseUrl: 'http://127.0.0.1:1234/v1', embeddingModel: 'text-embedding-bge-m3', rerankModel: '' })
  let tool
  const dispose = registerKnowledgeTool({ tools: { register: (t) => { tool = t; return () => {} } } }, engine)
  if (tool === undefined) throw new Error('tool did not register')
  console.log(`tool name=${tool.name} hasExecute=${typeof tool.execute === 'function'} params=${Object.keys(tool.parameters).join(',')}`)
  if (tool.name !== 'knowledge_search') throw new Error(`unexpected tool name: ${tool.name}`)
  dispose()

  // 2) Host plugin apply against a real cordis Context with fake services.
  const cordis = await import('@deepseek-ai/cordis')
  const entry = await import('../lib/index.js')
  const name = entry.name
  const inject = entry.inject
  const applyFn = entry.apply
  console.log(`entry name=${name} inject=${JSON.stringify(inject)} hasApply=${typeof applyFn === 'function'}`)

  // Build a Context and provide a fake 'tools' service; register the plugin.
  const ctx = new (cordis.Context ?? cordis.default)()
  ctx.provide('tools', { register: (t) => { console.log(`  plugin registered tool ${t.name}`); return () => {} } })
  ctx.provide('webServer', {
    register: (route) => { console.log(`  plugin registered route ${route.kind} ${route.path}`); return () => {} },
  })
  await applyFn(ctx, { dataDir: 'scratch/plugin-data' })
  console.log('OK plugin apply')
  engine.close()
}

main().catch((e) => { console.error('FAILED', e); process.exit(1) })
