/**
 * Optional reranker client for OpenAI/Jina-compatible `/rerank` endpoints.
 * Returns a relevance score per input document. When the endpoint is absent
 * or errors, the caller falls back to embedding cosine search.
 */
export interface RerankConfig {
    /** Base URL for rerank (defaults to the embedding base URL). */
    readonly baseUrl: string;
    readonly model: string;
    readonly apiKey?: string;
    readonly timeoutMs?: number;
}
export interface RerankResult {
    /** Sorted array of { index, score }. */
    readonly ordered: Array<{
        index: number;
        score: number;
    }>;
}
/**
 * Score `documents` against `query`. Returns null when the endpoint is
 * unavailable or does not support reranking (caller degrades to cosine).
 */
export declare function rerank(config: RerankConfig, query: string, documents: string[]): Promise<RerankResult | null>;
