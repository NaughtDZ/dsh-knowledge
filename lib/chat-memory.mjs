/**
 * 对话增量向量入库（chat memory）。
 *
 * 把某一局已经写完的对话按轮切成块、嵌入、写进指定知识库；账本表 `chat_sources`
 * 记住这局入库到第几轮，下次点按钮只补新的那几轮。一个对局只对应一份记忆文件。
 *
 * 只依赖 Tavern 的公开读接口（getTurnState / getHistory / getCard / getPlayerName）
 * 与自己的 SQLite，不碰 Tavern 的数据目录。
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chunkText } from './core/chunk.js'
import { embedTexts } from './core/embed.js'

/** 记忆文件在 files/<kbId>/<fileId>/ 下的固定名。 */
const MEMORY_FILE = '对话向量记忆.md'
/** 单次最多补多少轮，避免一次点击跑太久。 */
const MAX_TURNS_PER_RUN = 200
/** 每次向 /v1/embeddings 提交多少块。 */
const EMBED_BATCH = 8

function turnToText(entry, playerName, charName) {
  const input = String(entry?.input ?? '').trim()
  const text = String(entry?.text ?? '').trim()
  if (input === '' && text === '') return ''
  const lines = [`第${entry.turn}轮`]
  if (input !== '') lines.push(`【${playerName}】${input}`)
  if (text !== '') lines.push(`【${charName}】${text}`)
  return lines.join('\n')
}

/**
 * 把一局对话增量写进知识库。
 * @param {object} opts
 * @param {object} opts.engine KnowledgeEngine 实例
 * @param {object} opts.api 薄封装后的 Tavern 读接口
 * @param {string} opts.gameId 对局 id
 * @param {string} opts.kbId 目标知识库
 * @param {string} opts.filesRoot 原始文件根目录（写入可重新量化的原文）
 * @param {boolean} [opts.rebuild] 丢弃旧记忆，从第 1 轮重建
 * @returns {Promise<{ok:true, added:number, from:number, to:number, chunkCount:number, totalTurns:number, upToDate:boolean}>}
 */
