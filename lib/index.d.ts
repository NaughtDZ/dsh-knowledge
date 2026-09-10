/**
 * dsh-knowledge host entry: wires the `knowledge_search` tool, the same-origin
 * `/knowledge` API routes, and the persistent engine (SQLite + uploaded files).
 * Everything tears down with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config } from './config.ts';
export declare const name = "dsh-knowledge";
export { defaultDataDir, resolveConfig, migrateLegacyDataDir, Config };
/** Services required before the plugin can mount. */
export declare const inject: string[];
/**
 * Apply the plugin: open the engine, register the tool, and mount the routes.
 * The engine closes when the plugin fiber unmounts.
 */
export declare function apply(ctx: Context, entryConfig: Partial<Config>): Promise<void>;
