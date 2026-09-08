/**
 * The dsh-knowledge browser panel: configuration, knowledge-base & file
 * management, workspace mounts, and a live search test. Pure React with
 * inline styles (theme-agnostic) so it needs no CSS build step.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { KnowledgeBase, KnowledgeConfig, KnowledgeFile, SearchHit, WorkspaceMount } from '../core/types.ts'
import { getJson, postJson, uploadFile } from './api.ts'
import type { Translate } from './i18n.ts'

const STYLES = {
  container: { width: '100%', display: 'flex', flexDirection: 'column' as const, fontSize: 13, color: 'var(--dsw-alias-label-primary, #d4d4d4)', background: 'var(--dsw-alias-bg-layer-1, #1e1e1e)' },
  header: { padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border, #333)', display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 16, fontWeight: 600 },
  tabs: { display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--dsw-alias-border, #2a2a2a)' },
  tab: { padding: '6px 14px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #999)', border: '1px solid transparent' },
  tabActive: { background: 'var(--dsw-alias-bg-layer-2, #333)', color: 'var(--dsw-alias-label-primary, #eee)', border: '1px solid var(--dsw-alias-border, #555)' },
  body: { padding: '12px 16px' },
  section: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)', margin: '8px 0 4px' },
  field: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, #444)', background: 'var(--dsw-alias-bg-layer-2, #222)', color: 'var(--dsw-alias-label-primary, #eee)', boxSizing: 'border-box' as const },
  button: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, #555)', background: 'var(--dsw-alias-bg-layer-3, #2a2a2a)', color: 'var(--dsw-alias-label-primary, #eee)', cursor: 'pointer' },
  buttonPrimary: { background: '#4f6ef7', border: '1px solid #4f6ef7', color: '#fff' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border, #2a2a2a)' },
  chip: { padding: '2px 8px', borderRadius: 10, fontSize: 11, background: 'var(--dsw-alias-bg-layer-3, #333)', color: 'var(--dsw-alias-label-secondary, #aaa)' },
  statusChip: (status: string) => ({ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: status === 'ready' ? '#1f6f3f' : status === 'failed' ? '#7f2a2a' : '#555' }),
  hint: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #888)', margin: '4px 0 0' },
  error: { color: '#e06c75', fontSize: 12, marginTop: 6 },
  muted: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 },
} as const

type Tab = 'config' | 'bases' | 'search'

const DEFAULT_CONFIG: KnowledgeConfig = {
  endpointBaseUrl: 'http://127.0.0.1:1234/v1',
  embeddingModel: 'text-embedding-bge-m3',
  apiKey: '', rerankModel: '', rerankEndpoint: '',
  chunkSize: 1200, chunkOverlap: 150, defaultTopK: 5, stripMarkup: true,
}

interface PanelProps {
  t: Translate
  /** Optional: render a close affordance in the header (injected by the host). */
  onClose?: () => void
}

