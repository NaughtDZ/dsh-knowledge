/**
 * Same-origin HTTP helpers for the dsh-knowledge panel. All calls go to the
 * plugin's own `/knowledge` API routes.
 */

async function json<T = unknown>(response: Response): Promise<T> {
  const text = await response.text()
  const body = text === '' ? {} : (JSON.parse(text) as unknown)
  if (!response.ok) {
    const err = (body as { error?: string }).error
    throw new Error(err ?? `HTTP ${response.status}`)
  }
  return body as T
}

export async function getJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`/knowledge${path}`, { headers: { accept: 'application/json' } })
  return json<T>(response)
}

export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/knowledge${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return json<T>(response)
}

/** Upload raw file bytes to import into a knowledge base. */
export async function uploadFile<T = unknown>(kbId: string, name: string, bytes: ArrayBuffer): Promise<T> {
  const response = await fetch(`/knowledge/files?kbId=${encodeURIComponent(kbId)}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', accept: 'application/json' },
    body: bytes,
  })
  return json<T>(response)
}
