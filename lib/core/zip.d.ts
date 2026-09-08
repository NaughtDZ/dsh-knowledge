/**
 * A small, dependency-free ZIP reader for office files (docx / pptx / xlsx),
 * which are ZIP archives of XML parts. It parses the End-Of-Central-Directory
 * record and the central directory, then decompresses selected entries with
 * Node's built-in zlib (method 8 = deflate, method 0 = stored).
 */
/**
 * Parse the ZIP central directory and return every entry's file name and the
 * bytes needed to extract it. Ignores entries that are directories.
 */
export declare function listZipEntries(buf: Buffer): Map<string, {
    method: number;
    compressedSize: number;
    localOffset: number;
}>;
/**
 * Extract and decompress one entry by name.
 * @returns the decompressed bytes, or null when the entry is missing.
 */
export declare function readZipEntry(buf: Buffer, name: string): Buffer | null;
/** Whether the buffer looks like a ZIP archive (PK signature). */
export declare function isZip(buf: Buffer): boolean;
/** Return every entry whose name matches a glob-like prefix, decompressed. */
export declare function readZipByPrefix(buf: Buffer, prefix: string): Array<{
    name: string;
    data: Buffer;
}>;
