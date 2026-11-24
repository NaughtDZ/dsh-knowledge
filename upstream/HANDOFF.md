# dsh-knowledge 项目交接文档

> 面向接手开发者的工程说明。产品功能与用户手册见 [README.md](README.md)；本文讲**怎么改、怎么发、哪里会踩坑**。
>
> 本文档基于 **2026-11-24** 的仓库状态撰写，若与代码不符，**以代码为准**，并请顺手更新本文。

---

## 1. 这是什么

一个 **DeepSeek Harness（DSH）外部插件**，给 agent 提供知识库 / RAG 能力：

- 导入 Office（docx/pptx/xlsx，doc/ppt/xls 尽力而为）与文本（txt/md/csv/html/json）文件
- 通过**任意 OpenAI 兼容的 `/v1/embeddings` 端点**（LM Studio、Ollama、托管服务）向量化
- 一个知识库装多个文件；按**工作区**选择性挂载
- agent 运行时通过 `knowledge_search` 工具做向量检索（可选 rerank）
- 设置页里有一个完整的管理面板（导入、进度条、停止、重量化、挂载）

### 两个决定性技术选择（改代码前必须知道）

| 选择 | 原因 |
|---|---|
| **零运行时依赖**：只用 `node:sqlite` / `node:zlib` / `node:util`(TextDecoder) / 内置 `fetch` | 插件直接装进 profile，不引入任何第三方包，避免版本冲突与供应链风险。**新增依赖要慎之又慎** |
| **宿主机只依赖 DSH 的公共 API**：`ctx.tools.register` + `ctx.webServer.register` + `settings.section` 插槽 | 不做私有 API 依赖，降低跨 DSH 版本的断裂面 |

---

## 2. 当前状态快照

| 项 | 值 |
|---|---|
| 插件版本 | **0.1.2**（`aa580aa`） |
| 仓库 | `NaughtDZ/dsh-knowledge`（公开） |
| 开发时 DSH 版本 | **0.2.2-rc.1** |
| 声明的 DSH 兼容范围 | `>=0.1.2-alpha.4 <0.2.0-0 \|\| >=0.2.0-rc.0 <0.3.0-0` |
| Node 要求 | `>=22.19`（`node:sqlite` 与完整 ICU 需要） |
| 安装方式 | `github:NaughtDZ/dsh-knowledge`（track 默认分支） |
| 已验证能力 | 导入 / 向量化 / 检索 / 挂载 / 体积重算 / 停止 / 卸载清理，均在本机实测通过 |

> **构建产物（`lib/`、`client/`）是提交进仓库的**，原因见 §11。

---

## 3. 五分钟上手

```bash
# 1. 取代码
git clone https://github.com/NaughtDZ/dsh-knowledge.git
cd dsh-knowledge

# 2. 装开发依赖并构建
pnpm install
pnpm build          # tsc -> lib/ ；tsdown -> client/client.js

# 3. 自测（需要本地有 /v1/embeddings 服务，见下）
pnpm test           # tsx scripts/selftest.ts

# 4. 装进正在用的 DSH profile
dsh plugin --profile web add github:NaughtDZ/dsh-knowledge
# 或从本地目录装（会走 pnpm 的 file:/link: 语义，注意 §13.3）

# 5. 重启该 profile，然后验证
node scripts/verify-dsh-compat.mjs
```

**外部服务**：默认配置指向 `http://127.0.0.1:1234/v1`（LM Studio），嵌入模型 `text-embedding-qwen3-embedding-0.6b`。没有它时导入会失败，但插件本身照常加载、面板能打开。

---

## 4. 仓库结构

