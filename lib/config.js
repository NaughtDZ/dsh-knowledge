/**
 * dsh-knowledge host configuration (the Loader-entry config). The runtime
 * endpoint/model/chunk settings live in the plugin's own SQLite config and are
 * edited from the plugin panel; these fields place the data directory.
 *
 * The data directory is ALWAYS absolute and rooted at the DSH home
 * (`$DSH_HOME`, else `~/.dsh`) so it never lands in the harness checkout. A
 * one-time migration moves a legacy relative `./dsh-knowledge` directory
 * (created by older builds when `DSH_HOME` was absent) into place.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
/** Resolve the DSH home: `$DSH_HOME`, else `~/.dsh` (matches the harness default). */
export function dshHome() {
    const env = process.env.DSH_HOME;
    return env !== undefined && env !== '' ? env : join(homedir(), '.dsh');
}
/** Default plugin data directory: `<DSH_HOME>/data/dsh-knowledge` (always absolute). */
export function defaultDataDir() {
    return join(dshHome(), 'data', 'dsh-knowledge');
}
/**
 * Move a legacy relative `./dsh-knowledge` data directory into the canonical
 * location. Older builds fell back to a relative path when `DSH_HOME` was
 * unset in the host process, creating the dir under the process CWD. Runs
 * once: skipped when the canonical dir already holds a database, or when the
 * legacy dir is absent. Cross-drive safe (copy then remove).
 * @param canonical - the resolved absolute data directory.
 */
export function migrateLegacyDataDir(canonical) {
    try {
        const legacy = join(process.cwd(), 'dsh-knowledge');
        if (legacy === canonical)
            return;
        if (existsSync(join(canonical, 'knowledge.sqlite')))
            return;
        if (!existsSync(join(legacy, 'knowledge.sqlite')))
            return;
        mkdirSync(dirname(canonical), { recursive: true });
        cpSync(legacy, canonical, { recursive: true, force: true });
        rmSync(legacy, { recursive: true, force: true });
        console.log(`dsh-knowledge: migrated legacy data from ${legacy} to ${canonical}`);
    }
    catch (error) {
        // Best effort: a failed migration leaves the old data intact and the
        // plugin simply starts with a fresh store at the canonical location.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`dsh-knowledge: legacy data migration failed (${message}); continuing with ${canonical}`);
    }
}
export const Config = z.object({
    /** Data directory (SQLite + uploaded files). Empty = <DSH_HOME>/data/dsh-knowledge. */
    dataDir: z.string().default(''),
    /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
    filesRoot: z.string().default(''),
});
/** Resolve the Config object with defaults applied (absolute paths only). */
export function resolveConfig(raw) {
    const dataDir = raw.dataDir !== undefined && raw.dataDir !== '' ? raw.dataDir : defaultDataDir();
    const filesRoot = raw.filesRoot !== undefined && raw.filesRoot !== '' ? raw.filesRoot : join(dataDir, 'files');
    return { dataDir, filesRoot };
}
