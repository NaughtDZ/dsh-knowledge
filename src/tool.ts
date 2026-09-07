/**
 * Model-facing `knowledge_search` tool for dsh-knowledge. Searches the
 * knowledge bases enabled for the given workspace (or a specific base, or all
 * bases) and returns the top-matching chunks.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { KnowledgeEngine } from './core/engine.ts'

const TOOL_DESCRIPTION =
  'Search the knowledge bases enabled for a workspace (or a specific knowledge base, or all bases) and return the '
  + 'top-matching text chunks. Use when the user asks a question about imported documents, or when you need facts '
  + 'from uploaded office/text files. Each result reports its knowledge base, file name, chunk text, and similarity '
  + 'score. Scope with `workspace` (recommended) or `kbId`; omit both to search every knowledge base.'

export function registerKnowledgeTool(ctx: { tools: { register(tool: unknown): () => void } }, engine: KnowledgeEngine): () => void {
  return ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: TOOL_DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The question / search text to match against the knowledge base.',
      },
      workspace: {
        type: 'string',
        description: 'Workspace id to scope to; searches the knowledge bases enabled for that workspace.',
      },
      kbId: {
        type: 'string',
        description: 'A specific knowledge base id to search (overrides `workspace`).',
      },
      topK: {
        type: 'integer',
        description: 'Number of top results to return (default uses the plugin configuration).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: { query: string; workspace?: string; kbId?: string; topK?: number }, exec) {
      const hits = await engine.search(args.query, {
        ...args.workspace !== undefined && args.workspace !== '' ? { workspaceId: args.workspace } : {},
        ...args.kbId !== undefined && args.kbId !== '' ? { kbIds: [args.kbId] } : {},
        ...args.topK !== undefined && args.topK > 0 ? { topK: Math.min(Math.floor(args.topK), 20) } : {},
        useRerank: true,
        signal: exec.signal,
      })
      return {
        query: args.query,
        count: hits.length,
        hits: hits.map(h => ({
          kbId: h.kbId,
          kbName: h.kbName,
          fileId: h.fileId,
          fileName: h.fileName,
          chunkId: h.chunkId,
          text: h.text,
          index: h.index,
          score: h.score,
          ...(h.rerankScore !== undefined ? { rerankScore: h.rerankScore } : {}),
        })),
      }
    },
  }))
}
