/**
 * OpenAI-compatible embedding client: POSTs batches of text to
 * `${baseUrl}/embeddings`. Accepts any endpoint that speaks the OpenAI
 * embeddings protocol (LM Studio, Ollama, local servers, hosted APIs).
 */

export interface EmbedConfig {
  /** Base URL, e.g. http://127.0.0.1:1234/v1 (embeddings appended). */
  readonly baseUrl: string
  readonly model: string
  /** Optional API key. */
  readonly apiKey?: string
  readonly timeoutMs?: number
}

export async function embedTexts(config: EmbedConfig, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  if (inputs.length === 0) return []
  const url = `${config.baseUrl.replace(/\/$/u, '')}/embeddings`
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs ?? 30000)
  const controller = signal !== undefined
    ? (() => { const c = new AbortController(); const onAbort = (): void => c.abort(); signal.addEventListener('abort', onAbort, { once: true }); return c })()
    : timeoutController
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey !== undefined && config.apiKey !== '' ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, input: inputs }),
      signal: controller.signal === timeoutController.signal ? controller.signal : AbortSignal.any([controller.signal, timeoutController.signal]),
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`embedding request failed (${response.status}): ${body.slice(0, 400)}`)
  }
  const payload = (await response.json()) as { data?: Array<{ embedding: number[] }>; error?: { message?: string } }
  if (payload.error !== undefined) throw new Error(`embedding error: ${payload.error.message ?? 'unknown'}`)
  if (payload.data === undefined) throw new Error('embedding response missing data')
  const data = payload.data
  return data.map(item => item.embedding.map(Number))
}

/** Embed a single text (shortcut). */
export async function embedText(config: EmbedConfig, text: string, signal?: AbortSignal): Promise<number[]> {
  const result = await embedTexts(config, [text], signal)
  const vector = result[0]
  if (vector === undefined) throw new Error('embedding returned no vector')
  return vector
}

/** Batch a large list by maxTokens-per-request (chars). */
export async function embedBatched(config: EmbedConfig, texts: string[], maxCharsPerBatch = 8000, signal?: AbortSignal): Promise<number[][]> {
  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i += Math.max(1, Math.floor(maxCharsPerBatch / 8))) {
    if (signal?.aborted === true) break
    const batch = texts.slice(i, i + Math.max(1, Math.floor(maxCharsPerBatch / 8)))
    const result = await embedTexts(config, batch, signal)
    vectors.push(...result)
  }
  return vectors
}

/** Compute cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
