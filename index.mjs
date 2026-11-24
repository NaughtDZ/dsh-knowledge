/**
 * dsh-tavern-knowledge —— DSH Tavern 的知识库插件（宿主侧）。
 *
 * 能力：
 *   1. 把 Office / 文本资料拖进面板 → 自动切块、向量化，按库独立配置；
 *   2. 每轮按玩家输入检索本局绑定的库，把命中片段作为【知识库资料】注入正文请求；
 *   3. 后台结算模型可以用 knowledge_search 主动再查一次；
 *   4. 手动把某一局对话增量向量化，做成"只增不改"的对话记忆库；
 *   5. 整库备份 / 恢复。
 *
 * 只使用 Tavern 公开接口（turnSection / gameSettings / settlementTool /
 * onGameRemoved / readGameData / saveGameData / 读历史）与 DSH 的 webServer 服务。
 * 自己的数据全部落在 dataDir 里，卸载时不改 Tavern 的任何文件。
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KnowledgeEngine } from './lib/core/engine.js'
import { mountRoutes } from './lib/routes.mjs'
import { retrieve, buildSection, normalizeQuery } from './lib/retrieval.mjs'
import { ingestChat } from './lib/chat-memory.mjs'
import { importBackup } from './lib/backup.mjs'

export const name = 'dsh-tavern-knowledge'
/** webServer 提供面板与上传通道；tavern 在 apply 里用 ctx.inject 等它就绪。 */
export const inject = ['webServer']

/** 单轮检索的硬上限：到点就放弃注入，正文照常写。 */
const SECTION_TIMEOUT_MS = 8000
/** 本局绑定的缓存时长。 */
const BINDING_TTL_MS = 5000
/** 内存里最多记多少局的注入结果。 */
const INJECT_LOG_LIMIT = 200

