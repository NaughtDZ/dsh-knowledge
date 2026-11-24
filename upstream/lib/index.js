import { join } from 'node:path';
import { KnowledgeEngine } from "./core/engine.js";
import { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config } from "./config.js";
import { mountKnowledgeRoutes } from "./routes.js";
import { registerKnowledgeTool } from "./tool.js";
export const name = 'dsh-knowledge';
export { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config };
/** Services required before the plugin can mount. */
export const inject = ['tools'];
/**
 * Apply the plugin: open the engine, register the tool, and mount the routes.
 * The engine closes when the plugin fiber unmounts.
 */
export async function apply(ctx, entryConfig) {
    const config = resolveConfig(entryConfig);
    // One-time: move a legacy relative ./dsh-knowledge dir (old builds) into place.
    migrateLegacyDataDir(config.dataDir);
    const engine = new KnowledgeEngine({
        dbPath: join(config.dataDir, 'knowledge.sqlite'),
        filesRoot: config.filesRoot,
    });
    // The model-facing tool (registered on the tools registry declared in inject).
    ctx.effect(() => {
        const dispose = registerKnowledgeTool(ctx, engine);
        return () => { dispose(); };
    }, 'dsh-knowledge: tool');
    // The same-origin API routes ride a webServer sub-fiber; reading the service
    // directly would silently skip the mount when the web server is absent.
    // Workspaces come from the host workspaceRegistry (optional; absent → empty).
    ctx.inject(['webServer'], (webCtx) => {
        const webServer = webCtx.get('webServer');
        const listWorkspaces = () => {
            try {
                const registry = webCtx.get('workspaceRegistry', false);
                return registry?.list().map(w => ({ id: String(w.id), title: w.title, path: w.path })) ?? [];
            }
            catch {
                return [];
            }
        };
        const buffer = [];
        const disposer = mountKnowledgeRoutes(webServer, engine, listWorkspaces);
        if (disposer !== undefined)
            buffer.push(disposer);
        if (buffer.length > 0) {
            ctx.effect(() => () => { for (const dispose of buffer)
                dispose(); }, 'dsh-knowledge: routes');
        }
    });
    // Close the SQLite handle on unmount.
    ctx.effect(() => () => { engine.close(); }, 'dsh-knowledge: engine');
}
