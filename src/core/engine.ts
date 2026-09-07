/**
 * The high-level knowledge engine: imports files (extract → chunk → embed),
 * stores everything, and serves vector search. DSH-independent — the host
 * plugin wraps this with HTTP routes, a settings namespace, and a tool.
 */

import { KnowledgeStore } from './store.ts'
import { extractText } from './extract.ts'
import { chunkText } from './chunk.ts'
import { embedBatched, type EmbedConfig } from './embed.ts'
import { topKByCosine } from './search.ts'
import { rerank, type RerankConfig } from './rerank.ts'
import type {
  Chunk, KnowledgeBase, KnowledgeConfig, KnowledgeFile, SearchHit, WorkspaceMount,
} from './types.ts'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface EngineOptions {
  readonly dbPath: string
  /** Where to persist original uploaded files. Empty = do not retain raw files. */
  readonly filesRoot?: string
}

export interface SearchOptions {
  /** Restrict to these knowledge base ids; empty = all bases. */
  readonly kbIds?: string[]
  /** The workspace to scope to (searches its enabled bases). */
  readonly workspaceId?: string
  readonly topK?: number
  /** Run the reranker over the cosine candidates (default true when configured). */
  readonly useRerank?: boolean
  /** A broader candidate pool before rerank (default topK * 4). */
  readonly candidateK?: number
  /** Cancellation signal. */
  readonly signal?: AbortSignal
}

export interface ImportResult {
  readonly file: KnowledgeFile
  readonly chunkCount: number
  readonly embeddingDim: number
}

export class KnowledgeEngine {
  private readonly store: KnowledgeStore
  private readonly filesRoot: string | undefined

  constructor(options: EngineOptions | string) {
    const opts = typeof options === 'string' ? { dbPath: options } : options
    this.store = new KnowledgeStore(opts.dbPath)
    this.filesRoot = opts.filesRoot
  }

  close(): void {
    this.store.close()
  }

  // ── config ────────────────────────────────────────────────────────────────

  getConfig(): KnowledgeConfig {
    return this.store.getConfig()
  }

  saveConfig(patch: Partial<KnowledgeConfig>): KnowledgeConfig {
    return this.store.saveConfig(patch)
  }

  // ── bases ─────────────────────────────────────────────────────────────────

  listBases(): KnowledgeBase[] {
    return this.store.listBases()
  }

  createBase(name: string, description = ''): KnowledgeBase {
    return this.store.createBase(name, description)
  }

  deleteBase(id: string): void {
    this.store.deleteBase(id)
  }

  // ── files ─────────────────────────────────────────────────────────────────

  filesOf(kbId: string): KnowledgeFile[] {
    return this.store.filesOf(kbId)
  }

  fileOf(id: string): KnowledgeFile | null {
    return this.store.fileOf(id)
  }

  /** Read the originally-uploaded bytes for a file (relative to filesRoot). */
  readFileBytes(relPath: string): Buffer | null {
    if (this.filesRoot === undefined || relPath === '') return null
    try {
      return readFileSync(join(this.filesRoot, relPath))
    } catch {
      return null
    }
  }

  deleteFile(id: string): void {
    this.store.deleteFile(id)
  }

