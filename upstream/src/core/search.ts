/**
 * Vector search: rank candidates by cosine similarity to a query vector.
 */

import { cosine } from './embed.ts'

export interface RankedItem<T> {
  readonly item: T
  readonly score: number
}

/**
 * Rank `candidates` by cosine similarity to `query`, returning the top `k`.
 * Candidates whose vector dimension does not match are skipped.
 */
export function topKByCosine<T>(
  query: number[],
  candidates: Array<{ vector: number[]; item: T }>,
  k: number,
): RankedItem<T>[] {
  const scored: RankedItem<T>[] = []
  for (const candidate of candidates) {
    if (candidate.vector.length !== query.length) continue
    const score = cosine(query, candidate.vector)
    scored.push({ item: candidate.item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(0, k))
}
