# 本地知识库：导入、检索与对话接入

日期：2026-11-04（P1 实施：2026-11-06；P2 实施：2026-11-07）
状态：**P1、P2 已实施并验收；P3 暂缓**。已获用户确认：schema v6、新增 IPC、云端 embedding（用户自配 API Key）、零新增依赖、AI 可导入文档（走审批）、新增顶层入口。P1 先做纯关键词；P2 已补齐向量模型 / 重排模型配置、语义召回、RRF 与重排。用户当前没有可用的向量模型，P2 的接口与降级路径用注入的 mock 请求验证，未发起真实 embedding / rerank 调用。

---

## 0. 实施记录

| 项 | 结果 |
| --- | --- |
| schema | v5 → v6，新增 `kb_documents` / `kb_chunks` / `kb_chunks_fts` + 2 个索引；升级前 `backups/toolbox-before-v6-*.db`；P2 复用预留的 `embedding` / `embedding_model` / `embedding_dim` 列，**不再升 schema** |
| 导入 | `.md` / `.txt`，10MB / 50 个一批 / 200 篇 / 5 万块；SHA-256 去重；编码探测复用 `library/encoding.ts` |
| 分块 | 标题面包屑 + 递归换行；代码围栏与表格原子保留；目标 800 / 最小 300 / 最大 1400，仅强制切分处 ≤100 字重叠 |
| 关键词 | FTS5 中文二元组 + 拉丁词；`bm25(fts, 0.0, 1.0, 2.0)`；8 段 / 6000 字 / 单文档 4 段；单汉字 LIKE 兜底 |
| 向量 | 档案新增 `embeddingModel` 字段；导入 / 重建时按 32 块一批、并发 2 调 `/embeddings`；float32 BLOB 落库；主进程缓存全量向量，2 万块上限；失败只降级不标整篇失败 |
| 语义 | 查询向量 + 余弦（阈值 0.25）取 20 条；与关键词做 RRF（k=60）；按类别过滤；命中后按 id 取正文 |
| 重排 | 档案新增 `rerankModel` 字段；融合后取前 20 段调 `/rerank`，失败保持融合顺序；单段送排前截断到 2000 字 |
| 降级 | `no-embedding` / `no-vectors` / `embedding-failed` / `too-many-vectors` 四种原因，结果与 Agent 文本都如实说明 |
| IPC | `kb:list` / `kb:import` / `kb:reindex` / `kb:remove` / `kb:search` / `kb:document` + `kb:progress` 事件（P2 未新增通道） |
| Agent | `kb_search` / `kb_list_documents` / `kb_add_document`（write，审批）/ `kb_remove_document`（destructive，审批）；引用 `toolbox://open/kb/<id>?chunk=<id>`；导入审批卡随向量配置说明是否外发正文 |
| 界面 | 新顶层「知识库 → 资料库」；列表显示向量覆盖率、「补齐向量」、导入/重建进度（含分批）、混合检索标签与降级原因、分块详情与引用定位；设置页新增向量 / 重排模型输入 |
| 未做 | PDF / Word 解析、多集合、块级增量（P3）；检索自测面板简化为结果里的关键词 / 语义命中计数 |

验证：`npm run typecheck` / `lint` / `test`（148 files / 1099 tests）/ `build` 通过；`--knowledge-only` 7 项、`--model-settings-only` 3 项、`--sidebar-only` 11 项与全量 UI 113 项通过。真实 SQLite + FTS5 的导入/检索/重建/删除由 `kb-service.test.ts` 覆盖；`/embeddings` 与 `/rerank` 的请求格式、错误脱敏、语义融合、重排与降级由 `kb-model-client.test.ts`、`kb-service.test.ts`、`kb-retrieval.test.ts` 用注入的 mock fetch 覆盖，**未调用真实向量模型**。

---

## 1. 目标

把用户自己的 `.md` / `.txt` 资料导入本机，按类别（工作资料 / 个人资料 / 以后可扩展）管理；对话时由 Agent 自行判断是否检索，命中的片段带出处交回模型作答。检索同时支持**关键词**与**语义**，两者融合排序。

### 非目标

- PDF / Word / 图片 OCR（P3 再评估，需要解析依赖）。
- 多用户、云同步、跨设备共享。
- ANN 索引、重排模型（rerank）、多语言翻译。
- 自动爬取网页、监控文件夹变化。

