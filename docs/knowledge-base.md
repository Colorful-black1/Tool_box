# 本地知识库：导入、检索与对话接入

把本机 `.md` / `.txt` 导入 `toolbox.db`，按标题切段后用「关键词 + 语义 + 可选重排」检索，回答附出处。
当前 schema 为 v7；知识库三张表在 v6 建立，v7 未改动其结构。

## 1. 范围与上限

| 项 | 值 |
| --- | --- |
| 文件类型 | `.md` / `.txt` |
| 单文件 | ≤ 10MB |
| 单库文档 | ≤ 200 篇 |
| 单库分块 | ≤ 50,000 块 |
| 语义扫描 | ≤ 20,000 块向量（约 82MB 主进程内存） |
| 类别 | `work` 工作资料 / `personal` 个人资料；自定义类别 1–20 字符 |
| 入口 | 顶层「知识库 → 资料库」 |

- 导入按 SHA-256 去重，同一内容再次导入提示「已导入」，不产生重复文档。
- 编码探测复用阅读器的 BOM / UTF-16 / GBK 逻辑。
- 内容变化按整篇重建，不做块级增量。

## 2. 数据模型

```sql
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'work',
  source_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | indexing | ready | failed
  chunk_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_sha ON kb_documents(sha256);
CREATE INDEX IF NOT EXISTS idx_kb_documents_category
  ON kb_documents(category, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  tokens TEXT NOT NULL DEFAULT '',
  embedding BLOB,
  embedding_model TEXT NOT NULL DEFAULT '',
  embedding_dim INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_pending ON kb_chunks(document_id, ordinal)
  WHERE embedding IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  tokens,
  heading,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

- 不建外键：删除文档时在同一事务内显式删 `kb_chunks` 与 `kb_chunks_fts`，避免 `ON DELETE CASCADE` 与 FTS 虚表混用。
- 不用触发器：导入 / 删除在同一 `db.transaction` 内显式写 FTS；重建先整篇删后整篇插。
- `embedding` 是 float32 小端 BLOB，`NULL` 表示尚未向量化；`embedding_model` 与当前模型不一致的块不参与语义比较，换模型需重建。
- `start_offset` 是清洗后正文中的字符偏移，用于回链定位。
- 回滚：用升级前的 `backups/toolbox-before-v6-*.db` 覆盖 `toolbox.db`；旧版本读取 v6+ 库时跳过迁移，知识库数据不可见但不会被破坏。

## 3. 分块

- 目标 800 / 最小 300 / 硬上限 1,400 字符。
- 先按 ATX 标题（`#`–`######`）切 section，记录面包屑（如 `部署 > 回滚 > 数据库`）；标题行不单独成块。
- section 内逐级降级：空行 → 单换行 → 句末标点（`。！？；.!?`）→ 在 `max` 处按码点硬切（不切断代理对与组合字符）。
- 代码围栏与 Markdown 表格是原子块，不参与内部切分；超过 `max` 时独占一块并标 `oversized`，宁可超长也不切碎。
- 碎片按顺序贪心合并到 target，不超过 `max`，不跨标题边界；小于 `min` 的尾块并入前一块。
- 只在「同一段落被强制切开」处把上一块最后一个完整句（≤ 100 字）带到下一块开头；标题与段落边界不重叠。
- 送 embedding 的文本是「面包屑 + 换行 + 块正文」；FTS 的 `tokens` 也包含面包屑。
- 落库的 `content` 保持原文，`heading` 存面包屑。

## 4. 索引流水线

1. 选择文件：系统文件框，过滤 `.md` / `.txt`；渲染层只传路径。
2. 校验：扩展名白名单、存在性、≤ 10MB、可解码；`sha256` 命中则复用已有文档。
3. 解析：Markdown 按标题切段，纯文本按空行分段。
4. 分块：按 §3 执行，写入 `heading` 与 `start_offset`。
5. 分词：`tokens` = 中文相邻二元组 + 拉丁词（小写、去标点），写入 FTS。
6. 向量化：`POST {baseUrl}/embeddings`，模型取档案的 `embeddingModel`；32 块一批、并发 2；返回 float32 存 BLOB 并记 `embedding_model` / `embedding_dim`；未配置模型时不发请求、不写 BLOB。
7. 写入：单文档一个事务；失败置 `status = failed` 并保存可读原因；向量化失败不回滚关键词索引，文档保持可用。
8. 进度：读取 / 切块 / 写入 / 向量分批推 `kb:progress`；不支持取消，中断后可在列表点「重建」。

## 5. 检索

### 5.1 关键词

```sql
SELECT chunk_id, bm25(kb_chunks_fts, 0.0, 1.0, 2.0) AS score
FROM kb_chunks_fts
WHERE kb_chunks_fts MATCH ?
ORDER BY score
LIMIT 20;
```

- 三个权重依次对应 `chunk_id`（UNINDEXED 列也占一位）、`tokens`、`heading`，标题命中权重更高。
- 查询串与写入使用同一套分词；单个汉字没有二元组，退回 `content LIKE`（主进程转义 `%` / `_`）。
- 关键词模式不调用向量接口。

