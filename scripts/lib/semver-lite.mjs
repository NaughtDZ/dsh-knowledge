/**
 * Minimal node-semver subset used only when the real `semver` package cannot be
 * resolved. DSH evaluates peer ranges with the real library, so this fallback
 * exists to keep the verifier useful on a bare machine — not to replace it.
 *
 * Supported: `||` alternative sets, whitespace-joined comparator sets, the
 * `>= > <= < =` operators, exact versions, and `^` / `~` sugar expanded the way
 * node-semver expands them (a release-line upper bound spelled `<X.Y.Z-0`).
 * Prereleases compare per the semver precedence rules.
 */

/** Parse an exact version, tolerating a leading `v` or `=`. */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
    .exec(String(text).trim().replace(/^[=v]/, ''))
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (index >= left.length) return -1
    if (index >= right.length) return 1
    const a = left[index]
    const b = right[index]
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1
    } else if (aNumeric) return -1
    else if (bNumeric) return 1
    else if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/** Compare two parsed versions by semver precedence. */
export function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** Render a parsed version back to its canonical text. */
export function formatVersion(parsed) {
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return parsed.prerelease.length === 0 ? core : `${core}-${parsed.prerelease.join('.')}`
}

/** Lowest prerelease of a release line; node-semver spells this `<X.Y.Z-0`. */
function lineFloor(major, minor, patch) {
  return formatVersion({ major, minor, patch, prerelease: ['0'] })
}

/** Expand one range token into primitive comparators, mirroring node-semver. */
function expandToken(token) {
  // `*`, `x` and `X` mean "any version" — an empty comparator set, which the
  // caller ANDs into a vacuous truth.
  if (token === '*' || token === 'x' || token === 'X') return []
  const caret = /^\^(.+)$/.exec(token)
  if (caret !== null) {
    const parsed = parseVersion(caret[1])
    if (parsed === undefined) return undefined
    const lower = formatVersion(parsed)
    if (parsed.major !== 0) return [{ op: '>=', version: lower }, { op: '<', version: lineFloor(parsed.major + 1, 0, 0) }]
    if (parsed.minor !== 0) return [{ op: '>=', version: lower }, { op: '<', version: lineFloor(0, parsed.minor + 1, 0) }]
    return [{ op: '>=', version: lower }, { op: '<', version: lineFloor(0, 0, parsed.patch + 1) }]
  }
  const tilde = /^~(.+)$/.exec(token)
  if (tilde !== null) {
    const parsed = parseVersion(tilde[1])
    if (parsed === undefined) return undefined
    return [{ op: '>=', version: formatVersion(parsed) }, { op: '<', version: lineFloor(parsed.major, parsed.minor + 1, 0) }]
  }
  const comparator = /^(>=|<=|>|<|=)(.+)$/.exec(token)
  if (comparator !== null) return [{ op: comparator[1], version: comparator[2] }]
  if (/^\d/.test(token)) return [{ op: '=', version: token }]
  return undefined
}

function satisfiesComparator(candidate, comparator) {
  const target = parseVersion(comparator.version)
  if (target === undefined) return false
  const order = compareVersions(candidate, target)
  switch (comparator.op) {
    case '>=': return order >= 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '<': return order < 0
    default: return order === 0
  }
}

/** `||` separates alternative sets; whitespace separates comparators ANDed together. */
export function satisfiesRange(candidateText, range) {
  const candidate = parseVersion(candidateText)
  if (candidate === undefined) return false
  const sets = range.split('||').map(set => set.trim()).filter(set => set !== '')
  if (sets.length === 0) return false
  return sets.some(set => set.split(/\s+/).filter(Boolean).every(token => {
    const comparators = expandToken(token)
    return comparators !== undefined && comparators.every(comparator => satisfiesComparator(candidate, comparator))
  }))
}
