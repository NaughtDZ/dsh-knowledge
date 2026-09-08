/**
 * The high-level knowledge engine: imports files (extract → chunk → embed),
 * stores everything, and serves vector search. DSH-independent — the host
 * plugin wraps this with HTTP routes, a settings namespace, and a tool.
 */
import type { KnowledgeBase, KnowledgeConfig, KnowledgeFile, SearchHit, WorkspaceMount } from './types.ts';
export interface EngineOptions {
    readonly dbPath: string;
    /** Where to persist original uploaded files. Empty = do not retain raw files. */
    readonly filesRoot?: string;
}
export interface SearchOptions {
    /** Restrict to these knowledge base ids; empty = all bases. */
    readonly kbIds?: string[];
    /** The workspace to scope to (searches its enabled bases). */
    readonly workspaceId?: string;
    readonly topK?: number;
    /** Run the reranker over the cosine candidates (default true when configured). */
    readonly useRerank?: boolean;
    /** A broader candidate pool before rerank (default topK * 4). */
    readonly candidateK?: number;
    /** Cancellation signal. */
    readonly signal?: AbortSignal;
}
export interface ImportResult {
    readonly file: KnowledgeFile;
    readonly chunkCount: number;
    readonly embeddingDim: number;
}
export declare class KnowledgeEngine {
    private readonly store;
    private readonly filesRoot;
    constructor(options: EngineOptions | string);
    close(): void;
    getConfig(): KnowledgeConfig;
    saveConfig(patch: Partial<KnowledgeConfig>): KnowledgeConfig;
    listBases(): KnowledgeBase[];
    createBase(name: string, description?: string): KnowledgeBase;
    deleteBase(id: string): void;
    filesOf(kbId: string): KnowledgeFile[];
    fileOf(id: string): KnowledgeFile | null;
    /** Read the originally-uploaded bytes for a file (relative to filesRoot). */
    readFileBytes(relPath: string): Buffer | null;
    deleteFile(id: string): void;
    /**
     * Import a file: extract text, chunk it, embed every chunk, and persist.
     * @returns the file record plus stats. On embedding failure the file is
     * marked 'failed' and no chunks are persisted.
     */
    importFile(kbId: string, filename: string, bytes: Buffer): Promise<ImportResult>;
    setMount(kbId: string, workspaceId: string, enabled: boolean, note?: string): WorkspaceMount;
    mounts(): WorkspaceMount[];
    workspaceKbIds(workspaceId: string): string[];
    /**
     * Vector-search knowledge bases, optionally reranking the top candidates.
     * @param query - the search text.
     * @param options - scope / k / rerank controls.
     */
    search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
    private embedConfig;
}