### 5.2 语义

- 只与 `embedding_model` 等于当前模型的块比较；换模型后旧向量自动失效，需重建。
- 2 万块以内把向量与元数据缓存在主进程，查询时直接算余弦；超过上限返回 `too-many-vectors`，只做关键词。
- 相似度阈值 0.25（`KB_COSINE_MIN`）；语义排名只带元数据，命中后再按 `chunk_id` 取正文。

### 5.3 融合与重排

- RRF：`score = Σ 1 / (60 + rank)`，两路各取 Top 20，同一 `chunk_id` 分数相加。
- 配置 `rerankModel` 时对融合后前 20 段调 `/rerank`（单段截断 2,000 字），按重排分倒序；失败保持融合顺序并标 `rerank: 'failed'`。
- 按 `chunk_id` 去重；同一文档最多保留 4 段；取前 8 段、总字符 ≤ 6,000；单段超过 1,200 字符按句号截断并标注。
- 语义模式只返回语义结果；关键词模式不碰向量；混合模式才融合。

## 6. 降级

| 原因 | 含义 |
| --- | --- |
| `no-embedding` | 未配置 `embeddingModel` |
| `no-vectors` | 配了模型，但库中没有该模型的向量（可「补齐向量」） |
| `embedding-failed` | 向量接口失败、缺 Key / 地址，或导入时向量化失败（带真实原因） |
| `too-many-vectors` | 向量块超过 2 万扫描上限 |

- 重排失败不改变降级原因，只额外标 `rerank: 'failed'`。
- 完全没有可用结果时返回空集，并建议「换个说法或先看看文档目录」。

## 7. Agent 工具

| 工具 | risk | 审批 | 入参 / 返回 |
| --- | --- | --- | --- |
| `kb_search` | read | 不需要 | `{ query, category?, topK? }` → 命中片段（不含全文） |
| `kb_list_documents` | read | 不需要 | `{ category? }` → 标题、类别、块数、状态 |
| `kb_add_document` | write | 需要 | `{ path }` → 导入结果；审批卡展示绝对路径与大小 |
| `kb_remove_document` | destructive | 需要 | `{ documentId }` → 删除；审批卡展示标题与块数 |

- 不做额外分类器：工具描述写明「涉及用户自己的资料时先检索」，系统提示要求先 `kb_list_documents` 再 `kb_search`；与本地资料无关的问题不调用。
- 导入只接受绝对路径、白名单扩展名、≤ 10MB 的已存在文件；拒绝后不读文件、不建文档。
- 引用格式 `toolbox://open/kb/<id>?chunk=<chunkId>`，点击打开资料库并定位到该块。
- 单次最多 8 段 / 6,000 字符，超出部分告知模型「还有 N 段未展开」。

## 8. IPC 与事件

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `kb:list` | `{ category?, status?, query? }` | `KbDocumentView[]`（只回摘要，不含正文） |
| `kb:import` | `{ paths?: string[] }` | `KbImportResult`；不传路径时弹系统文件框 |
| `kb:reindex` | `{ documentId }` | `void`（整篇重建，清理旧块与 FTS） |
| `kb:remove` | `{ documentId }` | `void`（物理删除，界面二次确认） |
| `kb:search` | `{ query, category?, mode?, topK? }` | `KbSearchResult`；`mode`: `hybrid` / `keyword` / `semantic` |
| `kb:document` | `{ documentId, chunkId? }` | `KbDocumentDetail`；`chunkId` 用于定位 |
| `kb:progress`（事件） | — | `{ documentId, phase, done, total }` |

- 全部经 `ipc/validation.ts` 收窄，并做窗口与主 frame 校验。
- `source_path` 只在详情返回，列表显示文件名。

## 9. 隐私与外发边界

- 配置向量模型后，导入会把分块正文发给当前服务的 `/embeddings`；检索发查询词；配置重排模型后把候选片段发给 `/rerank`。
- 纯本地模式（embedding 与 rerank 都留空）不发送任何文档内容，只在本机解析与检索。
- 首次导入 / 补齐向量前弹一次说明；导入审批卡同步写明是否外发正文。
- 只有 `kb_search` 命中的片段进入对话上下文，不整篇上传。
- 不把文档正文写进日志；HTTP 错误只回状态码与可读提示，不带 Key 或响应体。
- 删除是物理删除（块与向量一并删除），界面二次确认并写明源文件不受影响。

## 10. 验证状态与未做

- 真实 SQLite + FTS5 的导入、检索、重建、删除由服务层测试覆盖（真实库，非 mock）。
- **未接真实向量 / 重排模型**：`/embeddings` 与 `/rerank` 从未调用真实服务；请求格式、错误脱敏、余弦排序、RRF、重排回填与四类降级由注入的 mock 请求覆盖。
- 混合检索端到端延迟未实测（依赖真实向量服务）；关键词检索在 2 万块合成数据上满足目标。
- 未做：PDF / Word 解析与图片 OCR、多集合、块级增量、ANN 索引（`sqlite-vec`）、导入取消、独立检索调参面板。
