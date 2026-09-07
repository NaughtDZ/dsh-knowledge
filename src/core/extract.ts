/**
 * Document text extraction for dsh-knowledge. Pure Node, no dependencies.
 *
 * Supported inputs:
 *   - docx / pptx / xlsx (ZIP+XML) — full fidelity.
 *   - txt / md / csv / html        — encoding-aware decode, CRLF→LF.
 *   - doc / ppt / xls (OLE2)       — best-effort text pull (limited fidelity).
 */

import { decodeText, normalizeLineEndings, type DecodedText } from './encoding.ts'
import { isZip, readZipEntry, readZipByPrefix } from './zip.ts'
import { parseXml, descendants, textOf, localNameOf, type XmlElement } from './xml.ts'

export interface ExtractionResult {
  readonly text: string
  readonly kind: 'office' | 'text' | 'unknown'
  /** Detected subtype: 'docx' | 'pptx' | 'xlsx' | 'doc' | 'ppt' | 'xls' | 'txt' | 'md' | 'csv' | 'html' | 'xml' | 'json' | 'unknown'. */
  readonly subtype: string
  readonly encoding: string
  readonly hadBom: boolean
  readonly charCount: number
  /** Whether the extraction was best-effort/lossy. */
  readonly degraded: boolean
}

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'html', 'htm', 'xml', 'json', 'log', 'ini', 'conf', 'yml', 'yaml', 'tsv', 'text'])

/** Lower-cased extension without dot. */
function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

const ZIP_XML_EXT = new Set(['docx', 'pptx', 'xlsx'])
const OLE2_EXT = new Set(['doc', 'ppt', 'xls'])

function isOle2(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'
}

function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-'
}

/** Extract w:t / a:t runs text from a paragraph-ish container, with breaks. */
function paraText(node: XmlElement): string {
  let out = ''
  const walk = (n: XmlElement): void => {
    for (const child of n.children) {
      if (child.kind === 'text') {
        out += child.text
        continue
      }
      const local = localNameOf(child.tag)
      if (local === 't') {
        out += textOf(child)
      } else if (local === 'br' || local === 'cr') {
        out += '\n'
      } else if (local === 'tab') {
        out += '\t'
      } else {
        walk(child)
      }
    }
  }
  walk(node)
  return out
}

/** Build the full document text from docx `word/document.xml`. */
function extractDocx(documentXml: Buffer): string {
  const root = parseXml(documentXml.toString('utf8'))
  if (root === null) return ''
  const paragraphs = descendants(root, 'p')
  const lines: string[] = []
  for (const p of paragraphs) {
    const text = paraText(p).replace(/\s+$/u, '')
    if (text.trim() !== '') lines.push(text)
    else if (text.includes('\n')) lines.push('')
  }
  return lines.join('\n')
}

/** Build slide text from pptx `ppt/slides/slideN.xml`. */
function extractPptx(buf: Buffer): string {
  const slides = readZipByPrefix(buf, 'ppt/slides/slide')
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name))
  const blocks: string[] = []
  for (const slide of slides) {
    const root = parseXml(slide.data.toString('utf8'))
    if (root === null) continue
    const paragraphs = descendants(root, 'p')
    const lines: string[] = []
    for (const p of paragraphs) {
      const text = paraText(p)
      if (text.trim() !== '') lines.push(text)
    }
    blocks.push(`--- Slide ${slideNumber(slide.name)} ---`)
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n')
}

function slideNumber(name: string): number {
  const m = /(\d+)\.xml$/u.exec(name)
  return m === null ? 0 : Number(m[1])
}

/** Column letters (A, B, …, AA, …) to zero-based index. */
function colIndex(ref: string): number {
  let col = 0
  for (let i = 0; i < ref.length; i++) {
    const ch = ref[i]!
    if (ch >= 'A' && ch <= 'Z') col = col * 26 + (ch.charCodeAt(0) - 64)
    else break
  }
  return col - 1
}

function rowIndexOf(ref: string): number {
  const m = /\d+/u.exec(ref)
  return m === null ? 0 : Number(m[0]) - 1
}

