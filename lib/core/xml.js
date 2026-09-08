/**
 * A small, dependency-free XML parser sufficient for office document markup
 * (docx / pptx / xlsx). It builds a lightweight element tree with tag name,
 * attributes, and a children list whose leaf nodes are Text nodes. Comments,
 * processing instructions, and DOCTYPE declarations are skipped. Entity
 * references in text and attribute values are decoded.
 */
const NAME = /^[A-Za-z_][\w.:-]*/u;
const WS = /[ \t\r\n]/u;
/** Decode the five predefined entities plus numeric character references. */
function decodeEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_m, cp) => String.fromCodePoint(Number(cp)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, cp) => String.fromCodePoint(Number.parseInt(cp, 16)));
}
/** Parse one opening or self-closing tag from its raw text. */
function parseTag(raw) {
    let i = 1; // skip '<'
    while (i < raw.length && WS.test(raw[i]))
        i++;
    const nameMatch = raw.slice(i).match(NAME);
    if (nameMatch === null) {
        // Not a normal tag (e.g. "<!..." or "<?..."). Handled by the caller.
        return { tag: '', attrs: {}, selfClosing: raw.endsWith('/>'), raw };
    }
    const tag = nameMatch[0];
    i += tag.length;
    const attrs = {};
    while (i < raw.length) {
        while (i < raw.length && WS.test(raw[i]))
            i++;
        if (i >= raw.length || raw[i] === '/' || raw[i] === '>')
            break;
        const attrMatch = raw.slice(i).match(/^[A-Za-z_][\w.:-]*/u);
        if (attrMatch === null) {
            i++;
            continue;
        }
        const key = attrMatch[0];
        i += key.length;
        while (i < raw.length && WS.test(raw[i]))
            i++;
        let value = '';
        if (raw[i] === '=') {
            i++;
            while (i < raw.length && WS.test(raw[i]))
                i++;
            const quote = raw[i] === '"' || raw[i] === "'" ? raw[i] : '"';
            if (raw[i] === quote) {
                i++;
                const start = i;
                while (i < raw.length && raw[i] !== quote)
                    i++;
                value = raw.slice(start, i);
                if (raw[i] === quote)
                    i++;
            }
        }
        attrs[key] = decodeEntities(value);
    }
    return { tag, attrs, selfClosing: raw.endsWith('/>'), raw };
}
/**
 * Parse an XML document into an element tree. Throws on malformed structure
 * (unclosed tags, stray close tags).
 */
export function parseXml(source) {
    let pos = 0;
    const len = source.length;
    const isWs = (ch) => ch !== undefined && /[ \t\r\n\u000b\u000c]/u.test(ch);
    /** Skip prolog junk: whitespace, comments, PI, DOCTYPE. */
    function skipMisc() {
        while (pos < len) {
            if (isWs(source[pos])) {
                pos++;
                continue;
            }
            if (source.startsWith('<?', pos)) {
                pos = source.indexOf('?>', pos);
                pos = pos === -1 ? len : pos + 2;
                continue;
            }
            if (source.startsWith('<!--', pos)) {
                pos = source.indexOf('-->', pos);
                pos = pos === -1 ? len : pos + 3;
                continue;
            }
            if (source.startsWith('<!', pos)) {
                // DOCTYPE or other declaration: skip to matching '>'.
                pos = source.indexOf('>', pos);
                pos = pos === -1 ? len : pos + 1;
                continue;
            }
            break;
        }
    }
    function parseElement() {
        // pos is at '<tag'. Read to the matching '>' (respecting quotes).
        let end = pos;
        let quote;
        while (end < len) {
            const ch = source[end];
            if (quote !== undefined) {
                if (ch === quote)
                    quote = undefined;
            }
            else if (ch === '"' || ch === "'") {
                quote = ch;
            }
            else if (ch === '>') {
                break;
            }
            end++;
        }
        if (end >= len)
            throw new Error('xml: unterminated tag');
        const raw = source.slice(pos, end + 1);
        const { tag, attrs, selfClosing } = parseTag(raw);
        if (tag === '')
            throw new Error(`xml: unsupported tag near ${raw.slice(0, 24)}`);
        pos = end + 1;
        const element = { kind: 'element', tag, attrs, children: [] };
        if (selfClosing)
            return element;
        // Children until matching close tag.
        for (;;) {
            if (pos >= len)
                throw new Error(`xml: unclosed element <${tag}>`);
            if (source.startsWith('</', pos)) {
                const closeEnd = source.indexOf('>', pos);
                if (closeEnd === -1)
                    throw new Error('xml: unterminated close tag');
                const closeRaw = source.slice(pos, closeEnd + 1);
                const closeName = closeRaw.slice(2).split(/[\s>]/u)[0] ?? '';
                if (closeName !== tag)
                    throw new Error(`xml: mismatched close tag </${closeName}> for <${tag}>`);
                pos = closeEnd + 1;
                return element;
            }
            if (source.startsWith('<!--', pos)) {
                const idx = source.indexOf('-->', pos);
                pos = idx === -1 ? len : idx + 3;
                continue;
            }
            if (source.startsWith('<![CDATA[', pos)) {
                const idx = source.indexOf(']]>', pos);
                const body = idx === -1 ? source.slice(pos) : source.slice(pos, idx);
                element.children.push({ kind: 'text', text: body });
                pos = idx === -1 ? len : idx + 3;
                continue;
            }
            if (source[pos] !== '<') {
                let next = pos;
                while (next < len && source[next] !== '<')
                    next++;
                const text = source.slice(pos, next);
                pos = next;
                if (text.trim() !== '')
                    element.children.push({ kind: 'text', text: decodeEntities(text) });
                continue;
            }
            // Nested element (or PI/comment already handled).
            if (source.startsWith('<?', pos)) {
                const idx = source.indexOf('?>', pos);
                pos = idx === -1 ? len : idx + 2;
                continue;
            }
            element.children.push(parseElement());
        }
    }
    skipMisc();
    if (pos >= len || source[pos] !== '<')
        return null;
    return parseElement();
}
/** Collect every descendant (including self) element whose local tag matches. */
export function descendants(node, localTag) {
    const out = [];
    const visit = (n) => {
        const local = localNameOf(n.tag);
        if (local === localTag)
            out.push(n);
        for (const child of n.children) {
            if (child.kind === 'element')
                visit(child);
        }
    };
    visit(node);
    return out;
}
/** Concatenate the text content of an element, recursively. */
export function textOf(node) {
    if (node.kind === 'text')
        return node.text;
    let out = '';
    for (const child of node.children)
        out += textOf(child);
    return out;
}
/** The local part of a (possibly namespaced) tag name. */
export function localNameOf(tag) {
    const idx = tag.indexOf(':');
    return idx === -1 ? tag : tag.slice(idx + 1);
}
/** Direct child elements of one element. */
export function childrenOf(node) {
    return node.children.filter((child) => child.kind === 'element');
}
