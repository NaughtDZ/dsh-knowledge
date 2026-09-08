/**
 * The high-level knowledge engine: imports files (extract → chunk → embed),
 * re-quantizes them on demand, stores everything, and serves vector search.
 * DSH-independent — the host plugin wraps this with HTTP routes, a settings
 * namespace, and a tool.
 *
 * Long-running work (imports and re-quantization) runs as a cancellable
 * "operation" so the UI can show progress and stop it without restarting.
 */
import type { KnowledgeBase, KnowledgeConfig, KnowledgeFile, SearchHit, WorkspaceMount } from './types.ts';
export interface EngineOptions {
    readonly dbPath: string;
    /** Where to persist original uploaded files. Empty = do not retain raw files. */
    readonly filesRoot?: string;
}
export interface SearchOptions {
    readonly kbIds?: string[];
    readonly workspaceId?: string;
    readonly topK?: number;
    readonly useRerank?: boolean;
    readonly candidateK?: number;
    readonly signal?: AbortSignal;
}
export interface ImportResult {
    readonly file: KnowledgeFile;
    readonly chunkCount: number;
    readonly embeddingDim: number;
    /** True when the operation was cancelled by the user. */
    readonly stopped?: boolean;
}
export type OperationKind = 'import' | 'reindex-base' | 'reindex-all';
/** A live (or just-finished) operation, safe for the wire. */
export interface OperationView {
    readonly id: string;
    readonly kind: OperationKind;
    readonly label: string;
    /** Batch-level progress: files completed (reindex) or 1 (single import). */
    readonly total: number;
    readonly done: number;
    /** Chunk-level progress of the CURRENT file. */
    readonly chunkTotal: number;
    readonly chunkDone: number;
    /** Current file/stage name. */
    readonly current: string;
    /** Overall progress in [0, 1]. */
    readonly progress: number;
    readonly startedAt: number;
    readonly finished: boolean;
    readonly failed: boolean;
}
export declare class KnowledgeEngine {
    private readonly store;
    private readonly filesRoot;
    private readonly operations;
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
    /** Snapshot of live and just-finished operations. */
    activeOperations(): OperationView[];
    private viewOf;
    /** Abort one operation. @returns true when it was running. */
    stopOperation(id: string): boolean;
    /** Abort every running operation. @returns the number aborted. */
    stopAll(): number;
    /**
     * Import a file: persist the upload, extract → chunk → embed, and store.
     * Auto-embeds on import. @returns the file record (status ready/failed/stopped).
     */
    importFile(kbId: string, filename: string, bytes: Buffer): Promise<ImportResult>;
    /**
     * Re-embed a single existing file with the current embedding config.
     * @returns the import result, or null when the file/bytes are missing.
     */
    reembedFile(fileId: string, signal?: AbortSignal, onProgress?: (current: string, chunkTotal: number, chunkDone: number) => void): Promise<ImportResult | null>;
    /** Re-embed every file in one knowledge base; returns the operation id immediately. */
    reindexBase(kbId: string): string;
    /** Re-embed every file in every knowledge base; returns the operation id. */
    reindexAll(): string;
    setMount(kbId: string, workspaceId: string, enabled: boolean, note?: string): WorkspaceMount;
    mounts(): WorkspaceMount[];
    workspaceKbIds(workspaceId: string): string[];
    search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
    /**
     * Extract → chunk → embed → persist for one file. Throws when aborted or
     * when no vectors are produced; the caller updates the file status.
     * @param onProgress - reports (currentName, chunkTotal, chunkDone) as batches land.
     */
    private indexBytes;
    /** Run a batch of file re-embeds with progress + cancellation. */
    private runBatch;
    private track;
    private removeOp;
    /** Delete a raw uploaded file and prune now-empty parent dirs up to filesRoot. */
    private removeFileFromDisk;
    private embedConfig;
}
