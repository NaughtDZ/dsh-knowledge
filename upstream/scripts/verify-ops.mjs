/**
 * Verify the built engine's re-quantization (operations + progress + stop) and
 * cleanup-on-delete logic. Run: node scripts/verify-ops.mjs
 */
import { KnowledgeEngine } from '../lib/core/engine.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
const docxBuf = () => storeZip([{ name: 'word/document.xml', data: Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>嵌入模型向量化指南</w:t></w:r></w:p></w:body></w:document>', 'utf8') }])
const txtBuf = () => Buffer.from('知识库使用方法与注意事项。', 'utf8')

const root = join(process.cwd(), 'scratch', 'ops')
const db = join(root, 'db.sqlite')
const filesRoot = join(root, 'files')

const engine = new KnowledgeEngine({ dbPath: db, filesRoot })
engine.saveConfig({ endpointBaseUrl: 'http://127.0.0.1:1234/v1', embeddingModel: 'text-embedding-bge-m3' })
const base = engine.createBase('操作测试库', 'ops')
const f1 = await engine.importFile(base.id, 'a.docx', docxBuf())
const f2 = await engine.importFile(base.id, 'b.txt', txtBuf())
console.log('imported:', f1.file.status, f2.file.status, '| files=', engine.filesOf(base.id).length)

// Reindex a single base (background operation).
const opId = engine.reindexBase(base.id)
console.log('reindexBase opId=', opId)
let ops = engine.activeOperations()
let guard = 0
while (ops.length > 0 && guard++ < 60) { await new Promise(r => setTimeout(r, 250)); ops = engine.activeOperations() }
console.log('reindexBase done after poll. remaining ops=', ops.length)

// Reindex all.
const opAll = engine.reindexAll()
console.log('reindexAll opId=', opAll)
guard = 0
while (engine.activeOperations().length > 0 && guard++ < 60) await new Promise(r => setTimeout(r, 250))
console.log('reindexAll done.')

// Stop test: start reindex-all then immediately stop.
const opStop = engine.reindexAll()
engine.stopAll()
await new Promise(r => setTimeout(r, 300))
const stillRunning = engine.activeOperations().filter(o => !o.finished).length
console.log('after stopAll, still-running ops=', stillRunning)

// Progress snapshot shape.
engine.reindexBase(base.id)
await new Promise(r => setTimeout(r, 120))
const snap = engine.activeOperations()
console.log('op snapshot fields=', snap.length ? Object.keys(snap[0]).join(',') : 'none')
engine.stopAll()
await new Promise(r => setTimeout(r, 200))

// Cleanup on delete: delete a file → disk file + chunk gone.
const relPath = f1.file.relPath
const diskFile = join(filesRoot, relPath)
console.log('before delete, disk file exists=', existsSync(diskFile), '| relPath=', relPath)
engine.deleteFile(f1.file.id)
console.log('after deleteFile: file present=', engine.fileOf(f1.file.id) !== null, '| disk file gone=', !existsSync(diskFile))

// Cleanup on base delete: mounts + files gone, disk pruned.
engine.setMount(base.id, 'ws', true)
engine.deleteBase(base.id)
console.log('after deleteBase: base present=', engine.listBases().some(b => b.id === base.id), '| mounts=', engine.mounts().length, '| kb dir remains=', existsSync(join(filesRoot, base.id)))

engine.close()
console.log('OK ops/cleanup')
