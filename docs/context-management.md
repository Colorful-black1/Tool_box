# 对话上下文：占用与压缩

对话按模型窗口做预算：标题栏展示占用，超阈值时把较早消息压成检查点摘要，原始消息始终保留。
本文只写现行行为与仍有效的边界：窗口来源、阈值算法、检查点数据、IPC 与降级路径。

## 1. 不变量

- 消息只增不删：压缩只改变「发给模型的内容」，界面仍可回看原文。
- 摘要只是替身：检查点独立存储，不写入 `messages`，不影响条数、标题与导出。
- 度量诚实：没有供应商实测值时一律标「约」，不宣称精确。
- 失败可降级：压缩失败、供应商报超长、切到小窗口模型都不阻塞发送；只有单条消息本身超出窗口时才拒绝发送。
- 用量不持久化：`lastUsage` 只在内存，重启后退回估算。

## 2. 窗口来源与解析顺序

| 优先级 | windowSource | 写入方 | 覆盖规则 |
| --- | --- | --- | --- |
| 1 | `manual` | 设置页手填 | 任何自动刷新都不覆盖 |
| 2 | `api` | `/models` 元数据 | 可覆盖 `learned` |
| 3 | `learned` | 供应商报超长时解析 | 可覆盖 `api`，不覆盖 `manual` |
| 4 | `catalog` | 内置供应商目录 | 前四者都缺失时兜底 |
| 5 | `default` | 128,000 | 界面明确写「未检测到，默认 128k」 |

`windowSource` 的完整取值是 `manual | api | learned | catalog | default`，浮层如实展示。

- `/models` 识别 `context_window`、`context_length`、`top_provider.context_length`、`model_info.context_window`、`max_model_len`、`meta.n_ctx_train`、`inputTokenLimit`、`max_context_length` 等别名；同一响应多个字段时按上述顺序取第一个可信值。
- 只接受 `4,000 ≤ N ≤ 10,000,000` 的整数；越界、非数字、字符串数字按缺失处理。
- 只返回 `id` 的端点不报错，窗口留空，继续走 `catalog` / `default`。
- 目录按供应商分组，同名模型不跨组套用，带 `-free` 等后缀的模型不命中目录。
- 不内置「模型名 → 窗口」的全局硬编码，也不发试探请求探测窗口。

## 3. 占用估算与阈值参数

```text
CJK 字符（含中文标点）      × 1.0
其他字符（英文/数字/符号）  ÷ 3.5
每条消息                    + 8
工具 schema（JSON 文本）    ÷ 3.5
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `W` 窗口 | 见 §2 | 接口 / 手动 / 学习 / 目录 / 128k |
| `O` 输出预留 | 8,192 | 接口返回 `max_output_tokens` 时取 `min(该值, 8,192)` |
| `B` 安全余量 | 4,096 | 估算误差与请求结构波动 |
| 触发阈值 | `min(0.8W, W − O − B)` | 128k → 102,400；32k → 20,800 |
| 保留尾部 | `clamp(0.15 × (W − O), 4,000, 15,000)` | 128k → 15,000；32k → 4,000 |
| 摘要输出上限 | 2,000 token | 与提示词的简洁要求一致 |
| 自动压缩 | 开 | 可在浮层关闭 |
| 溢出重试 | 1 次 | 仅本轮无输出、无工具时 |
| 压缩后最小释放 | 1,000 token 且 ≥ 5% | 否则视为无效摘要 |

- 不引入分词器依赖：对 DeepSeek / Qwen / GLM / Kimi 都不准，且需要联网拉词表。
- 固定开销 = system prompt + 当前权限下的工具 schema + 每条消息结构开销；压缩省不掉，但必须计入阈值。
- 浮层主数字是「下一轮请求的估算总量」，副数字是「上次实测（含工具过程，可能高于下一轮）」。

## 4. 压缩流程

```text
发送前
  → 读最近检查点 + 检查点之后的消息
  → 估算 = 固定开销 + 摘要 + 消息
  → 未超阈值 / 关闭自动压缩 / 消息 ≤ 2 条：直接发送
  → trimMessages(strategy: 'last', startOn: 'human', allowPartial: false) 取尾部
  → 尾部之前的消息作为 source；source 为空则不压缩
  → 一次摘要调用（同模型，temperature 0，maxTokens 2,000，不绑工具，不流式）
  → 收缩校验通过才写检查点
  → 用「摘要 + 尾部」发送；本轮 usage 回传并广播上下文视图
