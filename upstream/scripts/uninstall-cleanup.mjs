/**
 * dsh-knowledge uninstall cleanup: removes the plugin's data directory so no
 * knowledge bases, embeddings, or uploaded files remain after the plugin is
 * removed. Runs as the pnpm `uninstall`/`postuninstall` lifecycle hook.
 *
 * Safety: only ever deletes the well-known plugin data dir under DSH_HOME.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const target = join(home, 'data', 'dsh-knowledge')

// Guard: the target must end with the exact relative path; never delete more.
const tailOk = target.endsWith('\\data\\dsh-knowledge') || target.endsWith('/data/dsh-knowledge')
if (!tailOk || target.split(/[\\/]/u).length < 3) {
  console.error(`dsh-knowledge: refusing to remove unexpected path: ${target}`)
  process.exitCode = 1
} else {
  try {
    rmSync(target, { recursive: true, force: true })
    console.log(`dsh-knowledge: removed plugin data directory ${target}`)
  } catch (error) {
    console.error(`dsh-knowledge: could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
