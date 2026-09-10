/**
 * dsh-knowledge host entry: wires the `knowledge_search` tool, the same-origin
 * `/knowledge` API routes, and the persistent engine (SQLite + uploaded files).
 * Everything tears down with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webserver Context augmentation (`webServer`).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { join } from 'node:path'
import { KnowledgeEngine } from './core/engine.ts'
import { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config } from './config.ts'
import { mountKnowledgeRoutes } from './routes.ts'
import { registerKnowledgeTool } from './tool.ts'

export const name = 'dsh-knowledge'
export { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config }

/** Services required before the plugin can mount. */
export const inject = ['tools']

/** Structural slice of the tools registry the tool needs. */
interface ToolRegistry {
  register(tool: unknown): () => void
}

/**
 * Apply the plugin: open the engine, register the tool, and mount the routes.
 * The engine closes when the plugin fiber unmounts.
 */
export async function apply(ctx: Context, entryConfig: Partial<Config>): Promise<void> {
  const config = resolveConfig(entryConfig)
  // One-time: move a legacy relative ./dsh-knowledge dir (old builds) into place.
  migrateLegacyDataDir(config.dataDir)
  const engine = new KnowledgeEngine({
    dbPath: join(config.dataDir, 'knowledge.sqlite'),
    filesRoot: config.filesRoot,
  })

  // The model-facing tool (registered on the tools registry declared in inject).
  ctx.effect(() => {
    const dispose = registerKnowledgeTool(ctx as unknown as { tools: ToolRegistry }, engine)
    return () => { dispose() }
  }, 'dsh-knowledge: tool')

  // The same-origin API routes ride a webServer sub-fiber; reading the service
  // directly would silently skip the mount when the web server is absent.
  // Workspaces come from the host workspaceRegistry (optional; absent → empty).
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer') as { register(route: unknown): () => void } | undefined
    const listWorkspaces = (): Array<{ id: string; title: string; path: string }> => {
      try {
        const registry = webCtx.get('workspaceRegistry', false) as
          | { list(): Array<{ id: string; title: string; path: string }> }
          | undefined
        return registry?.list().map(w => ({ id: String(w.id), title: w.title, path: w.path })) ?? []
      } catch {
        return []
      }
    }
    const buffer: Array<() => void> = []
    const disposer = mountKnowledgeRoutes(webServer as never, engine, listWorkspaces)
    if (disposer !== undefined) buffer.push(disposer)
    if (buffer.length > 0) {
      ctx.effect(() => () => { for (const dispose of buffer) dispose() }, 'dsh-knowledge: routes')
    }
  })

  // Close the SQLite handle on unmount.
  ctx.effect(() => () => { engine.close() }, 'dsh-knowledge: engine')
}