```
dsh-knowledge/
├── src/
│   ├── index.ts              宿主入口：注册 tool、挂载路由、开引擎、管生命周期
│   ├── config.ts             数据目录解析 + 遗留目录迁移 + schemastery Config
│   ├── routes.ts             /knowledge/* 的 REST 路由分发（单 prefix 路由）
│   ├── http.ts               路由层小工具（JSON/裸 body、同源校验、错误）
│   ├── tool.ts               knowledge_search 工具定义
│   ├── core/                 ── 纯 Node，无任何 DSH import ──
│   │   ├── engine.ts         知识引擎门面（导入/检索/重量化/挂载/操作进度）
│   │   ├── store.ts          SQLite 存取（node:sqlite DatabaseSync）
│   │   ├── extract.ts        文档 → 纯文本（ZIP+XML / OLE2 / 编码检测）
│   │   ├── encoding.ts       ANSI/UTF-8 检测与解码（全 ICU TextDecoder）
│   │   ├── zip.ts            最小 ZIP 读取器（inflateRawSync）
│   │   ├── xml.ts            最小 XML 解析（docx/pptx/xlsx 用）
│   │   ├── chunk.ts          分块（段落聚合 + 重叠 + 超长硬切）
│   │   ├── embed.ts          OpenAI 兼容 /embeddings 客户端 + cosine
│   │   ├── rerank.ts         可选 /rerank 客户端（不可用时返回 null）
│   │   ├── search.ts         余弦 top-K
│   │   └── types.ts          共享类型（无 DSH 依赖）
│   └── client/               ── 浏览器侧（React，CJS bundle）──
│       ├── index.ts          注册 settings.section 插槽
│       ├── panel.tsx         管理面板（config / bases / search 三个 tab）
│       ├── api.ts            fetch 封装
│       └── i18n.ts           中英文案
├── scripts/                  验证与运维脚本（见 §12）
│   └── lib/semver-lite.mjs   零依赖 semver 兜底（仅 verify-dsh-compat 用）
├── lib/                      【提交】tsc 产物（宿主侧）
├── client/client.js          【提交】tsdown 产物（浏览器侧）
├── cordis.patch.yml          把插件插入 profile 层栈
├── tsconfig.json             宿主侧编译（NodeNext）
├── tsconfig.client.json      客户端类型检查（Bundler + jsx）
├── tsdown.config.mjs         客户端打包（输出 __ModuleLoader__.load 工厂）
└── package.json              清单（注意 peerDependencies，见 §13.1）
```

`src/core/**` 不 import 任何 `@deepseek-ai/*`——**这是刻意的**：它可以在没有 DSH 的环境里单独跑（`scripts/verify-built.mjs` 就是这么测的）。保持这条边界。

---

## 5. 架构与加载链路

```
            ┌──────────────────────── DSH 宿主进程 ────────────────────────┐
profile ──▶ │ cordis.patch.yml  insert row { id: knowledge, name: dsh-knowledge }
            │        │
            │        ▼
            │  src/index.ts  apply(ctx, config)
            │        ├── resolveConfig() + migrateLegacyDataDir()
            │        ├── new KnowledgeEngine({ dbPath, filesRoot })
            │        ├── ctx.effect → registerKnowledgeTool()   → ctx.tools
            │        └── ctx.inject(['webServer']) → mountKnowledgeRoutes()
            │                                   → webServer.register(prefix /knowledge)
            └────────────────────────────────┬──────────────────────────────┘
                                             │ 同源 fetch
            ┌────────────────────────────────▼──────────────────────────────┐
            │ 浏览器：client/client.js  （__ModuleLoader__ 工厂）
            │  apply(ctx) → ctx.slots.inject('settings.section', …)
            │  React 面板 → fetch('/knowledge/...')
            └───────────────────────────────────────────────────────────────┘
```

**客户端为什么走 HTTP 而不是 Typert remote**：面板与宿主同源，`fetch('/knowledge/*')` 最简单、无类型生成步骤、无跨版本协议风险。代价是没有编译期类型校验，`src/client/api.ts` 是唯一的契约层。

**生命周期**：全部注册都挂在 `ctx.effect` 上，插件卸载时自动摘除路由、注销工具、关闭 SQLite 句柄。**新增注册必须同样放到 effect 里**，否则会泄漏。

---

## 6. 数据模型

### 6.1 落盘位置

```
<DSH_HOME>/data/dsh-knowledge/          # DSH_HOME 缺省 = ~/.dsh
├── knowledge.sqlite                     # 全部元数据 + 向量（WAL 模式）
├── knowledge.sqlite-wal / -shm
└── files/<kbId>/<fileId>/<safeName>     # 原始上传文件副本
```

