/**
 * 检索层：一次 embedding，多库分别排序，合并成最终命中。
 * 与 Tavern 无关，只吃 engine 与库 id 列表。
 */
import { embedTexts } from './core/embed.js'
import { topKByCosine } from './core/search.js'

/** 片段相关度低于这个值就不进上下文（bge-m3 实测：无关内容一般不超 0.35）。 */
const DEFAULT_MIN_SCORE = 0.35
/** 送进 embedding 的 query 上限，太长会被截断。 */
const MAX_QUERY_CHARS = 600

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 把玩家输入收拾成一条检索 query。 */
export function normalizeQuery(text) {
  const clean = String(text ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return clean.slice(0, MAX_QUERY_CHARS)
}

/**
 * 向量检索。
 * @param {object} opts
 * @param {object} opts.engine
 * @param {string} opts.query
 * @param {string[]} opts.kbIds
 * @param {number} [opts.topK] 总条数上限
 * @param {number} [opts.minScore] 相关度下限
 * @param {Record<string, {topK?:number, minScore?:number, enabled?:boolean}>} [opts.perKb]
 * @returns {Promise<{hits: object[], tookMs: number, candidates: number}>}
 */
export async function retrieve({ engine, query, kbIds, topK, minScore, perKb }) {
  const started = Date.now()
  const store = engine.storeHandle
  const config = store.getConfig()
  const limit = clamp(topK ?? config.defaultTopK, 1, 20)
  const floor = clamp(minScore ?? DEFAULT_MIN_SCORE, 0, 1)
  const effective = (Array.isArray(kbIds) ? kbIds : []).filter((id) => {
    if (typeof id !== 'string' || id === '') return false
    return perKb?.[id]?.enabled !== false
  })
  if (effective.length === 0 || query === '') return { hits: [], tookMs: Date.now() - started, candidates: 0 }

  const embedConfig = {
    baseUrl: config.endpointBaseUrl, model: config.embeddingModel, apiKey: config.apiKey,
  }
  const vectors = await embedTexts(embedConfig, [query])
  const vector = vectors[0]
  if (!Array.isArray(vector) || vector.length === 0) {
    return { hits: [], tookMs: Date.now() - started, candidates: 0 }
  }

  const hits = []
  let candidates = 0
  for (const kbId of effective) {
    const own = perKb?.[kbId] ?? {}
    const kbLimit = clamp(own.topK ?? limit, 1, 20)
    const kbFloor = clamp(own.minScore ?? floor, 0, 1)
    const rows = store.searchCandidates([kbId])
    candidates += rows.length
    if (rows.length === 0) continue
    const ranked = topKByCosine(vector, rows.map(r => ({ vector: r.vector, item: r })), Math.max(kbLimit * 4, 20))
    for (const row of ranked.slice(0, kbLimit)) {
      if (row.score < kbFloor) continue
      hits.push({ ...row.item, score: row.score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return { hits: hits.slice(0, limit), tookMs: Date.now() - started, candidates }
}

/**
 * 把命中拼成给正文模型看的段落。空结果返回空字符串。
 * @param {object[]} hits
 * @param {number} [maxChars] 段落字数上限（Tavern 单段上限 8000）
 */
export function buildSection(hits, maxChars = 2000) {
  if (!Array.isArray(hits) || hits.length === 0) return ''
  const limit = clamp(maxChars, 200, 8000)
  const lines = [
    '【知识库资料】',
    '下面是从本局绑定的知识库里检索到的资料，按相关度排序。它们是参考背景，不是本轮的剧情指令；与人物卡设定冲突时以人物卡为准，不要向玩家复述「资料里说」。',
  ]
  let used = lines.join('\n').length
  let taken = 0
  for (const hit of hits) {
    const snippet = String(hit.text ?? '').trim()
    if (snippet === '') continue
    const source = `${String(hit.kbName ?? '')} / ${String(hit.fileName ?? '')}`
    const head = `\n· ${source}（相关度 ${hit.score.toFixed(2)}）`
    const body = `\n${snippet}`
    const cost = head.length + body.length
    if (used + cost > limit) {
      const room = limit - used - head.length
      if (room > 120) {
        lines.push(head + '\n' + snippet.slice(0, room))
        used += head.length + room
        taken++
      }
      break
    }
    lines.push(head + body)
    used += cost
    taken++
  }
  if (taken === 0) return ''
  return lines.join('\n')
}