export async function ingestChat({ engine, api, gameId, kbId, filesRoot, rebuild = false }) {
  if (typeof gameId !== 'string' || gameId === '') throw new Error('缺少对局 id')
  const store = engine.storeHandle
  const base = store.baseOf(kbId)
  if (base === null) throw new Error('知识库不存在')

  const state = await api.getTurnState({ gameId })
  const latestTurn = Number(state?.turn ?? 0)
  if (latestTurn < 1) return { ok: true, added: 0, from: 0, to: 0, chunkCount: 0, totalTurns: 0, upToDate: true }

  let source = store.chatSourceOf(gameId)
  if (source !== null && source.kbId !== kbId) {
    // 换了目标库：旧的那份记忆留着不动，在这个库里另起一份。
    source = null
  }
  if (rebuild && source !== null) {
    store.deleteFile(source.fileId)
    store.deleteChatSource(gameId)
    source = null
  }

  const from = source === null ? 1 : Math.max(1, source.lastTurn + 1)
  if (from > latestTurn) {
    return { ok: true, added: 0, from, to: latestTurn, chunkCount: source?.lastTurn ?? 0, totalTurns: latestTurn, upToDate: true }
  }

  const cardName = await readCardName(api, gameId)
  const playerName = await readPlayerName(api, gameId)

  // ── 拉取待入库的轮次（getHistory 一次最多 50 轮） ──────────────────────────
  const target = Math.min(latestTurn, from + MAX_TURNS_PER_RUN - 1)
  const entries = []
  for (let start = from; start <= target; start += 50) {
    const to = Math.min(target, start + 49)
    const batch = await api.getHistory({ gameId, from: start, to })
    for (const entry of batch ?? []) {
      if (entry.turn >= start && entry.turn <= to) entries.push(entry)
    }
  }
  entries.sort((a, b) => a.turn - b.turn)
  if (entries.length === 0) {
    return { ok: true, added: 0, from, to: target, chunkCount: 0, totalTurns: latestTurn, upToDate: true }
  }

  // ── 切块 ────────────────────────────────────────────────────────────────
  const config = store.getConfig()
  const pieces = []
  for (const entry of entries) {
    const raw = turnToText(entry, playerName, cardName)
    if (raw === '') continue
    for (const piece of chunkText(raw, config.chunkSize, config.chunkOverlap)) {
      pieces.push({ text: piece.text, heading: `第${entry.turn}轮` })
    }
  }

  // ── 嵌入 ────────────────────────────────────────────────────────────────
  const embedConfig = {
    baseUrl: config.endpointBaseUrl, model: config.embeddingModel, apiKey: config.apiKey,
  }
  const vectors = []
  for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
    const slice = pieces.slice(i, i + EMBED_BATCH).map(p => p.text)
    const res = await embedTexts(embedConfig, slice)
    for (const vector of res) vectors.push(vector)
    if (vectors.length !== i + res.length) throw new Error('嵌入返回的数量与提交的不一致')
  }
  const dim = vectors[0]?.length ?? 0
  if (pieces.length > 0 && dim === 0) throw new Error('嵌入返回了空向量')

  // ── 落库 ────────────────────────────────────────────────────────────────
  const now = Date.now()
  const plain = entries.map(e => turnToText(e, playerName, cardName)).filter(t => t !== '').join('\n\n')
  let file = source === null ? null : store.fileOf(source.fileId)
  if (file === null) {
    const fileId = randomUUID()
    const relPath = `${kbId}/${fileId}/${MEMORY_FILE}`
    if (typeof filesRoot === 'string' && filesRoot !== '') {
      const target_path = join(filesRoot, relPath)
      mkdirSync(dirname(target_path), { recursive: true })
      writeFileSync(target_path, plain, 'utf8')
    }
    file = store.addFile({
      id: fileId, kbId, name: `${cardName === '' ? '本局对话' : cardName} · ${MEMORY_FILE}`,
      ext: 'md', kind: 'text', relPath, size: plain.length, encoding: 'utf-8', lineEnding: 'lf',
      charCount: plain.length, chunkCount: 0, status: 'ready', createdAt: now,
    })
  } else if (typeof filesRoot === 'string' && filesRoot !== '' && file.relPath !== '') {
    const target_path = join(filesRoot, file.relPath)
    try {
      if (!existsSync(target_path)) mkdirSync(dirname(target_path), { recursive: true })
      appendFileSync(target_path, `\n\n${plain}`, 'utf8')
    } catch { /* 原文落下失败不影响向量 */ }
  }

  const startIndex = store.maxChunkIndex(file.id) + 1
  const records = pieces.map((piece, i) => ({
    index: startIndex + i, text: piece.text, heading: piece.heading, dim, vector: vectors[i] ?? [],
  }))
  const appended = store.appendChunks(file.id, kbId, records, now)
  if (appended !== pieces.length) throw new Error(`只写入了 ${appended}/${pieces.length} 块`)
  const nextCount = Number(file.chunkCount ?? 0) + appended
  store.updateFile(file.id, {
    chunkCount: nextCount, charCount: Number(file.charCount ?? 0) + plain.length,
    size: Number(file.size ?? 0) + plain.length, status: 'ready',
    embeddingModel: config.embeddingModel, embeddingDim: dim,
  })
  store.saveChatSource({ gameId, kbId, fileId: file.id, cardName, lastTurn: target })

  return {
    ok: true, added: target - from + 1, from, to: target,
    chunkCount: nextCount, totalTurns: latestTurn,
    upToDate: target >= latestTurn,
  }
}

/** 这条对局已经入库到哪一轮（没有记录时返回 null）。 */
export function chatSourceOf(engine, gameId) {
  return engine.storeHandle.chatSourceOf(gameId)
}

export function listChatSources(engine) {
  return engine.storeHandle.listChatSources()
}

export function forgetChatSource(engine, gameId) {
  const store = engine.storeHandle
  const source = store.chatSourceOf(gameId)
  if (source !== null) store.deleteFile(source.fileId)
  store.deleteChatSource(gameId)
  return true
}

async function readCardName(api, gameId) {
  try {
    const card = await api.getCard({ gameId })
    const name = typeof card?.name === 'string' ? card.name.trim() : ''
    return name
  } catch {
    return ''
  }
}

async function readPlayerName(api, gameId) {
  try {
    if (typeof api.getPlayerName === 'function') {
      const name = await api.getPlayerName({ gameId })
      if (typeof name === 'string' && name.trim() !== '') return name.trim()
    }
  } catch { /* 回退到「玩家」 */ }
  return '玩家'
}
