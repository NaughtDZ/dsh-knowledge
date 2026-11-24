/**
 * Verify the data-directory fix: defaultDataDir is always absolute and rooted
 * at DSH_HOME (or ~/.dsh), and migrateLegacyDataDir moves a legacy relative
 * ./dsh-knowledge dir into place. Run: node scripts/verify-datadir.mjs
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { defaultDataDir, resolveConfig, migrateLegacyDataDir } from '../lib/config.js'

// 1) Without DSH_HOME the default must be absolute under ~/.dsh.
delete process.env.DSH_HOME
const noHome = defaultDataDir()
console.log('no DSH_HOME  ->', noHome)
console.log('  absolute:', isAbsolute(noHome), '| under ~/.dsh:', noHome.startsWith(join(homedir(), '.dsh')))

// 2) With DSH_HOME it must use it.
process.env.DSH_HOME = 'X:\\dshhome'
const withHome = defaultDataDir()
console.log('DSH_HOME set ->', withHome, '| uses it:', withHome === join('X:\\dshhome', 'data', 'dsh-knowledge'))
delete process.env.DSH_HOME

// 3) resolveConfig makes filesRoot absolute under dataDir.
const cfg = resolveConfig({ dataDir: join(tmpdir(), 'kb-cfg') })
console.log('filesRoot:', cfg.filesRoot, '| absolute:', isAbsolute(cfg.filesRoot))

// 4) Migration: a legacy relative ./dsh-knowledge under cwd moves to canonical.
const cwd = join(tmpdir(), 'legacy-cwd-' + Date.now())
const canonical = join(tmpdir(), 'canonical-' + Date.now())
mkdirSync(join(cwd, 'dsh-knowledge'), { recursive: true })
writeFileSync(join(cwd, 'dsh-knowledge', 'knowledge.sqlite'), 'legacydb')
writeFileSync(join(cwd, 'dsh-knowledge', 'marker.txt'), 'hello')
const prev = process.cwd()
process.chdir(cwd)
try {
  migrateLegacyDataDir(canonical)
} finally {
  process.chdir(prev)
}
console.log('after migration: canonical sqlite =', existsSync(join(canonical, 'knowledge.sqlite')))
console.log('after migration: legacy removed =', !existsSync(join(cwd, 'dsh-knowledge')))
rmSync(cwd, { recursive: true, force: true })
rmSync(canonical, { recursive: true, force: true })

console.log('OK datadir')
