/**
 * Text chunking for vectorization: splits a large document into overlapping
 * chunks bounded by `maxChars`, breaking preferentially on paragraph and
 * sentence boundaries.
 */
export interface ChunkPiece {
    readonly text: string;
    readonly heading?: string;
}
/**
 * Greedy paragraph-grouping chunker with tail overlap.
 * @param text - the normalized document text.
 * @param maxChars - target max chunk length (characters).
 * @param overlapChars - trailing overlap shared between consecutive chunks.
 * @param minChars - drop residual chunks shorter than this.
 */
export declare function chunkText(text: string, maxChars: number, overlapChars: number, minChars?: number): ChunkPiece[];
/**
 * Split text into chunks with a sensible default (used by the host import
 * pipeline when no custom values are configured).
 */
export declare function defaultChunk(text: string, maxChars?: number, overlapChars?: number): ChunkPiece[];
