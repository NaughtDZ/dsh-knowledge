/**
 * Persistent store for dsh-knowledge over Node's built-in `node:sqlite`.
 * Stores knowledge bases, imported files, text chunks + embedding vectors,
 * and workspace mounts. DSH-independent.
 */
import type { Chunk, KnowledgeBase, KnowledgeFile, KnowledgeConfig, SearchHit, WorkspaceMount } from './types.ts';
export declare class KnowledgeStore {
    private readonly db;
    constructor(dbPath: string);
    private migrate;
    close(): void;
    getConfig(): KnowledgeConfig;
    saveConfig(config: Partial<KnowledgeConfig>): KnowledgeConfig;
    createBase(name: string, description?: string): KnowledgeBase;
    listBases(): KnowledgeBase[];
    baseOf(id: string): KnowledgeBase | null;
    deleteBase(id: string): void;
    addFile(f: Omit<KnowledgeFile, 'updatedAt'>): KnowledgeFile;
    updateFile(id: string, patch: Partial<KnowledgeFile>): KnowledgeFile | null;
    fileOf(id: string): KnowledgeFile | null;
    private fileOfRow;
    filesOf(kbId: string): KnowledgeFile[];
    deleteFile(id: string): void;
    replaceChunks(fileId: string, kbId: string, chunks: Array<Pick<Chunk, 'index' | 'text' | 'heading' | 'dim' | 'vector'>>, now?: number): number;
    /** Load every chunk (with vector) belonging to a set of knowledge bases. */
    loadChunks(kbIds: string[]): Chunk[];
    /** All chunk ids (no vectors) belonging to a set of KBs — for count/cleanup. */
    chunkIds(kbIds: string[]): string[];
    private fileNames;
    setMount(kbId: string, workspaceId: string, enabled: boolean, note?: string): WorkspaceMount;
    deleteMount(kbId: string, workspaceId: string): void;
    mounts(): WorkspaceMount[];
    workspaceKbIds(workspaceId: string): string[];
    /** Return candidate search hits (text + vector) for the given KBs. */
    searchCandidates(kbIds: string[], limit?: number): Array<SearchHit & {
        vector: number[];
    }>;
}