export function KnowledgePanel({ t, onClose }: PanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('config')
  const [config, setConfig] = useState<KnowledgeConfig>(DEFAULT_CONFIG)
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [mounts, setMounts] = useState<WorkspaceMount[]>([])
  const [selectedBase, setSelectedBase] = useState<string | null>(null)
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const loadConfig = useCallback(async () => {
    try { setConfig(await getJson<KnowledgeConfig>('/config')) } catch { setConfig(DEFAULT_CONFIG) }
  }, [])
  const loadBases = useCallback(async () => {
    try { setBases(await getJson<KnowledgeBase[]>('/bases')) } catch { /* ignore */ }
  }, [])
  const loadMounts = useCallback(async () => {
    try { setMounts(await getJson<WorkspaceMount[]>('/mounts')) } catch { /* ignore */ }
  }, [])
  const loadFiles = useCallback(async (kbId: string) => {
    try { setFiles(await getJson<KnowledgeFile[]>(`/files?kbId=${encodeURIComponent(kbId)}`)) } catch { setFiles([]) }
  }, [])

  useEffect(() => { void loadConfig(); void loadBases(); void loadMounts() }, [loadConfig, loadBases, loadMounts])
  useEffect(() => {
    if (selectedBase !== null) void loadFiles(selectedBase)
    else setFiles([])
  }, [selectedBase, loadFiles])

  const refreshAll = useCallback(async () => { await Promise.all([loadBases(), loadMounts()]) }, [loadBases, loadMounts])

  const saveConfig = useCallback(async () => {
    setBusy(true); setNotice('')
    try { await postJson('/config', config); setNotice(t('saved')) } catch (e) { setNotice(String(e)) } finally { setBusy(false) }
  }, [config, t])

  const testConnection = useCallback(async () => {
    setBusy(true); setNotice('')
    try {
      const r = await postJson<{ ok: boolean; dim?: number; latencyMs?: number; error?: string }>('/config/test', config)
      setNotice(r.ok ? t('testOk', `dim=${r.dim} ${r.latencyMs}ms`) : `${t('testFail')}: ${r.error ?? ''}`)
    } catch (e) { setNotice(`${t('testFail')}: ${String(e)}`) } finally { setBusy(false) }
  }, [config, t])

  const createBase = useCallback(async () => {
    const name = prompt(t('baseNamePlaceholder'))
    if (name === null || name.trim() === '') return
    try { await postJson('/bases', { name: name.trim(), description: '' }); await refreshAll() } catch (e) { setNotice(String(e)) }
  }, [refreshAll, t])

  const deleteBase = useCallback(async (id: string) => {
    if (!confirm(t('delete'))) return
    try { await postJson('/bases/delete', { id }); if (selectedBase === id) setSelectedBase(null); await refreshAll() } catch (e) { setNotice(String(e)) }
  }, [refreshAll, selectedBase, t])

  const deleteFile = useCallback(async (fileId: string) => {
    try { await postJson('/files/delete', { fileId }); if (selectedBase !== null) await loadFiles(selectedBase) } catch (e) { setNotice(String(e)) }
  }, [loadFiles, selectedBase])

  const onImport = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    if (file === undefined || selectedBase === null) { input.value = ''; return }
    setBusy(true); setNotice('')
    try {
      const bytes = await file.arrayBuffer()
      const r = await uploadFile<{ chunkCount: number; file: KnowledgeFile }>(selectedBase, file.name, bytes)
      setNotice(`${file.name}: ${r.chunkCount} chunks`)
      await loadFiles(selectedBase)
    } catch (err) { setNotice(`${file.name}: ${String(err)}`) } finally { setBusy(false); input.value = '' }
  }, [loadFiles, selectedBase])

  const addMount = useCallback(async () => {
    const kbId = prompt(t('mountKb'))
    const workspaceId = prompt(t('mountWorkspace'))
    if (kbId === null || workspaceId === null || kbId.trim() === '' || workspaceId.trim() === '') return
    try { await postJson('/mounts', { kbId: kbId.trim(), workspaceId: workspaceId.trim(), enabled: true }); await loadMounts() } catch (e) { setNotice(String(e)) }
  }, [loadMounts, t])

  const toggleMount = useCallback(async (kbId: string, workspaceId: string, enabled: boolean) => {
    try { await postJson('/mounts', { kbId, workspaceId, enabled: !enabled }); await loadMounts() } catch (e) { setNotice(String(e)) }
  }, [loadMounts])

  const setCfg = useCallback((patch: Partial<KnowledgeConfig>) => setConfig(c => ({ ...c, ...patch })), [])

  const selectedBaseObj = useMemo(() => bases.find(b => b.id === selectedBase), [bases, selectedBase])

  return (
    <div style={STYLES.container}>
      <div style={STYLES.header}>
        <span style={STYLES.title}>{t('title')}</span>
        {notice !== '' && <span style={STYLES.muted}>{notice}</span>}
        {onClose !== undefined && (
          <button style={{ ...STYLES.button, marginLeft: 'auto' }} onClick={onClose}>{t('close')}</button>
        )}
      </div>
      <div style={STYLES.tabs}>
        {(['config', 'bases', 'search'] as Tab[]).map(k => (
          <button key={k} style={{ ...STYLES.tab, ...(tab === k ? STYLES.tabActive : {}) }} onClick={() => setTab(k)}>
            {t(`tab${k === 'config' ? 'Config' : k === 'bases' ? 'Bases' : 'Search'}`)}
          </button>
        ))}
      </div>
      <div style={STYLES.body}>
        {tab === 'config' && (
          <div>
            <div style={STYLES.section}>
              <span style={{ ...STYLES.label, fontSize: 14, fontWeight: 600 }}>{t('configTitle')}</span>
              <label style={STYLES.label}>{t('configEndpoint')}</label>
              <input style={STYLES.field} value={config.endpointBaseUrl} onChange={e => setCfg({ endpointBaseUrl: e.target.value })} />
              <label style={STYLES.label}>{t('configModel')}</label>
              <input style={STYLES.field} value={config.embeddingModel} onChange={e => setCfg({ embeddingModel: e.target.value })} />
              <label style={STYLES.label}>{t('configApiKey')}</label>
              <input style={STYLES.field} type="password" value={config.apiKey} onChange={e => setCfg({ apiKey: e.target.value })} />
              <label style={STYLES.label}>{t('configRerankModel')}</label>
              <input style={STYLES.field} value={config.rerankModel} onChange={e => setCfg({ rerankModel: e.target.value })} />
              <label style={STYLES.label}>{t('configRerankEndpoint')}</label>
              <input style={STYLES.field} value={config.rerankEndpoint} onChange={e => setCfg({ rerankEndpoint: e.target.value })} />
            </div>
            <div style={STYLES.section}>
              <label style={STYLES.label}>{t('configChunkSize')}</label>
              <input style={STYLES.field} type="number" value={config.chunkSize} onChange={e => setCfg({ chunkSize: Number(e.target.value) || 1200 })} />
              <label style={STYLES.label}>{t('configChunkOverlap')}</label>
              <input style={STYLES.field} type="number" value={config.chunkOverlap} onChange={e => setCfg({ chunkOverlap: Number(e.target.value) || 0 })} />
              <label style={STYLES.label}>{t('configTopK')}</label>
              <input style={STYLES.field} type="number" value={config.defaultTopK} onChange={e => setCfg({ defaultTopK: Number(e.target.value) || 5 })} />
              <label style={{ ...STYLES.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={config.stripMarkup} onChange={e => setCfg({ stripMarkup: e.target.checked })} />
                {t('configStripMarkup')}
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...STYLES.button, ...STYLES.buttonPrimary }} disabled={busy} onClick={() => void saveConfig()}>{busy ? t('saving') : t('save')}</button>
              <button style={STYLES.button} disabled={busy} onClick={() => void testConnection()}>{busy ? t('testing') : t('testConnection')}</button>
            </div>
          </div>
        )}

        {tab === 'bases' && (
          <div>
            <div style={STYLES.section}>
              <button style={STYLES.button} onClick={() => void createBase()}>{t('createBase')}</button>
              <div>{bases.length === 0 && <span style={STYLES.muted}>{t('empty')}</span>}</div>
              {bases.map(b => (
                <div key={b.id} style={STYLES.row}>
                  <button style={STYLES.button} onClick={() => setSelectedBase(b.id)}>{b.name}</button>
                  <span style={STYLES.chip}>{b.fileCount} files · {b.chunkCount} chunks</span>
                  <span style={STYLES.muted}>{b.description}</span>
                  <button style={STYLES.button} onClick={() => void deleteBase(b.id)}>{t('delete')}</button>
                </div>
              ))}
            </div>
            {selectedBaseObj !== undefined && (
              <div style={STYLES.section}>
                <span style={{ ...STYLES.label, fontSize: 14, fontWeight: 600 }}>{t('importFiles')} — {selectedBaseObj.name}</span>
                <div style={STYLES.hint}>{t('importHint')}</div>
                <input type="file" disabled={busy} onChange={e => void onImport(e)} style={{ marginTop: 8 }} />
                <div>{files.length === 0 && <span style={STYLES.muted}>{t('empty')}</span>}</div>
                {files.map(f => (
                  <div key={f.id} style={STYLES.row}>
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <span style={STYLES.statusChip(f.status)}>{t(`status${f.status[0]!.toUpperCase()}${f.status.slice(1)}`)}</span>
                    <span style={STYLES.muted}>{f.chunkCount} chunks · {f.encoding}</span>
                    <button style={STYLES.button} onClick={() => void deleteFile(f.id)}>{t('delete')}</button>
                  </div>
                ))}
              </div>
            )}
            <div style={STYLES.section}>
              <span style={{ ...STYLES.label, fontSize: 14, fontWeight: 600 }}>{t('mountsTitle')}</span>
              <button style={STYLES.button} onClick={() => void addMount()}>{t('mountAdd')}</button>
              <div>{mounts.length === 0 && <span style={STYLES.muted}>{t('empty')}</span>}</div>
              {mounts.map(m => (
                <div key={`${m.kbId}:${m.workspaceId}`} style={STYLES.row}>
                  <span style={{ flex: 1 }}>{bases.find(b => b.id === m.kbId)?.name ?? m.kbId}</span>
                  <span style={STYLES.chip}>{m.workspaceId}</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={m.enabled} onChange={() => void toggleMount(m.kbId, m.workspaceId, m.enabled)} />
                    {t('mountEnable')}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'search' && <SearchTab t={t} bases={bases} />}
      </div>
    </div>
  )
}

function SearchTab({ t, bases }: { t: Translate; bases: KnowledgeBase[] }): JSX.Element {
  const [query, setQuery] = useState('')
  const [kbId, setKbId] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    if (query.trim() === '') return
    setBusy(true); setError('')
    try {
      const r = await postJson<{ hits: SearchHit[] }>('/search', { query, ...(kbId === '' ? {} : { kbIds: [kbId] }), topK: 5 })
      setResults(r.hits)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }, [query, kbId])

  return (
    <div>
      <div style={STYLES.section}>
        <input style={STYLES.field} placeholder={t('searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void run() }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select style={STYLES.field} value={kbId} onChange={e => setKbId(e.target.value)}>
            <option value="">{t('basesTitle')}</option>
            {bases.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button style={{ ...STYLES.button, ...STYLES.buttonPrimary }} disabled={busy} onClick={() => void run()}>{busy ? t('searching') : t('search')}</button>
        </div>
      </div>
      {error !== '' && <div style={STYLES.error}>{error}</div>}
      <div>
        {results.map((h, i) => (
          <div key={h.chunkId} style={STYLES.row}>
            <span style={STYLES.chip}>{i + 1}</span>
            <span style={{ flex: 1 }}>
              <div>{h.text.slice(0, 200)}</div>
              <div style={STYLES.muted}>{h.kbName} · {h.fileName} · {h.index} · score={h.score.toFixed(3)}{h.rerankScore !== undefined ? ` · rerank=${h.rerankScore.toFixed(3)}` : ''}</div>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
