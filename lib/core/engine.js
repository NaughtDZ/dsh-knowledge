/**
 * The high-level knowledge engine: imports files (extract → chunk → embed),
 * stores everything, and serves vector search. DSH-independent — the host
 * plugin wraps this with HTTP routes, a settings namespace, and a tool.
 */
import { KnowledgeStore } from "./store.js";
import { extractText } from "./extract.js";
import { chunkText } from "./chunk.js";
import { embedBatched } from "./embed.js";
import { topKByCosine } from "./search.js";
import { rerank } from "./rerank.js";
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export class KnowledgeEngine {
    store;
    filesRoot;
    constructor(options) {
        const opts = typeof options === 'string' ? { dbPath: options } : options;
        this.store = new KnowledgeStore(opts.dbPath);
        this.filesRoot = opts.filesRoot;
    }
    close() {
        this.store.close();
    }
    // ── config ────────────────────────────────────────────────────────────────
    getConfig() {
        return this.store.getConfig();
    }
    saveConfig(patch) {
        return this.store.saveConfig(patch);
    }
    // ── bases ─────────────────────────────────────────────────────────────────
    listBases() {
        return this.store.listBases();
    }
    createBase(name, description = '') {
        return this.store.createBase(name, description);
    }
    deleteBase(id) {
        this.store.deleteBase(id);
    }
    // ── files ─────────────────────────────────────────────────────────────────
    filesOf(kbId) {
        return this.store.filesOf(kbId);
    }
    fileOf(id) {
        return this.store.fileOf(id);
    }
    /** Read the originally-uploaded bytes for a file (relative to filesRoot). */
    readFileBytes(relPath) {
        if (this.filesRoot === undefined || relPath === '')
            return null;
        try {
            return readFileSync(join(this.filesRoot, relPath));
        }
        catch {
            return null;
        }
    }
    deleteFile(id) {
        this.store.deleteFile(id);
    }
    /**
     * Import a file: extract text, chunk it, embed every chunk, and persist.
     * @returns the file record plus stats. On embedding failure the file is
     * marked 'failed' and no chunks are persisted.
     */
    async importFile(kbId, filename, bytes) {
        const config = this.store.getConfig();
        const fileId = randomUUID();
        const now = Date.now();
        // Persist the original upload so the corpus is recoverable.
        let relPath = '';
        if (this.filesRoot !== undefined) {
            relPath = `${kbId}/${fileId}/${safeName(filename)}`;
            const target = join(this.filesRoot, relPath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, bytes);
        }
        const initial = {
            id: fileId, kbId, name: filename, ext: ext(filename), kind: 'text',
            relPath, size: bytes.length, encoding: 'auto', lineEnding: 'lf',
            charCount: 0, chunkCount: 0, status: 'pending', createdAt: now,
        };
        this.store.addFile(initial);
        try {
            this.store.updateFile(fileId, { status: 'indexing' });
            const extracted = extractText(filename, bytes, undefined, config.stripMarkup);
            if (extracted.text.trim() === '') {
                if (extracted.subtype === 'pdf')
                    throw new Error('PDF files are not supported yet; convert to text or an Office format first.');
                throw new Error(`no readable text extracted from ${filename}`);
            }
            const pieces = chunkText(extracted.text, config.chunkSize, config.chunkOverlap);
            if (pieces.length === 0)
                throw new Error('no chunks produced');
            const embedConfig = this.embedConfig(config);
            const texts = pieces.map(p => p.text);
            const vectors = await embedBatched(embedConfig, texts);
            const dim = vectors[0]?.length ?? 0;
            if (dim === 0)
                throw new Error('embedding returned zero-length vectors');
            const chunkRecords = pieces.map((piece, i) => ({
                index: i, text: piece.text, heading: piece.heading, dim, vector: vectors[i] ?? [],
            }));
            const count = this.store.replaceChunks(fileId, kbId, chunkRecords, now);
            this.store.updateFile(fileId, {
                encoding: extracted.encoding, kind: extracted.kind, charCount: extracted.charCount,
                chunkCount: count, status: 'ready', embeddingModel: config.embeddingModel, embeddingDim: dim,
            });
            return { file: this.store.fileOf(fileId), chunkCount: count, embeddingDim: dim };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.store.updateFile(fileId, { status: 'failed', error: message });
            return { file: this.store.fileOf(fileId), chunkCount: 0, embeddingDim: 0 };
        }
    }
    // ── mounts ────────────────────────────────────────────────────────────────
    setMount(kbId, workspaceId, enabled, note = '') {
        return this.store.setMount(kbId, workspaceId, enabled, note);
    }
    mounts() {
        return this.store.mounts();
    }
    workspaceKbIds(workspaceId) {
        return this.store.workspaceKbIds(workspaceId);
    }
    // ── search ─────────────────────────────────────────────────────────────────
    /**
     * Vector-search knowledge bases, optionally reranking the top candidates.
     * @param query - the search text.
     * @param options - scope / k / rerank controls.
     */
    async search(query, options = {}) {
        const config = this.store.getConfig();
        const kbIds = options.kbIds?.length
            ? options.kbIds
            : options.workspaceId !== undefined
                ? this.store.workspaceKbIds(options.workspaceId)
                : this.store.listBases().map(b => b.id);
        if (kbIds.length === 0 || query.trim() === '')
            return [];
        const topK = options.topK ?? config.defaultTopK;
        const candidateK = options.candidateK ?? Math.max(topK * 4, 20);
        const embedConfig = this.embedConfig(config);
        const embedded = await embedBatched(embedConfig, [query], 8000, options.signal);
        const queryVector = embedded[0];
        if (queryVector === undefined || queryVector.length === 0)
            return [];
        const candidates = this.store.searchCandidates(kbIds);
        const ranked = topKByCosine(queryVector, candidates.map(c => ({ vector: c.vector, item: c })), candidateK);
        let hits = ranked.map(r => ({ kbId: r.item.kbId, kbName: r.item.kbName, fileId: r.item.fileId, fileName: r.item.fileName, chunkId: r.item.chunkId, text: r.item.text, index: r.item.index, score: r.score }));
        const rerankModel = config.rerankModel;
        if (rerankModel !== '' && options.useRerank !== false && hits.length > 0) {
            const rerankConfig = {
                baseUrl: config.rerankEndpoint !== '' ? config.rerankEndpoint : config.endpointBaseUrl,
                model: rerankModel,
                apiKey: config.apiKey,
            };
            const result = await rerank(rerankConfig, query, hits.map(h => h.text));
            if (result !== null) {
                const order = new Map(result.ordered.map(r => [r.index, r.score]));
                hits = hits.map((h, i) => ({ ...h, rerankScore: order.get(i) ?? 0 }));
                hits.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
            }
        }
        return hits.slice(0, topK);
    }
    embedConfig(config) {
        return {
            baseUrl: config.endpointBaseUrl,
            model: config.embeddingModel,
            apiKey: config.apiKey,
        };
    }
}
function ext(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}
function safeName(name) {
    return name.replace(/[\\/:*?"<>|]/gu, '_').replace(/\.\./gu, '_');
}
