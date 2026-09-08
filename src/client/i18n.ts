/**
 * Minimal plugin-local i18n (zh/en) for the dsh-knowledge panel.
 */
export type Lang = 'zh' | 'en'

type DictValue = string | ((arg?: string) => string)
const dictionary: Record<Lang, Record<string, DictValue>> = {
  zh: {
    title: '知识库',
    tabConfig: '配置',
    tabBases: '知识库',
    tabSearch: '检索',
    configTitle: '向量化配置',
    configEndpoint: 'OpenAI 兼容接口地址',
    configModel: '嵌入模型',
    configApiKey: 'API Key（可选）',
    configRerankModel: '重排模型（可选）',
    configRerankEndpoint: '重排接口地址（可选）',
    configChunkSize: '分块大小（字符）',
    configChunkOverlap: '分块重叠（字符）',
    configTopK: '默认检索条数',
    configStripMarkup: '提取时去除 HTML 标签',
    save: '保存',
    saving: '保存中…',
    saved: '已保存',
    testConnection: '测试连接',
    testing: '测试中…',
    testOk: (s?: string) => (s ? `连接成功：${s}` : '连接成功'),
    testFail: '连接失败',
    basesTitle: '知识库列表',
    createBase: '新建知识库',
    baseNamePlaceholder: '知识库名称',
    create: '创建',
    delete: '删除',
    empty: '暂无数据',
    importFiles: '导入文件到当前知识库',
    importHint: '支持 doc/docx/ppt/pptx/xls/xlsx/txt/md/csv/html。',
    files: '文件',
    statusReady: '就绪',
    statusIndexing: '处理中',
    statusPending: '等待中',
    statusFailed: '失败',
    mountsTitle: '工作区挂载',
    mountWorkspace: '工作区 ID',
    mountKb: '知识库',
    mountEnable: '启用',
    mountAdd: '添加挂载',
    searchPlaceholder: '输入要检索的问题…',
    search: '检索',
    searching: '检索中…',
    noBase: '请先选择一个知识库',
    loading: '加载中…',
    close: '关闭',
    reindexBase: '重新量化',
    reindexAll: '全部重新量化',
    quantizing: '量化中',
    stop: '停止',
    stopped: '已停止',
    progressFiles: (s?: string) => s ?? '',
  },
  en: {
    title: 'Knowledge Base',
    tabConfig: 'Config',
    tabBases: 'Knowledge Bases',
    tabSearch: 'Search',
    configTitle: 'Embedding Configuration',
    configEndpoint: 'OpenAI-compatible endpoint',
    configModel: 'Embedding model',
    configApiKey: 'API Key (optional)',
    configRerankModel: 'Rerank model (optional)',
    configRerankEndpoint: 'Rerank endpoint (optional)',
    configChunkSize: 'Chunk size (chars)',
    configChunkOverlap: 'Chunk overlap (chars)',
    configTopK: 'Default top K',
    configStripMarkup: 'Strip HTML tags on import',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testOk: (s?: string) => (s ? `Connected: ${s}` : 'Connected'),
    testFail: 'Connection failed',
    basesTitle: 'Knowledge bases',
    createBase: 'New knowledge base',
    baseNamePlaceholder: 'Knowledge base name',
    create: 'Create',
    delete: 'Delete',
    empty: 'Nothing here yet',
    importFiles: 'Import files into this base',
    importHint: 'Supports doc/docx/ppt/pptx/xls/xlsx/txt/md/csv/html.',
    files: 'Files',
    statusReady: 'Ready',
    statusIndexing: 'Indexing',
    statusPending: 'Pending',
    statusFailed: 'Failed',
    mountsTitle: 'Workspace mounts',
    mountWorkspace: 'Workspace ID',
    mountKb: 'Knowledge base',
    mountEnable: 'Enabled',
    mountAdd: 'Add mount',
    searchPlaceholder: 'Type a question to search…',
    search: 'Search',
    searching: 'Searching…',
    noBase: 'Select a knowledge base first',
    loading: 'Loading…',
    close: 'Close',
    reindexBase: 'Re-embed',
    reindexAll: 'Re-embed all',
    quantizing: 'Quantizing',
    stop: 'Stop',
    stopped: 'Stopped',
    progressFiles: (s?: string) => s ?? '',
  },
}

export function getLang(): Lang {
  return (globalThis as { localStorage?: Storage }).localStorage?.getItem('dsh-knowledge-lang') === 'en' ? 'en' : 'zh'
}

export function setLang(lang: Lang): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem('dsh-knowledge-lang', lang) } catch { /* ignore */ }
}

export type Translate = (key: string, arg?: string) => string

/** Build a t() that returns zh/en strings, falling back to the key. */
export function makeT(lang: Lang): Translate {
  const dict = dictionary[lang] ?? dictionary.zh
  return (key: string, arg?: string) => {
    const value = dict[key]
    return typeof value === 'function' ? value(arg) : (value ?? key)
  }
}