---

## 2. 总体数据流

```
手动导入 / AI 审批导入
        ↓
解析（编码探测）→ 分块（标题 + 递归换行，目标 800）→ 中文二元组分词
        ↓                          ↓
   FTS5 关键词索引            embedding（当前档案的 /embeddings，可关闭）
        ↓                          ↓
     SQLite: kb_documents / kb_chunks / kb_chunks_fts（向量存 BLOB）
        ↓
查询：关键词 BM25 Top20 + 语义余弦 Top20 → RRF 融合 → 8 段 / 6000 字预算
        ↓
Agent 工具 kb_search → 带编号的上下文 + 引用 → 回答
```

技术约束：全部在现有 Electron 主进程内完成，数据只落在 `toolbox.db`；不引入向量数据库服务、不新增第三方依赖。

---

## 3. 数据模型（schema v6）

`SCHEMA_VERSION` 5 → 6。`current < 6` 段内建表，全部 `IF NOT EXISTS`，幂等可重入。

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
CREATE INDEX IF NOT EXISTS idx_kb_documents_category
  ON kb_documents(category, updated_at_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_sha
  ON kb_documents(sha256);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL DEFAULT 0, -- 在清洗后正文中的字符偏移，用于回链
  char_count INTEGER NOT NULL DEFAULT 0,
  tokens TEXT NOT NULL DEFAULT '',        -- 中文二元组 + 拉丁词，供 FTS 使用
  embedding BLOB,                          -- float32 小端；NULL 表示尚未向量化
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

说明：

- **不建外键约束**，删除文档时由代码在同一事务内删 `kb_chunks` 与 `kb_chunks_fts`（显式可控，避免 `ON DELETE CASCADE` 与 FTS 虚表混用）。
- **FTS 与主表同步**：导入/删除在同一个 `db.transaction` 内显式写 FTS，不用触发器；重建索引时先整篇删后整篇插。
- **类别**用 `TEXT`，不建字典表。预设常量放 `src/shared/knowledge-base.ts`：

```ts
export const KB_CATEGORIES = [
  { id: 'work', label: '工作资料' },
  { id: 'personal', label: '个人资料' }
] as const
```

以后加类型只改常量与界面文案，不动库结构与迁移；自定义类别允许 1–20 字符，主进程校验。

### 升级与回滚

- 升级前沿用现有机制：`VACUUM INTO backups/toolbox-before-v6-<ts>-<uuid>.db`，失败即中止启动并提示（与 v5 一致）。
- 回滚：退出应用 → 用备份覆盖 `toolbox.db` → 启动旧版本。旧版本读取 v6 库时会跳过迁移（`current >= SCHEMA_VERSION`），既有的 12 张表仍可读，知识库数据不可见但不会被破坏。
- 影响：新增 3 张表 + 1 张 FTS 虚表；不修改既有表、不改列、不动加密链路。

---

## 4. IPC

新增 6 个通道 + 1 个事件，全部经 `ipc/validation.ts` 校验，并做窗口与主 frame 检查（沿用编程 Agent 的 `handle` 包装）。

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `kb:list` | `{ category?, status?, query? }` | `KbDocumentView[]` | 列表只回摘要，不含正文 |
| `kb:import` | `{ paths?: string[] }` | `KbImportResult` | 不传路径时弹系统文件框；传路径仅用于 AI 审批后的导入 |
| `kb:reindex` | `{ documentId }` | `void` | 整篇重建；清理旧块与 FTS |
| `kb:remove` | `{ documentId }` | `void` | 物理删除（界面二次确认） |
| `kb:search` | `{ query, category?, mode?, topK? }` | `KbSearchResult` | `mode`: `hybrid` / `keyword` / `semantic` |
| `kb:document` | `{ documentId, chunkId? }` | `KbDocumentDetail` | 详情与分块；`chunkId` 用于引用定位 |
| `kb:progress`（事件） | — | `KbProgressEvent` | `{ documentId, phase, done, total }` |

视图对象一律脱敏：不含绝对路径以外的敏感字段；`source_path` 只在详情中返回，列表显示文件名。

---

## 5. 索引流水线

1. **选择文件**：`dialog.showOpenDialog`，过滤 `.md/.txt`；也支持拖拽（渲染层只传路径给导入接口）。
2. **校验**：扩展名白名单、文件存在、大小 ≤ 10MB、文本可解码；重复 `sha256` 直接复用已有文档（提示"已导入"）。
3. **解析**：复用 `src/main/services/library/encoding.ts` 的 BOM / UTF-16 / GBK 探测；Markdown 按 `#` 标题切段，纯文本按空行分段。
4. **分块**：按标题 + 递归换行切分，目标 800 / 最小 300 / 硬上限 1400 字符；详见 §5.1。保留 `heading`（标题面包屑）与该块在正文中的 `start_offset`。
5. **分词**：`tokens` = 中文相邻二字组合 + 拉丁词（小写、去标点）；写入 FTS。中文二元组保证"部署"这类两字查询可命中。
6. **向量化**：`POST {baseUrl}/embeddings`，模型取自档案新增的 `embeddingModel` 字段；批量 32 块、并发 2；返回 `float32` 存 BLOB，并记 `embedding_model` / `embedding_dim`。没有配置模型时不发请求、不写 BLOB，检索走纯关键词。单个批次失败不自动重试，文档保留关键词索引并在 `error` 里写明原因，可在列表重建。
7. **写入**：单文档一个事务；失败置 `status=failed` 并保存可读原因，可单独重建。向量化失败不回滚关键词索引，状态保持 `ready` 并附提示。
8. **进度**：读取 / 切块 / 写入 / 向量分批推送 `kb:progress`；暂不支持取消，中断后保留已完成分块，可在列表点「重建」。
9. **增量**：P1/P2 不做块级增量；内容变化按整篇重建（导入按 SHA-256 去重，重建重新计算）。

上限：单文件 10MB、单库 5 万块、最多 200 篇；超限明确拒绝并说明原因。

### 5.1 分块策略（标题 + 递归换行）

固定 1200 字符 / 150 重叠的问题：会把代码块、表格、列表项切成两半；重叠位置落在句子中间，制造近似重复块挤占召回名额；完全不利用 Markdown 的标题结构。改为结构化切分：

1. **按标题切 section**：识别 ATX 标题（`#`–`######`），记录面包屑（如 `部署 > 回滚 > 数据库`）；标题行本身不单独成块。
2. **递归切分**（同一 section 内，逐级降级到能切开为止）：
   1. 空行（`\n\n`，段落）
   2. 单换行（`\n`，列表项 / 短行）
   3. 句末标点（`。！？；.!?`）
   4. 硬切：恰好在 `max` 处按码点切（不切断代理对与组合字符）
3. **原子块**：代码围栏（```）与 Markdown 表格整体不参与内部切分；超过 `max` 时允许独占一块并标注 `oversized`，宁可超一点也不切碎代码。
4. **反向合并**：切完的碎片按顺序贪心合并到 `target`（800），不超过 `max`（1400），**不跨标题边界**；小于 `min`（300）的尾块并入前一块。
5. **重叠**：只在"同一段落被强制切开"的位置，把上一块最后一个完整句（≤100 字）带到下一块开头；标题边界与段落边界不重叠——语义本来就已经断开，重叠只是噪音。
6. **标题上下文**：送 embedding 的文本是 `面包屑 + 换行 + 块正文`；FTS 的 `tokens` 也包含面包屑，并用列权重 `bm25(kb_chunks_fts, 0.0, 1.0, 2.0)` 提高标题命中权重（`chunk_id` 是 UNINDEXED 列，也占一个权重位）。落库的 `content` 保持原文，`heading` 存面包屑。

参数依据：中文 800 字约 600–1000 token，多数 embedding 模型上限内安全；7–8 段 × 800 字 ≈ 5600–6400，正好贴着 6000 字上下文预算。

代价：块数增加（50 万字约 700 块，比 1200 字方案多 75%），向量与 FTS 体积、embedding 调用次数同步上升，但仍在 2 万块上限内；解析器复杂度上升，需要单测覆盖代码围栏、表格、标题层级、无换行长文本。

**怎么验证分块好坏**：准备 20–30 个真实问题并人工标注应命中的章节，对比三组配置——(A) 固定 1200/150；(B) 标题+递归 800/300/1400 无重叠；(C) B + 句级重叠 100。看 Recall@5、MRR、平均块长、重复块比例。若 C 相对 B 提升不足 2%，选 B（更省 token）。

---

## 6. 检索

### 6.1 关键词

```sql
SELECT chunk_id, bm25(kb_chunks_fts, 0.0, 1.0, 2.0) AS score
FROM kb_chunks_fts
WHERE kb_chunks_fts MATCH ?
ORDER BY score
LIMIT 20;
```

bm25 的权重按列位置传参：`chunk_id` 是 UNINDEXED 列也占一位，`tokens` 权重 1.0、`heading` 权重 2.0。已用 better-sqlite3 13 实测三参数形式生效。

`MATCH` 的查询串与写入使用同一套分词；两字中文词以二元组展开，避免 trigram 的"少于 3 字查不到"。单个汉字没有二元组，检索时退回 `content LIKE '%字%'`（主进程补上 `%` / `_` 转义），并在结果里自然带出所属分块。

### 6.2 语义

- `embed(query)` → 与 `kb_chunks.embedding` 做余弦；只在 `embedding_model` 等于当前模型、且有向量的块中比较（换模型后旧向量自动失效，需重建）。
- 2 万块以内把向量与元数据缓存在主进程（约 82MB），查询时直接扫描；超过上限返回 `too-many-vectors`，只做关键词，后续再评估 `sqlite-vec`。
- 相似度阈值 0.25（`KB_COSINE_MIN`），低于阈值不返回，避免"什么都召回到一点"。
- 正文不随向量常驻内存：语义排名只带元数据，命中后再按 `chunk_id` 取完整片段。

### 6.3 融合与重排

- RRF：`score = Σ 1 / (60 + rank)`，两路各取 Top 20；同一 `chunk_id` 两路命中时分数相加。
- 语义模式只返回语义结果；关键词模式不调用向量接口；混合模式才融合。
- 配置了 `rerankModel` 时，对融合后的前 20 段调用 `/rerank`（单段截断到 2000 字），按重排分数倒序；调用失败保持融合顺序并标记 `rerank: 'failed'`。
- 按 `chunk_id` 去重；同一文档最多保留 4 段，避免一份文档占满上下文。
- 取前 8 段，总字符 ≤ 6000；单段超过 1200 字符按句号截断并标注。
- 输出每条命中包含：文档标题、类别、章节、块序号、偏移、片段、来源分数（内部自测用）。

### 6.4 降级

- `no-embedding`：未配置 `embeddingModel`。
- `no-vectors`：配了模型，但库中还没有对应模型的向量（可在资料库「补齐向量」）。
- `embedding-failed`：向量接口失败、配置缺 Key / 地址，或之前导入时向量化失败（消息里带真实原因）。
- `too-many-vectors`：向量块超过 2 万扫描上限。
- 重排失败不改变降级原因，只额外标记 `rerank: 'failed'`。
- 完全没有可用结果：`kb_search` 返回空集并建议"换个说法或先看看文档目录"。

### 6.5 性能目标

| 场景 | 目标 |
| --- | --- |
| 关键词检索（5 千块） | < 20ms |
| 混合检索（2 万块，向量已缓存） | < 200ms |
| 单文档导入（10 万字符） | < 15s（含 embedding） |

P1 实测（合成数据、本机 SSD、主进程）：2 万块写入 FTS 约 295ms；单次关键词检索 20–25ms（含候选 20 条与预算收敛）。5 千块规模约 5–6ms，满足目标。混合检索的耗时取决于向量接口与本地余弦，**当前没有真实向量模型，未做端到端计时**；代码路径用 mock 请求验证。

---

## 7. Agent 接入

工具放在 `src/main/services/agent/tools/knowledge.ts`，在 `tools/index.ts` 注册：

| 工具 | risk | 审批 | 入参 / 返回 |
| --- | --- | --- | --- |
| `kb_search` | read | 不需要 | `{ query, category?, topK? }` → 命中片段（不含全文） |
| `kb_list_documents` | read | 不需要 | `{ category? }` → 标题、类别、块数、状态 |
| `kb_add_document` | write | 需要 | `{ path }` → 导入结果；审批卡展示绝对路径与大小 |
| `kb_remove_document` | destructive | 需要 | `{ documentId }` → 删除；审批卡展示文档标题与块数 |

- **自主判断**：不做额外分类器。工具描述写明"当问题涉及用户自己的资料时先检索"；系统提示补一条策略——先 `kb_list_documents` 看有没有相关文档，再 `kb_search`；与本地资料无关的问题不调用。
- **安全**：`kb_add_document` 只接受绝对路径、白名单扩展名、≤10MB 的已存在文件；路径与大小进审批卡，拒绝即不读文件。
- **引用**：命中结果通过 `references()` 转成 `AppReference`，新增 `AppTarget` 分支 `{ kind: 'kb', id, chunkId? }`，同步更新 `shared/app-reference.ts` 的格式化/解析与 `open-app-reference.ts` 的跳转——点击引用打开知识库并定位到该块。
- **上下文预算**：单次最多 8 段、6000 字符；超出部分明确告知模型"还有 N 段未展开"。

---

## 8. 界面

### 8.1 导航

新增顶层大类（第 5 组）：

```ts
{
  id: 'knowledge',
  label: '知识库',
  children: [{ view: 'kb', label: '资料库', icon: 'library' }]
}
```

同步改动：`AppView` 增加 `'kb'`、`PAGE_META` 增加标题、`App.tsx` 增加分支、`shell.tsx` 的图标映射增加 `library`、`icons.tsx` 新增图标。

### 8.2 资料库页面

- 顶部：类别筛选（工作资料 / 个人资料 / 全部）+ 搜索框 +「补齐向量」（有缺口时）+「导入资料」按钮。
- 列表：文件名、类别、块数、状态徽标（索引中 / 就绪 / 失败）、向量覆盖率、更新时间；行内操作「重建」「删除」。
- 详情页：文档信息、分块预览、向量覆盖率与失败原因；`chunkId` 定位时滚动到对应块并高亮；向量化失败时用金色提示条给出「重试向量化」。
- 检索结果：显示「关键词 N · 语义 M」、混合/降级标签、重排状态与失败原因；不单独做调参面板。
- 空状态：说明支持的文件类型、大小上限，以及配置向量模型后正文会发送给 `/embeddings`。

### 8.3 对话侧

- 回答末尾的引用卡片显示文档名 + 章节；点击跳转到资料库对应块。
- 检索降级时在回答里附一句具体原因（未配置向量模型 / 资料未向量化 / 向量调用失败），不会笼统说“语义检索”成功。

---

## 9. 隐私与安全

- 配置向量模型后，导入会把**分块正文**发送给当前启用服务的 `/embeddings`；检索会发送**查询词**；配置重排模型时会把**候选片段**发送给 `/rerank`。首次导入 / 补齐向量前弹一次说明，导入审批卡也写明。
- 纯本地模式（embedding 与 rerank 都留空）不发送任何文档内容，只在本机解析与检索。
- 只有 `kb_search` 命中的片段进入对话上下文，不整篇上传。
- 不记录文档正文到日志；错误信息不带原文；HTTP 错误只回状态码与可读提示，不带 Key 或响应体。
- 删除为物理删除，界面二次确认并写明"块与向量一并删除，源文件不受影响"。
- 所有 SQL 参数化；类别、路径、查询串一律经 `ipc/validation.ts` 收窄。

---

## 10. 分期

| 阶段 | 范围 | 依赖 |
| --- | --- | --- |
| P1 ✅ | schema v6、导入解析分块、FTS5 关键词检索、资料库页面、`kb_search` / `kb_list_documents` / `kb_add_document` / `kb_remove_document`、引用跳转 | 零新增依赖 |
| P2 ✅ | 档案新增 `embeddingModel` / `rerankModel` 与设置项、批次向量化、语义检索、RRF 融合、重排、补齐向量入口 | 用户配置支持 embeddings / rerank 的服务；**接口与降级路径以 mock 请求验证，尚未接真实模型** |
| P3 ⏸ | PDF / Word 解析、多集合、块级增量 | 需再次授权依赖 |

P1 结束时即使不配 embedding，也能"导入 → 提问 → 带出处回答"。P2 的字段与表列（`embedding` / `embedding_model` / `embedding_dim`）已在 v6 预留，接入时不需要再升 schema。

---

## 11. 验收

1. **导入**：导入一个 5 万字的 `.md` 与一个 GBK 编码的 `.txt`，均成功；列表显示块数与"就绪"。
2. **去重**：同一文件再导入一次，提示已存在，不产生重复文档。
3. **拒绝**：11MB 文件、`.pdf`、损坏文件分别给出明确原因，不写入半成品数据。
4. **关键词**：搜"部署"（两字）能命中包含该词的块；搜英文单词大小写不敏感。
5. **类别**：只筛"工作资料"时，个人资料的块不出现在结果里。
6. **语义**：配置向量模型后，问"怎么回滚数据库"能召回写有"恢复备份"的块（不同措辞）；用 mock 请求覆盖了向量请求与余弦排序，待真实模型复验。
7. **混合**：关键词与语义命中不同块时，两条都在结果里，且 RRF 排序稳定。
8. **降级**：删掉 `embeddingModel` 后检索仍可用，回答与界面标注"仅关键词"并给出原因。
9. **Agent**：问文档相关问题，Agent 先 `kb_list_documents` 再 `kb_search`；无关问题不调用。
10. **审批**：要求 AI 导入文件时弹出审批卡，展示路径与大小；配置向量模型时审批卡说明正文会发送给 `/embeddings`；拒绝后不读文件、不建文档。
11. **引用**：点击回答下方引用，跳转到资料库并定位到对应块。
12. **回滚**：用 v5 备份恢复后，旧功能正常，知识库表消失且不报错。
13. **性能**：2 万块合成数据下关键词检索 ≤ 200ms；单文档导入有进度；取消尚未实现，中断后可在列表重建。
14. **分块**：代码围栏与表格不被切断；每块的 `heading` 面包屑与该块所在章节一致；无换行的长文本按句切分后仍能硬切兜底；单块长度在 300–1400 之间（原子块除外）。
15. `npm run typecheck` / `lint` / `test` / `build` 通过；新增纯逻辑（分块、分词、RRF、余弦、重排回填）必须有单测。
16. **向量配置**：设置页可填写 / 清空向量与重排模型；对话切模型不会清掉它们；「补齐向量」能逐篇重建并显示覆盖率。

---

## 12. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 中文分词质量 | 关键词召回差 | 二元组 + BM25；检索结果里显示关键词 / 语义命中数便于对比 |
| embedding 供应商差异（维度、批量上限、限流） | 导入失败或维度不一致 | 记录 `embedding_model` / `dim`，只按当前模型检索；批量固定 32、并发 2，失败保留关键词并给出原因 |
| better-sqlite3 未启用 FTS5 | 关键词检索不可用 | **已实测**：现有 `better-sqlite3` 13 / SQLite 3.53.4 支持 FTS5，`unicode61` 下二元组（"部署 署失 失败"）可被两字查询命中；仍建议在单测里保留一次建表探针 |
| 主进程内存 | 2 万块向量约 82MB | 缓存 + 2 万块扫描上限；超限退回关键词并提示 |
| 文档内容外发 | 隐私 | 配置向量 / 重排后，导入发送分块正文、检索发送查询词、重排发送候选片段；首次操作明确提示，纯本地模式完全不出网 |
| 单篇超大文档 | 索引久、上下文挤占 | 10MB 上限；单文档最多占 4 段 |
| 分块边界仍可能切在表格/代码外 | 召回块可读性差 | 代码与表格作原子块；验收里逐项核对 |
| 与现有 schema 迁移冲突 | 升级失败 | 升级前 VACUUM INTO 备份；幂等建表；不修改既有表 |

---

## 13. 默认参数（已确认）

| 项 | 值 |
| --- | --- |
| 文件类型 | `.md` / `.txt` |
| 分块 | 标题 + 递归换行；目标 800 / 最小 300 / 硬上限 1400；仅强制切分处句级重叠 ≤100；代码围栏与表格不切 |
| 检索段数 | 8 段 / 6000 字（单段 ≤1200） |
| 入库上限 | 单文件 10MB、单库 5 万块、200 篇 |
| 检索 | 关键词 Top20 + 语义 Top20 → RRF(k=60) → 重排 Top20（可选）→ 8 段 / 6000 字 |
| 语义阈值 | 0.25 |
| 向量批量 | 32 块 / 批，并发 2；单库超过 2 万向量只做关键词 |
| 重排 | 当前档案的 `rerankModel`；送排单段截断 2000 字；失败保持融合排序 |
| 类别预设 | 工作资料 / 个人资料（可扩展） |
| 入口 | 新顶层「知识库 → 资料库」 |
| 向量存储 | SQLite BLOB + 主进程余弦（零依赖） |
| embedding | 当前 AI 档案的 `/embeddings`，用户自配 Key；空串关闭 |
| 引用 | 回答固定附引用卡片，可跳转定位 |