`DSH_HOME` 与目录都可用 cordis 行的 `config.dataDir` / `config.filesRoot` 覆盖（默认空 = 用上面的路径）。

### 6.2 SQLite schema（`src/core/store.ts`）

| 表 | 关键列 | 说明 |
|---|---|---|
| `knowledge_bases` | `id`(uuid), `name`, `description`, `created_at`, `updated_at` | 文件数/分块数是查询时聚合的，不落列 |
| `files` | `id`, `kb_id`→FK CASCADE, `name`, `ext`, `kind`, `rel_path`, `size`, `encoding`, `line_ending`, `char_count`, `chunk_count`, `status`, `error`, `embedding_model`, `embedding_dim` | `status ∈ pending/indexing/ready/failed` |
| `chunks` | `id`, `file_id`→FK CASCADE, `kb_id`, `idx`, `text`, `dim`, `vector BLOB`, `size`, `heading`, `created_at` | `idx` 是文件内序号；`heading` 预留给分段溯源 |
| `mounts` | PRIMARY KEY(`kb_id`,`workspace_id`), `enabled`, `note`, `created_at` | 工作区 ↔ 知识库 |
| `settings` | `id` 固定为 1, `json` | 单行 KV，存插件运行配置（端点/模型/分块参数） |

**向量存储格式**：`Float32Array` 的原始字节写入 BLOB，读回时 `Array.from(new Float32Array(buf))`。**不是 JSON**，改这里要注意字节序与长度（`dim × 4`）。

**注意（重要）**：schema 里写了 `ON DELETE CASCADE`，但 `store.ts` **没有开启 `PRAGMA foreign_keys`**（只设了 `journal_mode = WAL`，而 SQLite 外键默认关闭），所以级联**实际不生效**。删除完全依赖显式 SQL：`store.deleteBase` 依次删 `files` → `chunks` → `mounts` → `knowledge_bases`；`store.deleteFile` 先删 `chunks` 再删 `files`。**新增表或新增删除路径时必须自己补齐顺序**，否则会留下孤儿行。

---

## 7. HTTP API（`src/routes.ts`）

单条 prefix 路由 `/knowledge`。**所有请求都过 `sameOrigin()` 校验**（有 `Origin` 时必须与 `Host` 同源，否则 403）。错误统一 `{ error: string }`。

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/knowledge` 或 `/knowledge/config` | — | `KnowledgeConfig` |
| POST | `/knowledge/config` | 配置补丁对象 | 保存后的 `KnowledgeConfig` |
| POST | `/knowledge/config/test` | `{endpointBaseUrl?,embeddingModel?,apiKey?}` | `{ok,dim,latencyMs,model}` 或 `{ok:false,error,…}` |
| GET | `/knowledge/bases` | — | `KnowledgeBase[]` |
| POST | `/knowledge/bases` | `{name,description?}` | 新建的 `KnowledgeBase` |
| POST | `/knowledge/bases/delete` | `{id}` | `{ok:true}` |
| GET | `/knowledge/files` | query `kbId`（必填） | `KnowledgeFile[]` |
| POST | `/knowledge/files` | query `kbId`,`name`；body = **原始字节** | `ImportResult` |
| POST | `/knowledge/files/delete` | `{fileId}` | `{ok:true}` |
| GET | `/knowledge/mounts` | — | `WorkspaceMount[]` |
| POST | `/knowledge/mounts` | `{kbId,workspaceId,enabled?,note?}` | `WorkspaceMount` |
| POST | `/knowledge/mounts/delete` | `{kbId,workspaceId}` | `{ok:true}` |
| GET | `/knowledge/workspaces` | — | `{id,title,path}[]`（来自宿主的 workspaceRegistry） |
| POST | `/knowledge/search` | `{query,kbIds?,workspaceId?,topK?,useRerank?}` | `{query,count,hits[]}` |
| GET | `/knowledge/health` | — | `{ok:true,baseCount,fileCount}` |
| GET | `/knowledge/operations` | — | `OperationView[]`（进度/状态） |
| POST | `/knowledge/operations/stop` | `{operationId}` | `{ok:boolean}` |
| POST | `/knowledge/stop` | — | `{ok:true,stopped:n}` |
| POST | `/knowledge/reindex` | `{kbId}` | `{operationId}` |
| POST | `/knowledge/reindex-all` | — | `{operationId}` |

`topK` 在路由层被夹到 `≤20`。

**上传没有显式大小限制**（`readRawBody` 全量读进内存）。导入超大文件时注意内存；若要做限制，在这里加。

---

## 8. 模型工具 `knowledge_search`（`src/tool.ts`）

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string（必填） | 检索文本 |
| `workspace` | string | 按工作区限定（用该工作区已挂载的库） |
| `kbId` | string | 指定单个库，**覆盖** `workspace` |
| `topK` | integer | 默认用配置值，夹到 ≤20 |

- 始终 `useRerank: true`（配置了重排模型时才真正生效，见 §13.5）
- 输出是 `{query,count,hits[]}` 的 **JSON 文本**（`render` 里 `JSON.stringify`），命中含 `kbName`/`fileName`/`text`/`score`/`rerankScore?`
- 尊重 `exec.signal`（导入/检索可被中断）

---

## 9. 配置项（`KnowledgeConfig`，存 `settings` 表）

| 字段 | 默认 | 说明 |
|---|---|---|
| `endpointBaseUrl` | `http://127.0.0.1:1234/v1` | OpenAI 兼容端点（含 `/v1`） |
| `embeddingModel` | `text-embedding-qwen3-embedding-0.6b` | 嵌入模型 id |
| `apiKey` | `''` | 可选 Bearer token |
| `rerankModel` | `qwen3-reranker-0.6b` | 空 = 关闭重排 |
| `rerankEndpoint` | 同 `endpointBaseUrl` | 重排端点（缺 `/rerank` 时自动降级） |
| `chunkSize` | `1200` | 分块字符数 |
| `chunkOverlap` | `150` | 块间重叠字符数 |
| `defaultTopK` | `8` | 检索默认条数 |
| `stripMarkup` | `true` | 导入时剥离 HTML 标签 |

