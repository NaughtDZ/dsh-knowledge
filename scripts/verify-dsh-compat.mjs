/**
 * Check whether this plugin still fits the DSH runtime it sits next to.
 *
 * DSH >= 0.2 admits a profile bundle only after evaluating the bundle manifest's
 * `@deepseek-ai/dsh*` peer requirements, its `dsh.bundle.platforms` declaration,
 * and (for the browser half) its `dsh.client.inject` packages. A bundle that
 * fails any of those is skipped silently — the plugin simply disappears, with
 * no startup error. This script reproduces that admission logic locally so a DSH
 * upgrade can be triaged in one command instead of by reading the loader source.
 *
 * Run:
 *   node scripts/verify-dsh-compat.mjs                       # manifest + platform + data
 *   node scripts/verify-dsh-compat.mjs --search              # also run one real query
 *   node scripts/verify-dsh-compat.mjs --dsh-version=0.2.3   # override detection
 *   node scripts/verify-dsh-compat.mjs --json                # machine-readable
 *
 * Exit code: 0 when every check passes, 1 when any check fails. Skipped checks
 * (no data dir yet, DSH stopped, embedding endpoint offline) never fail the run.
 *
 * Peer ranges are evaluated with the real `semver` package whenever it resolves
 * — the same library and `includePrerelease` option DSH uses — and fall back to
 * `./lib/semver-lite.mjs` otherwise.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { compareVersions, formatVersion, parseVersion, satisfiesRange } from './lib/semver-lite.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))

const DSH_PEER_EXACT = '@deepseek-ai/dsh'
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const WORKSPACE_RANGES = new Set(['workspace:^', 'workspace:~', 'workspace:*'])

const MARK = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', warn: 'WARN' }

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { json: false, search: false, help: false }
  for (const argument of argv) {
    if (argument === '--json') options.json = true
    else if (argument === '--search') options.search = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument.startsWith('--dsh-version=')) options.dshVersion = argument.slice('--dsh-version='.length)
    else if (argument.startsWith('--data-dir=')) options.dataDir = argument.slice('--data-dir='.length)
    else if (argument.startsWith('--base-url=')) options.baseUrl = argument.slice('--base-url='.length)
    else if (argument.startsWith('--query=')) options.query = argument.slice('--query='.length)
    else throw new Error(`unknown argument ${JSON.stringify(argument)} (try --help)`)
  }
  return options
}

// ---------------------------------------------------------------------------
// module resolution probes
// ---------------------------------------------------------------------------

/** A require() rooted at an anchor directory, for resolving host packages. */
function requireAt(anchor) {
  return createRequire(join(anchor, '__dsh_compat_probe__.js'))
}

function candidateAnchors() {
  const anchors = [PLUGIN_ROOT, process.cwd()]
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const profilesDir = join(home, 'profiles')
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) anchors.push(join(profilesDir, entry.name))
    }
  }
  return [...new Set(anchors)]
}

/**
 * Load the real semver, preferring the copy DSH itself resolves so peer
 * evaluation matches the host exactly.
 */
function loadSemver(runtimeSource) {
  const probes = []
  if (runtimeSource !== undefined && !runtimeSource.startsWith('--')) probes.push(dirname(runtimeSource))
  probes.push(PLUGIN_ROOT, process.cwd())
  for (const probe of probes) {
    try {
      return requireAt(probe)('semver')
    } catch { /* try the next probe */ }
  }
  return undefined
}

/**
 * Detect a peer range whose upper bound leaks prereleases of the line it is
 * supposed to close. `<0.3.0` still admits `0.3.0-rc.1` because a prerelease
 * sorts below its release, so a runtime DSH ships as a 0.3.0 prerelease would
 * be admitted unverified; `<0.3.0-0` is the bound that actually closes the line.
 * @param satisfies the active range evaluator.
 * @returns every leaking bound, or undefined when every bound is tight.
 */
