# dsh-knowledge

一个运行在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) 里的**知识库 / RAG 插件**。像 Cherry Studio 的知识库一样：把本地的 Office 与文本资料导入、通过任意 **OpenAI 兼容接口**（如 LM Studio、Ollama）用你设定的嵌入模型**向量化**，然后在指定工作区**启用**，让 agent 在运行时用**向量检索**（可选的**重排模型**）回答你的问题。

A knowledge-base (RAG) plugin for DeepSeek Harness. Import Office & text documents, vectorize them through any OpenAI-compatible endpoint (e.g. LM Studio), enable them per workspace, and let the agent run vector search (with optional rerank).

---

## 功能特性 / Features

- 📁 **导入并保存文件** — 支持 `doc/docx`、`ppt/pptx`、`xls/xlsx`（ZIP+XML，完整提取），以及 `txt/md/csv/html`（**编码感知**：UTF-8/UTF-16、GB18030/GBK、Windows-1252、Big5、Shift_JIS；统一 **CRLF/LF→LF**）。旧版二进制 `doc/ppt/xls` 做**尽力而为**提取。原始文件也会持久化。
- 🔎 **任意 OpenAI 兼容嵌入接口** — 支持 LM Studio / Ollama / 本地或托管服务；可配置 `baseURL`、`model`、`apiKey`。
- <img width="1173" height="1207" alt="image" src="https://github.com/user-attachments/assets/40524db0-eed4-4ddf-977d-dcda15caa2f0" />

- ▶️ **导入自动量化 + 进度条 + 停止** — 导入即自动嵌入；面板实时显示**进度条**（文件数 + 分块数），运行中可点击**停止**中断。
- 🔁 **手动重新量化** — 每个知识库一个「重新量化」按钮 + 一个「全部重新量化」按钮（用当前嵌入模型重算全体，可停止）。
- 🧠 **重排模型（可选）** — 调用 `/rerank` 端点做二次排序；接口不支持时自动回退到向量相似度。
- 🧹 **自动清理** — UI 内删除知识库/文件会同步清除嵌入与磁盘上的原始文件；**卸载插件**时自动删除插件数据目录。
- 📚 **知识库** — 一个知识库包含多个导入文件。
- 🗂 **工作区挂载** — 列表式：先选一个**工作区**，再在它下面用**复选框多选**该工作区启用的知识库（无需手输 ID）。
- <img width="1146" height="1166" alt="image" src="https://github.com/user-attachments/assets/64e22f71-dacc-4f08-baf3-1c7d0c3ee89a" />

- 🤖 **agent 工具** — 提供 `knowledge_search` 工具，agent 自动检索当前/指定工作区已启用的知识库。
- <img width="1146" height="1169" alt="image" src="https://github.com/user-attachments/assets/83186f18-339f-46cb-a862-7ee7cd6f94a1" />

- 🎛 **DSH 设置悬浮窗** — 知识库管理器注册为 DSH **设置菜单里的一个 section**（和设置菜单一样是悬浮弹窗），不占用侧边栏、不与其它插件的侧边栏 / UI 重叠，内含配置 / 知识库 / 工作区挂载 / 检索测试。

---

## 支持的输入格式 / Supported inputs

| 格式 | 提取方式 | 说明 |
|---|---|---|
| `.docx` `.pptx` `.xlsx` | ZIP+XML 解析（纯 Node，无外部依赖） | 高保真：段落/表格/幻灯片内容 |
| `.txt` `.md` `.csv` `.html` | 编码感知解码 + 标签剥离（html） | 处理 ANSI/UTF-8、CRLF/LF |
| `.doc` `.ppt` `.xls` | OLE2 最佳努力文本提取 | 有限保真，建议转换为新格式 |

> 说明：不用任何运行时外部依赖（无 mammoth/pdf-parse/xlsx 等），文本提取、ZIP 解压、XML 解析、向量检索全部内置，仅靠 Node 内置能力（`node:sqlite`、`node:zlib`、`node:util` 的 `TextDecoder`）。PDF 暂不支持。

---

## 安装 / Install

要求：DSH (Node ≥ 22.19)，以及一个 OpenAI 兼容的 `/v1/embeddings` 端点（如 LM Studio，端口一般为 `http://127.0.0.1:1234/v1`）。

在目标 profile（如 `web`）中添加该插件：

```bash
# 从本仓库 clone 后（或用发布的 npm 包）
dsh plugin --profile web add dsh-knowledge
```

或在 profile 的 `package.json` 中把 `dsh-knowledge` 加入 `dependencies`，并把 `dsh-knowledge` 加入 `dsh.profile.bundles`。插件通过 `cordis.patch.yml` 插入 `knowledge` 行，并注册同源 `/knowledge/*` 路由。