> `config.ts` 里的 `Config`（`dataDir`/`filesRoot`）是**另一套**：它来自 cordis 行配置，只决定数据落在哪；运行参数在 SQLite 里、由面板编辑。**别把两者搞混。**

---

## 10. 核心流程与关键参数

### 10.1 导入（`engine.importFile`）

```
bytes → 落盘 files/<kbId>/<fileId>/<safeName>
     → extract()      文档 → 纯文本（记录 encoding / lineEnding / degraded）
     → chunkText()    段落聚合分块（超长段落硬切）
     → embedBatched() 每批 8 条 → /v1/embeddings
     → store.replaceChunks()  向量以 Float32 BLOB 落库
     → 更新 files.status = ready
```

- **每批 8 条**是刻意的：让进度条在单文件内也能平滑推进（`onProgress(chunkTotal, chunkDone)`）。
- 任一步失败 → `status='failed'` + `error` 落库，文件仍可见。
- 导入在**操作表**里登记，可被 `/knowledge/operations/stop` 中断；中断后不会留下半库（`replaceChunks` 是整文件替换）。

### 10.2 检索（`engine.search`）

```
kbIds 解析：kbId 直传 > workspaceId → workspaceKbIds() > 全部库
query → embedText() → searchCandidates(kbIds, limit=10000)
      → 余弦 top-K（candidateK = max(topK*4, 20)）
      → 若配置了 rerankModel 且 useRerank !== false → POST /rerank 重排
      → slice(0, topK)
```

- **候选上限 10000 chunk**：超过此数的库只有前 1 万条参与打分。这是当前最大的性能/正确性边界，见 §15。
- 重排失败（端点不存在/非 2xx/解析失败）**静默降级**为余弦排序，`rerankScore` 全为 0。这是设计行为，不是 bug。

### 10.3 重量化（`engine.reindexBase` / `reindexAll` / `reembedFile`）

- 用途：换嵌入模型后重算向量（维度变化时必须做）
- 返回 `operationId`，进度通过 `activeOperations()` 读
- 可单独停某一个（`stopOperation`）或全停（`stopAll`）

---

## 11. 构建、提交与发布

### 构建

