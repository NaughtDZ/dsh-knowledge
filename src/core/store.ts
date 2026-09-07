/**
 * Persistent store for dsh-knowledge over Node's built-in `node:sqlite`.
 * Stores knowledge bases, imported files, text chunks + embedding vectors,
 * and workspace mounts. DSH-independent.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Chunk, KnowledgeBase, KnowledgeFile, KnowledgeConfig, SearchHit, WorkspaceMount,
} from './types.ts'

interface ChunkRow {
  id: string
  file_id: string
  kb_id: string
  idx: number
  text: string
  dim: number
  vector: Uint8Array | null
  size: number
  heading: string | null
  created_at: number
}

interface FileRow {
  id: string
  kb_id: string
  name: string
  ext: string
  kind: string
  rel_path: string
  size: number
  encoding: string
  line_ending: string
  char_count: number
  chunk_count: number
  status: string
  error: string | null
  embedding_model: string | null
  embedding_dim: number | null
  created_at: number
  updated_at: number
}

const DEFAULT_CONFIG: KnowledgeConfig = {
  endpointBaseUrl: 'http://127.0.0.1:1234/v1',
  embeddingModel: 'text-embedding-bge-m3',
  apiKey: '',
  rerankModel: '',
  rerankEndpoint: '',
  chunkSize: 1200,
  chunkOverlap: 150,
  defaultTopK: 5,
  stripMarkup: true,
}

export class KnowledgeStore {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        kind TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        encoding TEXT NOT NULL,
        line_ending TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        embedding_model TEXT,
        embedding_dim INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_kb ON files(kb_id);
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        kb_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB,
        size INTEGER NOT NULL,
        heading TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
      CREATE TABLE IF NOT EXISTS mounts (
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (kb_id, workspace_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
    `)
  }

  close(): void {
    this.db.close()
  }

  // ── config ────────────────────────────────────────────────────────────────

  getConfig(): KnowledgeConfig {
    const row = this.db.prepare('SELECT json FROM settings WHERE id = 1').get() as { json: string } | undefined
    if (row === undefined) return { ...DEFAULT_CONFIG }
    try {
      return { ...DEFAULT_CONFIG, ...(JSON.parse(row.json) as Partial<KnowledgeConfig>) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  saveConfig(config: Partial<KnowledgeConfig>): KnowledgeConfig {
    const next = { ...this.getConfig(), ...config }
    this.db.prepare(
      'INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
    ).run(JSON.stringify(next))
    return next
  }

  // ── knowledge bases ────────────────────────────────────────────────────────

  createBase(name: string, description = ''): KnowledgeBase {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(
      'INSERT INTO knowledge_bases (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, description, now, now)
    return this.baseOf(id)!
  }

  listBases(): KnowledgeBase[] {
    const rows = this.db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM files f WHERE f.kb_id = b.id) AS file_count,
        (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = b.id) AS chunk_count
      FROM knowledge_bases b ORDER BY b.created_at DESC
    `).all() as unknown as Array<Record<string, unknown>>
    return rows.map(r => ({
      id: String(r.id), name: String(r.name), description: String(r.description ?? ''),
      fileCount: Number(r.file_count ?? 0), chunkCount: Number(r.chunk_count ?? 0),
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    }))
  }

  baseOf(id: string): KnowledgeBase | null {
    const r = this.db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (r === undefined) return null
    const fileCount = Number((this.db.prepare('SELECT COUNT(*) AS n FROM files WHERE kb_id = ?').get(id) as { n: number }).n)
    const chunkCount = Number((this.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE kb_id = ?').get(id) as { n: number }).n)
    return {
      id: String(r.id), name: String(r.name), description: String(r.description ?? ''),
      fileCount, chunkCount, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    }
  }

  deleteBase(id: string): void {
    this.db.prepare('DELETE FROM files WHERE kb_id = ?').run(id)
    this.db.prepare('DELETE FROM chunks WHERE kb_id = ?').run(id)
    this.db.prepare('DELETE FROM mounts WHERE kb_id = ?').run(id)
    this.db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id)
  }

  // ── files ──────────────────────────────────────────────────────────────────

  addFile(f: Omit<KnowledgeFile, 'updatedAt'>): KnowledgeFile {
    const now = Date.now()
    const row: KnowledgeFile = { ...f, updatedAt: now }
    this.db.prepare(`
      INSERT INTO files (id, kb_id, name, ext, kind, rel_path, size, encoding, line_ending,
        char_count, chunk_count, status, error, embedding_model, embedding_dim, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.kbId, row.name, row.ext, row.kind, row.relPath, row.size, row.encoding,
      row.lineEnding, row.charCount, row.chunkCount, row.status, row.error ?? null,
      row.embeddingModel ?? null, row.embeddingDim ?? null, row.createdAt, row.updatedAt)
    return row
  }

  updateFile(id: string, patch: Partial<KnowledgeFile>): KnowledgeFile | null {
    const current = this.fileOf(id)
    if (current === null) return null
    const next: KnowledgeFile = { ...current, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE files SET ext=?, kind=?, rel_path=?, size=?, encoding=?, line_ending=?, char_count=?,
        chunk_count=?, status=?, error=?, embedding_model=?, embedding_dim=?, updated_at=?
      WHERE id = ?
    `).run(next.ext, next.kind, next.relPath, next.size, next.encoding, next.lineEnding,
      next.charCount, next.chunkCount, next.status, next.error ?? null, next.embeddingModel ?? null,
      next.embeddingDim ?? null, next.updatedAt, id)
    return next
  }

  fileOf(id: string): KnowledgeFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined
    if (row === undefined) return null
    return this.fileOfRow(row)
  }

  private fileOfRow(row: FileRow): KnowledgeFile {
    return {
      id: row.id, kbId: row.kb_id, name: row.name, ext: row.ext, kind: row.kind as KnowledgeFile['kind'],
      relPath: row.rel_path, size: row.size, encoding: row.encoding, lineEnding: row.line_ending as 'lf',
      charCount: row.char_count, chunkCount: row.chunk_count, status: row.status as KnowledgeFile['status'],
      error: row.error ?? undefined, embeddingModel: row.embedding_model ?? undefined,
      embeddingDim: row.embedding_dim ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  filesOf(kbId: string): KnowledgeFile[] {
    const rows = this.db.prepare('SELECT * FROM files WHERE kb_id = ? ORDER BY created_at DESC').all(kbId) as unknown as FileRow[]
    return rows.map(r => this.fileOfRow(r))
  }

  deleteFile(id: string): void {
    this.db.prepare('DELETE FROM chunks WHERE file_id = ?').run(id)
    this.db.prepare('DELETE FROM files WHERE id = ?').run(id)
  }

  // ── chunks ─────────────────────────────────────────────────────────────────

  replaceChunks(fileId: string, kbId: string, chunks: Array<Pick<Chunk, 'index' | 'text' | 'heading' | 'dim' | 'vector'>>, now = Date.now()): number {
    this.db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId)
    const insert = this.db.prepare(`
      INSERT INTO chunks (id, file_id, kb_id, idx, text, dim, vector, size, heading, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const vectorBlob = (vector: number[]): Uint8Array => {
      const f = new Float32Array(vector)
      return new Uint8Array(f.buffer)
    }
    for (const chunk of chunks) {
      const id = randomUUID()
      const size = chunk.text.length
      insert.run(id, fileId, kbId, chunk.index, chunk.text, chunk.dim, vectorBlob(chunk.vector), size, chunk.heading ?? null, now)
    }
    return chunks.length
  }

  /** Load every chunk (with vector) belonging to a set of knowledge bases. */
  loadChunks(kbIds: string[]): Chunk[] {
    if (kbIds.length === 0) return []
    const placeholders = kbIds.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT * FROM chunks WHERE kb_id IN (${placeholders})`,
    ).all(...kbIds) as unknown as ChunkRow[]
    const files = this.fileNames()
    return rows.map(r => ({
      id: r.id, fileId: r.file_id, kbId: r.kb_id, index: r.idx, text: r.text,
      dim: r.dim, vector: r.vector === null ? [] : Array.from(new Float32Array(r.vector.buffer.slice(0))),
      size: r.size, heading: r.heading ?? undefined, createdAt: r.created_at,
    }))
  }

  /** All chunk ids (no vectors) belonging to a set of KBs — for count/cleanup. */
  chunkIds(kbIds: string[]): string[] {
    if (kbIds.length === 0) return []
    const placeholders = kbIds.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT id FROM chunks WHERE kb_id IN (${placeholders})`).all(...kbIds) as unknown as Array<{ id: string }>
    return rows.map(r => r.id)
  }

  private fileNames(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, name FROM files').all() as unknown as Array<{ id: string; name: string }>
    return new Map(rows.map(r => [r.id, r.name]))
  }

  // ── mounts ─────────────────────────────────────────────────────────────────

  setMount(kbId: string, workspaceId: string, enabled: boolean, note = ''): WorkspaceMount {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO mounts (kb_id, workspace_id, enabled, note, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kb_id, workspace_id) DO UPDATE SET enabled = excluded.enabled, note = excluded.note
    `).run(kbId, workspaceId, enabled ? 1 : 0, note, now)
    return { kbId, workspaceId, enabled, note, createdAt: now }
  }

  mounts(): WorkspaceMount[] {
    const rows = this.db.prepare('SELECT * FROM mounts').all() as unknown as Array<Record<string, unknown>>
    return rows.map(r => ({
      kbId: String(r.kb_id), workspaceId: String(r.workspace_id),
      enabled: Number(r.enabled) === 1, note: String(r.note ?? ''), createdAt: Number(r.created_at),
    }))
  }

  workspaceKbIds(workspaceId: string): string[] {
    const rows = this.db.prepare('SELECT kb_id FROM mounts WHERE workspace_id = ? AND enabled = 1').all(workspaceId) as unknown as Array<{ kb_id: string }>
    return rows.map(r => r.kb_id)
  }

  // ── search helpers ─────────────────────────────────────────────────────────

  /** Return candidate search hits (text + vector) for the given KBs. */
  searchCandidates(kbIds: string[], limit = 10000): Array<SearchHit & { vector: number[] }> {
    if (kbIds.length === 0) return []
    const placeholders = kbIds.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT c.id AS chunk_id, c.kb_id, c.file_id, c.idx, c.text, c.vector,
        b.name AS kb_name, f.name AS file_name
      FROM chunks c
      JOIN knowledge_bases b ON b.id = c.kb_id
      JOIN files f ON f.id = c.file_id
      WHERE c.kb_id IN (${placeholders}) AND c.vector IS NOT NULL
      ORDER BY c.idx
      LIMIT ${Math.max(1, limit)}
    `).all(...kbIds) as unknown as Array<Record<string, unknown>>
    return rows.map(r => ({
      kbId: String(r.kb_id), kbName: String(r.kb_name), fileId: String(r.file_id),
      fileName: String(r.file_name), chunkId: String(r.chunk_id), text: String(r.text),
      index: Number(r.idx), score: 0,
      vector: rowVector(r.vector),
    }))
  }
}

function rowVector(v: unknown): number[] {
  if (v instanceof Uint8Array) return Array.from(new Float32Array(v.buffer.slice(0)))
  if (Array.isArray(v)) return v as number[]
  return []
}
