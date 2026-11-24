/**
 * A small, dependency-free XML parser sufficient for office document markup
 * (docx / pptx / xlsx). It builds a lightweight element tree with tag name,
 * attributes, and a children list whose leaf nodes are Text nodes. Comments,
 * processing instructions, and DOCTYPE declarations are skipped. Entity
 * references in text and attribute values are decoded.
 */
export interface XmlElement {
    readonly kind: 'element';
    readonly tag: string;
    readonly attrs: Record<string, string>;
    readonly children: XmlNode[];
}
export interface XmlText {
    readonly kind: 'text';
    readonly text: string;
}
export type XmlNode = XmlElement | XmlText;
/**
 * Parse an XML document into an element tree. Throws on malformed structure
 * (unclosed tags, stray close tags).
 */
export declare function parseXml(source: string): XmlElement | null;
/** Collect every descendant (including self) element whose local tag matches. */
export declare function descendants(node: XmlElement, localTag: string): XmlElement[];
/** Concatenate the text content of an element, recursively. */
export declare function textOf(node: XmlNode): string;
/** The local part of a (possibly namespaced) tag name. */
export declare function localNameOf(tag: string): string;
/** Direct child elements of one element. */
export declare function childrenOf(node: XmlElement): XmlElement[];