```bash
pnpm build:host     # tsc -p tsconfig.json        → lib/
pnpm build:client   # tsdown -c tsdown.config.mjs → client/client.js
pnpm typecheck      # 两套 tsconfig 都过一遍
```

**客户端打包的特殊之处**（`tsdown.config.mjs`）：产物必须是 DSH 的 `__ModuleLoader__.load({id, factory})` 工厂形态，所以配置里手工加了 `banner`/`intro`/`footer` 把 CJS 包起来，并且把 `react`、`@deepseek-ai/dsh-client-ui-*` 等列为 **externals**（由宿主平台模块表提供，不能打进 bundle）。

### 为什么构建产物要提交

`pnpm` 默认**禁止 git 依赖执行构建脚本**（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）。因此本仓库：

- **没有** `prepare` 脚本（曾经有，踩坑后删掉了）
- `lib/` 与 `client/` **提交进 git**，git 安装直接拿到可用产物

> **改完源码必须 `pnpm build` 并一起提交 `lib/`、`client/`**，否则远端装到的是旧代码。

### 版本发布流程

```bash
# 1. 改 package.json version（语义化）
# 2. 重建并确认产物已更新
pnpm build
node scripts/verify-dsh-compat.mjs     # 必须全 PASS
# 3. 提交（含 lib/ client/）
git add -A && git commit -m "feat: …"
git push origin main
# 4. 更新已装实例（git 依赖默认跟默认分支）
dsh plugin --profile web update dsh-knowledge
# 5. 重启该 profile
```

---

## 12. 测试与验证脚本

全部是**可独立运行**的脚本，不依赖测试框架：

| 脚本 | 需要已构建 | 需要外部服务 | 作用 |
|---|---|---|---|
| `scripts/selftest.ts` | 否（直接跑 src） | **是**（嵌入端点） | 核心引擎自测：docx/pptx/xlsx 夹具、编码、分块、检索 |
| `scripts/verify-built.mjs` | 是 | 否（用桩） | 建库→导入 in-memory docx→挂载→检索，跑**已构建的** `lib/` |
| `scripts/verify-routes.mjs` | 是 | 否 | 用假 webServer 验证 `/knowledge` 路由注册与分发 |
| `scripts/verify-tool.mjs` | 是 | 否 | 验证 `knowledge_search` 注册；用真 cordis 上下文跑 `apply` |
| `scripts/verify-ops.mjs` | 是 | 否 | 重量化、进度、停止、删除清理 |
| `scripts/verify-datadir.mjs` | 是 | 否 | 数据目录恒为绝对路径 + 遗留目录迁移 |
| `scripts/verify-dsh-compat.mjs` | 否\* | 可选 | **DSH 兼容性体检**（见 §13.1）。\*不构建也能跑；`lib/` 缺失时会跳过数据目录检查 |
| `scripts/uninstall-cleanup.mjs` | 否 | 否 | 卸载时删数据目录（挂在 `uninstall`/`postuninstall`） |

**手工验收清单**（本机实测过的路径，改 UI 后建议全过一遍）：

1. 设置里出现「知识库」页，能打开
2. 配置页填端点 → 「测试连接」返回维度
3. 新建知识库 → 导入多个文件 → 进度条推进 → 可「停止」
4. 文件列表显示 `ready` 与 chunk 数
5. 「重新量化」单库 / 「全部重新量化」都能跑并显示进度
6. 挂载页：下拉选工作区 → 勾选库 → 成为已挂载
7. 检索页手动搜一次，有命中与分数
8. 让 agent 调 `knowledge_search`，返回结构化命中

---

## 13. 已知陷阱（血泪教训，务必读）

### 13.1 DSH ≥ 0.2 的插件版本校验 —— 最容易被静默坑死

DSH 在加载 bundle **之前**会校验 `package.json` 里所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 `peerDependencies`，**不满足就静默跳过该 bundle**（不报错、不失败，插件直接"消失"）。

两个方向都会出错：

| 陷阱 | 例子 | 后果 |
|---|---|---|
| **下界漏报** | `^0.1.2-alpha.4` 展开成 `>=0.1.2-alpha.4 <0.2.0-0` | 排除 `0.2.0-rc.1` 等全部 0.2.0 预发布 → 新 DSH 上插件消失 |
| **上界泄漏** | `<0.3.0` 仍然接受 `0.3.0-rc.1`（预发布排序低于同号正式版） | 未验证的下一条线的预发布被放行 → 隐患 |

