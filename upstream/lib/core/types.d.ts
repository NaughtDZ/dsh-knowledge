/**
 * Core shared types for dsh-knowledge (DSH-independent, no DSH imports).
 */
/** A single indexed text chunk belonging to an imported file. */
export interface Chunk {
    /** Stable chunk id (uuid). */
    id: string;
    /** Id of the owning file. */
    fileId: string;
    /** Id of the owning knowledge base. */
    kbId: string;
    /** Chunk ordinal within the file. */
    index: number;
    /** The chunk text. */
    text: string;
    /** Embedding dimension of the stored vector (0 = not embedded yet). */
    dim: number;
    /** Embedding vector, as a flat number array. */
    vector: number[];
    /** Character/word count of the chunk. */
    size: number;
    /** Optional section/paragraph heading hint for provenance. */
    heading?: string;
    /** Created timestamp (ms). */
    createdAt: number;
}
/** A knowledge base: a named collection of imported files. */
export interface KnowledgeBase {
    id: string;
    name: string;
    description: string;
    /** Number of files in this base. */
    fileCount: number;
    /** Number of embedded chunks. */
    chunkCount: number;
    createdAt: number;
    updatedAt: number;
}
/** An imported file within a knowledge base. */
export interface KnowledgeFile {
    id: string;
    kbId: string;
    name: string;
    /** File extension, lowercased, without the dot. */
    ext: string;
    /** Detected MIME/subtype label. */
    kind: 'office' | 'text' | 'unknown';
    /** Stored relative path under the plugin data dir. */
    relPath: string;
    /** Absolute size in bytes. */
    size: number;
    /** Detected text encoding label (utf-8, gb18030, …). */
    encoding: string;
    /** Line-ending normalization target ('lf' after normalize). */
    lineEnding: 'lf';
    /** Total extracted character count. */
    charCount: number;
    /** Number of chunks produced. */
    chunkCount: number;
    /** Indexing status. */
    status: 'pending' | 'indexing' | 'ready' | 'failed';
    /** Failure message when status === 'failed'. */
    error?: string;
    /** Embedding model the chunks were written with. */
    embeddingModel?: string;
    /** Embedding dimension. */
    embeddingDim?: number;
    createdAt: number;
    updatedAt: number;
}
/** A workspace mount: which knowledge base is enabled in which workspace. */
export interface WorkspaceMount {
    /** Knowledge base id. */
    kbId: string;
    /** Workspace id this base is mounted to. */
    workspaceId: string;
    /** Whether recall/search is enabled for this mount. */
    enabled: boolean;
    /** Per-mount note/override. */
    note: string;
    createdAt: number;
}
/** RAG configuration (persisted in the settings namespace + db). */
export interface KnowledgeConfig {
    /** OpenAI-compatible base URL for embeddings (e.g. http://127.0.0.1:1234/v1). */
    endpointBaseUrl: string;
    /** Embedding model id (e.g. text-embedding-bge-m3). */
    embeddingModel: string;
    /** Optional API key for the endpoint. */
    apiKey: string;
    /** Optional rerank model id; empty disables rerank. */
    rerankModel: string;
    /** Optional rerank endpoint; defaults to endpointBaseUrl. */
    rerankEndpoint: string;
    /** Chunk size (characters). */
    chunkSize: number;
    /** Chunk overlap (characters). */
    chunkOverlap: number;
    /** Default topK for the search tool. */
    defaultTopK: number;
    /** Whether to strip markdown/html tags during extraction. */
    stripMarkup: boolean;
}
/** One search hit returned to a caller. */
export interface SearchHit {
    /** Knowledge base id. */
    kbId: string;
    /** Knowledge base name. */
    kbName: string;
    /** File id. */
    fileId: string;
    /** File name. */
    fileName: string;
    /** Chunk id. */
    chunkId: string;
    /** Chunk text. */
    text: string;
    /** Chunk ordinal in the file. */
    index: number;
    /** Cosine similarity score (for embedding search). */
    score: number;
    /** Reranker score, when rerank ran. */
    rerankScore?: number;
}