function checkUpperBoundLeak(satisfies) {
  const leaking = new Map()
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (name !== DSH_PEER_EXACT && !name.startsWith(DSH_PEER_PREFIX)) continue
    if (WORKSPACE_RANGES.has(range)) continue
    // Only a bare release upper bound can leak; `<X.Y.Z-0` is already tight.
    const bounds = [...range.matchAll(/<\s*(\d+\.\d+\.\d+)(?![\d.-])/g)]
      .map(match => parseVersion(match[1]))
      .filter(parsed => parsed !== undefined)
    if (bounds.length === 0) continue
    // The highest bound is the one that decides admission of the next line;
    // lower bounds are usually closed by a later, prerelease-anchored set.
    const highest = bounds.reduce((left, right) => (compareVersions(left, right) >= 0 ? left : right))
    const bound = formatVersion(highest)
    const probe = `${bound}-rc.1`
    if (satisfies(probe, range)) leaking.set(`${range}|${bound}`, { name, range, bound, probe })
  }
  return leaking.size === 0 ? undefined : [...leaking.values()]
}

// ---------------------------------------------------------------------------
// DSH runtime version discovery (the same manifest DSH reads)
// ---------------------------------------------------------------------------

function readDshVersion() {
  for (const anchor of candidateAnchors()) {
    try {
      const resolved = requireAt(anchor).resolve('@deepseek-ai/dsh-app-boot/package.json')
      const version = JSON.parse(readFileSync(resolved, 'utf8')).version
      return { version, source: resolved }
    } catch { /* try the next anchor */ }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

function checkPeers(runtimeVersion, satisfies) {
  const peers = []
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (name !== DSH_PEER_EXACT && !name.startsWith(DSH_PEER_PREFIX)) continue
    const requirement = WORKSPACE_RANGES.has(range) ? runtimeVersion : range
    peers.push({ name, range, satisfied: satisfies(runtimeVersion, requirement) })
  }
  return peers
}

function checkBundlePlatform() {
  const platforms = manifest.dsh?.bundle?.platforms
  if (platforms === undefined) return { declared: false, supported: true }
  const supported = Array.isArray(platforms) && platforms.includes(process.platform)
  return { declared: true, platforms, supported }
}

function checkClientDependencies() {
  const packages = manifest.dsh?.client?.inject ?? []
  const missing = []
  for (const name of packages) {
    let found = false
    for (const anchor of candidateAnchors()) {
      try {
        requireAt(anchor).resolve(`${name}/package.json`)
        found = true
        break
      } catch { /* try the next anchor */ }
    }
    if (!found) missing.push(name)
  }
  return { total: packages.length, resolvable: packages.length - missing.length, missing }
}

function checkDataDirectory(dataDir) {
  if (dataDir === undefined) return { skipped: 'no data directory could be resolved' }
  const databasePath = join(dataDir, 'knowledge.sqlite')
  const summary = { exists: existsSync(databasePath), path: databasePath, dataDir }
  if (summary.exists === false) return summary
  try {
    const sqlite = process.getBuiltinModule?.('node:sqlite')
    if (sqlite?.DatabaseSync === undefined) return { ...summary, skipped: 'node:sqlite unavailable' }
    const database = new sqlite.DatabaseSync(databasePath, { readOnly: true })
    try {
      summary.integrity = database.prepare('PRAGMA integrity_check').get().integrity_check
      for (const table of ['knowledge_bases', 'files', 'chunks', 'mounts']) {
        summary[table] = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
      }
    } finally {
      database.close()
    }
  } catch (error) {
    summary.error = String(error)
  }
  return summary
}

async function checkHttp(baseUrl, runSearch, query) {
  const result = {}
  try {
    const health = await fetch(`${baseUrl}/knowledge/health`, { signal: AbortSignal.timeout(5000) })
    if (!health.ok) return { reachable: false, status: health.status }
    result.reachable = true
    result.health = await health.json()
  } catch (error) {
    return { reachable: false, error: String(error) }
  }
  if (!runSearch) return result
  try {
    const response = await fetch(`${baseUrl}/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ query, topK: 3 }),
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok) return { ...result, search: { ok: false, status: response.status } }
    const payload = await response.json()
    const hits = Array.isArray(payload.hits) ? payload.hits : []
    return {
      ...result,
      search: {
        ok: true,
        count: hits.length,
        topScore: hits.length === 0 ? undefined : hits[0].score,
        rerankDegraded: hits.length > 0 && hits.every(hit => (hit.rerankScore ?? 0) === 0),
        sample: hits.slice(0, 1).map(hit => ({ fileName: hit.fileName, score: hit.score })),
      },
    }
  } catch (error) {
    return { ...result, search: { ok: false, error: String(error) } }
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function buildReport(runtime, options, semverAnchor) {
  const { version: runtimeVersion, source } = runtime
  const semver = loadSemver(semverAnchor ?? source)
  const satisfies = semver === undefined
    ? satisfiesRange
    : (candidate, range) => semver.satisfies(candidate, range, { includePrerelease: true })

  const peers = checkPeers(runtimeVersion, satisfies)
  const failedPeers = peers.filter(peer => !peer.satisfied)
  const ranges = [...new Set(peers.map(peer => peer.range))]
  const platform = checkBundlePlatform()
  const client = checkClientDependencies()
  const data = checkDataDirectory(options.dataDir)
  const leak = checkUpperBoundLeak(satisfies)

  const checks = [
    {
      label: 'runtime',
      mark: MARK.pass,
      detail: `${runtimeVersion}  (from ${source})`,
    },
    {
      label: 'peer contract',
      mark: failedPeers.length === 0 ? MARK.pass : MARK.fail,
      detail: peers.length === 0
        ? 'no @deepseek-ai/dsh* peers declared — DSH admits any runtime'
        : failedPeers.length > 0
          ? failedPeers.map(peer => `${peer.name} ${peer.range} ∉ ${runtimeVersion}`).join('; ')
          : `${peers.length} peer(s) satisfied${ranges.length === 1 ? ` — ${ranges[0]}` : ''}`
            + `${semver === undefined ? '  [built-in semver]' : ''}`,
    },
    {
      label: 'upper bound',
      mark: leak === undefined ? MARK.pass : MARK.warn,
      detail: peers.length === 0
        ? 'no bounded peer range to check'
        : leak === undefined
          ? 'closed — no upper bound leaks the next line’s prereleases'
          : leak.map(entry => `${entry.range} admits ${entry.probe}; use "<${entry.bound}-0"`).join('; '),
    },
    {
      label: 'bundle platform',
      mark: platform.supported ? MARK.pass : MARK.fail,
      detail: platform.declared
        ? `dsh.bundle.platforms = ${JSON.stringify(platform.platforms)}; host = ${process.platform}`
        : `not declared — DSH admits every host (host = ${process.platform})`,
    },
    {
      label: 'client inject',
      mark: client.missing.length === 0 ? MARK.pass : MARK.fail,
      detail: client.total === 0
        ? 'no browser half declared'
        : client.missing.length === 0
          ? `${client.resolvable}/${client.total} resolvable`
          : `missing: ${client.missing.join(', ')}`,
    },
    {
      label: 'data directory',
      mark: data.exists === false || data.skipped !== undefined
        ? MARK.skip
        : (data.integrity === 'ok' ? MARK.pass : MARK.warn),
      detail: data.skipped !== undefined
        ? data.skipped
        : data.exists === false
          ? `not created yet (${data.path})`
          : data.integrity === 'ok'
            ? `integrity ok — ${data.knowledge_bases} bases / ${data.files} files / ${data.chunks} chunks`
            : `integrity ${data.integrity ?? data.error}`,
    },
  ]

  return {
    plugin: `${manifest.name}@${manifest.version}`,
    runtimeVersion,
    runtimeSource: source,
    semverImplementation: semver === undefined ? 'built-in' : 'semver',
    peerRange: ranges.length === 1 ? ranges[0] : ranges,
    checks,
    peers,
    upperBoundLeak: leak,
    platform,
    client,
    data,
  }
}

function printHuman(report) {
  const line = (check) => {
    process.stdout.write(`  ${check.mark.padEnd(4)}  ${check.label.padEnd(18)} ${check.detail}\n`)
  }
  process.stdout.write(`\n${report.plugin}  ×  DSH ${report.runtimeVersion}\n`)
  process.stdout.write(`${'-'.repeat(80)}\n`)
  for (const check of report.checks) line(check)
  process.stdout.write(`${'-'.repeat(80)}\n`)
  const failed = report.checks.filter(check => check.mark === MARK.fail).length
  const warned = report.checks.filter(check => check.mark === MARK.warn).length
  if (failed === 0) {
    process.stdout.write(`  OK — DSH admits this bundle on the running runtime${warned === 0 ? '.' : `, with ${warned} warning(s).`}\n`)
    if (typeof report.peerRange === 'string') {
      process.stdout.write(`  Declared support: ${report.peerRange}\n`)
      process.stdout.write('  A runtime outside that range needs a new plugin release (or an --accept-risk exemption).\n')
    }
  } else {
    process.stdout.write(`  FAILED — ${failed} check(s) keep DSH from loading this bundle.\n`)
    process.stdout.write('  Remedy: widen the failing peer ranges, then publish a new plugin version.\n')
    process.stdout.write(`  Temporary: dsh plugin --profile <profile> allow-version ${report.plugin}`
      + ` --dsh-version ${report.runtimeVersion} --accept-risk\n`)
  }
  process.stdout.write('\n')
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** Use the plugin's own resolution so the check follows DSH_HOME and migration. */
async function defaultDataDir() {
  try {
    const module = await import(new URL('../lib/config.js', import.meta.url).href)
    return module.defaultDataDir()
  } catch {
    return undefined
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]}\n`)
    return 0
  }
  options.dataDir ??= await defaultDataDir()

  if (options.dshVersion !== undefined && parseVersion(options.dshVersion) === undefined) {
    process.stderr.write(`--dsh-version=${options.dshVersion} is not an exact semantic version\n`)
    return 1
  }
  const detected = readDshVersion()
  const runtime = options.dshVersion === undefined
    ? detected
    : { version: options.dshVersion, source: '--dsh-version' }
  if (runtime === undefined) {
    process.stderr.write('Cannot find @deepseek-ai/dsh-app-boot/package.json next to this plugin.\n'
      + 'Run from the DSH profile directory, or pass --dsh-version=<exact version>.\n')
    return 1
  }

  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:3080'
  const report = buildReport(runtime, options, detected?.source)
  report.http = await checkHttp(baseUrl, options.search, options.query ?? 'knowledge base retrieval test')

  if (report.http.reachable === true) {
    const health = report.http.health ?? {}
    report.checks.push({
      label: 'live host',
      mark: MARK.pass,
      detail: `${baseUrl}/knowledge/health ok — ${health.baseCount ?? '?'} bases / ${health.fileCount ?? '?'} files`,
    })
  } else {
    report.checks.push({
      label: 'live host',
      mark: MARK.skip,
      detail: `not reachable at ${baseUrl} (DSH stopped, or routes not mounted yet)`,
    })
  }

  if (report.http.search !== undefined) {
    const search = report.http.search
    report.checks.push({
      label: 'live retrieval',
      mark: search.ok ? (search.count > 0 ? MARK.pass : MARK.warn) : MARK.warn,
      detail: search.ok
        ? `${search.count} hit(s), top score ${search.topScore?.toFixed(4) ?? 'n/a'}`
          + `${search.rerankDegraded ? ' — rerank degraded to cosine (no /rerank endpoint)' : ''}`
        : `query failed (${search.error ?? `HTTP ${search.status}`}) — embedding endpoint offline?`,
    })
  }

  if (options.json) process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
  else printHuman(report)

  const failed = report.checks.filter(check => check.mark === MARK.fail).length
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