**正确写法**（当前采用）：

```
>=0.1.2-alpha.4 <0.2.0-0 || >=0.2.0-rc.0 <0.3.0-0
```

`-0` 是该线最小的预发布版，只有它才能真正封住整条线。

**DSH 升 minor 版时必须做的事**：把上界补一段（如 `|| >=0.3.0-rc.0 <0.4.0-0`）、升插件版本、重新发布。否则插件会静默消失。

**体检命令**（会直接报出上面两类问题）：

```bash
node scripts/verify-dsh-compat.mjs
```

### 13.2 数据目录绝不能是相对路径

早期版本在 `DSH_HOME` 未设置时回退成相对路径 `./dsh-knowledge`，结果写进了 DSH 检出目录（`L:\deepseek-harness\dsh-knowledge`）。

现在 `defaultDataDir()` 恒为绝对路径（`$DSH_HOME` 否则 `~/.dsh`），并且 `migrateLegacyDataDir()` 会在启动时把遗留目录搬走。**任何新的路径逻辑都必须保持绝对路径**。

### 13.3 pnpm 硬链接：不要手改 `node_modules` 里的文件

profile 里装好的文件是指向 pnpm store 的**硬链接**（`fsutil hardlink list` 可验证）。`Copy-Item`/就地写入会**写穿同一个 inode**，污染 store 并破坏可复现性。

- 替换插件请走 `dsh plugin --profile web add|update <spec>`
- 只想本地调试而绕开 pnpm 时，至少要知道：**下一次 `pnpm install` 会把你的改动覆盖掉**

顺带：`link:<路径>` 是**真符号链接**（源码改动立即生效，但路径一挪就坏）；`file:`/裸路径是**硬链接拷贝**（不跟源码）。

### 13.4 构建产物必须提交

见 §11。忘了这一步，`dsh plugin update` 装到的是旧构建。

### 13.5 rerank 端点是可选能力，不要当必需

LM Studio 某些版本**没有** `/v1/rerank`（返回 `{"error":"Unexpected endpoint or method"}`）。此时：

- `rerank()` 收到非 2xx / 解析失败 → 返回 `null`
- `engine.search` 保持余弦分数，`rerankScore` 全 0

这是**预期降级**。想要真重排，需换支持 `/rerank` 的后端（llama.cpp server / vLLM / Jina 兼容服务）。

### 13.6 编码检测不能只看"能不能解码"

GBK/ANSI 文本用 windows-1252 也能解码（变成乱码但不报错）。`encoding.ts` 里用「解出的中文占比」这类质量分挑编码，别退化成"第一个能解码的就行"。

### 13.7 OLE2（doc/xls/ppt）与 PDF 是尽力而为

- doc/ppt/xls：从 OLE2 容器里抽可读文本，**保真度有限**，`degraded: true`
- pdf：当前**不解析**，返回空文本 + `degraded: true`（文件仍会入库，只是 0 chunk）

改这块前先确认用户是否真的需要（Office 的 OOXML 三种已完整支持）。

### 13.8 工作区 ID 与迁移

`mounts` 按 `workspace_id` 存。工作区记录在 `~/.dsh/storages/workspace.json` 里**按路径**成立、ID 是随机 UUID。**工作区目录一挪，DSH 会生成新的 workspace_id，旧挂载就失效**——需要重新挂载（不会报错）。

### 13.9 profile 的 pnpm 供应链策略

profile 可能开了 `minimumReleaseAge`（新发布的包要等够时间才允许装）。`dsh plugin update` 会解析整个依赖图，**可能因为其它插件的新版本太新而整体失败**，与本插件无关。看到 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 先判断是哪个包，别怀疑本插件。

### 13.10 改了 `devDependencies` 必须重新 `pnpm install`

`pnpm-lock.yaml` 里每个依赖的 `specifiers` 必须与 `package.json` 一致，否则 `pnpm install --frozen-lockfile`（CI 常用）会直接失败。本仓库就发生过「改了 devDeps 的版本范围但没重装」的失配。

