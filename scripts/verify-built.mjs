/**
 * Smoke-test the BUILT host library (lib/core/engine.js) end-to-end:
 * create a base, import an in-memory docx, mount to a workspace, and search.
 * Run with: node scripts/verify-built.mjs
 */
import { KnowledgeEngine } from '../lib/core/engine.js'
import { extractText } from '../lib/core/extract.js'

// Build a minimal docx in-memory (store-only zip).
function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
function storeZip(entries) {
  const local = []; const central = []; let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'); const crc = crc32(e.data)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26)
    local.push(lh, name, e.data)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(ch, name); offset += 30 + name.length + e.data.length
  }
  const cb = Buffer.concat(central); const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cb.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cb, eocd])
}

const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>嵌入模型与向量检索指南</w:t></w:r></w:p><w:p><w:r><w:t>本指南介绍如何把文档变成向量。</w:t></w:r></w:p></w:body></w:document>'
const docx = storeZip([{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }])
console.log('docx extract chars =', extractText('guide.docx', docx).charCount)

const engine = new KnowledgeEngine({ dbPath: 'scratch/verify-built.sqlite', filesRoot: 'scratch/fixtures-built' })
engine.saveConfig({ endpointBaseUrl: 'http://127.0.0.1:1234/v1', embeddingModel: 'text-embedding-bge-m3' })
const base = engine.createBase('物理课本', 'test')
const imported = await engine.importFile(base.id, 'guide.docx', docx)
console.log('import status =', imported.file.status, 'chunks =', imported.chunkCount, 'dim =', imported.embeddingDim)
engine.setMount(base.id, 'ws-alpha', true)
console.log('ws-alpha bases =', JSON.stringify(engine.workspaceKbIds('ws-alpha')))
const hits = await engine.search('如何向量化文档', { workspaceId: 'ws-alpha', topK: 3 })
console.log('search hits =', hits.length)
for (const h of hits) console.log('  ' + h.kbName + ' | ' + h.fileName + ' | score=' + h.score.toFixed(3) + ' | ' + h.text.slice(0, 50))
engine.close()
