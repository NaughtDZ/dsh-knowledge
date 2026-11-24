/**
 * Optional reranker client for OpenAI/Jina-compatible `/rerank` endpoints.
 * Returns a relevance score per input document. When the endpoint is absent
 * or errors, the caller falls back to embedding cosine search.
 */

export interface RerankConfig {
  /** Base URL for rerank (defaults to the embedding base URL). */
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
  readonly timeoutMs?: number
}

export interface RerankResult {
  /** Sorted array of { index, score }. */
  readonly ordered: Array<{ index: number; score: number }>
}

/**
 * Score `documents` against `query`. Returns null when the endpoint is
 * unavailable or does not support reranking (caller degrades to cosine).
 */
export async function rerank(config: RerankConfig, query: string, documents: string[]): Promise<RerankResult | null> {
  if (documents.length === 0) return null
  const url = `${config.baseUrl.replace(/\/$/u, '')}/rerank`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20000)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey !== undefined && config.apiKey !== '' ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, query, documents }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (payload === null) return null
  const rawResults = Array.isArray(payload['results'])
    ? payload['results'] as unknown[]
    : Array.isArray(payload['data'])
      ? payload['data'] as unknown[]
      : []
  const ordered = rawResults
    .map(r => {
      const rec = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
      const index = typeof rec['index'] === 'number' ? rec['index'] : 0
      const score = typeof rec['relevance_score'] === 'number' ? rec['relevance_score'] : 0
      return { index, score }
    })
    .filter(r => Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score)
  return { ordered }
}