重装后 lockfile 可能额外补上一批 `deprecated:` 备注行——那是 pnpm 记录的 npm 废弃提示，**无害**，一起提交即可。

---

## 14. 排障手册

| 症状 | 先查 | 处置 |
|---|---|---|
| 设置里没有「知识库」，`/knowledge/health` 返回 404 | `node scripts/verify-dsh-compat.mjs`；`dsh --profile <p> --dump-config 2>&1 \| Select-String 'skipping profile bundle'` | 修 peer 范围并重新发布（§13.1）；或临时 `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <ver> --accept-risk` |
| 导入报错 / 0 chunk | 配置页「测试连接」；`files.status`/`error` 字段 | 端点/模型名不对；或文件是 PDF/OLE2（§13.7） |
| 检索无结果 | 库是否已挂到当前工作区；`chunks` 表是否有向量（`dim>0`） | 挂载（§13.8）；或重新量化 |
| 检索分数全是 0 | 查询与文档的 `embedding_dim` 是否一致 | 换模型后必须「全部重新量化」 |
| 数据"不见了" | `<DSH_HOME>/data/dsh-knowledge/knowledge.sqlite` 是否存在；`DSH_HOME` 是否被改过 | 见 §13.2；迁移逻辑只在启动时跑一次 |
| 卸载后数据还在/已消失 | `scripts/uninstall-cleanup.mjs` 是否执行 | 它在 `uninstall`/`postuninstall` 里删数据目录；手动删也能达到目的 |

---

## 15. 当前限制与可扩展方向

按价值排序，供接手者挑活：

1. **向量检索是暴力扫描**：`searchCandidates` 一次取 ≤10000 条全部算余弦。库更大时应上 ANN 索引（如 sqlite-vec、或自建 HNSW）。**这是最值得做的一项。**
2. **PDF 不支持**：接入 `pdfjs` 或外部转换会引入依赖，需权衡"零依赖"原则。
3. **doc/xls/ppt 保真度低**：考虑可选地调用 LibreOffice 转换（会引入外部进程）。
4. **无增量去重**：同一文件重复导入会产生重复 chunk；可按内容 hash 去重。
5. **上传无大小限制**：`readRawBody` 全量进内存。
6. **测试无单元框架**：目前靠 `scripts/verify-*.mjs`，没有 vitest/jest。要长期维护建议补一套。
7. **i18n 仅中/英**，且文案在 `client/i18n.ts` 里手写。
8. **未在 macOS/Linux 实测**：代码是纯 Node，理论上跨平台，但 `dsh.bundle.platforms` 未声明（缺省即全平台放行）。
9. **挂载是一次一个工作区**：可加"把一个库挂到多个工作区"的批量操作。

---

## 16. 接手检查表

- [ ] 跑通 §3 的五步，`verify-dsh-compat.mjs` 全 PASS
- [ ] 跑 `pnpm test`（需要嵌入端点）与 `scripts/verify-*.mjs` 全绿
- [ ] 读 §13 十条陷阱
- [ ] 确认你能回答：改完代码为什么必须提交 `lib/`+`client/`？
- [ ] 确认你能回答：DSH 升到 0.3.x 时本插件会发生什么、要改哪两处？
- [ ] 记录当前 `DSH 版本`、`插件版本`、`commit`，作为你的基线

---

## 附：关键文件速查

| 想改什么 | 去哪 |
|---|---|
| 新增/修改 HTTP 接口 | `src/routes.ts`（记得同步 `src/client/api.ts`） |
| 改检索排序逻辑 | `src/core/engine.ts:search` + `src/core/search.ts` |
| 改分块策略 | `src/core/chunk.ts` |
| 加文档格式 | `src/core/extract.ts` |
| 改编码判定 | `src/core/encoding.ts` |
| 改表结构 | `src/core/store.ts:migrate`（**注意已有数据迁移**） |
| 改面板 UI | `src/client/panel.tsx` |
| 改工具描述/参数 | `src/tool.ts` |
| 改兼容范围 | `package.json` 的 `peerDependencies`（读 §13.1） |

---

*文档由开发交接生成，最后更新：2026-11-24。发现不符请以代码为准并回写本文。*
