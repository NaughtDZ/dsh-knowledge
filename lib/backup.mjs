/**
 * 知识库备份与恢复。
 *
 * 备份是一个自包含的 JSON 文件：库、文件元数据、（可选）原始文件、（可选）分块向量。
 * 换机器、换 embedding 模型、插件重装都不会丢东西；导入时可以只带文本，让新机器
 * 用自己的模型重新量化。
 *
 * 只用 engine 的公开方法，不读 Tavern 的任何文件。
 */
import { mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FORMAT = 'dsh-tavern-knowledge/backup'
const VERSION = 1

function encodeVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return ''
  const f = new Float32Array(vector)
  return Buffer.from(f.buffer).toString('base64')
}

function decodeVector(base64) {
  if (typeof base64 !== 'string' || base64 === '') return []
  const buf = Buffer.from(base64, 'base64')
  // 保证按 4 字节对齐再切 Float32
  const usable = buf.length - (buf.length % 4)
  return Array.from(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable)))
}

/**
 * 导出一个（或全部）知识库到 JSON 文件。
 * @param {object} opts
 * @param {object} opts.engine
 * @param {string} opts.dataDir 插件数据目录（备份写到 <dataDir>/exports）
 * @param {string} [opts.kbId] 只导出这个库；省略时导出全部
 * @param {boolean} [opts.includeVectors] 带上向量（true = 导入后立即可用）
 * @param {boolean} [opts.includeRaw] 带上原始文件（true = 导入后能重新量化）
 */
export function exportBackup({ engine, dataDir, kbId, includeVectors = true, includeRaw = true }) {
  const store = engine.storeHandle
  const config = store.getConfig()
  const bases = kbId !== undefined && kbId !== ''
    ? [store.baseOf(kbId)].filter(b => b !== null)
    : store.listBases()
  if (bases.length === 0) throw new Error('没有可导出的知识库')

  const files = []
  for (const base of bases) {
    const chunksByFile = new Map()
    for (const chunk of store.loadChunks([base.id])) {
      const list = chunksByFile.get(chunk.fileId) ?? []
      list.push(chunk)
      chunksByFile.set(chunk.fileId, list)
    }
    for (const file of store.filesOf(base.id)) {
      const record = {
        id: file.id, kbId: file.kbId, name: file.name, ext: file.ext, kind: file.kind,
        size: file.size, encoding: file.encoding, lineEnding: file.lineEnding,
        charCount: file.charCount, chunkCount: file.chunkCount, status: file.status,
        embeddingModel: file.embeddingModel ?? '', embeddingDim: file.embeddingDim ?? 0,
        createdAt: file.createdAt, updatedAt: file.updatedAt,
        chunks: (chunksByFile.get(file.id) ?? [])
          .sort((a, b) => a.index - b.index)
          .map(c => ({
            index: c.index, text: c.text, heading: c.heading ?? '',
            dim: c.dim, vector: includeVectors ? encodeVector(c.vector) : '',
          })),
      }
      if (includeRaw && file.relPath !== '') {
        const bytes = engine.readFileBytes(file.relPath)
        if (bytes !== null) {
          record.relPath = file.relPath
          record.rawFile = bytes.toString('base64')
        }
      }
      files.push(record)
    }
  }

  const chatSources = store.listChatSources().filter(s => bases.some(b => b.id === s.kbId))
  const payload = {
    format: FORMAT, version: VERSION, exportedAt: Date.now(),
    embeddingModel: config.embeddingModel,
    chunkSize: config.chunkSize, chunkOverlap: config.chunkOverlap,
    bases: bases.map(b => ({ id: b.id, name: b.name, description: b.description, createdAt: b.createdAt })),
    files, chatSources,
  }
  const json = JSON.stringify(payload)
  const dir = join(dataDir, 'exports')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const label = bases.length === 1 ? safe(bases[0].name) : 'all'
  const path = join(dir, `knowledge-${label}-${stamp}.json`)
  writeFileSync(path, json, 'utf8')
  return {
    path, bytes: Buffer.byteLength(json), bases: bases.length, files: files.length,
    chunks: files.reduce((sum, f) => sum + f.chunks.length, 0),
    includeVectors, includeRaw,
  }
}