  /**
   * Import a file: extract text, chunk it, embed every chunk, and persist.
   * @returns the file record plus stats. On embedding failure the file is
   * marked 'failed' and no chunks are persisted.
   */
  async importFile(kbId: string, filename: string, bytes: Buffer): Promise<ImportResult> {
    const config = this.store.getConfig()
    const fileId = randomUUID()
    const now = Date.now()
    // Persist the original upload so the corpus is recoverable.
    let relPath = ''
    if (this.filesRoot !== undefined) {
      relPath = `${kbId}/${fileId}/${safeName(filename)}`
      const target = join(this.filesRoot, relPath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
    const initial: Omit<KnowledgeFile, 'updatedAt'> = {
      id: fileId, kbId, name: filename, ext: ext(filename), kind: 'text',
      relPath, size: bytes.length, encoding: 'auto', lineEnding: 'lf',
      charCount: 0, chunkCount: 0, status: 'pending', createdAt: now,
    }
    this.store.addFile(initial)
    try {
      this.store.updateFile(fileId, { status: 'indexing' })
      const extracted = extractText(filename, bytes, undefined, config.stripMarkup)
      if (extracted.text.trim() === '') {
        if (extracted.subtype === 'pdf') throw new Error('PDF files are not supported yet; convert to text or an Office format first.')
        throw new Error(`no readable text extracted from ${filename}`)
      }
      const pieces = chunkText(extracted.text, config.chunkSize, config.chunkOverlap)
      if (pieces.length === 0) throw new Error('no chunks produced')
      const embedConfig = this.embedConfig(config)
      const texts = pieces.map(p => p.text)
      const vectors = await embedBatched(embedConfig, texts)
      const dim = vectors[0]?.length ?? 0
      if (dim === 0) throw new Error('embedding returned zero-length vectors')
      const chunkRecords: Array<Pick<Chunk, 'index' | 'text' | 'heading' | 'dim' | 'vector'>> =
        pieces.map((piece, i) => ({
          index: i, text: piece.text, heading: piece.heading, dim, vector: vectors[i] ?? [],
        }))
      const count = this.store.replaceChunks(fileId, kbId, chunkRecords, now)
      this.store.updateFile(fileId, {
        encoding: extracted.encoding, kind: extracted.kind, charCount: extracted.charCount,
        chunkCount: count, status: 'ready', embeddingModel: config.embeddingModel, embeddingDim: dim,
      } as Partial<KnowledgeFile>)
      return { file: this.store.fileOf(fileId)!, chunkCount: count, embeddingDim: dim }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.updateFile(fileId, { status: 'failed', error: message } as Partial<KnowledgeFile>)
      return { file: this.store.fileOf(fileId)!, chunkCount: 0, embeddingDim: 0 }
    }
  }

  // ── mounts ────────────────────────────────────────────────────────────────

  setMount(kbId: string, workspaceId: string, enabled: boolean, note = ''): WorkspaceMount {
    return this.store.setMount(kbId, workspaceId, enabled, note)
  }

  mounts(): WorkspaceMount[] {
    return this.store.mounts()
  }

  workspaceKbIds(workspaceId: string): string[] {
    return this.store.workspaceKbIds(workspaceId)
  }

  // ── search ─────────────────────────────────────────────────────────────────

  /**
   * Vector-search knowledge bases, optionally reranking the top candidates.
   * @param query - the search text.
   * @param options - scope / k / rerank controls.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const config = this.store.getConfig()
    const kbIds = options.kbIds?.length
      ? options.kbIds
      : options.workspaceId !== undefined
        ? this.store.workspaceKbIds(options.workspaceId)
        : this.store.listBases().map(b => b.id)
    if (kbIds.length === 0 || query.trim() === '') return []

    const topK = options.topK ?? config.defaultTopK
    const candidateK = options.candidateK ?? Math.max(topK * 4, 20)
    const embedConfig = this.embedConfig(config)
    const embedded = await embedBatched(embedConfig, [query], 8000, options.signal)
    const queryVector = embedded[0]
    if (queryVector === undefined || queryVector.length === 0) return []

    const candidates = this.store.searchCandidates(kbIds)
    const ranked = topKByCosine(queryVector, candidates.map(c => ({ vector: c.vector, item: c })), candidateK)

    let hits: SearchHit[] = ranked.map(r => ({ kbId: r.item.kbId, kbName: r.item.kbName, fileId: r.item.fileId, fileName: r.item.fileName, chunkId: r.item.chunkId, text: r.item.text, index: r.item.index, score: r.score }))

    const rerankModel = config.rerankModel
    if (rerankModel !== '' && options.useRerank !== false && hits.length > 0) {
      const rerankConfig: RerankConfig = {
        baseUrl: config.rerankEndpoint !== '' ? config.rerankEndpoint : config.endpointBaseUrl,
        model: rerankModel,
        apiKey: config.apiKey,
      }
      const result = await rerank(rerankConfig, query, hits.map(h => h.text))
      if (result !== null) {
        const order = new Map(result.ordered.map(r => [r.index, r.score]))
        hits = hits.map((h, i) => ({ ...h, rerankScore: order.get(i) ?? 0 }))
        hits.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      }
    }

    return hits.slice(0, topK)
  }

  private embedConfig(config: KnowledgeConfig): EmbedConfig {
    return {
      baseUrl: config.endpointBaseUrl,
      model: config.embeddingModel,
      apiKey: config.apiKey,
    }
  }
}

function ext(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/gu, '_').replace(/\.\./gu, '_')
}
