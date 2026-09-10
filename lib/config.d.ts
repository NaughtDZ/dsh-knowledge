import z from '@deepseek-ai/schemastery';
/** Resolve the DSH home: `$DSH_HOME`, else `~/.dsh` (matches the harness default). */
export declare function dshHome(): string;
/** Default plugin data directory: `<DSH_HOME>/data/dsh-knowledge` (always absolute). */
export declare function defaultDataDir(): string;
/**
 * Move a legacy relative `./dsh-knowledge` data directory into the canonical
 * location. Older builds fell back to a relative path when `DSH_HOME` was
 * unset in the host process, creating the dir under the process CWD. Runs
 * once: skipped when the canonical dir already holds a database, or when the
 * legacy dir is absent. Cross-drive safe (copy then remove).
 * @param canonical - the resolved absolute data directory.
 */
export declare function migrateLegacyDataDir(canonical: string): void;
export declare const Config: z<Schemastery.ObjectS<{
    /** Data directory (SQLite + uploaded files). Empty = <DSH_HOME>/data/dsh-knowledge. */
    dataDir: z<string, string>;
    /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
    filesRoot: z<string, string>;
}>, Schemastery.ObjectT<{
    /** Data directory (SQLite + uploaded files). Empty = <DSH_HOME>/data/dsh-knowledge. */
    dataDir: z<string, string>;
    /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
    filesRoot: z<string, string>;
}>>;
export type Config = {
    dataDir: string;
    filesRoot: string;
};
/** Resolve the Config object with defaults applied (absolute paths only). */
export declare function resolveConfig(raw: Partial<Config>): Config;
