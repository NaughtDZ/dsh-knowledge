/**
 * dsh-knowledge host configuration (the Loader-entry config). The runtime
 * endpoint/model/chunk settings live in the plugin's own SQLite config and are
 * edited from the plugin panel; these fields place the data directory and the
 * embedding defaults.
 */
import z from '@deepseek-ai/schemastery';
/** Resolve DSH home and default the plugin data dir. */
export declare function defaultDataDir(): string;
export declare const Config: z<Schemastery.ObjectS<{
    /** Data directory (SQLite + uploaded files). Empty = DSH_HOME/data/dsh-knowledge. */
    dataDir: z<string, string>;
    /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
    filesRoot: z<string, string>;
}>, Schemastery.ObjectT<{
    /** Data directory (SQLite + uploaded files). Empty = DSH_HOME/data/dsh-knowledge. */
    dataDir: z<string, string>;
    /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
    filesRoot: z<string, string>;
}>>;
export type Config = {
    dataDir: string;
    filesRoot: string;
};
/** Resolve the Config object with defaults applied. */
export declare function resolveConfig(raw: Partial<Config>): Config;