/**
 * 从备份 JSON 文件恢复。默认建新库（id 全部重编），已经存在的库不会被动。
 * @param {object} opts
 * @param {object} opts.engine
 * @param {string} opts.filesRoot 原始文件落盘目录
 * @param {string} opts.path 备份文件路径
 * @returns {{bases:number, files:number, chunks:number, reembed:string[]}}
 */
export async function importBackup({ engine, filesRoot, path }) {
  const raw = readFileSync(path, 'utf8')
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('不是合法的备份文件（JSON 解析失败）')
  }
  if (payload?.format !== FORMAT) throw new Error('不是本插件的知识库备份')
  if (Number(payload.version) > VERSION) throw new Error('备份版本比当前插件新，请先更新插件')

  const store = engine.storeHandle
  const config = store.getConfig()
  const idMap = new Map()
  const stats = { bases: 0, files: 0, chunks: 0, reembed: [] }

  for (const base of payload.bases ?? []) {
    const created = store.createBase(String(base.name ?? '未命名'), String(base.description ?? ''))
    idMap.set(String(base.id), created.id)
    stats.bases++
  }

  const now = Date.now()
  for (const file of payload.files ?? []) {
    const kbId = idMap.get(String(file.kbId))
    if (kbId === undefined) continue
    const fileId = randomUUID()
    let relPath = ''
    if (typeof file.rawFile === 'string' && file.rawFile !== '') {
      const name = String(file.name ?? 'file.bin')
      relPath = `${kbId}/${fileId}/${name.replace(/[\\/:*?"<>|]/gu, '_')}`
      const target = join(filesRoot, relPath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, Buffer.from(file.rawFile, 'base64'))
    }
    const chunks = Array.isArray(file.chunks) ? file.chunks : []
    const dim = chunks.find(c => Number(c.dim) > 0)?.dim ?? 0
    const canReuseVectors = chunks.every(c => typeof c.vector === 'string' && c.vector !== '')
    const record = store.addFile({
      id: fileId, kbId, name: String(file.name ?? 'file'), ext: String(file.ext ?? ''),
      kind: String(file.kind ?? 'text'), relPath,
      size: Number(file.size ?? 0), encoding: String(file.encoding ?? 'utf-8'),
      lineEnding: 'lf', charCount: Number(file.charCount ?? 0),
      chunkCount: 0, status: canReuseVectors ? 'ready' : 'pending',
      createdAt: Number(file.createdAt ?? now), updatedAt: now,
    })
    if (chunks.length > 0) {
      const records = chunks.map(c => ({
        index: Number(c.index ?? 0), text: String(c.text ?? ''),
        heading: typeof c.heading === 'string' && c.heading !== '' ? c.heading : undefined,
        dim: Number(c.dim ?? 0), vector: decodeVector(c.vector),
      }))
      store.appendChunks(fileId, kbId, records, now)
      store.updateFile(fileId, {
        chunkCount: records.length, status: canReuseVectors ? 'ready' : 'pending',
        embeddingModel: canReuseVectors ? String(file.embeddingModel ?? config.embeddingModel) : undefined,
        embeddingDim: canReuseVectors ? Number(dim) : undefined,
      })
      stats.chunks += records.length
    }
    stats.files++
    if (!canReuseVectors && relPath !== '') stats.reembed.push(record.id)
  }

  // 没有向量但有原文的文件：用当前模型补一次嵌入。
  for (const fileId of stats.reembed) {
    try {
      await engine.reembedFile(fileId)
    } catch { /* 单个文件失败不影响其余导入 */ }
  }
  return stats
}

/** 列出已有的备份文件。 */
export function listBackups({ dataDir }) {
  const dir = join(dataDir, 'exports')
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map((name) => {
        const full = join(dir, name)
        let bytes = 0
        let createdAt = 0
        try {
          const st = statSync(full)
          bytes = st.size
          createdAt = st.mtimeMs
        } catch { /* ignore */ }
        return { name, path: full, bytes, createdAt }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function safe(name) {
  return String(name).replace(/[\\/:*?"<>|\s]/gu, '_').slice(0, 40)
}