> 加入 bundle 集后需**重启该 profile** 才生效（DSH 不会热加载新 bundle）。

---

## 使用 / Usage

1. **打开面板** — 打开 DSH 设置（侧边栏底部的齿轮），左侧导航选择「知识库」。它和设置菜单一样是悬浮弹窗，不与其它插件的侧边栏重叠。
2. **配置嵌入** — 在「配置」页填：OpenAI 兼容接口地址、嵌入模型、可选 API Key、可选重排模型；点「测试连接」验证。
3. **创建知识库并导入文件** — 「知识库」页新建一个库，选择一个库后「导入文件」（支持多选/拖拽，浏览器文件选择）。导入后**自动开始量化**，面板顶部显示**进度条**；运行中可点「停止」中断。
4. **重新量化** — 更换嵌入模型后，可对单个知识库点「重新量化」，或点右上「全部重新量化」用当前模型重算全体（同样可停止、看进度）。
5. **挂载到工作区** — 「知识库」页底部「工作区挂载」：先在下拉框**选工作区**，再用**复选框多选**该工作区要启用的知识库（勾选即挂载、取消即卸载；工作区列表来自 DSH 的 workspaceRegistry）。
6. **删除/卸载清理** — 删除知识库/文件会同步清除嵌入与原始文件；卸载插件（`dsh plugin remove`）会自动删除插件数据目录。
7. **agent 检索** — 模型在运行时自动拥有 `knowledge_search` 工具；你也可以在「检索」页手动测试。

### agent 工具 `knowledge_search`

```
knowledge_search(query, { workspace?, kbId?, topK? })
```

- `query`：检索问题（必填）。
- `workspace`：按此工作区已启用的知识库检索（推荐）。
- `kbId`：只检索某个知识库（优先于 workspace）。
- `topK`：返回条数。

返回每个命中块的知识库/文件名/文本/相似度/重排分。

---

## 配置 / Configuration

面板「配置」页（持久化到插件自身的 SQLite）：

| 字段 | 说明 | 默认 |
|---|---|---|
| `endpointBaseUrl` | OpenAI 兼容接口地址（含 `/v1`） | `http://127.0.0.1:1234/v1` |
| `embeddingModel` | 嵌入模型名 | `text-embedding-bge-m3` |
| `apiKey` | 可选 API Key | `''` |
| `rerankModel` | 可选重排模型名，空 = 关闭 | `''` |
| `rerankEndpoint` | 可选重排接口地址，空 = 用上面那个 | `''` |
| `chunkSize` | 分块大小（字符） | `1200` |
| `chunkOverlap` | 分块重叠（字符） | `150` |
| `defaultTopK` | 默认检索条数 | `5` |
| `stripMarkup` | 导入时是否剥离 HTML 标签 | `true` |

### 目录 / Data layout

数据放在 `$DSH_HOME/data/dsh-knowledge/`（可用 cordis 行 `config.dataDir` 覆盖）：

```
data/dsh-knowledge/
  knowledge.sqlite      # 知识库/文件/分块/向量/挂载 的 SQLite 数据库
  files/<kbId>/<fileId>/<name>   # 原始上传文件的副本
```

---

## 从源码构建 / Build from source

```bash
pnpm install
pnpm build       # build:host (tsc -> lib/) + build:client (tsdown -> client/client.js)
pnpm test        # 运行核心自测（需本地 LM Studio 提供 /v1/embeddings）
```

输出：`lib/`（宿主侧）+ `client/client.js`（浏览器侧）+ `cordis.patch.yml`。

---

## 架构 / Architecture

- **宿主侧** `src/index.ts`（函数插件）：注册 `knowledge_search` 工具、同源 `/knowledge/*` HTTP 路由、打开引擎。
  - `src/core/*`：**纯 Node、无 DSH 依赖** 的知识引擎（文件提取/编码/分块/嵌入/向量检索/重排/SQLite 存储）。
  - `src/routes.ts`：REST 路由（config/bases/files/mounts/search）。
  - `src/tool.ts`：`knowledge_search` 工具。
- **浏览器侧** `src/client/*`：`sidebar.footer.action` 入口 + 面板抽屉，以及 `settings.section` 设置页。
- **IPC**：浏览器侧通过 `fetch('/knowledge/...')` 调用宿主同源路由（DSH 自带网关承载）。
- **无外部运行时依赖**：只用 `node:sqlite`、`node:zlib`、`node:util`(TextDecoder)。

---

## License

MIT
