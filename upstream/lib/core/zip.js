/**
 * A small, dependency-free ZIP reader for office files (docx / pptx / xlsx),
 * which are ZIP archives of XML parts. It parses the End-Of-Central-Directory
 * record and the central directory, then decompresses selected entries with
 * Node's built-in zlib (method 8 = deflate, method 0 = stored).
 */
import { inflateRawSync } from 'node:zlib';
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const MAX_EOCD_SCAN = 65557;
/** A little-endian u16 / u32 reader over a Buffer. */
class Reader {
    buf;
    constructor(buf) {
        this.buf = buf;
    }
    u16(offset) {
        return this.buf.readUInt16LE(offset);
    }
    u32(offset) {
        return this.buf.readUInt32LE(offset);
    }
}
/**
 * Locate the EOCD record by scanning backward for its signature.
 * @returns the offset of the EOCD record, or -1.
 */
function findEocd(buf) {
    const start = Math.max(0, buf.length - MAX_EOCD_SCAN);
    for (let i = buf.length - 4; i >= start; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG)
            return i;
    }
    return -1;
}
/**
 * Parse the ZIP central directory and return every entry's file name and the
 * bytes needed to extract it. Ignores entries that are directories.
 */
export function listZipEntries(buf) {
    const eocd = findEocd(buf);
    if (eocd === -1)
        throw new Error('zip: end-of-central-directory not found');
    const r = new Reader(buf);
    const entryCount = r.u16(eocd + 10);
    let offset = r.u32(eocd + 16);
    if (offset === 0xffffffff || entryCount === 0xffff)
        throw new Error('zip: ZIP64 unsupported');
    const out = new Map();
    for (let i = 0; i < entryCount; i++) {
        const sig = r.u32(offset);
        if (sig !== CEN_SIG)
            break;
        const method = r.u16(offset + 10);
        const compressedSize = r.u32(offset + 20);
        const nameLen = r.u16(offset + 28);
        const extraLen = r.u16(offset + 30);
        const commentLen = r.u16(offset + 32);
        const localOffset = r.u32(offset + 42);
        const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
        if (!name.endsWith('/')) {
            out.set(name, { method, compressedSize, localOffset });
        }
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}
/**
 * Extract and decompress one entry by name.
 * @returns the decompressed bytes, or null when the entry is missing.
 */
export function readZipEntry(buf, name) {
    const entries = listZipEntries(buf);
    const entry = entries.get(name);
    if (entry === undefined)
        return null;
    const { method, compressedSize, localOffset } = entry;
    const r = new Reader(buf);
    const sig = r.u32(localOffset);
    if (sig !== 0x04034b50)
        throw new Error('zip: bad local header');
    const nameLen = r.u16(localOffset + 26);
    const extraLen = r.u16(localOffset + 28);
    const dataStart = localOffset + 30 + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0)
        return Buffer.from(raw);
    if (method === 8)
        return inflateRawSync(raw);
    throw new Error(`zip: unsupported compression method ${method}`);
}
/** Whether the buffer looks like a ZIP archive (PK signature). */
export function isZip(buf) {
    return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}
/** Return every entry whose name matches a glob-like prefix, decompressed. */
export function readZipByPrefix(buf, prefix) {
    const entries = listZipEntries(buf);
    const out = [];
    for (const [name] of entries) {
        if (name.startsWith(prefix)) {
            const data = readZipEntry(buf, name);
            if (data !== null)
                out.push({ name, data });
        }
    }
    return out;
}
