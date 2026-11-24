// dsh-tavern-knowledge 浏览器侧：侧栏「知识库」面板 + 本局状态分节。
// 手写 React（require('react')），不依赖打包，也不依赖 DSH 客户端 UI 包。
window.__ModuleLoader__.load({
  id: 'dsh-tavern-knowledge',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const BASE = '/plugins/dsh-tavern-knowledge'
    const CSS_ID = 'dsh-tavern-knowledge-css'

    const CSS = `
.tk-root { display:flex; flex-direction:column; gap:10px; font-size:13px; line-height:1.5; padding:4px 2px 18px; }
.tk-tabs { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid currentColor; border-color:color-mix(in oklab, currentColor 16%, transparent); padding-bottom:6px; }
.tk-tab { appearance:none; border:0; background:transparent; color:inherit; opacity:.62; padding:4px 9px; border-radius:8px; cursor:pointer; font:inherit; }
.tk-tab[data-on="1"] { opacity:1; background:color-mix(in oklab, currentColor 10%, transparent); font-weight:600; }
.tk-card { border:1px solid color-mix(in oklab, currentColor 14%, transparent); border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
.tk-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.tk-row-between { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.tk-muted { opacity:.6; font-size:12px; }
.tk-btn { appearance:none; font:inherit; cursor:pointer; border-radius:8px; padding:4px 10px; border:1px solid color-mix(in oklab, currentColor 22%, transparent); background:color-mix(in oklab, currentColor 6%, transparent); color:inherit; }
.tk-btn:hover:not([disabled]) { background:color-mix(in oklab, currentColor 12%, transparent); }
.tk-btn[disabled] { opacity:.45; cursor:default; }
.tk-btn-primary { border-color:color-mix(in oklab, currentColor 40%, transparent); background:color-mix(in oklab, currentColor 16%, transparent); font-weight:600; }
.tk-btn-danger { color:#d25555; border-color:color-mix(in oklab, #d25555 45%, transparent); }
.tk-input, .tk-select { font:inherit; color:inherit; background:color-mix(in oklab, currentColor 5%, transparent); border:1px solid color-mix(in oklab, currentColor 18%, transparent); border-radius:8px; padding:4px 8px; min-width:0; }
.tk-input { flex:1 1 160px; }
.tk-field { display:flex; gap:8px; align-items:center; }
.tk-field > label { width:120px; flex:0 0 120px; opacity:.72; font-size:12px; }
.tk-list { display:flex; flex-direction:column; gap:6px; max-height:240px; overflow:auto; }
.tk-item { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:9px; background:color-mix(in oklab, currentColor 5%, transparent); }
.tk-item[data-on="1"] { outline:1px solid color-mix(in oklab, currentColor 30%, transparent); }
.tk-name { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tk-chip { font-size:11px; padding:1px 7px; border-radius:99px; background:color-mix(in oklab, currentColor 12%, transparent); opacity:.8; }
.tk-drop { border:1.5px dashed color-mix(in oklab, currentColor 26%, transparent); border-radius:12px; padding:16px; text-align:center; opacity:.75; font-size:12px; cursor:pointer; }
.tk-drop[data-hot="1"] { border-color:color-mix(in oklab, currentColor 60%, transparent); opacity:1; background:color-mix(in oklab, currentColor 6%, transparent); }
.tk-toast { position:sticky; bottom:0; padding:6px 10px; border-radius:9px; font-size:12px; }
.tk-toast[data-kind="err"] { background:color-mix(in oklab, #d25555 22%, transparent); }
.tk-toast[data-kind="ok"] { background:color-mix(in oklab, #3f9b62 22%, transparent); }
.tk-hit { border-left:2px solid color-mix(in oklab, currentColor 25%, transparent); padding:2px 0 2px 8px; margin-top:6px; }
.tk-hit-body { white-space:pre-wrap; font-size:12px; opacity:.85; max-height:130px; overflow:auto; }
.tk-bar { height:6px; border-radius:99px; background:color-mix(in oklab, currentColor 12%, transparent); overflow:hidden; }
.tk-bar > i { display:block; height:100%; background:color-mix(in oklab, currentColor 55%, transparent); }
`

    // ── HTTP 小工具 ────────────────────────────────────────────────────────
    async function request(path, init) {
      const response = await fetch(BASE + path, init)
      const text = await response.text()
      let body = null
      if (text !== '') {
        try { body = JSON.parse(text) } catch { body = { error: text.slice(0, 300) } }
      }
      if (!response.ok) throw new Error((body && body.error) || `HTTP ${response.status}`)
      if (body && typeof body.error === 'string') throw new Error(body.error)
      return body
    }
    const getJson = path => request(path)
    const postJson = (path, body) => request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
    })
    const uploadFile = (path, file) => request(path, { method: 'POST', body: file })

    function fmtBytes(n) {
      const v = Number(n) || 0
      if (v < 1024) return `${v} B`
      if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
      return `${(v / 1024 / 1024).toFixed(1)} MB`
    }

    // ── 通用控件 ────────────────────────────────────────────────────────────
    function Btn({ children, onClick, primary, danger, disabled, title }) {
      return h('button', {
        className: `tk-btn${primary ? ' tk-btn-primary' : ''}${danger ? ' tk-btn-danger' : ''}`,
        onClick, disabled: disabled === true, title,
      }, children)
    }

    function Field({ label, children }) {
      return h('div', { className: 'tk-field' }, h('label', null, label), children)
    }

    function TextInput({ value, onChange, placeholder, type }) {
      return h('input', {
        className: 'tk-input', value: value ?? '', placeholder: placeholder ?? '',
        type: type ?? 'text',
        onChange: event => onChange(event.target.value),
      })
    }

    function Select({ value, onChange, options }) {
      return h('select', {
        className: 'tk-select', value: value ?? '',
        onChange: event => onChange(event.target.value),
      }, options.map(item => h('option', { key: item.value, value: item.value }, item.label)))
    }

    function DropZone({ label, onFiles, accept }) {
      const [hot, setHot] = useState(false)
      const pick = useRef(null)
      return h('div', {
        className: 'tk-drop', 'data-hot': hot ? '1' : '0',
        onClick: () => { if (pick.current) pick.current.click() },
        onDragOver: event => { event.preventDefault(); setHot(true) },
        onDragLeave: () => setHot(false),
        onDrop: event => {
          event.preventDefault()
          setHot(false)
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.length > 0) onFiles(files)
        },
      },
      h('input', {
        ref: pick, type: 'file', multiple: true, accept: accept ?? undefined,
        style: { display: 'none' },
        onChange: event => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles(files)
          event.target.value = ''
        },
      }),
      label)
    }

    // ── 主面板 ──────────────────────────────────────────────────────────────
    function Panel({ gameId }) {
      const [tab, setTab] = useState('inject')
      const [data, setData] = useState(null)
      const [toast, setToast] = useState(null)
      const [error, setError] = useState('')

      const flash = useCallback((kind, text) => {
        setToast({ kind, text })
        setTimeout(() => setToast(current => (current && current.text === text ? null : current)), 4000)
      }, [])

      const reload = useCallback(async () => {
        try {
          const next = await getJson('/state')
          setData(next)
          setError('')
        } catch (err) {
          setError(String(err?.message ?? err))
        }
      }, [])

      useEffect(() => { reload() }, [reload])

      const busy = (data?.operations ?? []).some(op => op.finished !== true)
      useEffect(() => {
        if (!busy) return undefined
        const timer = setInterval(() => { reload() }, 1500)
        return () => clearInterval(timer)
      }, [busy, reload])

      const tabs = [
        ['inject', '本局'],
        ['library', '资料库'],
        ['settings', '设置'],
        ['backup', '备份'],
      ]

      return h('div', { className: 'tk-root' },
        h('div', { className: 'tk-tabs' },
          tabs.map(([key, label]) => h('button', {
            key, className: 'tk-tab', 'data-on': tab === key ? '1' : '0',
            onClick: () => setTab(key),
          }, label)),
          h('button', { className: 'tk-tab', onClick: reload, title: '刷新' }, '↻')),
        error !== '' ? h('div', { className: 'tk-toast', 'data-kind': 'err' }, `接口出错：${error}`) : null,
        data === null
          ? h('div', { className: 'tk-muted' }, '读取中…')
          : tab === 'inject'
            ? h(InjectTab, { gameId, data, reload, flash })
            : tab === 'library'
              ? h(LibraryTab, { data, reload, flash })
              : tab === 'settings'
                ? h(SettingsTab, { data, reload, flash })
                : h(BackupTab, { data, reload, flash }),
        toast !== null ? h('div', { className: 'tk-toast', 'data-kind': toast.kind }, toast.text) : null,
      )
    }

    // ── 本局：绑定 + 命中 + 对话入库 ─────────────────────────────────────────
    function InjectTab({ gameId, data, reload, flash }) {
      const [binding, setBinding] = useState(null)
      const [inject, setInject] = useState(null)
      const [memoryKb, setMemoryKb] = useState('')
      const [working, setWorking] = useState('')

      const loadBinding = useCallback(async () => {
        if (!gameId) return
        try { setBinding(await getJson(`/binding?gameId=${encodeURIComponent(gameId)}`)) } catch { setBinding(null) }
      }, [gameId])

      const loadInject = useCallback(async () => {
        if (!gameId) return
        try { setInject(await getJson(`/inject?gameId=${encodeURIComponent(gameId)}`)) } catch { setInject(null) }
      }, [gameId])

      useEffect(() => { loadBinding(); loadInject() }, [loadBinding, loadInject])
      useEffect(() => {
        const timer = setInterval(() => { loadInject() }, 3000)
        return () => clearInterval(timer)
      }, [loadInject])

      const bases = data?.bases ?? []
      const effective = binding?.effective ?? []
      const byDefault = binding?.byDefault !== false

      const toggle = async (kbId) => {
        if (!gameId) return
        const current = Array.isArray(binding?.bound) ? binding.bound : effective
        const next = current.includes(kbId) ? current.filter(id => id !== kbId) : [...current, kbId]
        try {
          await postJson('/binding', { gameId, kbIds: next })
          await loadBinding()
          flash('ok', '本局绑定已更新')
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const resetBinding = async () => {
        try {
          await postJson('/binding', { gameId, kbIds: null })
          await loadBinding()
          flash('ok', '已回到默认库')
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const ingest = async (rebuild) => {
        if (!gameId || memoryKb === '') return
        setWorking('ingest')
        try {
          const result = await postJson('/chat/ingest', { gameId, kbId: memoryKb, rebuild: rebuild === true })
          flash('ok', result.upToDate
            ? `已是最新（第 ${result.to} 轮），这次没新增`
            : `入库第 ${result.from}–${result.to} 轮，新增 ${result.added} 轮`)
          await reload()
          await loadBinding()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      const forget = async () => {
        if (!gameId) return
        setWorking('forget')
        try {
          await postJson('/chat/forget', { gameId })
          flash('ok', '本局的对话向量记忆已删除')
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      const source = (data?.chatSources ?? []).find(item => item.gameId === gameId)
      const hits = Array.isArray(inject?.hits) ? inject.hits : []

      if (!gameId) return h('div', { className: 'tk-muted' }, '打开一局游戏后这里会显示本局绑定。')

      return h(React.Fragment, null,
        h('div', { className: 'tk-card' },
          h('div', { className: 'tk-row-between' },
            h('strong', null, '本局绑定的知识库'),
            h('span', { className: 'tk-muted' }, byDefault ? '跟随默认' : '手动绑定')),
          h('div', { className: 'tk-muted' }, '勾选即生效，改动只影响这一局。'),
          bases.length === 0
            ? h('div', { className: 'tk-muted' }, '还没有知识库，去「资料库」新建一个。')
            : h('div', { className: 'tk-list' }, bases.map(base => h('label', {
              key: base.id, className: 'tk-item', 'data-on': effective.includes(base.id) ? '1' : '0',
            },
            h('input', {
              type: 'checkbox', checked: effective.includes(base.id),
              onChange: () => toggle(base.id),
            }),
            h('span', { className: 'tk-name' }, base.name),
            h('span', { className: 'tk-chip' }, `${base.fileCount} 文件 / ${base.chunkCount} 块`)))),
          h('div', { className: 'tk-row' },
            h(Btn, { onClick: resetBinding, disabled: byDefault }, '恢复默认')),
        ),

        h('div', { className: 'tk-card' },
          h('div', { className: 'tk-row-between' },
            h('strong', null, '本轮检索'),
            h('span', { className: 'tk-muted' },
              inject?.at ? `${new Date(inject.at).toLocaleTimeString()} · ${inject.tookMs ?? 0} ms` : '还没有记录')),
          inject?.error ? h('div', { className: 'tk-muted' }, `上次失败：${inject.error}`) : null,
          inject?.query ? h('div', { className: 'tk-muted' }, `query：${inject.query}`) : null,
          hits.length === 0
            ? h('div', { className: 'tk-muted' }, '这一轮没有命中片段。发一句话试试，或调低相关度下限。')
            : hits.map((hit, index) => h('div', { key: `${hit.fileName}-${index}`, className: 'tk-hit' },
              h('div', { className: 'tk-row-between' },
                h('span', null, `${hit.kbName} / ${hit.fileName}`),
                h('span', { className: 'tk-chip' }, Number(hit.score).toFixed(2))),
              h('div', { className: 'tk-hit-body' }, hit.text))),
        ),

        h('div', { className: 'tk-card' },
          h('strong', null, '对话向量记忆'),
          h('div', { className: 'tk-muted' }, '把这一局已经写完的对话按轮向量化，写进选定的库。之后再点只补新的几轮。'),
          h('div', { className: 'tk-row' },
            h(Select, {
              value: memoryKb, onChange: setMemoryKb,
              options: [{ value: '', label: '选择要写入的库…' }]
                .concat(bases.map(base => ({ value: base.id, label: base.name }))),
            }),
            h(Btn, {
              primary: true, disabled: working !== '' || memoryKb === '',
              onClick: () => ingest(false),
            }, working === 'ingest' ? '写入中…' : '增量入库'),
            h(Btn, {
              disabled: working !== '' || memoryKb === '',
              onClick: () => ingest(true),
            }, '重建'),
          ),
          source
            ? h('div', { className: 'tk-row-between' },
              h('span', { className: 'tk-muted' }, `已入库到第 ${source.lastTurn} 轮 · ${new Date(source.updatedAt).toLocaleString()}`),
              h(Btn, { danger: true, disabled: working !== '', onClick: forget }, '删除记忆'))
            : h('div', { className: 'tk-muted' }, '这一局还没有向量记忆。'),
        ),
      )
    }

    // ── 资料库：库 + 文件 + 上传 ─────────────────────────────────────────────
    function LibraryTab({ data, reload, flash }) {
      const bases = data?.bases ?? []
      const [selected, setSelected] = useState('')
      const [files, setFiles] = useState([])
      const [newName, setNewName] = useState('')
      const [working, setWorking] = useState('')

      const kbId = selected !== '' ? selected : (bases[0]?.id ?? '')
      useEffect(() => {
        if (selected === '' && bases.length > 0) setSelected(bases[0].id)
      }, [bases, selected])

      const loadFiles = useCallback(async () => {
        if (kbId === '') { setFiles([]); return }
        try { setFiles(await getJson(`/files?kbId=${encodeURIComponent(kbId)}`)) } catch { setFiles([]) }
      }, [kbId])

      useEffect(() => { loadFiles() }, [loadFiles])
      const busy = (data?.operations ?? []).some(op => op.finished !== true)
      useEffect(() => {
        if (!busy) return undefined
        const timer = setInterval(() => { loadFiles() }, 2000)
        return () => clearInterval(timer)
      }, [busy, loadFiles])

      const createBase = async () => {
        const name = newName.trim()
        if (name === '') return
        try {
          const created = await postJson('/bases', { name })
          setNewName('')
          setSelected(created.id)
          await reload()
          flash('ok', `已新建「${created.name}」`)
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const removeBase = async (base) => {
        if (!window.confirm(`删除知识库「${base.name}」？里面的文件和向量一起删掉。`)) return
        try {
          await postJson('/bases/delete', { id: base.id })
          if (selected === base.id) setSelected('')
          await reload()
          flash('ok', '已删除')
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const upload = async (fileList) => {
        if (kbId === '') { flash('err', '先选一个知识库'); return }
        setWorking('upload')
        try {
          for (const file of fileList) {
            await uploadFile(`/files?kbId=${encodeURIComponent(kbId)}&name=${encodeURIComponent(file.name)}`, file)
          }
          flash('ok', `${fileList.length} 个文件已提交，正在后台向量化`)
          await reload()
          await loadFiles()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      const removeFile = async (file) => {
        try {
          await postJson('/files/delete', { fileId: file.id })
          await loadFiles()
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const reindex = async () => {
        try {
          await postJson('/reindex', { kbId })
          flash('ok', '开始重新量化')
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const operations = (data?.operations ?? []).filter(op => op.finished !== true)

      return h(React.Fragment, null,
        h('div', { className: 'tk-card' },
          h('strong', null, '知识库'),
          h('div', { className: 'tk-row' },
            h(TextInput, { value: newName, onChange: setNewName, placeholder: '新库名，例如「世界观」「角色档案」' }),
            h(Btn, { primary: true, onClick: createBase, disabled: newName.trim() === '' }, '新建')),
          bases.length === 0
            ? h('div', { className: 'tk-muted' }, '还没有库。')
            : h('div', { className: 'tk-list' }, bases.map(base => h('div', {
              key: base.id, className: 'tk-item', 'data-on': base.id === kbId ? '1' : '0',
            },
            h('button', {
              className: 'tk-name', style: { background: 'none', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
              onClick: () => setSelected(base.id),
            }, base.name),
            h('span', { className: 'tk-chip' }, `${base.fileCount} 文件`),
            h('span', { className: 'tk-chip' }, `${base.chunkCount} 块`),
            h(Btn, { danger: true, onClick: () => removeBase(base) }, '删除')))),
        ),

        kbId === ''
          ? null
          : h('div', { className: 'tk-card' },
            h(DropZone, { label: '把 docx / pptx / xlsx / txt / md / csv / html 拖进来，或点这里选文件', onFiles: upload }),
            h('div', { className: 'tk-row-between' },
              h('strong', null, '文件'),
              h('div', { className: 'tk-row' },
                h(Btn, { onClick: reindex }, '重新量化本库'),
                h(Btn, { onClick: loadFiles }, '刷新'))),
            operations.length > 0
              ? h('div', null, operations.map(op => h('div', { key: op.id },
                h('div', { className: 'tk-muted' }, `${op.label} · ${op.current || '准备中'} · ${Math.round((op.progress ?? 0) * 100)}%`),
                h('div', { className: 'tk-bar' }, h('i', { style: { width: `${Math.round((op.progress ?? 0) * 100)}%` } })))))
              : null,
            files.length === 0
              ? h('div', { className: 'tk-muted' }, '这个库还是空的。')
              : h('div', { className: 'tk-list' }, files.map(file => h('div', { key: file.id, className: 'tk-item' },
                h('span', { className: 'tk-name', title: file.name }, file.name),
                h('span', { className: 'tk-chip' }, file.status === 'ready'
                  ? `${file.chunkCount} 块`
                  : file.status === 'failed' ? '失败' : file.status),
                h('span', { className: 'tk-muted' }, fmtBytes(file.size)),
                h(Btn, { danger: true, onClick: () => removeFile(file) }, '×')))),
            h('div', { className: 'tk-muted' }, '换 embedding 模型后必须「重新量化」，否则新旧向量维度不一致。'),
          ),
      )
    }

    // ── 设置 ────────────────────────────────────────────────────────────────
    function SettingsTab({ data, reload, flash }) {
      const config = data?.config ?? {}
      const [form, setForm] = useState(() => ({ ...config }))
      const [testing, setTesting] = useState('')
      const [testResult, setTestResult] = useState(null)
      const [defaults, setDefaults] = useState(Array.isArray(config.defaultKbIds) ? config.defaultKbIds : [])

      useEffect(() => { setForm({ ...config }) }, [data])
      useEffect(() => { setDefaults(Array.isArray(config.defaultKbIds) ? config.defaultKbIds : []) }, [data])

      const set = (key) => (value) => setForm(current => ({ ...current, [key]: value }))

      const save = async () => {
        try {
          await postJson('/config', {
            endpointBaseUrl: String(form.endpointBaseUrl ?? '').trim(),
            embeddingModel: String(form.embeddingModel ?? '').trim(),
            apiKey: String(form.apiKey ?? ''),
            rerankModel: String(form.rerankModel ?? '').trim(),
            rerankEndpoint: String(form.rerankEndpoint ?? '').trim(),
            chunkSize: Number(form.chunkSize) || 1200,
            chunkOverlap: Number(form.chunkOverlap) || 150,
            defaultTopK: Number(form.defaultTopK) || 5,
            stripMarkup: form.stripMarkup !== false,
            defaultKbIds: defaults,
          })
          await reload()
          flash('ok', '设置已保存')
        } catch (err) { flash('err', String(err?.message ?? err)) }
      }

      const test = async () => {
        setTesting('test')
        setTestResult(null)
        try {
          setTestResult(await postJson('/config/test', {
            endpointBaseUrl: form.endpointBaseUrl,
            embeddingModel: form.embeddingModel,
            apiKey: form.apiKey,
          }))
        } catch (err) {
          setTestResult({ ok: false, error: String(err?.message ?? err) })
        }
        setTesting('')
      }

      const toggleDefault = (kbId) => {
        setDefaults(current => current.includes(kbId) ? current.filter(id => id !== kbId) : [...current, kbId])
      }

      return h(React.Fragment, null,
        h('div', { className: 'tk-card' },
          h('strong', null, '嵌入服务（OpenAI 兼容 /v1/embeddings）'),
          h(Field, { label: '接口地址' }, h(TextInput, { value: form.endpointBaseUrl, onChange: set('endpointBaseUrl'), placeholder: 'http://127.0.0.1:1234/v1' })),
          h(Field, { label: '嵌入模型' }, h(TextInput, { value: form.embeddingModel, onChange: set('embeddingModel'), placeholder: 'text-embedding-bge-m3' })),
          h(Field, { label: 'API Key' }, h(TextInput, { value: form.apiKey, onChange: set('apiKey'), placeholder: '本地服务通常留空' })),
          h(Field, { label: '重排模型' }, h(TextInput, { value: form.rerankModel, onChange: set('rerankModel'), placeholder: '留空 = 不重排' })),
          h(Field, { label: '重排地址' }, h(TextInput, { value: form.rerankEndpoint, onChange: set('rerankEndpoint'), placeholder: '留空 = 用上面的地址' })),
          h('div', { className: 'tk-row' },
            h(Btn, { onClick: test, disabled: testing !== '' }, testing === 'test' ? '测试中…' : '测试连接'),
            testResult !== null
              ? h('span', { className: 'tk-muted' }, testResult.ok
                ? `成功：${testResult.dim} 维 / ${testResult.latencyMs} ms / ${testResult.model}`
                : `失败：${testResult.error}`)
              : null),
        ),

        h('div', { className: 'tk-card' },
          h('strong', null, '切块'),
          h(Field, { label: '块大小' }, h(TextInput, { value: form.chunkSize, onChange: set('chunkSize'), type: 'number' })),
          h(Field, { label: '重叠' }, h(TextInput, { value: form.chunkOverlap, onChange: set('chunkOverlap'), type: 'number' })),
          h(Field, { label: '默认条数' }, h(TextInput, { value: form.defaultTopK, onChange: set('defaultTopK'), type: 'number' })),
          h('div', { className: 'tk-muted' }, '改切块参数只影响之后新导入的文件；已入库的请重新量化。'),
        ),

        h('div', { className: 'tk-card' },
          h('strong', null, '默认启用的库'),
          h('div', { className: 'tk-muted' }, '没有手动绑定过的对局，会用这里的库做检索。'),
          (data?.bases ?? []).length === 0
            ? h('div', { className: 'tk-muted' }, '还没有库。')
            : h('div', { className: 'tk-list' }, (data?.bases ?? []).map(base => h('label', {
              key: base.id, className: 'tk-item', 'data-on': defaults.includes(base.id) ? '1' : '0',
            },
            h('input', { type: 'checkbox', checked: defaults.includes(base.id), onChange: () => toggleDefault(base.id) }),
            h('span', { className: 'tk-name' }, base.name)))),
        ),

        h('div', { className: 'tk-row' }, h(Btn, { primary: true, onClick: save }, '保存全部设置')),
        h('div', { className: 'tk-muted' }, `插件数据目录：${data?.dataDir ?? ''}`),
      )
    }

    // ── 备份 ────────────────────────────────────────────────────────────────
    function BackupTab({ data, reload, flash }) {
      const [withVectors, setWithVectors] = useState(true)
      const [withRaw, setWithRaw] = useState(true)
      const [working, setWorking] = useState('')
      const [importPath, setImportPath] = useState('')
      const bases = data?.bases ?? []
      const backups = data?.backups ?? []

      const doExport = async () => {
        setWorking('export')
        try {
          const result = await postJson('/export', { includeVectors: withVectors, includeRaw: withRaw })
          flash('ok', `已导出 ${result.bases} 库 / ${result.files} 文件 / ${result.chunks} 块 · ${fmtBytes(result.bytes)}`)
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      const doImportFile = async (file) => {
        setWorking('import')
        try {
          const result = await request(`${BASE}/import?mode=raw`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })
          flash('ok', `已恢复 ${result.bases} 库 / ${result.files} 文件 / ${result.chunks} 块`)
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      const doImportPath = async () => {
        if (importPath.trim() === '') return
        setWorking('import')
        try {
          const result = await postJson('/import', { path: importPath.trim() })
          flash('ok', `已恢复 ${result.bases} 库 / ${result.files} 文件 / ${result.chunks} 块`)
          setImportPath('')
          await reload()
        } catch (err) { flash('err', String(err?.message ?? err)) }
        setWorking('')
      }

      return h(React.Fragment, null,
        h('div', { className: 'tk-card' },
          h('strong', null, '导出备份'),
          h('div', { className: 'tk-muted' }, `备份写到 ${data?.dataDir ?? ''}\\exports，一个自包含的 JSON 文件。`),
          h('label', { className: 'tk-row' },
            h('input', { type: 'checkbox', checked: withVectors, onChange: event => setWithVectors(event.target.checked) }),
            h('span', null, '带向量（导入即用，文件更大）')),
          h('label', { className: 'tk-row' },
            h('input', { type: 'checkbox', checked: withRaw, onChange: event => setWithRaw(event.target.checked) }),
            h('span', null, '带原始文件（导入后能重新量化）')),
          h('div', { className: 'tk-row' },
            h(Btn, { primary: true, onClick: doExport, disabled: working !== '' || bases.length === 0 },
              working === 'export' ? '导出中…' : '导出全部库')),
        ),

        h('div', { className: 'tk-card' },
          h('strong', null, '导入备份'),
          h(DropZone, { label: '把备份 .json 拖进来，或点这里选文件', accept: '.json', onFiles: files => doImportFile(files[0]) }),
          h('div', { className: 'tk-row' },
            h(TextInput, { value: importPath, onChange: setImportPath, placeholder: '或填备份文件在本机的完整路径' }),
            h(Btn, { onClick: doImportPath, disabled: working !== '' || importPath.trim() === '' }, '按路径导入')),
          h('div', { className: 'tk-muted' }, '导入永远建新库，不会覆盖或删除现有内容。'),
        ),

        h('div', { className: 'tk-card' },
          h('strong', null, '已有备份'),
          backups.length === 0
            ? h('div', { className: 'tk-muted' }, '还没有备份文件。')
            : h('div', { className: 'tk-list' }, backups.map(item => h('div', { key: item.name, className: 'tk-item' },
              h('span', { className: 'tk-name', title: item.path }, item.name),
              h('span', { className: 'tk-muted' }, fmtBytes(item.bytes)),
              h('a', {
                className: 'tk-btn', href: `${BASE}/download?name=${encodeURIComponent(item.name)}`,
                download: item.name,
              }, '下载')))),
        ),
      )
    }

    // ── 状态分节 ────────────────────────────────────────────────────────────
    function StatusSection({ gameId }) {
      const [inject, setInject] = useState(null)
      useEffect(() => {
        if (!gameId) return undefined
        let alive = true
        const tick = async () => {
          try {
            const next = await getJson(`/inject?gameId=${encodeURIComponent(gameId)}`)
            if (alive) setInject(next)
          } catch { /* 忽略 */ }
        }
        tick()
        const timer = setInterval(tick, 4000)
        return () => { alive = false; clearInterval(timer) }
      }, [gameId])

      if (!gameId || !inject || !inject.at) return null
      const hits = Array.isArray(inject.hits) ? inject.hits : []
      return h('div', { className: 'tk-root' },
        h('div', { className: 'tk-row-between' },
          h('span', null, hits.length === 0 ? '本轮没有命中知识库' : `本轮命中 ${hits.length} 段资料`),
          h('span', { className: 'tk-muted' }, `${inject.tookMs ?? 0} ms · 第 ${inject.turn ?? '?'} 轮`)),
        inject.error ? h('div', { className: 'tk-muted' }, `上次失败：${inject.error}`) : null,
        hits.map((hit, index) => h('div', { key: index, className: 'tk-hit' },
          h('div', { className: 'tk-row-between' },
            h('span', { className: 'tk-name' }, `${hit.kbName} / ${hit.fileName}`),
            h('span', { className: 'tk-chip' }, Number(hit.score).toFixed(2))),
          h('div', { className: 'tk-hit-body' }, String(hit.text ?? '').slice(0, 200)))),
      )
    }

    function apply(ctx) {
      try {
        if (!document.getElementById(CSS_ID)) {
          const style = document.createElement('style')
          style.id = CSS_ID
          style.textContent = CSS
          document.head.appendChild(style)
        }
      } catch { /* 样式失败不影响功能 */ }

      try {
        ctx.tavernUi.registerPanel({
          id: 'knowledge',
          title: '知识库',
          render: ({ gameId }) => h(Panel, { gameId }),
        })
      } catch (error) {
        try { console.warn('[dsh-tavern-knowledge] 面板注册失败:', error && error.message) } catch { /* ignore */ }
      }

      try {
        ctx.tavernUi.registerStatusSection({
          id: 'knowledge',
          title: '知识库',
          render: ({ gameId }) => h(StatusSection, { gameId }),
        })
      } catch (error) {
        try { console.warn('[dsh-tavern-knowledge] 状态分节注册失败:', error && error.message) } catch { /* ignore */ }
      }
    }

    return { name: 'dsh-tavern-knowledge', inject: ['tavernUi'], apply }
  },
})
