/**
 * Text chunking for vectorization: splits a large document into overlapping
 * chunks bounded by `maxChars`, breaking preferentially on paragraph and
 * sentence boundaries.
 */

export interface ChunkPiece {
  readonly text: string
  readonly heading?: string
}

/**
 * Split `text` into paragraphs (blank-line separated), tracking a light
 * heading hint (the last line that looked like a markdown heading).
 */
function paragraphsOf(text: string): Array<{ text: string; heading?: string }> {
  const blocks = text.split(/\n{2,}/u)
  const out: Array<{ text: string; heading?: string }> = []
  let lastHeading: string | undefined
  for (const block of blocks) {
    const lines = block.split('\n')
    // Detect a markdown/# heading in the block.
    let heading: string | undefined
    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+)$/u.exec(line.trim())
      if (m !== null) { heading = m[2]!.trim(); break }
    }
    if (heading !== undefined) lastHeading = heading
    const textBlock = lines.map(l => l.trim()).filter(Boolean).join(' ')
    if (textBlock.trim() !== '') out.push({ text: textBlock.trim(), heading: heading ?? lastHeading })
    if (heading !== undefined) lastHeading = heading
  }
  return out
}

/**
 * Greedy paragraph-grouping chunker with tail overlap.
 * @param text - the normalized document text.
 * @param maxChars - target max chunk length (characters).
 * @param overlapChars - trailing overlap shared between consecutive chunks.
 * @param minChars - drop residual chunks shorter than this.
 */
export function chunkText(text: string, maxChars: number, overlapChars: number, minChars = 1): ChunkPiece[] {
  if (maxChars <= 0) return []
  const normalized = text.replace(/\n{3,}/gu, '\n\n').trim()
  if (normalized === '') return []
  const paragraphs = paragraphsOf(normalized)
  const chunks: ChunkPiece[] = []
  let current = ''
  let currentHeading: string | undefined
  let tail = ''

  const pushCurrent = (): void => {
    const trimmed = current.trim()
    if (trimmed.length >= minChars) {
      chunks.push({ text: trimmed, heading: currentHeading })
      tail = trimmed.length > overlapChars ? trimmed.slice(trimmed.length - overlapChars) : trimmed
    } else {
      tail = ''
    }
    current = ''
    currentHeading = undefined
  }

  for (const para of paragraphs) {
    const next = current === '' ? para.text : `\n${para.text}`
    if (current === '' && para.text.length > maxChars) {
      // A single oversized paragraph hard-splits into standalone chunks.
      if (tail !== '') pushCurrent()
      for (const piece of hardSplit(para.text, maxChars, overlapChars)) {
        chunks.push({ text: piece, heading: para.heading ?? currentHeading })
      }
      tail = ''
      current = ''
      currentHeading = para.heading ?? currentHeading
      continue
    }
    if (current !== '' && current.length + next.length > maxChars) {
      pushCurrent()
      current = tail === '' ? para.text : `${tail}\n${para.text}`
      currentHeading = para.heading ?? currentHeading
      continue
    }
    current = current === '' ? para.text : `${current}\n${para.text}`
    if (currentHeading === undefined) currentHeading = para.heading
  }
  if (current.trim() !== '') pushCurrent()
  return chunks
}

/** Hard-split a single very long line into maxChars windows with overlap. */
function hardSplit(text: string, maxChars: number, overlapChars: number): string[] {
  const out: string[] = []
  let start = 0
  const len = text.length
  while (start < len) {
    const end = Math.min(start + maxChars, len)
    out.push(text.slice(start, end))
    if (end >= len) break
    start = Math.max(start + 1, end - overlapChars)
  }
  return out
}

/**
 * Split text into chunks with a sensible default (used by the host import
 * pipeline when no custom values are configured).
 */
export function defaultChunk(text: string, maxChars = 1200, overlapChars = 150): ChunkPiece[] {
  return chunkText(text, maxChars, overlapChars)
}