function cellText(cell: XmlElement, shared: string[]): string {
  const type = cell.attrs['t'] ?? ''
  const children = cell.children.filter((c): c is XmlElement => c.kind === 'element')
  const valueEl = children.find(c => localNameOf(c.tag) === 'v')
  const inlineIs = children.find(c => localNameOf(c.tag) === 'is')
  if (type === 'inlineStr' && inlineIs !== undefined) {
    return textOf(inlineIs).trim()
  }
  if (valueEl === undefined) return ''
  const raw = textOf(valueEl).trim()
  if (type === 's') {
    const idx = Number(raw)
    return Number.isFinite(idx) && idx >= 0 && idx < shared.length ? shared[idx]! : ''
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  return raw
}

/** Build cell-grid text from an xlsx workbook. */
function extractXlsx(buf: Buffer): string {
  // Shared strings table.
  const shared: string[] = []
  const ssXml = readZipEntry(buf, 'xl/sharedStrings.xml')
  if (ssXml !== null) {
    const root = parseXml(ssXml.toString('utf8'))
    if (root !== null) {
      for (const si of descendants(root, 'si')) {
        shared.push(textOf(si))
      }
    }
  }
  // Sheet files (best-effort order by sheet index suffix).
  const sheets = readZipByPrefix(buf, 'xl/worksheets/sheet')
    .sort((a, b) => { const na = /\/(\d+)\.xml$/.exec(a.name); const nb = /\/(\d+)\.xml$/.exec(b.name); return (na?.[1] ? Number(na[1]) : 0) - (nb?.[1] ? Number(nb[1]) : 0) })
  const blocks: string[] = []
  for (const sheet of sheets) {
    const root = parseXml(sheet.data.toString('utf8'))
    if (root === null) continue
    const rows: Map<number, Map<number, string>> = new Map()
    for (const row of descendants(root, 'row')) {
      const rowEl = row
      const rowNum = Number(rowEl.attrs['r'] ?? 0) - 1 || rows.size
      const cells = new Map<number, string>()
      for (const cell of descendants(rowEl, 'c')) {
        const ref = cell.attrs['r'] ?? ''
        if (ref === '') continue
        cells.set(colIndex(ref), cellText(cell, shared))
      }
      rows.set(rowNum, cells)
    }
    const lines: string[] = []
    const maxRow = Math.max(0, ...rows.keys())
    for (let r = 0; r <= maxRow; r++) {
      const cells = rows.get(r)
      if (cells === undefined || cells.size === 0) continue
      const maxCol = Math.max(0, ...cells.keys())
      const parts: string[] = []
      for (let c = 0; c <= maxCol; c++) parts.push(cells.get(c) ?? '')
      const line = parts.join('\t').replace(/\s+$/u, '')
      if (line.trim() !== '') lines.push(line)
    }
    blocks.push(`--- Sheet ${sheet.name} ---`)
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n')
}

/** Pull readable runs of text out of an OLE2 (legacy office) container. */
function extractOleText(buf: Buffer): string {
  const out: string[] = []
  const minRun = 4
  let i = 0
  // UTF-16LE runs.
  while (i + 2 <= buf.length) {
    const lo = buf[i]!
    const hi = buf[i + 1]!
    if (hi === 0 && ((lo >= 0x20 && lo < 0x7f) || (lo >= 0x80))) {
      let j = i
      let run = ''
      while (j + 2 <= buf.length) {
        const l = buf[j]!
        const h = buf[j + 1]!
        if (h === 0 && (l >= 0x20 && l < 0x7f || l >= 0x80)) { run += String.fromCharCode(l); j += 2 }
        else break
      }
      if (run.length >= minRun) out.push(run.trim())
      i = j
    } else {
      i += 2
    }
  }
  if (out.length === 0) {
    // Fallback: ASCII/Latin-1 runs.
    let run = ''
    const flush = (): void => {
      if (run.trim().length >= minRun) out.push(run.trim())
      run = ''
    }
    for (const byte of buf) {
      if (byte >= 0x20 && byte < 0x7f) run += String.fromCharCode(byte)
      else if (byte >= 0xa0) run += String.fromCharCode(byte) // latin-1 letters
      else flush()
    }
    flush()
  }
  return normalizeLineEndings(out.join(' '))
}

/** Strip HTML tags to a text approximation (keeps headings/paragraphs). */
function htmlToText(html: string): string {
  const root = parseXml(html)
  if (root === null) return normalizeLineEndings(html.replace(/<[^>]+>/gu, ' '))
  const blocks: string[] = []
  const walk = (n: XmlElement, depth: number): void => {
    for (const child of n.children) {
      if (child.kind === 'text') {
        blocks.push(child.text.trim())
        continue
      }
      const tag = localNameOf(child.tag)
      if (['p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'h4', 'tr', 'section', 'article', 'blockquote'].includes(tag)) {
        blocks.push('')
      }
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  const joined = blocks.filter(Boolean).join('\n')
  return normalizeLineEndings(joined.replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n'))
}

/**
 * Extract text from a file's bytes.
 * @param filename - original file name (used for extension detection).
 * @param buffer - raw file bytes.
 * @param preferredEncoding - optional encoding hint for text files.
 * @param stripMarkup - strip tags for html.
 */
export function extractText(filename: string, buffer: Buffer, preferredEncoding?: string, stripMarkup = true): ExtractionResult {
  const ext = extOf(filename)
  const lower = ext

  // --- ZIP+XML office formats (highest fidelity) ---
  if (ZIP_XML_EXT.has(lower) && isZip(buffer)) {
    if (lower === 'docx') {
      const xml = readZipEntry(buffer, 'word/document.xml')
      const text = xml === null ? '' : normalizeLineEndings(extractDocx(xml))
      return { text, kind: 'office', subtype: 'docx', encoding: 'utf-8', hadBom: false, charCount: text.length, degraded: false }
    }
    if (lower === 'pptx') {
      const text = normalizeLineEndings(extractPptx(buffer))
      return { text, kind: 'office', subtype: 'pptx', encoding: 'utf-8', hadBom: false, charCount: text.length, degraded: false }
    }
    if (lower === 'xlsx') {
      const text = normalizeLineEndings(extractXlsx(buffer))
      return { text, kind: 'office', subtype: 'xlsx', encoding: 'utf-8', hadBom: false, charCount: text.length, degraded: false }
    }
  }

  // --- legacy OLE2 office formats (best-effort) ---
  if (OLE2_EXT.has(lower) || isOle2(buffer)) {
    let text = ''
    if (isOle2(buffer)) text = extractOleText(buffer)
    // Some legacy files are actually zip-based despite the ext; retry zip.
    if (text.trim() === '' && isZip(buffer)) {
      const tryText = extractText(filename + 'x', buffer, preferredEncoding, stripMarkup)
      if (tryText.text.trim() !== '') return { ...tryText, subtype: lower, degraded: true }
    }
    return { text, kind: 'office', subtype: lower, encoding: 'latin1', hadBom: false, charCount: text.length, degraded: true }
  }

  // --- PDF (unsupported v1; flag clearly) ---
  if (lower === 'pdf' || isPdf(buffer)) {
    return { text: '', kind: 'unknown', subtype: 'pdf', encoding: 'utf-8', hadBom: false, charCount: 0, degraded: true }
  }

  // --- plain text formats (encoding-aware) ---
  const isTextish = TEXT_EXT.has(lower) || looksLikeTextLike(buffer)
  let decoded: DecodedText
  if (isTextish) {
    decoded = decodeText(buffer, preferredEncoding)
  } else {
    decoded = decodeText(buffer, preferredEncoding)
  }

  let text = normalizeLineEndings(decoded.text)
  let subtype = TEXT_EXT.has(lower) ? lower : 'txt'
  if (lower === 'html' || lower === 'htm') {
    subtype = 'html'
    if (stripMarkup && isMarkup(text)) text = htmlToText(text)
  }
  if (lower === 'md' || lower === 'markdown') subtype = 'md'
  if (lower === 'csv') subtype = 'csv'
  if (lower === 'json') subtype = 'json'

  return {
    text,
    kind: lower === 'html' || lower === 'htm' ? 'text' : 'text',
    subtype,
    encoding: decoded.encoding,
    hadBom: decoded.hadBom,
    charCount: text.length,
    degraded: false,
  }
}

function looksLikeTextLike(buf: Buffer): boolean {
  // No NUL bytes in the first 1KB and mostly printable.
  const sample = Math.min(buf.length, 1024)
  if (sample === 0) return true
  let printable = 0
  for (let i = 0; i < sample; i++) {
    const b = buf[i]!
    if (b === 0) return false
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b !== 0x7f)) printable++
  }
  return printable / sample > 0.85
}

function isMarkup(text: string): boolean {
  return /<(!doctype|html|head|body|div|p|span|td|a|script|style)\b/i.test(text)
}
