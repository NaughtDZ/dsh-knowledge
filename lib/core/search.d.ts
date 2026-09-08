/**
 * Vector search: rank candidates by cosine similarity to a query vector.
 */
export interface RankedItem<T> {
    readonly item: T;
    readonly score: number;
}
/**
 * Rank `candidates` by cosine similarity to `query`, returning the top `k`.
 * Candidates whose vector dimension does not match are skipped.
 */
export declare function topKByCosine<T>(query: number[], candidates: Array<{
    vector: number[];
    item: T;
}>, k: number): RankedItem<T>[];
