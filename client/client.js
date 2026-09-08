window.__ModuleLoader__.load({
	id: "dsh-knowledge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/i18n.ts
		const dictionary = {
			zh: {
				title: "知识库",
				tabConfig: "配置",
				tabBases: "知识库",
				tabSearch: "检索",
				configTitle: "向量化配置",
				configEndpoint: "OpenAI 兼容接口地址",
				configModel: "嵌入模型",
				configApiKey: "API Key（可选）",
				configRerankModel: "重排模型（可选）",
				configRerankEndpoint: "重排接口地址（可选）",
				configChunkSize: "分块大小（字符）",
				configChunkOverlap: "分块重叠（字符）",
				configTopK: "默认检索条数",
				configStripMarkup: "提取时去除 HTML 标签",
				save: "保存",
				saving: "保存中…",
				saved: "已保存",
				testConnection: "测试连接",
				testing: "测试中…",
				testOk: (s) => s ? `连接成功：${s}` : "连接成功",
				testFail: "连接失败",
				basesTitle: "知识库列表",
				createBase: "新建知识库",
				baseNamePlaceholder: "知识库名称",
				create: "创建",
				delete: "删除",
				empty: "暂无数据",
				importFiles: "导入文件到当前知识库",
				importHint: "支持 doc/docx/ppt/pptx/xls/xlsx/txt/md/csv/html。",
				files: "文件",
				statusReady: "就绪",
				statusIndexing: "处理中",
				statusPending: "等待中",
				statusFailed: "失败",
				mountsTitle: "工作区挂载",
				mountWorkspace: "工作区 ID",
				mountKb: "知识库",
				mountEnable: "启用",
				mountAdd: "添加挂载",
				searchPlaceholder: "输入要检索的问题…",
				search: "检索",
				searching: "检索中…",
				noBase: "请先选择一个知识库",
				loading: "加载中…",
				close: "关闭"
			},
			en: {
				title: "Knowledge Base",
				tabConfig: "Config",
				tabBases: "Knowledge Bases",
				tabSearch: "Search",
				configTitle: "Embedding Configuration",
				configEndpoint: "OpenAI-compatible endpoint",
				configModel: "Embedding model",
				configApiKey: "API Key (optional)",
				configRerankModel: "Rerank model (optional)",
				configRerankEndpoint: "Rerank endpoint (optional)",
				configChunkSize: "Chunk size (chars)",
				configChunkOverlap: "Chunk overlap (chars)",
				configTopK: "Default top K",
				configStripMarkup: "Strip HTML tags on import",
				save: "Save",
				saving: "Saving…",
				saved: "Saved",
				testConnection: "Test connection",
				testing: "Testing…",
				testOk: (s) => s ? `Connected: ${s}` : "Connected",
				testFail: "Connection failed",
				basesTitle: "Knowledge bases",
				createBase: "New knowledge base",
				baseNamePlaceholder: "Knowledge base name",
				create: "Create",
				delete: "Delete",
				empty: "Nothing here yet",
				importFiles: "Import files into this base",
				importHint: "Supports doc/docx/ppt/pptx/xls/xlsx/txt/md/csv/html.",
				files: "Files",
				statusReady: "Ready",
				statusIndexing: "Indexing",
				statusPending: "Pending",
				statusFailed: "Failed",
				mountsTitle: "Workspace mounts",
				mountWorkspace: "Workspace ID",
				mountKb: "Knowledge base",
				mountEnable: "Enabled",
				mountAdd: "Add mount",
				searchPlaceholder: "Type a question to search…",
				search: "Search",
				searching: "Searching…",
				noBase: "Select a knowledge base first",
				loading: "Loading…",
				close: "Close"
			}
		};
		function getLang() {
			return globalThis.localStorage?.getItem("dsh-knowledge-lang") === "en" ? "en" : "zh";
		}
		/** Build a t() that returns zh/en strings, falling back to the key. */
		function makeT(lang) {
			const dict = dictionary[lang] ?? dictionary.zh;
			return (key, arg) => {
				const value = dict[key];
				return typeof value === "function" ? value(arg) : value ?? key;
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Same-origin HTTP helpers for the dsh-knowledge panel. All calls go to the
		* plugin's own `/knowledge` API routes.
		*/
		async function json(response) {
			const text = await response.text();
			const body = text === "" ? {} : JSON.parse(text);
			if (!response.ok) {
				const err = body.error;
				throw new Error(err ?? `HTTP ${response.status}`);
			}
			return body;
		}
		async function getJson(path) {
			return json(await fetch(`/knowledge${path}`, { headers: { accept: "application/json" } }));
		}
		async function postJson(path, body) {
			return json(await fetch(`/knowledge${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				body: JSON.stringify(body ?? {})
			}));
		}
		/** Upload raw file bytes to import into a knowledge base. */
		async function uploadFile(kbId, name, bytes) {
			return json(await fetch(`/knowledge/files?kbId=${encodeURIComponent(kbId)}&name=${encodeURIComponent(name)}`, {
				method: "POST",
				headers: {
					"content-type": "application/octet-stream",
					accept: "application/json"
				},
				body: bytes
			}));
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* The dsh-knowledge browser panel: configuration, knowledge-base & file
		* management, workspace mounts, and a live search test. Pure React with
		* inline styles (theme-agnostic) so it needs no CSS build step.
		*/
		const STYLES = {
			container: {
				width: "100%",
				display: "flex",
				flexDirection: "column",
				fontSize: 13,
				color: "var(--dsw-alias-label-primary, #d4d4d4)",
				background: "var(--dsw-alias-bg-layer-1, #1e1e1e)"
			},
			header: {
				padding: "12px 16px",
				borderBottom: "1px solid var(--dsw-alias-border, #333)",
				display: "flex",
				alignItems: "center",
				gap: 12
			},
			title: {
				fontSize: 16,
				fontWeight: 600
			},
			tabs: {
				display: "flex",
				gap: 4,
				padding: "8px 16px",
				borderBottom: "1px solid var(--dsw-alias-border, #2a2a2a)"
			},
			tab: {
				padding: "6px 14px",
				borderRadius: 6,
				cursor: "pointer",
				background: "transparent",
				color: "var(--dsw-alias-label-secondary, #999)",
				border: "1px solid transparent"
			},
			tabActive: {
				background: "var(--dsw-alias-bg-layer-2, #333)",
				color: "var(--dsw-alias-label-primary, #eee)",
				border: "1px solid var(--dsw-alias-border, #555)"
			},
			body: { padding: "12px 16px" },
			section: { marginBottom: 16 },
			label: {
				display: "block",
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary, #999)",
				margin: "8px 0 4px"
			},
			field: {
				width: "100%",
				padding: "8px 10px",
				borderRadius: 6,
				border: "1px solid var(--dsw-alias-border, #444)",
				background: "var(--dsw-alias-bg-layer-2, #222)",
				color: "var(--dsw-alias-label-primary, #eee)",
				boxSizing: "border-box"
			},
			button: {
				padding: "6px 14px",
				borderRadius: 6,
				border: "1px solid var(--dsw-alias-border, #555)",
				background: "var(--dsw-alias-bg-layer-3, #2a2a2a)",
				color: "var(--dsw-alias-label-primary, #eee)",
				cursor: "pointer"
			},
			buttonPrimary: {
				background: "#4f6ef7",
				border: "1px solid #4f6ef7",
				color: "#fff"
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 0",
				borderBottom: "1px solid var(--dsw-alias-border, #2a2a2a)"
			},
			chip: {
				padding: "2px 8px",
				borderRadius: 10,
				fontSize: 11,
				background: "var(--dsw-alias-bg-layer-3, #333)",
				color: "var(--dsw-alias-label-secondary, #aaa)"
			},
			statusChip: (status) => ({
				padding: "2px 8px",
				borderRadius: 10,
				fontSize: 11,
				background: status === "ready" ? "#1f6f3f" : status === "failed" ? "#7f2a2a" : "#555"
			}),
			hint: {
				fontSize: 11,
				color: "var(--dsw-alias-label-secondary, #888)",
				margin: "4px 0 0"
			},
			error: {
				color: "#e06c75",
				fontSize: 12,
				marginTop: 6
			},
			muted: {
				color: "var(--dsw-alias-label-secondary, #888)",
				fontSize: 12
			}
		};
		const DEFAULT_CONFIG = {
			endpointBaseUrl: "http://127.0.0.1:1234/v1",
			embeddingModel: "text-embedding-bge-m3",
			apiKey: "",
			rerankModel: "",
			rerankEndpoint: "",
			chunkSize: 1200,
			chunkOverlap: 150,
			defaultTopK: 5,
			stripMarkup: true
		};
		function KnowledgePanel({ t, onClose }) {
			const [tab, setTab] = (0, react.useState)("config");
			const [config, setConfig] = (0, react.useState)(DEFAULT_CONFIG);
			const [bases, setBases] = (0, react.useState)([]);
			const [mounts, setMounts] = (0, react.useState)([]);
			const [selectedBase, setSelectedBase] = (0, react.useState)(null);
			const [files, setFiles] = (0, react.useState)([]);
			const [notice, setNotice] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const loadConfig = (0, react.useCallback)(async () => {
				try {
					setConfig(await getJson("/config"));
				} catch {
					setConfig(DEFAULT_CONFIG);
				}
			}, []);
			const loadBases = (0, react.useCallback)(async () => {
				try {
					setBases(await getJson("/bases"));
				} catch {}
			}, []);
			const loadMounts = (0, react.useCallback)(async () => {
				try {
					setMounts(await getJson("/mounts"));
				} catch {}
			}, []);
			const loadFiles = (0, react.useCallback)(async (kbId) => {
				try {
					setFiles(await getJson(`/files?kbId=${encodeURIComponent(kbId)}`));
				} catch {
					setFiles([]);
				}
			}, []);
			(0, react.useEffect)(() => {
				loadConfig();
				loadBases();
				loadMounts();
			}, [
				loadConfig,
				loadBases,
				loadMounts
			]);
			(0, react.useEffect)(() => {
				if (selectedBase !== null) loadFiles(selectedBase);
				else setFiles([]);
			}, [selectedBase, loadFiles]);
			const refreshAll = (0, react.useCallback)(async () => {
				await Promise.all([loadBases(), loadMounts()]);
			}, [loadBases, loadMounts]);
			const saveConfig = (0, react.useCallback)(async () => {
				setBusy(true);
				setNotice("");
				try {
					await postJson("/config", config);
					setNotice(t("saved"));
				} catch (e) {
					setNotice(String(e));
				} finally {
					setBusy(false);
				}
			}, [config, t]);
			const testConnection = (0, react.useCallback)(async () => {
				setBusy(true);
				setNotice("");
				try {
					const r = await postJson("/config/test", config);
					setNotice(r.ok ? t("testOk", `dim=${r.dim} ${r.latencyMs}ms`) : `${t("testFail")}: ${r.error ?? ""}`);
				} catch (e) {
					setNotice(`${t("testFail")}: ${String(e)}`);
				} finally {
					setBusy(false);
				}
			}, [config, t]);
			const createBase = (0, react.useCallback)(async () => {
				const name = prompt(t("baseNamePlaceholder"));
				if (name === null || name.trim() === "") return;
				try {
					await postJson("/bases", {
						name: name.trim(),
						description: ""
					});
					await refreshAll();
				} catch (e) {
					setNotice(String(e));
				}
			}, [refreshAll, t]);
			const deleteBase = (0, react.useCallback)(async (id) => {
				if (!confirm(t("delete"))) return;
				try {
					await postJson("/bases/delete", { id });
					if (selectedBase === id) setSelectedBase(null);
					await refreshAll();
				} catch (e) {
					setNotice(String(e));
				}
			}, [
				refreshAll,
				selectedBase,
				t
			]);
			const deleteFile = (0, react.useCallback)(async (fileId) => {
				try {
					await postJson("/files/delete", { fileId });
					if (selectedBase !== null) await loadFiles(selectedBase);
				} catch (e) {
					setNotice(String(e));
				}
			}, [loadFiles, selectedBase]);
			const onImport = (0, react.useCallback)(async (e) => {
				const input = e.target;
				const file = input.files?.[0];
				if (file === void 0 || selectedBase === null) {
					input.value = "";
					return;
				}
				setBusy(true);
				setNotice("");
				try {
					const bytes = await file.arrayBuffer();
					const r = await uploadFile(selectedBase, file.name, bytes);
					setNotice(`${file.name}: ${r.chunkCount} chunks`);
					await loadFiles(selectedBase);
				} catch (err) {
					setNotice(`${file.name}: ${String(err)}`);
				} finally {
					setBusy(false);
					input.value = "";
				}
			}, [loadFiles, selectedBase]);
			const addMount = (0, react.useCallback)(async () => {
				const kbId = prompt(t("mountKb"));
				const workspaceId = prompt(t("mountWorkspace"));
				if (kbId === null || workspaceId === null || kbId.trim() === "" || workspaceId.trim() === "") return;
				try {
					await postJson("/mounts", {
						kbId: kbId.trim(),
						workspaceId: workspaceId.trim(),
						enabled: true
					});
					await loadMounts();
				} catch (e) {
					setNotice(String(e));
				}
			}, [loadMounts, t]);
			const toggleMount = (0, react.useCallback)(async (kbId, workspaceId, enabled) => {
				try {
					await postJson("/mounts", {
						kbId,
						workspaceId,
						enabled: !enabled
					});
					await loadMounts();
				} catch (e) {
					setNotice(String(e));
				}
			}, [loadMounts]);
			const setCfg = (0, react.useCallback)((patch) => setConfig((c) => ({
				...c,
				...patch
			})), []);
			const selectedBaseObj = (0, react.useMemo)(() => bases.find((b) => b.id === selectedBase), [bases, selectedBase]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: STYLES.container,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: STYLES.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: STYLES.title,
								children: t("title")
							}),
							notice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: STYLES.muted,
								children: notice
							}),
							onClose !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: {
									...STYLES.button,
									marginLeft: "auto"
								},
								onClick: onClose,
								children: t("close")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: STYLES.tabs,
						children: [
							"config",
							"bases",
							"search"
						].map((k) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: {
								...STYLES.tab,
								...tab === k ? STYLES.tabActive : {}
							},
							onClick: () => setTab(k),
							children: t(`tab${k === "config" ? "Config" : k === "bases" ? "Bases" : "Search"}`)
						}, k))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: STYLES.body,
						children: [
							tab === "config" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: STYLES.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												...STYLES.label,
												fontSize: 14,
												fontWeight: 600
											},
											children: t("configTitle")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configEndpoint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											value: config.endpointBaseUrl,
											onChange: (e) => setCfg({ endpointBaseUrl: e.target.value })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configModel")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											value: config.embeddingModel,
											onChange: (e) => setCfg({ embeddingModel: e.target.value })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configApiKey")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											type: "password",
											value: config.apiKey,
											onChange: (e) => setCfg({ apiKey: e.target.value })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configRerankModel")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											value: config.rerankModel,
											onChange: (e) => setCfg({ rerankModel: e.target.value })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configRerankEndpoint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											value: config.rerankEndpoint,
											onChange: (e) => setCfg({ rerankEndpoint: e.target.value })
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: STYLES.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configChunkSize")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											type: "number",
											value: config.chunkSize,
											onChange: (e) => setCfg({ chunkSize: Number(e.target.value) || 1200 })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configChunkOverlap")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											type: "number",
											value: config.chunkOverlap,
											onChange: (e) => setCfg({ chunkOverlap: Number(e.target.value) || 0 })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											style: STYLES.label,
											children: t("configTopK")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: STYLES.field,
											type: "number",
											value: config.defaultTopK,
											onChange: (e) => setCfg({ defaultTopK: Number(e.target.value) || 5 })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: {
												...STYLES.label,
												display: "flex",
												alignItems: "center",
												gap: 8
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: config.stripMarkup,
												onChange: (e) => setCfg({ stripMarkup: e.target.checked })
											}), t("configStripMarkup")]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										style: {
											...STYLES.button,
											...STYLES.buttonPrimary
										},
										disabled: busy,
										onClick: () => void saveConfig(),
										children: busy ? t("saving") : t("save")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										style: STYLES.button,
										disabled: busy,
										onClick: () => void testConnection(),
										children: busy ? t("testing") : t("testConnection")
									})]
								})
							] }),
							tab === "bases" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: STYLES.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: STYLES.button,
											onClick: () => void createBase(),
											children: t("createBase")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: bases.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: STYLES.muted,
											children: t("empty")
										}) }),
										bases.map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: STYLES.row,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													style: STYLES.button,
													onClick: () => setSelectedBase(b.id),
													children: b.name
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: STYLES.chip,
													children: [
														b.fileCount,
														" files · ",
														b.chunkCount,
														" chunks"
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: STYLES.muted,
													children: b.description
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													style: STYLES.button,
													onClick: () => void deleteBase(b.id),
													children: t("delete")
												})
											]
										}, b.id))
									]
								}),
								selectedBaseObj !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: STYLES.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												...STYLES.label,
												fontSize: 14,
												fontWeight: 600
											},
											children: [
												t("importFiles"),
												" — ",
												selectedBaseObj.name
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: STYLES.hint,
											children: t("importHint")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "file",
											disabled: busy,
											onChange: (e) => void onImport(e),
											style: { marginTop: 8 }
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: files.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: STYLES.muted,
											children: t("empty")
										}) }),
										files.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: STYLES.row,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: { flex: 1 },
													children: f.name
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: STYLES.statusChip(f.status),
													children: t(`status${f.status[0].toUpperCase()}${f.status.slice(1)}`)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: STYLES.muted,
													children: [
														f.chunkCount,
														" chunks · ",
														f.encoding
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													style: STYLES.button,
													onClick: () => void deleteFile(f.id),
													children: t("delete")
												})
											]
										}, f.id))
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: STYLES.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												...STYLES.label,
												fontSize: 14,
												fontWeight: 600
											},
											children: t("mountsTitle")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: STYLES.button,
											onClick: () => void addMount(),
											children: t("mountAdd")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: mounts.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: STYLES.muted,
											children: t("empty")
										}) }),
										mounts.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: STYLES.row,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: { flex: 1 },
													children: bases.find((b) => b.id === m.kbId)?.name ?? m.kbId
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: STYLES.chip,
													children: m.workspaceId
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 6
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														checked: m.enabled,
														onChange: () => void toggleMount(m.kbId, m.workspaceId, m.enabled)
													}), t("mountEnable")]
												})
											]
										}, `${m.kbId}:${m.workspaceId}`))
									]
								})
							] }),
							tab === "search" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchTab, {
								t,
								bases
							})
						]
					})
				]
			});
		}
		function SearchTab({ t, bases }) {
			const [query, setQuery] = (0, react.useState)("");
			const [kbId, setKbId] = (0, react.useState)("");
			const [results, setResults] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const run = (0, react.useCallback)(async () => {
				if (query.trim() === "") return;
				setBusy(true);
				setError("");
				try {
					const r = await postJson("/search", {
						query,
						...kbId === "" ? {} : { kbIds: [kbId] },
						topK: 5
					});
					setResults(r.hits);
				} catch (e) {
					setError(String(e));
				} finally {
					setBusy(false);
				}
			}, [query, kbId]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: STYLES.section,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						style: STYLES.field,
						placeholder: t("searchPlaceholder"),
						value: query,
						onChange: (e) => setQuery(e.target.value),
						onKeyDown: (e) => {
							if (e.key === "Enter") run();
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							marginTop: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							style: STYLES.field,
							value: kbId,
							onChange: (e) => setKbId(e.target.value),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t("basesTitle")
							}), bases.map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: b.id,
								children: b.name
							}, b.id))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: {
								...STYLES.button,
								...STYLES.buttonPrimary
							},
							disabled: busy,
							onClick: () => void run(),
							children: busy ? t("searching") : t("search")
						})]
					})]
				}),
				error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: STYLES.error,
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: results.map((h, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: STYLES.row,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: STYLES.chip,
						children: i + 1
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { flex: 1 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: h.text.slice(0, 200) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: STYLES.muted,
							children: [
								h.kbName,
								" · ",
								h.fileName,
								" · ",
								h.index,
								" · score=",
								h.score.toFixed(3),
								h.rerankScore !== void 0 ? ` · rerank=${h.rerankScore.toFixed(3)}` : ""
							]
						})]
					})]
				}, h.chunkId)) })
			] });
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-knowledge client half: registers the knowledge-base manager as a page in
		* the DSH settings menu (the same floating modal geometry as every other
		* settings section), so it never competes with other plugins' sidebar entries.
		* Registered through slots.inject so contributions wait on the real slot
		* declarations and unwind with this plugin's fiber.
		*/
		const name = "dsh-knowledge";
		const inject = ["slots"];
		function apply(ctx) {
			const t = makeT(getLang());
			ctx.effect(() => () => void 0, "dsh-knowledge: client");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "knowledge",
				order: 40,
				label: () => t("title")
			}, (props) => (0, react.createElement)(KnowledgePanel, {
				t,
				onClose: (props ?? {}).close
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map