/**
 * The high-level knowledge engine: imports files (extract → chunk → embed),
 * re-quantizes them on demand, stores everything, and serves vector search.
 * DSH-independent — the host plugin wraps this with HTTP routes, a settings
 * namespace, and a tool.
 *
 * Long-running work (imports and re-quantization) runs as a cancellable
 * "operation" so the UI can show progress and stop it without restarting.
 */
import { KnowledgeStore } from "./store.js";
import { extractText } from "./extract.js";
import { chunkText } from "./chunk.js";
import { embedBatched, embedTexts } from "./embed.js";
import { topKByCosine } from "./search.js";
import { rerank } from "./rerank.js";
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
/** Thrown (or returned) when an operation is cancelled. */
const STOPPED = 'stopped';
export class KnowledgeEngine {
    store;
    filesRoot;
    operations = new Map();
    constructor(options) {
        const opts = typeof options === 'string' ? { dbPath: options } : options;
        this.store = new KnowledgeStore(opts.dbPath);
        this.filesRoot = opts.filesRoot;
    }
    close() {
        for (const op of this.operations.values())
            op.controller.abort();
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
        // Clean up raw files on disk, then the DB rows (cascades to chunks/mounts).
        for (const file of this.store.filesOf(id))
            this.removeFileFromDisk(file.relPath);
        this.store.deleteBase(id);
        // Final sweep: drop the base's whole directory (plus an empty parent fileId dir).
        if (this.filesRoot !== undefined) {
            try {
                rmSync(join(this.filesRoot, id), { recursive: true, force: true });
            }
            catch { /* best effort */ }
        }
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
        const file = this.store.fileOf(id);
        if (file !== null)
            this.removeFileFromDisk(file.relPath);
        this.store.deleteFile(id);
    }
    // ── operations (progress + cancellation) ──────────────────────────────────
    /** Snapshot of live and just-finished operations. */
    activeOperations() {
        return [...this.operations.values()].map((op) => this.viewOf(op));
    }
    viewOf(op) {
        const progress = op.total <= 0
            ? (op.chunkTotal > 0 ? Math.min(1, op.chunkDone / op.chunkTotal) : op.finished ? 1 : 0)
            : Math.min(1, (op.done + (op.chunkTotal > 0 ? op.chunkDone / op.chunkTotal : 0)) / op.total);
        return {
            id: op.id, kind: op.kind, label: op.label, total: op.total, done: op.done,
            chunkTotal: op.chunkTotal, chunkDone: op.chunkDone, current: op.current,
            progress, startedAt: op.startedAt, finished: op.finished, failed: op.failed,
        };
    }
    /** Abort one operation. @returns true when it was running. */
    stopOperation(id) {
        const op = this.operations.get(id);
        if (op === undefined || op.finished)
            return false;
        op.controller.abort();
        return true;
    }
    /** Abort every running operation. @returns the number aborted. */
    stopAll() {
        let count = 0;
        for (const op of [...this.operations.values()]) {
            if (!op.finished) {
                op.controller.abort();
                count++;
            }
        }
        return count;
    }
    // ── import ────────────────────────────────────────────────────────────────
    /**
     * Import a file: persist the upload, extract → chunk → embed, and store.
     * Auto-embeds on import. @returns the file record (status ready/failed/stopped).
     */
    async importFile(kbId, filename, bytes) {
        const fileId = randomUUID();
        const now = Date.now();
        let relPath = '';
        if (this.filesRoot !== undefined) {
            relPath = `${kbId}/${fileId}/${safeName(filename)}`;
            const target = join(this.filesRoot, relPath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, bytes);
        }
        this.store.addFile({
            id: fileId, kbId, name: filename, ext: ext(filename), kind: 'text', relPath,
            size: bytes.length, encoding: 'auto', lineEnding: 'lf', charCount: 0,
            chunkCount: 0, status: 'pending', createdAt: now,
        });
        const op = this.track('import', filename, 1);
        try {
            this.store.updateFile(fileId, { status: 'indexing' });
            const result = await this.indexBytes(fileId, kbId, filename, bytes, op.controller.signal, (current, chunkTotal, chunkDone) => {
                op.current = current;
                op.chunkTotal = chunkTotal;
                op.chunkDone = chunkDone;
            });
            op.done = 1;
            this.removeOp(op.id);
            return result;
        }
        catch (error) {
            const stopped = op.controller.signal.aborted || String(error).includes(STOPPED);
            const message = stopped ? 'stopped by user' : (error instanceof Error ? error.message : String(error));
            this.store.updateFile(fileId, { status: 'failed', error: message });
            this.removeOp(op.id);
            return { file: this.store.fileOf(fileId), chunkCount: 0, embeddingDim: 0, stopped };
        }
    }
    // ── re-quantization ───────────────────────────────────────────────────────
    /**
     * Re-embed a single existing file with the current embedding config.
     * @returns the import result, or null when the file/bytes are missing.
     */
    async reembedFile(fileId, signal, onProgress) {
        const file = this.store.fileOf(fileId);
        if (file === null)
            return null;
        const bytes = this.readFileBytes(file.relPath);
        if (bytes === null) {
            this.store.updateFile(fileId, { status: 'failed', error: 'original file is missing on disk' });
            return null;
        }
        this.store.updateFile(fileId, { status: 'indexing' });
        try {
            const result = await this.indexBytes(fileId, file.kbId, file.name, bytes, signal, onProgress);
            return result;
        }
        catch (error) {
            const stopped = signal?.aborted === true || String(error).includes(STOPPED);
            this.store.updateFile(fileId, { status: 'failed', error: stopped ? 'stopped by user' : (error instanceof Error ? error.message : String(error)) });
            return null;
        }
    }
    /** Re-embed every file in one knowledge base; returns the operation id immediately. */
    reindexBase(kbId) {
        const files = this.store.filesOf(kbId);
        const label = `重新量化: ${this.store.baseOf(kbId)?.name ?? kbId}`;
        const op = this.track('reindex-base', label, files.length);
        void this.runBatch(op, files.map(f => f.id));
        return op.id;
    }
    /** Re-embed every file in every knowledge base; returns the operation id. */
    reindexAll() {
        const bases = this.store.listBases();
        const ids = bases.flatMap(b => this.store.filesOf(b.id).map(f => f.id));
        const op = this.track('reindex-all', '重新量化: 全部知识库', ids.length);
        void this.runBatch(op, ids);
        return op.id;
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
    // ── internals ─────────────────────────────────────────────────────────────
    /**
     * Extract → chunk → embed → persist for one file. Throws when aborted or
     * when no vectors are produced; the caller updates the file status.
     * @param onProgress - reports (currentName, chunkTotal, chunkDone) as batches land.
     */
    async indexBytes(fileId, kbId, filename, bytes, signal, onProgress) {
        const config = this.store.getConfig();
        const extracted = extractText(filename, bytes, undefined, config.stripMarkup);
        if (extracted.text.trim() === '') {
            if (extracted.subtype === 'pdf')
                throw new Error('PDF files are not supported yet; convert to text or an Office format first.');
            throw new Error(`no readable text extracted from ${filename}`);
        }
        const pieces = chunkText(extracted.text, config.chunkSize, config.chunkOverlap);
        if (pieces.length === 0)
            throw new Error('no chunks produced');
        if (aborted(signal))
            throw new Error(STOPPED);
        const embedConfig = this.embedConfig(config);
        const texts = pieces.map(p => p.text);
        // Embed in small batches so the UI can show a smooth progress bar even
        // though the OpenAI-compatible /embeddings endpoint is not a stream.
        const vectors = [];
        const batch = 8;
        for (let i = 0; i < texts.length; i += batch) {
            if (aborted(signal))
                throw new Error(STOPPED);
            const slice = texts.slice(i, i + batch);
            const res = await embedTexts(embedConfig, slice, signal);
            vectors.push(...res);
            onProgress?.(filename, texts.length, Math.min(texts.length, i + res.length));
        }
        if (aborted(signal) || vectors.length < texts.length)
            throw new Error(STOPPED);
        const dim = vectors[0]?.length ?? 0;
        if (dim === 0)
            throw new Error('embedding returned zero-length vectors');
        const chunkRecords = pieces.map((piece, i) => ({ index: i, text: piece.text, heading: piece.heading, dim, vector: vectors[i] ?? [] }));
        const now = Date.now();
        const count = this.store.replaceChunks(fileId, kbId, chunkRecords, now);
        this.store.updateFile(fileId, {
            encoding: extracted.encoding, kind: extracted.kind, charCount: extracted.charCount,
            chunkCount: count, status: 'ready', embeddingModel: config.embeddingModel, embeddingDim: dim,
        });
        return { file: this.store.fileOf(fileId), chunkCount: count, embeddingDim: dim };
    }
    /** Run a batch of file re-embeds with progress + cancellation. */
    async runBatch(op, fileIds) {
        try {
            for (const fileId of fileIds) {
                if (op.controller.signal.aborted)
                    break;
                const file = this.store.fileOf(fileId);
                op.current = file?.name ?? fileId;
                op.chunkTotal = 0;
                op.chunkDone = 0;
                if (file !== null) {
                    await this.reembedFile(fileId, op.controller.signal, (current, chunkTotal, chunkDone) => {
                        op.current = current;
                        op.chunkTotal = chunkTotal;
                        op.chunkDone = chunkDone;
                    });
                }
                op.done++;
            }
            op.finished = true;
            op.failed = op.controller.signal.aborted;
        }
        catch {
            op.finished = true;
            op.failed = true;
        }
        finally {
            // Keep the finished record visible briefly so callers can read it, then drop.
            setTimeout(() => this.removeOp(op.id), 15_000);
        }
    }
    track(kind, label, total) {
        const id = randomUUID();
        const op = {
            id, kind, label, total, done: 0, current: '', startedAt: Date.now(),
            chunkTotal: 0, chunkDone: 0, finished: false, failed: false,
            controller: new AbortController(),
        };
        this.operations.set(id, op);
        return op;
    }
    removeOp(id) {
        this.operations.delete(id);
    }
    /** Delete a raw uploaded file and prune now-empty parent dirs up to filesRoot. */
    removeFileFromDisk(relPath) {
        if (this.filesRoot === undefined || relPath === '')
            return;
        const target = join(this.filesRoot, relPath);
        try {
            // Path-traversal guard.
            const rel = relative(this.filesRoot, target);
            if (rel === '' || rel.startsWith('..') || rel.split(/[\\/]/u).includes('..'))
                return;
            if (existsSync(target))
                unlinkSync(target);
        }
        catch {
            // Best effort; DB rows are already gone.
        }
        // Prune empty dirs: kbId/fileId up to filesRoot.
        let dir = dirname(target);
        while (dir !== this.filesRoot && dir.startsWith(this.filesRoot)) {
            try {
                if (existsSync(dir) && readdirEmpty(dir))
                    rmSync(dir, { recursive: false });
                else
                    break;
            }
            catch {
                break;
            }
            dir = dirname(dir);
        }
    }
    embedConfig(config) {
        return { baseUrl: config.endpointBaseUrl, model: config.embeddingModel, apiKey: config.apiKey };
    }
}
function ext(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}
function safeName(name) {
    return name.replace(/[\\/:*?"<>|]/gu, '_').replace(/\.\./gu, '_');
}
function readdirEmpty(dir) {
    return readdirSync(dir).length === 0;
}
function aborted(signal) {
    return signal?.aborted === true;
}
import { readdirSync } from 'node:fs';
