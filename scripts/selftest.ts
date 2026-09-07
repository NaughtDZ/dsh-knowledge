/**
 * Minimal store-only ZIP writer for building test fixtures (docx/pptx/xlsx),
 * and the self-test runner. Run with: tsx scripts/selftest.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractText } from '../src/core/extract.ts'
import { chunkText, defaultChunk } from '../src/core/chunk.ts'
import { embedText, cosine } from '../src/core/embed.ts'
import { topKByCosine } from '../src/core/search.ts'
import type { EmbedConfig } from '../src/core/embed.ts'

const EMBED: EmbedConfig = {
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'text-embedding-bge-m3',
}

// A store-only (method 0) zip builder.
function storeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method stored
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18) // csize
    local.writeUInt32LE(e.data.length, 22) // usize
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    localParts.push(local, name, e.data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(e.data.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += 30 + name.length + e.data.length
  }
  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralBuf, eocd])
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const b of buf) {
    crc ^= b
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sampleDocx(): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>知识库使用指南</w:t></w:r></w:p>
<w:p><w:r><w:t>这是第一段，介绍如何导入文档。</w:t></w:r></w:p>
<w:p><w:r><w:t>This paragraph is in English about embedding models.</w:t></w:r></w:p>
<w:p><w:r><w:br/><w:t>After a break.</w:t></w:r></w:p>
</w:body></w:document>`
  return storeZip([{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }])
}

function samplePptx(): Buffer {
  const slide = (n: number, title: string, body: string): { name: string; data: Buffer } => ({
    name: `ppt/slides/slide${n}.xml`,
    data: Buffer.from(`<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:cSld></p:sld>`, 'utf8'),
  })
  return storeZip([slide(1, 'Slide One: 向量搜索', 'embeddings turn text into vectors.'), slide(2, 'Slide Two', 'rerank 模型提升相关性。')])
}

function sampleXlsx(): Buffer {
  const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>名称</t></si><si><t>金额</t></si><si><t>备注</t></si><si><t>苹果</t></si><si><t>12.5</t></si><si><t>好吃</t></si></sst>`
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>12.5</v></c><c r="C2" t="s"><v>5</v></c></row>
</sheetData></worksheet>`
  return storeZip([
    { name: 'xl/sharedStrings.xml', data: Buffer.from(shared, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ])
}

function textSamples(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {}
  out['utf8.txt'] = Buffer.from('UTF-8 中文文件：hello world.\r\nsecond line with CRLF.\r\n', 'utf8')
  // GBK bytes (ANSI Chinese).
  out['ansi-gbk.txt'] = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a, 0xb1, 0xa8, 0xba, 0xec, 0x0d, 0x0a])
  out['markdown.md'] = Buffer.from('# 标题\n\n一段 markdown 文本。\n\n- item one\n- item 2\n', 'utf8')
  out['data.csv'] = Buffer.from('name,age,note\nAlice,30,hello\n张三,25,你好\n', 'utf8')
  out['page.html'] = Buffer.from('<html><body><h1>报告</h1><p>这是 HTML 内容。</p><p>Second para.</p></body></html>', 'utf8')
  return out
}

async function main(): Promise<void> {
  const scratch = join(process.cwd(), 'scratch', 'fixtures')
  mkdirSync(scratch, { recursive: true })
  const fixtures: Array<[string, Buffer]> = [
    ['sample.docx', sampleDocx()],
    ['sample.pptx', samplePptx()],
    ['sample.xlsx', sampleXlsx()],
    ...Object.entries(textSamples()) as Array<[string, Buffer]>,
  ]
  for (const [name, buf] of fixtures) writeFileSync(join(scratch, name), buf)

  console.log('=== extraction ===')
  for (const [name, buf] of fixtures) {
    const r = extractText(name, buf)
    console.log(`[${name}] kind=${r.kind} subtype=${r.subtype} enc=${r.encoding} chars=${r.charCount} degraded=${r.degraded}`)
    console.log('  --> ' + JSON.stringify(r.text.slice(0, 160).replace(/\n/g, '\\n')))
  }

  console.log('\n=== chunking ===')
  const doc = '段落一：介绍知识库。\n\n段落二：嵌入模型将文本转为向量用于检索。\n\n段落三：rerank 进一步排序。\n\n'
  const chunks = defaultChunk(doc.repeat(20), 200, 30)
  console.log(`chunk count=${chunks.length}; first=${JSON.stringify(chunks[0]?.text.slice(0, 80))}`)
  const big = 'x'.repeat(500)
  const hard = chunkText(big, 100, 20)
  console.log(`hard-split count=${hard.length}`)

  console.log('\n=== embedding (LM Studio) ===')
  try {
    const vec = await embedText(EMBED, '知识库向量检索')
    console.log(`embed dims=${vec.length}; first3=${vec.slice(0, 3).map(String).join(',')}`)
    console.log(`cosine(same)=${cosine(vec, vec)}`)
    const ranked = topKByCosine(vec, [{ vector: vec, item: 'a' }, { vector: [0, 0, 0], item: 'b' }], 1)
    console.log(`topk first=${ranked[0]?.item} score=${ranked[0]?.score}`)
  } catch (e) {
    console.log('embed SKIPPED/FAILED: ' + (e instanceof Error ? e.message : String(e)))
  }

  console.log('\n=== engine end-to-end (create/import/search) ===')
  try {
    const { KnowledgeEngine } = await import('../src/core/engine.ts')
    const dbPath = join(process.cwd(), 'scratch', 'knowledge.sqlite')
    const engine = new KnowledgeEngine(dbPath)
    engine.saveConfig({ endpointBaseUrl: 'http://127.0.0.1:1234/v1', embeddingModel: 'text-embedding-bge-m3' })
    const base = engine.createBase('测试库', 'a test knowledge base')
    const docx = await engine.importFile(base.id, 'sample.docx', sampleDocx())
    console.log(`import docx => status=${docx.file.status} chunks=${docx.chunkCount} dim=${docx.embeddingDim}`)
    const txt = await engine.importFile(base.id, 'utf8.txt', textSamples()['utf8.txt']!)
    console.log(`import txt => status=${txt.file.status} chunks=${txt.chunkCount} enc=${txt.file.encoding}`)
    engine.setMount(base.id, 'workspace-1', true)
    console.log(`workspace-1 enabled bases=${JSON.stringify(engine.workspaceKbIds('workspace-1'))}`)
    const hits = await engine.search('如何导入文档', { workspaceId: 'workspace-1', topK: 3 })
    console.log(`search top${hits.length}: `)
    for (const h of hits) console.log(`  [${h.kbName}] score=${h.score.toFixed(3)} ${h.fileName}: ${h.text.slice(0, 40)}`)
    engine.close()
  } catch (e) {
    console.log('engine FAILED: ' + (e instanceof Error ? e.stack ?? e.message : String(e)))
  }

  console.log('\nDONE')
}

void main()
