import type { KnowledgeEngine } from './core/engine.ts';
export declare function registerKnowledgeTool(ctx: {
    tools: {
        register(tool: unknown): () => void;
    };
}, engine: KnowledgeEngine): () => void;
