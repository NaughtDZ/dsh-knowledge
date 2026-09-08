/**
 * Text decoding with encoding detection for imported plain-text files.
 *
 * Handles UTF-8/16/32 BOMs, validates strict UTF-8, and falls back through
 * the common ANSI code pages (GB18030/GBK for Chinese, Shift_JIS, Big5,
 * Windows-1252). Normalizes CRLF / lone-CR line endings to LF.
 */
import { TextDecoder } from 'node:util';
/** BOM signatures. */
const BOMS = [
    { encoding: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
    { encoding: 'utf-16le', bytes: [0xff, 0xfe] },
    { encoding: 'utf-16be', bytes: [0xfe, 0xff] },
    { encoding: 'utf-32le', bytes: [0xff, 0xfe, 0x00, 0x00] },
    { encoding: 'utf-32be', bytes: [0x00, 0x00, 0xfe, 0xff] },
];
const ENCODINGS_BY_NAME = {
    'utf-16le': 'utf-16le',
    'utf-16be': 'utf-16be',
    'utf-32le': 'utf-32le',
    'utf-32be': 'utf-32be',
    'utf-8': 'utf-8',
    gbk: 'gbk',
    gb18030: 'gb18030',
    'windows-1252': 'windows-1252',
    shift_jis: 'shift_jis',
    big5: 'big5',
};
/** Whether a TextDecoder can decode `encoding` (full ICU). */
function supports(encoding) {
    try {
        const dec = new TextDecoder(encoding);
        return dec.encoding !== undefined;
    }
    catch {
        return false;
    }
}
/** Decode with strict validation (fatal), returning null on invalid bytes. */
function tryFatal(buffer, encoding) {
    if (!supports(encoding))
        return null;
    try {
        return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    }
    catch {
        return null;
    }
}
/** A coarse "quality" score for a decoded string, to prefer plausible text. */
function quality(text) {
    if (text.length === 0)
        return 0;
    let control = 0;
    let replacement = 0;
    let cjk = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === 0xfffd)
            replacement++;
        if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
            control++;
        if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf))
            cjk++;
    }
    const nonPrintable = control + replacement;
    // CJK reads strongly correct for Chinese/ANSI (GBK) streams, so weight it.
    return text.length - nonPrintable + cjk * 8;
}
function stripBom(buffer, encoding) {
    for (const bom of BOMS) {
        if (bom.encoding === encoding && buffer.length >= bom.bytes.length) {
            let match = true;
            for (let i = 0; i < bom.bytes.length; i++) {
                if (buffer[i] !== bom.bytes[i]) {
                    match = false;
                    break;
                }
            }
            if (match)
                return buffer.subarray(bom.bytes.length);
        }
    }
    return buffer;
}
/**
 * Detect an encoding and decode a text buffer.
 * @param buffer - raw file bytes.
 * @param preferred - optional hint (e.g. 'gb18030' or 'utf-8').
 */
export function decodeText(buffer, preferred) {
    // BOM detection.
    for (const bom of BOMS) {
        if (bom.bytes.length > buffer.length)
            continue;
        let match = true;
        for (let i = 0; i < bom.bytes.length; i++) {
            if (buffer[i] !== bom.bytes[i]) {
                match = false;
                break;
            }
        }
        if (match) {
            const enc = bom.encoding;
            const stripped = buffer.subarray(bom.bytes.length);
            const text = new TextDecoder(enc).decode(stripped);
            return { text, encoding: enc.startsWith('utf-32') ? 'utf-32' : enc, hadBom: true };
        }
    }
    // Confident strict UTF-8.
    const utf8 = tryFatal(buffer, 'utf-8');
    if (utf8 !== null)
        return { text: utf8, encoding: 'utf-8', hadBom: false };
    // An explicit preferred encoding gets first try (non-fatal measure behind
    // GB18030 which covers GBK/GB2312 for Chinese ANSI files).
    const candidates = [];
    if (preferred !== undefined)
        candidates.push(preferred);
    candidates.push('gb18030', 'shift_jis', 'big5', 'windows-1252');
    let best = null;
    for (const enc of candidates) {
        const decoded = tryFatal(buffer, enc);
        if (decoded === null)
            continue;
        const score = quality(decoded);
        // Prefer the highest-quality decode; CJK weight makes GB18030 win for
        // Chinese/ANSI streams while a pure-Latin file stays on windows-1252
        // (UTF-8 already caught any ASCII/Latin-1 that is valid UTF-8).
        if (best === null || score > best.score) {
            best = { encoding: enc, text: decoded, score };
        }
    }
    if (best !== null && best.text.trim() !== '') {
        return { text: best.text, encoding: best.encoding, hadBom: false };
    }
    // Last resort: lossy UTF-8 (replacement chars) or latin-1.
    const lossy = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    return { text: lossy, encoding: 'utf-8', hadBom: false };
}
/** Normalize CRLF and lone-CR line endings to LF. */
export function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
/** Whether a buffer has a UTF-16/32 BOM (binary/office detection helper). */
export function looksLikeText(buffer) {
    if (buffer.length === 0)
        return false;
    // Reject clear binary signatures.
    if (buffer.length >= 4) {
        const n = buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24);
        if (n === 0x04034b50)
            return false; // zip
        if (buffer.length >= 8) {
            const sig = Buffer.from(buffer.subarray(0, 8)).toString('hex');
            if (sig === 'd0cf11e0a1b11ae1')
                return false; // OLE2
            if (sig.startsWith('25504446') || sig.startsWith('%pdf'))
                return false; // PDF
        }
    }
    // A NUL byte in the first 1024 bytes usually indicates a binary container.
    for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
        if (buffer[i] === 0)
            return false;
    }
    return true;
}
