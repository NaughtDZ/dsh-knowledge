/**
 * dsh-knowledge host configuration (the Loader-entry config). The runtime
 * endpoint/model/chunk settings live in the plugin's own SQLite config and are
 * edited from the plugin panel; these fields place the data directory and the
 * embedding defaults.
 */
import z from '@deepseek-ai/schemastery'

/** Resolve DSH home and default the plugin data dir. */
export function defaultDataDir(): string {
  const base = process.env.DSH_HOME ?? ''
  return base === '' ? 'dsh-knowledge' : `${base}/data/dsh-knowledge`
}

export const Config = z.object({
  /** Data directory (SQLite + uploaded files). Empty = DSH_HOME/data/dsh-knowledge. */
  dataDir: z.string().default(''),
  /** Optional explicit directory for uploaded original files. Empty = <dataDir>/files. */
  filesRoot: z.string().default(''),
})

export type Config = {
  dataDir: string
  filesRoot: string
}

/** Resolve the Config object with defaults applied. */
export function resolveConfig(raw: Partial<Config>): Config {
  const dataDir = raw.dataDir !== undefined && raw.dataDir !== '' ? raw.dataDir : defaultDataDir()
  const filesRoot = raw.filesRoot !== undefined && raw.filesRoot !== '' ? raw.filesRoot : `${dataDir}/files`
  return { dataDir, filesRoot }
}
