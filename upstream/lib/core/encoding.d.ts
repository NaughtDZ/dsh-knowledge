/**
 * Text decoding with encoding detection for imported plain-text files.
 *
 * Handles UTF-8/16/32 BOMs, validates strict UTF-8, and falls back through
 * the common ANSI code pages (GB18030/GBK for Chinese, Shift_JIS, Big5,
 * Windows-1252). Normalizes CRLF / lone-CR line endings to LF.
 */
export interface DecodedText {
    readonly text: string;
    readonly encoding: string;
    readonly hadBom: boolean;
}
/**
 * Detect an encoding and decode a text buffer.
 * @param buffer - raw file bytes.
 * @param preferred - optional hint (e.g. 'gb18030' or 'utf-8').
 */
export declare function decodeText(buffer: Uint8Array, preferred?: string): DecodedText;
/** Normalize CRLF and lone-CR line endings to LF. */
export declare function normalizeLineEndings(text: string): string;
/** Whether a buffer has a UTF-16/32 BOM (binary/office detection helper). */
export declare function looksLikeText(buffer: Uint8Array): boolean;
