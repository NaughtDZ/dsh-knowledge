/**
 * Document text extraction for dsh-knowledge. Pure Node, no dependencies.
 *
 * Supported inputs:
 *   - docx / pptx / xlsx (ZIP+XML) — full fidelity.
 *   - txt / md / csv / html        — encoding-aware decode, CRLF→LF.
 *   - doc / ppt / xls (OLE2)       — best-effort text pull (limited fidelity).
 */
export interface ExtractionResult {
    readonly text: string;
    readonly kind: 'office' | 'text' | 'unknown';
    /** Detected subtype: 'docx' | 'pptx' | 'xlsx' | 'doc' | 'ppt' | 'xls' | 'txt' | 'md' | 'csv' | 'html' | 'xml' | 'json' | 'unknown'. */
    readonly subtype: string;
    readonly encoding: string;
    readonly hadBom: boolean;
    readonly charCount: number;
    /** Whether the extraction was best-effort/lossy. */
    readonly degraded: boolean;
}
/**
 * Extract text from a file's bytes.
 * @param filename - original file name (used for extension detection).
 * @param buffer - raw file bytes.
 * @param preferredEncoding - optional encoding hint for text files.
 * @param stripMarkup - strip tags for html.
 */
export declare function extractText(filename: string, buffer: Buffer, preferredEncoding?: string, stripMarkup?: boolean): ExtractionResult;
