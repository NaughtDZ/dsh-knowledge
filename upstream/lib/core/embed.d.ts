/**
 * OpenAI-compatible embedding client: POSTs batches of text to
 * `${baseUrl}/embeddings`. Accepts any endpoint that speaks the OpenAI
 * embeddings protocol (LM Studio, Ollama, local servers, hosted APIs).
 */
export interface EmbedConfig {
    /** Base URL, e.g. http://127.0.0.1:1234/v1 (embeddings appended). */
    readonly baseUrl: string;
    readonly model: string;
    /** Optional API key. */
    readonly apiKey?: string;
    readonly timeoutMs?: number;
}
export declare function embedTexts(config: EmbedConfig, inputs: string[], signal?: AbortSignal): Promise<number[][]>;
/** Embed a single text (shortcut). */
export declare function embedText(config: EmbedConfig, text: string, signal?: AbortSignal): Promise<number[]>;
/** Batch a large list by maxTokens-per-request (chars). */
export declare function embedBatched(config: EmbedConfig, texts: string[], maxCharsPerBatch?: number, signal?: AbortSignal): Promise<number[][]>;
/** Compute cosine similarity between two equal-length vectors. */
export declare function cosine(a: number[], b: number[]): number;