```

- 最新一条用户消息永远保留；断言不成立时回退到最后两条。
- `trimMessages` 抛错（预算连一条都放不下）时回退到最后两条；仍不行则 no-op。
- 检查点边界必须落在完整消息上，不把一条消息截一半存进摘要、一半留在原文。
- 旧摘要不进入 `trimMessages` 的输入，只作为摘要调用的第一条消息，避免出现「新摘要 + 尾部还带旧摘要」。
- `source` 会被二次裁剪时如实记录 `omitted_message_count`，界面写「最早 N 条未纳入摘要」。

## 5. 摘要内容与注入

摘要固定六段 Markdown 结构：用户目标与意图、已完成的操作与结果、关键事实与用户偏好、涉及的对象与标识、未完成与下一步、重要约束与上下文。

- 用条目、不写散文；空段落写「（无）」，不省略段落。
- 保留精确名称、ID、数字、日期、路径与用户原话；不确定的内容不编造。
- 不复述密码、API Key、Token 与完整密钥，用「已配置 / 已保存」代替。
- 输入里已有 `<compacted-summary>` 时按「保留仍成立的事实、删过期内容、合并新信息」处理，不原样抄。
- 注入用 HumanMessage：保持 user/assistant 交替合法，且摘要不获得 system 级指令权，降低「摘要里夹带指令」的风险。
- 固定前缀说明「这是已发生的背景，不要复述」，后接 `<compacted-summary>…</compacted-summary>`。
- 摘要正文按纯文本展示，不渲染 Markdown，避免摘要里的链接 / 图片被误点。

## 6. 收缩校验

写检查点前四项必须同时成立：

1. 摘要去空白后 ≥ 20 字符。
2. `estimateTextTokens(summary) ≤ 2,000 × 1.5`（防止模型无视 `maxTokens`）。
3. 释放量 `sourceTokens − summaryTokens ≥ max(1,000, sourceTokens × 5%)`。
4. 压缩后总估算小于压缩前，且至少小 1,000 token。

任一不满足：不写检查点，按压缩失败处理，提示「摘要未能有效压缩，已保留原上下文」。

## 7. 触发方式与溢出恢复

| 方式 | 行为 |
| --- | --- |
| 自动 | 发送前检查并同步压缩，界面显示「正在压缩上下文…」 |
| 手动 | 浮层「立即压缩」，不等阈值；对话太短返回「无需压缩」 |
| 溢出恢复 | 供应商明确报超长且本轮无输出、无工具时，强制压缩并重试一次 |
| 关闭自动 | 只保留手动与溢出恢复 |

溢出自动重试要求四条全部满足：

- 错误被识别为上下文超长（`context_length_exceeded` / `maximum context length` / `context window` / `too many tokens` / `prompt is too long` / `input is too long` / `reduce the length of the messages`，含 `cause` 链）。
- 本轮还没有向界面发出任何 `delta`。
- 本轮没有执行过工具（否则可能重复写操作）。
- 用户没有主动停止。

溢出时从错误文案解析真实上限 N（`4,000 ≤ N ≤ 10,000,000`），写入 `learned`（不覆盖 `manual`），再按 N 压缩；此时只保留最新 1–2 条消息（或 `10% × N`，取更小者）。仍失败说明固定开销本身已超窗口，直接报错并建议换更大窗口模型或新建对话。

## 8. 失败降级

- 自动压缩失败不阻塞发送：退回 token 预算裁剪（`W − 固定开销 − O − B`），不再使用旧的 8k 字符预算，并在 system prompt 追加「更早的 N 条未包含」。
- 界面用状态条提示「自动压缩失败：<原因>，本次仅携带最近对话」，不弹模态。
- 摘要调用空返回或被 `maxTokens` 截断时重试一次（`maxTokens` 提到 4,000）；网络 / 鉴权错误不重试，避免重复计费。
- 失败与停止都不写检查点；手动压缩被停止时广播 `compaction.failed`（已停止），不广播 `chat:stopped`。

## 9. 数据模型（schema v7）

```sql
CREATE TABLE IF NOT EXISTS conversation_checkpoints (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  covered_message_id TEXT NOT NULL,
  covered_message_count INTEGER NOT NULL,
  omitted_message_count INTEGER NOT NULL DEFAULT 0,
  summary_tokens INTEGER NOT NULL,
  source_tokens INTEGER NOT NULL,
  model TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_conversation
  ON conversation_checkpoints(conversation_id, created_at_ms DESC);
```

- 追加式：每次压缩插一行，「当前检查点」取最新一行；旧检查点保留，便于排查「哪次压缩压掉了什么」。
- `covered_message_id` 指向 `messages.id`；查询用 `rowid > (SELECT rowid FROM messages WHERE id = ?)` 而不是时间戳，避免同毫秒排序歧义；边界找不到时回退为全部消息（安全侧）。
- `covered_message_count` 是累计覆盖条数（含旧检查点已覆盖的部分）。
- `omitted_message_count` 只影响提示文案，不影响边界。
- `source_tokens` / `summary_tokens` 为本地估算值，用于展示释放量与收缩校验。
- 删除会话时级联删除检查点。

迁移与回滚：

- `SCHEMA_VERSION` 6 → 7，`current < 7` 段内建表建索引，幂等可重入；升级前生成 `backups/toolbox-before-v7-*.db`。
- 旧版本（v6）程序可打开 v7 库（迁移直接返回），但 v7 快照不能被 v6 的恢复接受，回滚需手动替换数据库文件。
- 回滚脚本：`DROP INDEX` → `DROP TABLE` → `PRAGMA user_version = 6`；不修改、不删除任何消息。

## 10. IPC 与视图类型

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `chat:context` | `conversationId` | `ChatContextView` | 只读；估算 + 检查点 + 上次实测 |
| `chat:compact` | `{ conversationId }` | `ChatCompactResult` | 手动压缩；进行中拒绝重复调用 |

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `chat:event:context` | `{ conversationId, context }` | 每轮结束、压缩完成、窗口 / 模型变化后广播 |
| `chat:event:compaction` | `{ conversationId, phase, message?, result? }` | `started / finished / failed / skipped`；`started` 不带摘要正文 |

| 类型 | 关键字段 |
| --- | --- |
| `ChatContextBreakdown` | `system` / `tools` / `summary` / `messages` |
| `ChatContextUsage` | `inputTokens` / `outputTokens` / `totalTokens` / `model` / `measuredAtMs` |
| `ChatCheckpointView` | `id` / `coveredMessageId` / `coveredMessageCount` / `omittedMessageCount` / `summary` / `tokens` / `sourceTokens` / `model` / `createdAtMs` |
| `ChatContextView` | `windowTokens` / `windowSource`（五值）/ `thresholdTokens` / `estimatedTokens` / `percent` / `breakdown` / `lastUsage` / `checkpoint` / `autoCompact` / `compacting` / `messageCount` |
| `ChatCompactResult` | `compacted` / `coveredMessages` / `freedTokens` / `message?` / `checkpoint?` |

- 新增能力按 shared 类型 → `ipc-contract` → bridge / preload → renderer 四处同步。

## 11. 并发与取消

- `AiGateway.active` 每会话记录 `{ controller, kind: 'send' | 'compact' }`。
- 生成中请求手动压缩 → 拒绝并提示「正在生成回复，请先停止」。
- 压缩中发送 → 拒绝并提示「正在压缩上下文，请稍候」。
- `chat:stop` 同时中止生成与压缩。
- 自动压缩被停止时用户消息保留，按现有停止语义广播 `chat:stopped`。
- `hasActiveRuns()` 把压缩计入，避免恢复快照时被写库打断。

## 12. 设置项

- 档案按模型存 `modelContextLimits`，不存全局 `contextWindow`，否则在 A 模型手填 1M 后切到 B 模型会沿用错值。
- 视图侧 `source` 为 `manual | api | learned`；入参侧只接受 `manual | api` 或 `null`，`null` 表示删除手动值并回落到自动值。
- 校验：`4,000 ≤ tokens ≤ 10,000,000` 的整数；模型 id 长度 ≤ 80，单档案最多 300 个模型。
- 保存档案后主进程后台刷新一次 `/models`（10 秒超时、失败静默），把 `contextWindows` 合并进 `modelContextLimits`。
- 自动压缩开关存 `contextAutoCompact`（默认 `true`），经 `config:set` 写入，校验层必须显式接受布尔值；开关只放在浮层，设置页不重复。
- 设置页提供手动窗口输入与「重新检测」；「重新检测」只解析 `/models`，不发对话请求。

## 13. 错误矩阵

| 场景 | 行为 |
| --- | --- |
| 未配置模型 / Key | `chat:context` 仍返回估算；压缩按钮禁用；发送走现有错误提示 |
| 自动压缩摘要失败 | 不写检查点，降级裁剪并继续发送 |
| 手动压缩失败 | 返回可读原因，不写检查点，不发消息 |
| 摘要没有变小 | 判失败，保留原上下文 |
| 报超长且无输出、无工具 | 压缩一次 + 重试一次；仍失败给可操作提示 |
| 报超长但已输出或已用工具 | 不自动重试，提示手动压缩或新建对话 |
| 切换成更小窗口模型 | 下一次发送前按新窗口判断并压缩；`chat:context` 立即反映 |
| `/models` 不返回窗口 | 回落到手动 / 学习 / 目录 / 128k，浮层提示可手填 |
| 接口值高于套餐上限 | 按接口值判断；真实超长后解析 N 写 `learned` 并重试 |
| 单条消息超窗口 | 发送前拒绝，提示拆分或调大窗口，不落库 |
| 供应商不返回 usage | `lastUsage = null`，只显示估算，不影响压缩 |
| 写检查点失败 | 本次按压缩失败降级，不阻塞发送；日志 ERROR 不含正文 |

## 14. 隐私与成本

- 摘要与普通对话走同一供应商、同一 Key，不新增外发对象。
- 摘要正文只落本地 `toolbox.db`，不写日志、不进遥测；备份 / 快照会包含摘要，与聊天记录同等对待。
- 提示词要求不复述密码、Key 与 Token，但摘要仍是模型生成，不能保证 100%；浮层首次使用给一句说明。
- 每次压缩 = 一次额外模型调用（输入为被压缩段，输出 ≤ 2,000 token）；浮层固定提示可能产生费用。
- 关闭自动压缩后，只有点击「立即压缩」才会发起摘要调用；不做后台预压缩。

## 15. 明确不做

- 不持久化 usage，不建 `conversation_usage` 表。
- 不挂 LangChain `summarizationMiddleware`：本项目每轮从 SQLite 重放历史，中间件的摘要不会跨轮保存。
- 不做单独摘要模型配置、`/compact` 斜杠命令、工具结果预裁剪、图片卸载与供应商原生加密压缩。

阈值、选段与收缩校验由合成数据覆盖；真实供应商的窗口元数据与摘要质量仍需实机体验确认。