function resolveDataDir() {
  const env = process.env.DSH_TAVERN_KNOWLEDGE_DIR
  if (typeof env === 'string' && env !== '') return env
  try {
    // <data>/plugins/dsh-tavern-knowledge/index.mjs → <data>/dsh-tavern-knowledge
    const here = dirname(fileURLToPath(import.meta.url))
    const pluginsDir = dirname(here)
    if (basename(pluginsDir) === 'plugins') return join(dirname(pluginsDir), 'dsh-tavern-knowledge')
  } catch { /* 落到下面的回退 */ }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-tavern-knowledge')
}

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('检索超时')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function apply(ctx, options = {}) {
  const dataDir = typeof options?.dataDir === 'string' && options.dataDir !== '' ? options.dataDir : resolveDataDir()
  const filesRoot = join(dataDir, 'files')
  mkdirSync(filesRoot, { recursive: true })
  const engine = new KnowledgeEngine({ dbPath: join(dataDir, 'knowledge.sqlite'), filesRoot })

  /** gameId → 最近一次注入结果（给面板看，不落盘）。 */
  const lastInject = new Map()
  /** gameId → { kbIds | null, at } */
  const bindingCache = new Map()

  // ── 本局绑定（存进本局插件数据，随存档走） ──────────────────────────────
  async function readBinding(gameId) {
    const cached = bindingCache.get(gameId)
    if (cached !== undefined && Date.now() - cached.at < BINDING_TTL_MS) return cached.kbIds
    try {
      const data = await ctx.tavern.readGameData({ gameId })
      const kbIds = Array.isArray(data?.kbIds)
        ? data.kbIds.filter(item => typeof item === 'string' && item !== '')
        : null
      bindingCache.set(gameId, { kbIds, at: Date.now() })
      return kbIds
    } catch {
      return null
    }
  }

  async function writeBinding(gameId, kbIds) {
    let previous = {}
    try {
      const data = await ctx.tavern.readGameData({ gameId })
      if (data !== null && typeof data === 'object' && !Array.isArray(data)) previous = data
    } catch { /* 没有旧数据 */ }
    const next = { ...previous }
    if (kbIds === null) delete next.kbIds
    else next.kbIds = kbIds
    await ctx.tavern.saveGameData({ gameId, data: next })
    bindingCache.set(gameId, { kbIds, at: Date.now() })
  }

  /** 本局实际检索哪些库：手绑优先，其次面板里的默认集合。 */
  async function resolveKbIds(gameId) {
    const bound = await readBinding(gameId)
    if (bound !== null) return bound
    const config = engine.getConfig()
    return Array.isArray(config.defaultKbIds)
      ? config.defaultKbIds.filter(item => typeof item === 'string' && item !== '')
      : []
  }

  async function gameSettingsOf(gameId) {
    try {
      return await ctx.tavern.getGameSettings({ gameId })
    } catch {
      return null
    }
  }

  /** 玩家这一轮说了什么；太短就把上一轮正文尾巴接上，免得检索不出东西。 */
  async function buildQuery(gameId, turn, input) {
    let query = normalizeQuery(input)
    if (query.length >= 8) return query
    try {
      const previous = await ctx.tavern.getTurn({ gameId, turn: Math.max(1, Number(turn) - 1) })
      const tail = normalizeQuery(previous?.text ?? '').slice(-240)
      if (tail !== '') query = query === '' ? tail : `${query} ${tail}`
    } catch { /* 没有上一轮就算了 */ }
    return query
  }

  // ── 面板 / 上传 / 备份接口 ────────────────────────────────────────────────
  const installRoutes = () => {
    if (ctx.webServer === undefined) return () => {}
    return mountRoutes(ctx.webServer, {
      engine,
      dataDir,
      filesRoot,
      getBinding: gameId => readBinding(gameId),
      setBinding: (gameId, kbIds) => writeBinding(gameId, kbIds),
      getGameInfo: async (gameId) => {
        try {
          return await ctx.tavern.getTurnState({ gameId })
        } catch {
          return null
        }
      },
      getLastInject: gameId => lastInject.get(gameId) ?? null,
      ingestChat: ({ gameId, kbId, rebuild }) => ingestChat({
        engine,
        gameId,
        kbId,
        rebuild,
        filesRoot,
        api: {
          getTurnState: args => ctx.tavern.getTurnState(args),
          getHistory: args => ctx.tavern.getHistory(args),
          getCard: args => ctx.tavern.getCard(args),
          getPlayerName: args => (typeof ctx.tavern.getPlayerName === 'function'
            ? ctx.tavern.getPlayerName(args)
            : Promise.resolve('')),
        },
      }),
      importBackup: ({ path }) => importBackup({ engine, filesRoot, path }),
    })
  }

  if (typeof ctx.effect === 'function') ctx.effect(installRoutes, 'dsh-tavern-knowledge: routes')
  else installRoutes()

  // ── Tavern 侧的注册 ──────────────────────────────────────────────────────
  ctx.inject(['tavern'], (scoped) => {
    // 本局设置：开关与检索参数
    try {
      scoped.tavern.gameSettings({
        title: '知识库',
        fields: [
          {
            key: 'knowledgeInject', type: 'boolean', label: '每轮自动检索知识库',
            description: '按你的输入检索本局绑定的知识库，把命中的资料放进本轮请求。', default: true,
          },
          {
            key: 'knowledgeTopK', type: 'number', label: '本轮最多几段资料',
            description: '条数越多越占上下文。', min: 1, max: 8, step: 1, default: 4,
          },
          {
            key: 'knowledgeMinScore', type: 'number', label: '相关度下限',
            description: '低于这个相似度的片段不进上下文。', min: 0, max: 1, step: 0.05, default: 0.35,
          },
          {
            key: 'knowledgeMaxChars', type: 'number', label: '资料段字数上限',
            description: '整段【知识库资料】最多多少字。', min: 300, max: 6000, step: 100, default: 1600,
          },
        ],
      })
    } catch (error) {
      console.warn(`dsh-tavern-knowledge: 本局设置注册失败 ${error?.message ?? error}`)
    }

    // 每轮正文请求前：检索 → 注入
    try {
      scoped.tavern.turnSection({
        name: 'knowledge',
        position: 'after',
        text: async ({ gameId, turn, input }) => {
          try {
            const settings = await gameSettingsOf(gameId)
            if (settings?.knowledgeInject === false) return ''
            const config = engine.getConfig()
            const injectDefaults = config.inject ?? {}
            const kbIds = await resolveKbIds(gameId)
            if (kbIds.length === 0) return ''
            const query = await buildQuery(gameId, turn, input)
            if (query === '') return ''
            const started = Date.now()
            const result = await withTimeout(retrieve({
              engine,
              query,
              kbIds,
              topK: clamp(settings?.knowledgeTopK ?? injectDefaults.topK ?? config.defaultTopK, 1, 8),
              minScore: clamp(settings?.knowledgeMinScore ?? injectDefaults.minScore ?? 0.35, 0, 1),
              perKb: config.kbSettings,
            }), SECTION_TIMEOUT_MS)
            const maxChars = clamp(settings?.knowledgeMaxChars ?? injectDefaults.maxChars ?? 1600, 300, 6000)
            const section = buildSection(result.hits, maxChars)
            rememberInject(gameId, {
              turn, query, tookMs: Date.now() - started, kbIds,
              candidates: result.candidates, section,
              hits: result.hits.map(hit => ({
                kbName: hit.kbName, fileName: hit.fileName, score: hit.score,
                text: String(hit.text ?? '').slice(0, 400),
              })),
            })
            return section
          } catch (error) {
            rememberInject(gameId, { turn, query: '', tookMs: 0, kbIds: [], hits: [], section: '', error: String(error?.message ?? error) })
            return ''
          }
        },
      })
    } catch (error) {
      console.warn(`dsh-tavern-knowledge: 检索注入注册失败 ${error?.message ?? error}`)
    }

    // 后台结算模型可以主动再查
    try {
      scoped.tavern.settlementTool({
        name: 'knowledge_search',
        description: '在本局绑定的知识库里做向量检索，返回最相关的资料片段。需要确认设定、名词、旧对话细节时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索问题或关键词' },
            topK: { type: 'number', description: '返回条数，默认 4，最多 8' },
          },
          required: ['query'],
        },
        enabledFor: async ({ gameId }) => {
          const settings = await gameSettingsOf(gameId)
          return settings?.knowledgeInject !== false
        },
        execute: async ({ gameId, arguments: args }) => {
          const query = normalizeQuery(args?.query)
          const kbIds = await resolveKbIds(gameId)
          if (query === '' || kbIds.length === 0) return { ok: false, reason: '没有绑定知识库或查询为空' }
          const config = engine.getConfig()
          const result = await retrieve({
            engine, query, kbIds,
            topK: clamp(args?.topK ?? config.defaultTopK, 1, 8),
            perKb: config.kbSettings,
          })
          return {
            ok: true,
            count: result.hits.length,
            hits: result.hits.map(hit => ({
              source: `${hit.kbName} / ${hit.fileName}`,
              score: Number(hit.score.toFixed(3)),
              text: hit.text,
            })),
          }
        },
      })
    } catch (error) {
      console.warn(`dsh-tavern-knowledge: 结算工具注册失败 ${error?.message ?? error}`)
    }

    try {
      scoped.tavern.onGameRemoved(({ gameId }) => {
        lastInject.delete(gameId)
        bindingCache.delete(gameId)
      })
    } catch { /* 旧宿主没有这个接口 */ }
  })

  function rememberInject(gameId, entry) {
    lastInject.delete(gameId)
    lastInject.set(gameId, { ...entry, at: Date.now() })
    while (lastInject.size > INJECT_LOG_LIMIT) {
      const oldest = lastInject.keys().next().value
      if (oldest === undefined) break
      lastInject.delete(oldest)
    }
  }

  // ── 卸载清理 ──────────────────────────────────────────────────────────────
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      try {
        engine.close()
      } catch { /* 已经关了 */ }
    }, 'dsh-tavern-knowledge: engine')
  }
}
