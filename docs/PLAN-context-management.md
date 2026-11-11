# 对话上下文：占用可视化与压缩

日期：2026-11-11
状态：**已实施**（按本方案落地；用户确认「开始按照计划实现」）。

## 0. 实施记录

| 项 | 结果 |
| --- | --- |
| schema | v6 → v7，新增 `conversation_checkpoints` + 1 个索引；升级前 `backups/toolbox-before-v7-*.db`；不改 `messages` |
| 窗口 | `/models` 解析 `context_window` / `context_length` / `max_model_len` / `meta.n_ctx_train` / `inputTokenLimit` 等；按模型保存 manual / api / learned；接口不返回时按供应商目录兜底（`shared/model-context.ts`）；默认 128k；保存后后台刷新一次，失败静默；设置页「获取模型列表」也会解析 |
| 估算 | `shared/context-tokens.ts` 中文保守估算；`shared/context-budget.ts` 阈值 / 保留 / 收缩校验 |
| 压缩 | 发送前超阈值自动压缩；手动 `chat:compact`；摘要失败退回 token 裁剪并注入提示；溢出仅无输出、无工具时压缩重试一次 |
| 存储 | `covered_message_id` 用 rowid 边界；`covered_message_count` 累计；`omitted_message_count` 记录二次裁剪未纳入摘要的条数 |
| IPC | `chat:context` / `chat:compact` + `chat:event:context` / `chat:event:compaction` |
| 界面 | 标题栏占用、浮层分项与来源、自动压缩开关、立即压缩、检查点卡片、设置页窗口输入 |
| 验证 | `npm run typecheck`、桌面 `lint`、桌面 `test`（153 files / 1151 tests）、`build` 通过；`node verify/desktop-ui/run.cjs --context-only --screenshots` 2 项通过 |

实现偏差：没有接 models.dev 目录；接口窗口在保存后后台刷新一次（失败静默），设置页「获取模型列表」也会解析并随档案保存。

---

## 0. 结论摘要

当前对话的问题不是「模型记性差」，而是**本地先把历史丢了**：

- 每轮只带最近 `MAX_HISTORY_CHARS = 8_000` 个字符（`src/shared/constants.ts:21`），按「轮」从旧到新整段丢弃（`src/shared/history.ts:32`）；
- 界面没有任何上下文占用显示，用户不知道什么时候会丢、丢了多少；
- 没有摘要，也没有「模型窗口」概念；换一个 32k 窗口的模型和 200k 窗口的模型，行为完全一样。

建议按 **P0 可视化 → P1 压缩** 两期做：

1. **度量**：优先用供应商返回的 `usage_metadata` 作为实测值；没有实测时用「中文保守估算」补增量。窗口优先从 `/models` 接口元数据读取（DeepSeek 的 `context_window`、Kimi 的 `context_length` 等），其次手动覆盖、错误学习、内置供应商目录，最后才用 128k 保守默认。
2. **自动压缩**：请求前估算总占用，超过 **min(窗口 × 80%, 窗口 − 输出预留 − 安全余量)** 时，把「较早的一段」交给一次模型调用生成检查点摘要，保留最近约 15k token 原文，然后继续正常请求。
3. **手动压缩**：上下文浮层提供「立即压缩」，不等到阈值；显示压缩条数、释放的 token。
4. **溢出恢复**：供应商明确报「上下文超长」且本轮还没输出、没执行工具时，强制压缩一次并重试一次；执行过工具就不自动重试，避免重复写操作。
5. **可见**：标题栏显示 `上下文 42%`，浮层展示窗口 / 已用 / 摘要 / 最近消息 / 上次实测；消息流里显示「已压缩 N 条」的检查点卡片，原始消息仍保留。

参考实现不是照搬，而是各取一段：

| 来源 | 采用 | 不采用 |
| --- | --- | --- |
| OpenCode V2 Compaction | `auto`、按窗口比例留 buffer、保留最近约 15k token、摘要覆盖「较早对话」、溢出后压缩重试一次、旧消息仍存储、手动压缩 | Provider 原生加密检查点、后台预压缩、图片卸载 |
| DeepSeek Harness `dsh-compaction-basic` | 触发阈值 = `min(窗口×0.8, 窗口−输出−余量)`、保留最近 16%、结构化检查点、`<compacted-summary>` 包裹、摘要必须真的变小、`/compact` 手动入口、工具结果先裁剪 | 会话日志/事务锁/模型切换专用错误码等重型机制 |
| LangChain JS `summarizationMiddleware` | 触发条件、保留条件、`trimMessages` 的 token 裁剪、摘要消息替换旧消息的思路 | 直接挂中间件（本项目没有 checkpointer，历史每轮从 SQLite 重放，中间件的摘要不会跨轮保存） |

**需要用户授权后才能动手的部分**：schema v6 → v7（新增检查点表）、2 个新 IPC 通道、2 个新事件、档案新增按模型的 `modelContextLimits` 字段。详见第 7、8、9 节和文末「待确认」。

---

## 1. 现状审计

| 位置 | 现在的行为 | 问题 |
| --- | --- | --- |
| `src/shared/constants.ts:21` | 单次请求历史预算 8,000 字符 | 中文约 8k token 以内；多数模型窗口远大于此，等于主动丢上下文 |
| `src/shared/history.ts:32` | 从最新一轮往回累加字符，超出就整段丢弃更早轮次 | 只裁剪、不摘要；丢弃后只在 system prompt 里加一句「更早的 N 条未包含」 |
| `src/main/services/ai-gateway/ai-gateway.ts:100` | 每轮 `trimHistory(listMessages(...), MAX_HISTORY_CHARS)` | 没有模型窗口、没有工具定义/系统提示的占用概念 |
| `src/main/services/agent/agent-runner.ts:115` | 把 `ChatMessage[]` 原样转成 Human/AI 消息 | 没有检查点消息，也没有 usage 回传 |
| `src/main/services/chat-store/chat-store.ts:371` | `messages` 只有 `id / conversation_id / role / content / created_at_ms` | 没有「摘要覆盖到哪条消息」的边界；消息本身不删除是对的 |
| `src/renderer/src/components/chat-panel.tsx:31` | 标题栏只有权限下拉和 READY/STREAMING | 用户看不到上下文占用、无法主动压缩 |
| `src/main/services/ai-gateway/errors.ts:52` | 只识别 401/403/404/429/超时/网络 | 不识别「上下文超长」，无法做溢出恢复 |

已有的可复用件：

- `src/renderer/src/components/opencode/agent-context-status.tsx` 已经有一套「上下文 X% + Popover + 进度条 + 准备压缩」的交互，样式在 `global.css` 的 `.agent-context-status` / `.agent-context-popover`，可直接复用视觉；
- `@shared/usage-format` 的 `formatCompact` / `formatPercent` 已有，不另造数字格式；
- `ChatOpenAI` 默认 `streamUsage = true`（`@langchain/openai` 1.6），流式最后会带 `usage_metadata`，可以直接拿供应商实测值。

---

## 2. 参考实现的关键事实

### 2.1 OpenCode V2

来源：[OpenCode Docs · Compaction](https://opencode.ai/docs/compaction/)（2026-11 抓取）。

- 自动压缩默认开启；默认 `buffer` 为窗口的 15%（至少 16k），即用到约 85% 时触发；
- 默认保留最近约 **15,000 token** 原文，摘要覆盖更早的整段对话；
- 摘要请求发送「完整当前对话 + 摘要指令」，便于复用供应商的 prompt cache；后续压缩基于上一个检查点增量更新；
- 摘要结构面向「另一个 agent 接手」：目标、下一步、决定、已完成/进行中、阻塞、相关文件；
- 供应商明确拒绝「太长」时，压缩后**重试一次**，第二次仍失败才报错；
- 旧消息仍然存储，只是不再发送给模型；
- 手动压缩可在任意时刻发起，等待安全点执行；`compact` 进行中收到的提示会排队；
- 还支持 provider 原生压缩，但只对特定 OpenAI Responses 模型有效。

### 2.2 DeepSeek Harness `dsh-compaction-basic` 0.2.2-rc.1

来源：本机 DSH 安装包内 `@deepseek-ai/dsh-compaction-basic/README.md`（已核对实现说明）。

- 触发：`floor(min(W × 0.8, W − O − B))`，`W` 为窗口，`O` 为输出预留，`B` 默认 **65,536** token 余量；
- 保留：最近 `16% × (W − O)` 原文；
- 摘要调用复用原请求的 system prompt / 工具 / 被摘要消息，尽量命中 warm prefix；
- 检查点用 `<compacted-summary>` 包裹，前置一段固定说明，告诉模型「这是已发生的背景，不要复述」；
- 摘要必须让上下文**真的变小**，否则拒绝替换；
- 工具结果先由独立 pruner 裁剪（无模型调用），裁完够用就不再摘要；
- 自动触发失败只告警并继续；溢出恢复只针对 `CONTEXT_WINDOW_EXCEEDED`，且只重试一次；
- `/compact` 手动压缩，报告压缩条数与释放 token；
- 明确承认 token meter 用「4 字符 ≈ 1 token」的启发式，**会低估 CJK**。

### 2.3 LangChain JS 1.5.18

来源：`node_modules/langchain/dist/agents/middleware/summarization.js` 与 `@langchain/core` 的 `trimMessages`。

- `summarizationMiddleware({ model, trigger, keep, tokenCounter, summaryPrompt, summaryPrefix, trimTokensToSummarize })`；
- `trigger` 支持 `tokens` / `messages` / `fraction`（多个条件是 AND，多个条件是 OR）；
- `keep` 只能三选一；默认保留 20 条消息；
- 内部用 `trimMessages(strategy: 'last', allowPartial: true)` 控制摘要输入，默认 4,000 token；
- 摘要替换方式：`RemoveMessage(REMOVE_ALL_MESSAGES)` + 一条 `HumanMessage(summaryPrefix + summary)` + 保留的最近消息；
- 默认 token 计数器 `countTokensApproximately` 是 **4 字符 = 1 token**，对中文同样低估；
- 关键限制：它操作的是 LangGraph state。本项目 `runAgent` 不接 checkpointer，每轮从 `ToolboxStore` 重新喂历史（`agent-runner.ts:50` 注释），所以**不能只挂中间件就以为摘要会跨轮保存**。

这三者共同说明：压缩本身不复杂，难的是「度量准确、边界清楚、失败可降级、压缩后真的变小」。

---

## 3. 目标与非目标

### 目标

1. 用户随时能看到「当前上下文用了多少、窗口多大、什么时候会压缩」。
2. 长对话不再因为本地 8k 字符预算而静默丢失；超出窗口前自动摘要，保留最近原文。
3. 用户能手动压缩，看到压缩了多少条、释放了多少 token。
4. 压缩失败、供应商报超长、切换小窗口模型时，行为可解释、可恢复，不白屏、不重复写操作。
5. 原始消息不删除；摘要只是「发送给模型时的替身」，界面仍可回看原文。

### 非目标

- 跨设备同步、云端记忆、向量化长期记忆；
- 修改 Agent system prompt 的人格/权限设定；
- 让模型自己决定压缩（本轮先由本地阈值决定，避免模型误判）；
- 压缩工具调用轨迹（当前工具轨迹本来就不落库，见 `agent-runner.ts:50`）；
- Provider 原生加密压缩、后台预压缩、图片卸载（没有对应场景/依赖）。

---

## 4. 总体设计

```
用户发送
  ↓
写入 user 消息（保留）
  ↓
读取「最近检查点 + 检查点之后的消息」
  ↓
估算：固定开销（system + tools）+ 摘要 + 消息
  ↓
超过阈值? ──否──→ 直接跑 Agent
  │是
  ↓
选段：较早消息（不含最近保留尾部）
  ↓
一次摘要模型调用（同模型，temperature=0）
  ↓
校验摘要确实变小 → 写入检查点
  ↓
用「检查点摘要 + 最近尾部」跑 Agent
  ↓
捕获本轮 usage_metadata → 广播上下文视图
```

核心概念：

| 概念 | 定义 |
| --- | --- |
| 固定开销 | system prompt + 当前权限下暴露的工具 schema + 每条消息的结构开销；每次压缩都省不掉 |
| 检查点 | 一条本地记录，保存摘要文本、覆盖到的最后一条消息 id、覆盖条数、摘要 token、模型、时间 |
| 保留尾部 | 检查点之后仍然原文发送的最近消息，默认约 15k token |
| 触发阈值 | 总估算超过 `min(0.8W, W − O − B)` 时压缩；`W` 窗口、`O` 输出预留、`B` 安全余量 |
| 实测 | 供应商 `usage_metadata` 的上一次请求输入/输出；只在内存中保留，重启后没有 |
| 估算 | 固定开销 + 摘要 + 消息的保守计算；界面一律加「约」 |

---

## 5. 度量方案

### 5.1 实测优先

`ChatOpenAI` 默认在流式请求里带 `stream_options.include_usage`，最后的 chunk / `on_chat_model_end` 会有：

```ts
usage_metadata: {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_token_details?: { cache_read?: number }
}
```

在 `agent-runner` 的 `streamEvents` 循环里记录**最后一次**模型调用的 usage，作为「上次请求实测」。工具循环中最后一次请求包含工具结果，所以这个值适合展示「上一次请求峰值」，不适合直接当作下一轮持久上下文。

`RunAgentResult` 增加：

```ts
usage: {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model: string
  measuredAtMs: number
} | null
```

由 `AiGateway` 存在内存 `Map<conversationId, ChatContextUsage>` 里；`chat:context` 读取。重启后为空，界面显示「估算」，不影响功能。

### 5.2 估算公式（只用于增量与压缩决策）

不引入 `js-tiktoken`：

- 它对 DeepSeek / Qwen / GLM / Kimi 的分词器并不准确；
- `@langchain/core/utils/tiktoken` 还需要联网拉 rank 文件，离线不可用；
- 单独打包 `o200k_base` 体积不小，收益有限。

采用与 DSH token meter 同类的「字符 + 结构开销」思路，但把中文权重修正为保守值：

```
CJK 字符（含中文标点）      × 1.0
其他字符（英文/数字/符号）  ÷ 3.5
每条消息                    + 8
工具 schema（JSON 文本）    ÷ 3.5
```

中文按 1 字 ≈ 1 token 是一个**中间值**：对 DeepSeek / Qwen 略保守（约 0.6 token/汉字），对较老的 OpenAI 分词器可能略低（约 1.3 token/汉字）。所以它不保证「永远高估」，真正的兜底是 4k 安全余量、供应商实测值和溢出恢复。浮层一律写「约」，不宣称精确；如果实测持续明显高于估算，P2 再加会话内校准系数。

建议实现为 `src/shared/context-tokens.ts`：

```ts
export function estimateTextTokens(text: string): number
export function estimateMessageTokens(message: { content: string }): number
export function estimateMessagesTokens(messages: Array<{ content: string }>): number
export function estimateToolsTokens(tools: unknown[]): number
```

单测覆盖：纯中文、纯英文、中英混排、空串、超长单条、JSON schema。

### 5.3 窗口从哪来（接口优先，不靠猜）

**标准 OpenAI `/v1/models` 不保证返回上下文窗口**，只保证 `id / object / owned_by`；但越来越多 OpenAI 兼容端点扩展了字段。能拿到就用，拿不到才降级：

| 来源 | 字段 | 备注 |
| --- | --- | --- |
| DeepSeek `/models` | `context_window` | 官方文档示例：DeepSeek V4 为 `1,048,576` |
| Kimi / Moonshot `/v1/models` | `context_length` | 官方文档明确返回 |
| OpenRouter `/api/v1/models` | `context_length` / `top_provider.context_length` | 聚合网关常见 |
| 阿里百炼原生 `/api/v1/models` | `output.models[].model_info.context_window` | 不是 OpenAI 兼容的 `/v1/models`，需要单独适配 |
| vLLM `/v1/models` | `max_model_len` | 新版本会暴露 |
| llama.cpp server `/v1/models` | `meta.n_ctx_train` | 本地模型 |
| Gemini 原生 `models.list` | `inputTokenLimit` | OpenAI 兼容端点不一定带 |
| LM Studio | `max_context_length` | 本地模型 |

因此新增 `extractModelLimits(payload)`：同时解析上述别名与嵌套字段，只接受 `4,000 ≤ value ≤ 10,000,000` 的整数；同一模型命中多个字段时按 `context_window → context_length → max_input_tokens → max_model_len → …` 的顺序取第一个可信值。不要只解析 `id` 就把整段响应丢掉——现在的 `model-fetcher.ts` 正是这样。

按「模型」存一张表，而不是给整个档案写一个窗口：

```ts
modelContextLimits[model] = {
  tokens: number
  source: 'manual' | 'api' | 'learned'
  updatedAtMs: number
}
```

解析顺序：

1. **`manual`**：用户在设置页为这个模型手填的值，优先级最高，任何自动刷新都不覆盖；
2. **`api`**：`/models` 返回的元数据；刷新时覆盖同模型的 `learned`，但保留 `manual`；
3. **`learned`**：供应商报「maximum context length is N tokens」时解析出的 N；覆盖 `api`，但不覆盖 `manual`；
4. **`catalog`**：接口不返回窗口时，按「供应商 + 模型 id」查内置目录兜底（`src/shared/model-context.ts`，值取自 models.dev 2026-11-11 快照；OpenCode Go 的 `deepseek-v4.1-flash` 为 1M，DeepSeek 官方 V4 为 1,048,576）；自定义供应商按 OpenAI 兼容端点识别 OpenCode Go / DeepSeek 官方地址；
5. **保守默认**：以上都没有时用 `128,000`，`windowSource = 'default'`，界面明确写「未检测到，默认 128k，可刷新或手填」。

`windowSource` 取 `'manual' | 'api' | 'learned' | 'catalog' | 'default'`，浮层如实显示。这样 DeepSeek V4 / Kimi 这类返回元数据的模型会直接拿到 1M；OpenCode Go 这种只返回 id 的网关也能命中目录，而不是被打回 128k。目录按 provider 分组，不跨供应商套用同名模型，免费层后缀（如 `-free`）也不会命中。

**不做「模型名 → 窗口」的全局硬编码表**：目录只在供应商维度、且接口/手动/学习都缺失时兜底；同一模型在不同网关的差异由 provider 分组隔离。也不做「故意发超长请求探测窗口」：浪费额度，且部分供应商会按输入计费。

输出预留 `O = 8,192`（当前请求没有设 `maxTokens`，给回答留空间），安全余量 `B = 4,096`。如果接口返回了 `max_output_tokens`，只取 `min(该值, 8,192)` 作为预留，不因为模型能输出 393k 就把整个窗口让给输出。

### 5.4 固定开销

- system prompt：`agentSystemPrompt()` 已有缓存，按 `estimateTextTokens` 计算；
- 工具 schema：按当前权限过滤后的工具定义 JSON 计算；工具集是静态的，按 `permission` 缓存；
- 每条消息的结构开销：估算函数里已加。

固定开销不参与摘要（省不掉），但必须计入触发阈值，否则「工具定义很大 + 窗口很小」时会误判。DSH 的 README 也明确说压缩不能减少 system/tools/prefix。

### 5.5 展示口径

浮层主数字：**下一轮请求的估算总量** = 固定开销 + 摘要 + 检查点之后的消息。

副数字：**上次实测** = 上一次模型调用的 `input_tokens + output_tokens`，注明「含工具过程，可能高于下一轮」。

这样不会出现「显示 42%，实际请求 90%」的错觉，也不会把工具循环的峰值当成持久占用。

---

## 6. 压缩算法

### 6.1 默认参数

| 参数 | 默认 | 说明 |
| --- | ---: | --- |
| `W` 窗口 | 接口元数据 / 档案手填 / 128,000 | 解析顺序见 5.3 |
| `O` 输出预留 | 8,192 | 给回答留的空间 |
| `B` 安全余量 | 4,096 | 估算误差 + 请求结构波动 |
| 触发阈值 | `min(0.8W, W − O − B)` | 128k → 102,400；32k → 20,800（O/B 按窗口比例封顶） |
| 保留尾部 | `clamp(0.15 × (W − O), 4,000, 15,000)` | 128k → 15,000；32k → 4,000 |
| 摘要输出上限 | 2,000 token | 中文约 2,000 字；提示词要求简洁 |
| 自动压缩 | 开 | 可在浮层关闭 |
| 溢出重试 | 1 次 | 仅在无输出、无工具时 |
| 压缩后最小释放 | 1,000 token 且 ≥ 5% | 否则视为无效摘要 |

与参考实现的差异：OpenCode 默认保留 15k、buffer 15%；DSH 默认保留 16%、余量 64k。本项目窗口通常较小、对话偏个人数据，取 15k 上限 + 4k 下限，避免 32k 窗口下保留过多导致摘要没地方放。

### 6.2 请求前流程

```
prepareContext(conversationId, userMessage):

  checkpoint = latestCheckpoint(conversationId)
  messages   = listMessagesAfter(conversationId, checkpoint.coveredMessageId)
  fixed      = systemTokens + toolTokens
  estimate   = fixed + tokens(checkpoint.summary) + tokens(messages)

  if !autoCompact || estimate <= threshold:
      return build(checkpoint, messages)

  if messages.length <= 2:            // 只有最新一问一答，没东西可压
      return build(checkpoint, messages)

  span = selectSpan(checkpoint, messages, tailBudget)
  if span.source.length === 0:
      return build(checkpoint, messages)

  summary = await summarize(span)
  if !summaryShrinks(span, summary):
      throw CompactionNoShrink

  checkpoint = store.insertCheckpoint(...)
  return build(checkpoint, span.tail)
```

`build` 生成：

```
[HumanMessage(summaryPreamble + "<compacted-summary>" + summary + "</compacted-summary>")?]
+ [Human/AI messages...]
```

摘要消息用 **HumanMessage**，不用 SystemMessage：

- 保持 user/assistant 交替合法（历史可能从 assistant 开始）；
- 摘要来自历史内容，不应获得 system 级指令权，降低「摘要里夹带指令」的注入风险；
- 与 LangChain `summarizationMiddleware`、DSH 的检查点做法一致。

### 6.3 选段

1. **不要**把旧摘要放进 `trimMessages` 的输入。旧摘要单独保存：它只作为摘要调用的第一条 HumanMessage，用来合并旧信息；如果混进 tail，会出现「新摘要 + tail 里还有旧摘要」的重复。
2. 对「检查点之后的消息」用 LangChain `trimMessages` 从后往前保留 `tailBudget`：

```ts
trimMessages(historyMessages, {
  maxTokens: tailBudget,
  tokenCounter,
  strategy: 'last',
  startOn: 'human',
  allowPartial: false,
  includeSystem: false
})
```

3. `trimMessages` 返回的第一条消息之前的消息就是 `source`；`source` 的最后一条 id 就是新检查点的 `coveredMessageId`。摘要调用的输入 = `[旧摘要（若有）, ...source, 摘要指令]`。
4. 最新一条用户消息永远保留：`trimMessages` 的 `strategy: 'last'` 天然保留；再加一道断言，若最新 user 不在 tail 中，回退到「最后两条消息」。
5. `source` 为空、或 `source` 只有 1 条且估算 < 1,000 token 时，不压缩（返回 `no-op`）。
6. `trimMessages` 抛错（预算连一条消息都放不下）时，回退到「最后两条消息」；仍不行则 `no-op`。

`allowPartial: false` 很重要：检查点边界必须落在完整消息上，不能把一条消息截一半存进摘要、一半留在原文。

如果 `source` 本身大到摘要模型也放不下，会再裁剪一次；这时**诚实记录** `omitted_message_count`（有多少条更早消息没进入摘要输入），界面显示「最早 N 条未纳入摘要」，不假装它们还在上下文里。这沿用 `shared/history.ts` 的原则：宁可说没带上，也不让模型误以为自己记得。

### 6.4 摘要调用

- 模型：默认当前对话模型（`config.model`），`temperature: 0`，`maxTokens: 2,000`，`maxRetries: 0`；
- 消息：`[SystemMessage(基础 system prompt，不带「历史被裁剪」提示), ...sourceMessages, HumanMessage(summaryInstruction)]`；
- 复用同一 system prompt 与消息原文，尽量命中供应商的 prompt cache（OpenCode / DSH 都这么做）；v1 不绑定工具 schema，避免模型在摘要时发起工具调用，也避免某些兼容端点不支持 `tool_choice: none`；
- 输入过长时，用 `trimMessages` 对 `source` 再做一次 `strategy: 'last'` 裁剪，预算 `W − O − 2,000 − 2,048`；被裁掉的最旧部分在指令里说明「更早内容未包含，按现有内容总结」；
- 超时复用 `CHAT_TIMEOUT_MS`（120s）；用户停止时 abort，不写检查点；
- 只取返回文本，不使用流式增量展示；摘要调用不产生聊天消息，也不广播 `chat:event:delta`；
- 空摘要、或明显被 `maxTokens` 截断时，重试一次（`maxTokens` 提到 4,000）；仍失败则按压缩失败处理，不写检查点；网络/鉴权错误不重试，避免重复计费。

### 6.5 摘要结构

新增 `assets/prompts/context_summary.txt`，中文提示词，要求输出固定 Markdown 结构：

```markdown
## 用户目标与意图
## 已完成的操作与结果
## 关键事实与用户偏好
## 涉及的对象与标识
## 未完成与下一步
## 重要约束与上下文
```

规则：

- 用简洁条目，不写散文；空段落写「（无）」，不省略段落；
- 保留精确名称、ID、数字、日期、路径、用户原话；不确定的内容不要编造；
- 不复述密码、API Key、Token、完整密钥；用「已配置/已保存」这类描述代替；
- 如果输入里已有 `<compacted-summary>`，它是旧检查点：保留仍成立的事实、删掉过期内容、合并新信息，不要原样抄一遍；
- 只输出摘要正文，不要输出解释、前言、代码围栏或工具调用。

### 6.6 检查点注入文本

固定前缀（中文，保持与 system prompt 一致）：

```text
这是系统自动生成的对话检查点，用于在释放上下文空间的同时保留此前进展。
请把它当作已经发生的背景，不要复述或确认这份摘要，直接继续后续对话。
```

后面接 `<compacted-summary>` … `</compacted-summary>`。用标签是为了：

- 一眼看出这是摘要而不是用户新说的话；
- 后续压缩能识别旧检查点并合并；
- 调试/日志（仅结构，不记录正文）能区分。

### 6.7 校验：摘要必须真的变小

写入前校验：

1. 摘要非空，去掉首尾空白后 ≥ 20 字符；
2. `estimateTextTokens(summary) ≤ 2,000 × 1.5`（防止模型无视 `maxTokens`）；
3. `sourceTokens − summaryTokens ≥ max(1,000, sourceTokens × 0.05)`；
4. 压缩后的总估算（固定开销 + 摘要 + 尾部）必须小于压缩前，且至少小 1,000 token。

任一不满足：不写检查点，按失败处理。DSH 明确拒绝「不 shrink 的摘要」；否则会出现「压缩了一次，上下文反而更大」。

### 6.8 触发方式

| 方式 | 行为 |
| --- | --- |
| 自动 | 发送前检查，超阈值同步压缩，再发请求；界面显示「正在压缩上下文…」 |
| 手动 | 浮层「立即压缩」；不等阈值，但仍要求 `source` 非空、摘要能变小；对话太短返回「无需压缩」 |
| 溢出恢复 | 供应商明确报上下文超长，且本轮无输出、无工具调用时，强制压缩一次（保留更少尾部）并重试一次 |
| 关闭自动 | `contextAutoCompact = false` 时只保留手动与溢出恢复；溢出恢复仍建议保留，避免用户完全无路可走 |

自动压缩失败不阻塞发送：

- 退回 token 预算裁剪（无摘要），预算用 `W − 固定开销 − O − B`，而不是旧的 8k 字符；并在 system prompt 里追加「更早的 N 条未包含」；
- 界面用 `.status-banner` 提示「自动压缩失败：<原因>，本次仅携带最近对话」；
- 日志只记条数、token、错误码，不记摘要正文。

### 6.9 为什么 v1 不挂 LangChain 中间件

`summarizationMiddleware` 很适合「单轮内工具循环太长」的场景，但它：

- 摘要只存在于本次 LangGraph state，本轮结束即丢；下一轮又从 SQLite 重放完整历史，等于白压；
- 它会自动改写消息序列，和我们的检查点边界容易叠加出两份摘要；
- 它假设有 system message 在首位，而本项目的摘要消息是后插入的 HumanMessage。

所以 v1 用「请求前一次性压缩 + 持久化检查点」。P2 如果发现单轮工具循环经常撑爆，再单独评估中间件，并给它加 `lc_source` 标记避免与检查点重复。

### 6.10 溢出恢复的安全边界

只在以下条件全部满足时自动重试：

- 错误被识别为上下文超长（`context_length_exceeded` / `maximum context length` / `too many tokens` / `prompt is too long` 等）；
- 本轮还没有向界面发过任何 `delta`；
- 本轮没有执行过任何工具（`usedTools === false`）；
- 没有用户主动停止。

原因：一旦工具已经执行（尤其是写操作），重试可能让模型再次调用同一个写工具，造成重复写入。此时直接把错误交给用户，并提示「可手动压缩后重试」。

溢出恢复先用 `parseContextLimit(error)` 解析供应商给出的真实上限 N，写入 `modelContextLimits`（`source = 'learned'`，手动值优先），再按 N 压缩。压缩不沿用常规保留预算：窗口可能被接口值/手填值放大了。此时保留 **最新 1–2 条消息**（或 `10% × N`，取更小者），把其余全部纳入摘要，尽量保证「固定开销 + 摘要 + 极短尾部」能真正落进窗口。如果这样仍失败，说明固定开销本身已经超过窗口，直接报错并建议换更大窗口的模型或新建对话。

---

## 7. 数据模型（schema v7）

### 7.1 新表

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

- 追加式：每次压缩插入一行，不更新旧行；「当前检查点」取最新一行。
- 旧检查点保留，便于排查「哪次压缩把什么压没了」；界面只展示最新检查点。
- 删除会话时 `ON DELETE CASCADE` 一起删除。
- `covered_message_id` 指向 `messages.id`；边界之后的消息原文发送。查询用 `rowid > (SELECT rowid FROM messages WHERE id = ?)` 而不是时间戳，避免同一毫秒内多条消息的排序歧义；边界 id 找不到时回退为「全部消息」（安全侧）。
- `covered_message_count` 是累计覆盖条数（**包含**旧检查点已覆盖的数量），便于界面显示「更早的 N 条」；实现时用 `previous.covered_count + source 中实际消息数`。
- `omitted_message_count` 是摘要输入被二次裁剪时、没进入摘要的最早消息条数；没有则为 0。它只影响提示文案，不影响边界。
- `source_tokens` / `summary_tokens` 用于展示释放量和校验，均为本地方案估算值。

### 7.2 为什么不用 messages 表加一列

候选方案：给 `messages` 加 `kind = 'chat' | 'summary'`，把摘要当成一条消息存进去（更接近 DSH 的「检查点就是一条消息」）。

不选的原因：

- 摘要不是用户或 AI 的真实发言，混进 `messages` 会污染 `messageCount`、自动标题、导出、未来可能的消息删除；
- `ChatMessage` 类型会被迫加字段，渲染层、手机端桥接、测试都要跟着改；
- 检查点需要 `covered_message_id`、`source_tokens` 等元数据，塞进消息行会让消息表职责变重。

独立表只影响主进程和「上下文」读取路径，回滚也简单（删表即可）。

如果暂时不授权 schema 变更，退路是把检查点 JSON 塞进现有 `kv`（例如 `conversation_checkpoints_v1`）：能跑，但删除会话不会联动清理、没有按会话查询的索引、也无从审计，长期会变成垃圾场。**不推荐**作为正式方案，只适合验证阶段临时用。

### 7.3 迁移与回滚

- `SCHEMA_VERSION` 6 → 7；`current < 7` 段内 `CREATE TABLE IF NOT EXISTS`，幂等可重入；
- 升级前沿用现有逻辑 `VACUUM INTO backups/toolbox-before-v7-*.db`；
- 旧版本程序（SCHEMA_VERSION=6）打开 v7 库时 `migrate()` 直接 return，会忽略新表，**可以打开**；但 v7 的备份不能被 v6 的「恢复快照」接受（`version > SCHEMA_VERSION` 会拒绝），回滚需要手动替换数据库文件；
- 回滚脚本（写入迁移注释/commit body）：

```sql
DROP INDEX IF EXISTS idx_conversation_checkpoints_conversation;
DROP TABLE IF EXISTS conversation_checkpoints;
PRAGMA user_version = 6;
```

- 不修改 `messages` 表，不删除任何消息。

### 7.4 不做 usage 持久化（v1）

`lastUsage` 只放内存：

- 重启后没有实测值，用估算显示；
- 避免为了一个展示数字再加 4 个列；
- 如果以后要做「跨重启成本统计」，再单独建 `conversation_usage` 表。

---

## 8. IPC 与主进程

### 8.1 新通道

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `chat:context` | `conversationId` | `ChatContextView` | 只读；估算 + 检查点 + 上次实测 |
| `chat:compact` | `{ conversationId }` | `ChatCompactResult` | 手动压缩；进行中拒绝重复调用 |

### 8.2 新事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `chat:event:context` | `{ conversationId, context }` | 每轮结束、压缩完成、模型/窗口变化后广播 |
| `chat:event:compaction` | `{ conversationId, phase, message?, result? }` | `started / finished / failed / skipped`，渲染层显示「压缩中」和失败提示 |

`phase = started` 时不带摘要正文；`finished` 可带 `ChatCompactResult`。

### 8.3 类型（`src/shared/types.ts`）

```ts
export interface ChatContextBreakdown {
  system: number
  tools: number
  summary: number
  messages: number
}

export interface ChatContextUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model: string
  measuredAtMs: number
}

export interface ChatCheckpointView {
  id: string
  coveredMessageId: string
  coveredMessageCount: number
  omittedMessageCount: number
  summary: string
  tokens: number
  sourceTokens: number
  model: string
  createdAtMs: number
}

export interface ChatContextView {
  conversationId: string
  model: string
  windowTokens: number
  windowSource: 'manual' | 'api' | 'learned' | 'default'
  thresholdTokens: number
  estimatedTokens: number
  percent: number
  breakdown: ChatContextBreakdown
  lastUsage: ChatContextUsage | null
  checkpoint: ChatCheckpointView | null
  autoCompact: boolean
  compacting: boolean
  messageCount: number
}

export interface ChatCompactResult {
  compacted: boolean
  coveredMessages: number
  freedTokens: number
  message?: string
  checkpoint?: ChatCheckpointView
}
```

`summary` 放在 `ChatContextView` 里会每次轮询都传一遍（约几百到两千字），可以接受；如果后续嫌大，再拆 `chat:checkpoint` 通道。

### 8.4 四处同步

按仓库约定，新增能力必须同步：

1. `src/shared/types.ts`：上述类型 + `AiProfileView.modelContextLimits?` + `AiProfileInput.modelContextLimits?` + `AiModelListResult.contextWindows?`；
2. `src/shared/ipc-contract.ts`：`IPC.chatContext`、`IPC.chatCompact`；`CHAT_EVENT.context`、`CHAT_EVENT.compaction`；
3. `src/shared/bridge.ts` + `src/preload/index.ts`：`chat.context(conversationId)`、`chat.compact(conversationId)`、`onChatContext` / `onChatCompaction`（按现有事件订阅写法）；
4. `src/main/ipc/register-ipc.ts`：`requireString` 收敛入参，调用 `aiGateway.context()` / `aiGateway.compact()`。

### 8.5 并发与取消

- `AiGateway.active` 从「每会话一个 AbortController」扩展为记录 `{ controller, kind: 'send' | 'compact' }`；
- `send` 时该会话正在压缩 → 拒绝并提示「正在压缩上下文，请稍候」；
- 手动压缩时该会话正在生成 → 拒绝并提示「正在生成回复，请先停止」；
- `chat:stop` 同时中止生成与压缩；
- 手动压缩被停止：不写检查点，广播 `compaction.failed`（message: 已停止），不广播 `chat:stopped`；
- 自动压缩被停止：用户消息已写入（和现有「停止后用户消息保留」一致），广播 `chat:stopped`；
- `hasActiveRuns()` 要把压缩算进去，避免恢复快照时被压缩写库打断。

### 8.6 主进程模块

建议拆分，避免 `ai-gateway.ts` 继续膨胀：

| 文件 | 职责 |
| --- | --- |
| `src/shared/context-tokens.ts` | 中文保守估算；纯函数，两端可测 |
| `src/shared/context-budget.ts` | 阈值、保留预算、选段、收缩校验；纯函数 |
| `src/main/services/ai-gateway/context-service.ts` | 读检查点/消息、组装上下文、调用摘要、写检查点 |
| `src/main/services/ai-gateway/context-prompt.ts` | 读取 `assets/prompts/context_summary.txt`、拼装检查点/指令 |
| `src/main/services/chat-store/chat-store.ts` | `latestCheckpoint` / `insertCheckpoint` / `listMessagesAfter` |
| `src/main/services/agent/agent-runner.ts` | 接受摘要消息、回传 usage |

`AiGateway` 只负责编排：发送前 `contextService.prepare()`，发送后更新 usage 并广播。

---

## 9. 设置

### 9.1 档案字段

不再给档案加一个全局 `contextWindow`（否则在 A 模型手填 1M，切到 B 模型会沿用错值），改为按模型存：

```ts
/** 视图：当前档案每个模型的窗口及来源。 */
modelContextLimits?: Record<
  string,
  { tokens: number; source: 'manual' | 'api' | 'learned'; updatedAtMs: number }
>

/** 入参：渲染层可提交手动值或本次接口值；learned 由主进程写。 */
modelContextLimits?: Record<
  string,
  { tokens: number; source: 'manual' | 'api' } | null
>
```

- 不提升 `ai-settings.json` 的 `version: 2`（与 `embeddingModel` / `rerankModel` 同样的「加可选字段」处理）；
- `settings:models:fetch` 的 `AiModelListResult` 增加 `contextWindows?: Record<string, number>`（本次从 `/models` 解析到的窗口）；设置页把它合并进草稿，保存时以 `source = 'api'` 提交；
- 主进程合并规则：`manual` 永远不被自动值覆盖；`api` 可覆盖 `learned`；`learned` 可覆盖 `api`、但不覆盖 `manual`；入参里的 `null` 表示删除该模型的手动值，回落到 api / learned / 默认；
- 保存校验：`4,000 ≤ tokens ≤ 10,000,000` 的整数；模型 id 最多 300 个、长度 ≤ 80；
- 切换模型/档案时窗口跟着模型走；界面 `windowSource` 如实标注 `manual / api / learned / default`；
- 设置页「重新检测」重新调一次模型列表：拿到新 `api` 值会覆盖同模型的 `learned`，避免一次免费层限流永久锁死；已手工覆盖的模型保持不变；
- **保存档案后主进程后台刷新一次** `/models`（10s 超时，失败静默，不阻塞保存），把 `contextWindows` 合并进 `modelContextLimits`。这样用户即使没点「获取模型」，DeepSeek V4 / Kimi 也会自动拿到 1M，而不是停在 128k 默认值。

### 9.2 自动压缩开关

- 存在现有 `kv` 配置：`contextAutoCompact: boolean`，默认 `true`；
- 通过现有 `config:set` 写入，但必须在 `validateConfigPatch` 里加显式布尔校验（当前该函数对未知字段是透传的，不能依赖前端）；
- 浮层里放一个开关，设置页不重复放。

### 9.3 设置页

在 AI 档案表单里、模型选择附近新增：

```
上下文窗口（Token）  [ 自动：1,048,576 ]  [重新检测]
                     手动填写可覆盖；留空使用接口值或默认 128k
```

- 默认显示当前模型解析出来的值和来源（接口 / 手动 / 错误学习 / 默认）；
- 输入框旁给快捷档位：128k / 256k / 512k / 1M / 2M，点一下填入，仍可手改；
- 「重新检测」复用现有「获取模型」逻辑，解析 `/models` 元数据，不发送对话请求；
- 提示文案：设小了会提前压缩，设大了可能被供应商拒绝（会自动压缩重试一次）。

---

## 10. 界面

### 10.1 标题栏

在权限下拉左侧加一个按钮（复用 `.agent-context-status` / `.agent-context-popover` 的视觉）：

```
上下文 42%   [写操作确认]   [就绪 · READY]
```

- `< 60%`：普通 ghost；
- `60%–80%`：金色描边/文字提示；
- `> 80%`：粉色/警示色，并在 title 里写「接近压缩阈值」；
- 按钮文案始终显示百分比；窗口实际来源放在浮层，不在标题栏堆字。

窄窗口（960px 左右）只显示 `42%`，隐藏「上下文」二字，避免挤压标题和权限下拉。

### 10.2 浮层

```text
当前上下文
约 54,000 / 128,000 Token            42%
[========------------------]  （80% 处画阈值刻度）

系统提示        2,100
工具定义        4,800
检查点摘要      1,900
最近消息       45,200

上次实测：61,300 Token（含工具过程）
压缩阈值：102,400（80%）
窗口来源：接口元数据 / 手动 / 错误学习 / 默认 128k
（DeepSeek V4 这类会显示 1,048,576）

[立即压缩]   [自动压缩 ✓]
压缩会额外调用一次模型，可能产生费用。
```

- `立即压缩`：`.btn-ghost`，压缩中变 `压缩中…` 并禁用；
- `自动压缩`：开关，写入 `contextAutoCompact`；
- 失败时浮层底部用 `.status-banner` 显示原因；
- 检查点存在时显示「上次压缩：11-11 15:20 · 覆盖 36 条 · 释放 28,400 token」。

### 10.3 消息流检查点卡片

在 `coveredMessageId` 对应消息之后插入一张卡片：

```text
┌ 已压缩 36 条更早消息 · 释放约 28,400 Token ──────────┐
│ 原始消息仍保留在下方，仅发送给模型时使用摘要。        │
│ [查看摘要]                                            │
└──────────────────────────────────────────────────────┘
```

- 默认折叠，点击展开摘要正文；
- 若 `omittedMessageCount > 0`，卡片多一行「另有 N 条最早消息未纳入摘要」；
- 摘要正文用 `<pre>`/普通文本，不渲染 Markdown（避免摘要里的链接/图片被误点）；
- 卡片放在消息列表里，滚动位置不变；
- 若 `coveredMessageId` 找不到（理论上只会在数据异常时），卡片放列表顶部。

### 10.4 压缩中的状态

- 自动压缩：`streaming` 已置位，消息气泡显示「正在压缩上下文…」而不是「正在连接模型…」；标题栏状态改为 `压缩上下文 · COMPACTING`；
- 手动压缩：按钮 busy，输入框禁用，状态条显示「正在压缩上下文…」；
- 完成后恢复；失败显示 banner，输入框恢复。

### 10.5 空状态/未配置

- 没有档案或没有 Key：上下文按钮仍显示估算（消息 + 固定开销），浮层提示「配置模型后可压缩」；
- 接口没返回窗口、也没手填：显示「未检测到 · 默认 128k」，并提供「去设置填写」；
- 消息为空：显示 `0%`，不弹任何提示。

---

## 11. 错误、降级与隐私

### 11.1 错误矩阵

| 场景 | 行为 |
| --- | --- |
| 未配置模型/Key | `chat:context` 正常返回估算；压缩按钮禁用；发送仍走现有错误提示 |
| 自动压缩摘要调用失败 | 不写检查点；退回 token 裁剪 + system 提示；banner 说明；继续发送 |
| 手动压缩失败 | 返回错误文案；不写检查点；不发送任何消息 |
| 摘要没有变小 | 视为失败；提示「摘要未能有效压缩，已保留原上下文」 |
| 压缩中被停止 | 不写检查点；手动压缩提示已停止；自动压缩按现有停止语义 |
| 供应商报上下文超长（无输出/无工具） | 强制压缩一次 + 重试一次；第二次失败给出可操作提示 |
| 供应商报超长（已输出/已用工具） | 不自动重试，直接报错，提示手动压缩或新建对话 |
| 切换成更小窗口模型 | 下一次 `send` 前按新窗口重新判断并压缩；`chat:context` 立即反映 |
| `/models` 不返回窗口 | 回落到手动值 / 错误学习 / 默认 128k；浮层提示「未检测到，可手填」 |
| 接口值大于实际套餐上限 | 仍按接口值判断；真实请求报超长后解析 N，写入 `learned`，压缩重试；下次按 N 判断 |
| 套餐升级后 `learned` 偏小 | 设置页「重新检测」或保存新模型列表时清除/覆盖 `learned`；也可手填更大值 |
| 单条用户消息本身超窗口 | 发送前拒绝，提示「消息过长，超出当前模型窗口；请拆分或调大窗口」，不写入消息 |
| 供应商不返回 usage | `lastUsage = null`，只显示估算；不影响压缩 |
| 数据库写检查点失败 | 本次按压缩失败降级；不阻塞发送；日志 ERROR（不含摘要正文） |

### 11.2 错误识别

在 `errors.ts` 增加：

```ts
export function isContextOverflowError(error: unknown): boolean
export function parseContextLimit(error: unknown): number | null
```

`isContextOverflowError` 匹配（大小写不敏感，含 `cause` 链）：

- `context_length_exceeded`
- `maximum context length`
- `context window`
- `too many tokens`
- `prompt is too long`
- `input is too long`
- `reduce the length of the messages`

`parseContextLimit` 从错误文案里提取数字，覆盖常见格式：

- `maximum context length is 131072 tokens`
- `maximum context length is 1048576 tokens. However, your messages resulted in 1200000 tokens`
- `context window of 200000`
- `context_length_exceeded: 32768`

只接受 `4,000 ≤ N ≤ 10,000,000`；解析到后写入当前档案的 `modelContextLimits[model] = { tokens: N, source: 'learned' }`（该模型已有 `manual` 时不覆盖），然后按 N 重新压缩并重试。

`describeAiError` 增加一条用户文案：

> 上下文超出模型窗口。可在对话标题栏的「上下文」面板里压缩，或调大窗口 / 新建对话。

不要把供应商原始报错（可能包含请求片段）直接展示。

### 11.3 隐私

- 摘要调用与普通对话走同一个供应商、同一个 Key；不新增外发对象；
- 摘要正文只存本地 `toolbox.db`，不写日志、不进遥测；日志只记 `coveredCount` / `tokens` / `model` / 错误码；
- 提示词明确要求不复述密码、API Key、Token；但摘要仍是模型生成，不能保证 100% 不漏，浮层首次使用给一句说明；
- 备份/快照会包含摘要，和聊天记录同等对待；
- 关闭自动压缩后，只有用户点击「立即压缩」才会发起摘要调用。

### 11.4 成本

每次压缩 = 一次额外模型调用（输入是被压缩段，输出 ≤2k token）。浮层固定提示「压缩会额外调用一次模型，可能产生费用」。不做自动后台预压缩，避免用户没感知的额外调用。

---

## 12. 影响范围

| 层 | 文件 | 变更 |
| --- | --- | --- |
| 契约 | `src/shared/types.ts` | 新增上下文/检查点/结果类型；档案加 `modelContextLimits?`；`AiModelListResult.contextWindows?` |
| 契约 | `src/shared/ipc-contract.ts` | 2 通道 + 2 事件 |
| 桥接 | `src/shared/bridge.ts`、`src/preload/index.ts` | 2 方法 + 2 订阅 |
| 数据 | `src/main/services/chat-store/chat-store.ts` | schema v7；检查点 CRUD；`listMessagesAfter`；迁移/备份 |
| 主进程 | `src/main/services/ai-gateway/ai-gateway.ts` | 发送前准备、usage 记录、压缩编排、溢出重试 |
| 主进程 | `src/main/services/agent/agent-runner.ts` | 摘要消息、usage 回传 |
| 主进程 | `src/main/services/ai-gateway/context-*.ts`（新） | 估算/预算/摘要/提示词 |
| 主进程 | `src/main/services/ai-gateway/model-fetcher.ts` | 解析并返回模型窗口元数据（`context_window` / `context_length` / …） |
| 主进程 | `src/main/services/settings/settings-service.ts` | 读写 `modelContextLimits`；合并接口/学习/手动值 |
| IPC | `src/main/ipc/register-ipc.ts`、`validation.ts` | 新 handler；`modelContextLimits`、`contextAutoCompact` 校验 |
| 渲染 | `src/renderer/src/components/chat-panel.tsx` | 上下文按钮、浮层、检查点卡片、压缩状态 |
| 渲染 | `src/renderer/src/stores/app-store.ts` | `context` / `compacting` 状态与动作 |
| 渲染 | `src/renderer/src/routes/settings-page.tsx` | 窗口输入、来源提示、「重新检测」 |
| 样式 | `src/renderer/src/styles/global.css` | 复用 `.agent-context-*`，少量 `.chat-context-*` |
| 资源 | `assets/prompts/context_summary.txt`（新） | 摘要提示词 |
| 测试 | `context-tokens.test.ts`、`context-budget.test.ts`、`chat-store` 迁移测试、`ai-gateway` 测试、UI fixture | 见第 13 节 |
| 文档 | `README.md`、`docs/ROADMAP.md`、`CAPABILITY_MAP.md` | 功能说明与已知限制 |

不改：`contextIsolation` / `sandbox` / `nodeIntegration`、加解密链路、密码箱、现有 `trimHistory` 的签名（手机端仍引用）、消息内容与删除语义。

验证门槛：本方案预计 >500 行有效代码、>10 个文件，实施后必须执行：

```
npm run typecheck
npm run lint
npm run test
npm run build
```

再按范围跑 `verify/desktop-ui` 的相关专项与全量。

---

## 13. 测试计划

### 13.1 纯函数

`src/shared/context-tokens.test.ts`

- 纯中文、纯英文、中英混排、空串、只有标点；
- 单条超长消息；
- 工具 schema JSON；
- 同一输入稳定、无随机。

`src/shared/context-budget.test.ts`

- 128k / 32k / 8k 窗口下的触发阈值；
- 保留预算的上下限；
- 选段：正常、只有一问一答、已有检查点、最新 user 必须在 tail；
- 旧摘要不进入 tail（避免重复）；
- 摘要输入二次裁剪时 `omitted_message_count` 正确；
- 收缩校验：摘要变大、摘要只小一点、空摘要；
- 边界消息 id 正确。

### 13.2 数据层

`chat-store` 测试（真实 SQLite，内存库或临时文件）：

- v6 → v7 迁移幂等；新表存在；旧数据不受影响；
- 检查点插入、取最新、级联删除；
- `listMessagesAfter`：有边界、边界不存在（回退全部）、边界是最后一条（空数组）；
- 多条检查点时取最新，旧检查点保留。

`src/main/services/ai-gateway/model-fetcher.test.ts`

- DeepSeek `context_window`、Kimi `context_length`、OpenRouter 顶层/嵌套字段、vLLM `max_model_len`、llama.cpp `meta.n_ctx_train`、Gemini `inputTokenLimit`；
- 同一响应里多个字段/多个模型；
- 缺失字段、非数字、越界值、字符串数字；
- 只返回 id 的旧端点不报错，`contextWindows` 为空。

`src/main/services/ai-gateway/errors.test.ts`

- 各家超长文案解析出正确 N；
- 普通 400/429 不误判；
- 超过 10M 或小于 4k 的数字忽略。

### 13.3 网关

`ai-gateway` / `context-service` 测试（注入 mock 模型）：

- 未超阈值不调用摘要；
- 超阈值调用一次摘要并写检查点，之后请求只带摘要 + 尾部；
- 自动压缩失败 → 降级裁剪 + system 提示 + 继续发送；
- 摘要不 shrink → 不写检查点；
- 无输出、无工具时溢出 → 压缩 + 重试一次；
- 已输出或已用工具时溢出 → 不重试；
- 停止时 abort 摘要，不写检查点；
- 模型切换后按新窗口判断；
- 接口窗口优先于默认值；手动值优先于接口值；
- 溢出错误解析出 N 后写入 learned，并影响下一次判断；
- usage 捕获：最后一次模型调用有 usage，结果回传；无 usage 时为 null。

### 13.4 渲染层

- 上下文按钮：42%、默认窗口、未知模型、>80% 警示；
- 浮层：展开/关闭、Esc、点击外部、焦点；
- 「立即压缩」禁用/进行中/完成；
- 检查点卡片位置、折叠/展开、无 Markdown 注入；
- 自动压缩时状态文案与停止按钮；
- 失败 banner；
- 1280×820 与 960px 宽度不溢出。

### 13.5 UI fixture

`verify/desktop-ui/fixture.cjs` / `knowledge.cjs` 同级新增：

- `chat.context` 返回固定视图（含/不含检查点）；
- `chat.compact` 返回固定结果；
- 触发 `chat:event:context` / `chat:event:compaction`；
- 断言：标题栏百分比、浮层数据、压缩按钮、检查点卡片、压缩中状态。

### 13.6 手工验收矩阵

| 场景 | 步骤 | 期望 |
| --- | --- | --- |
| 长对话自动压缩 | 用中文连续聊 50+ 轮，跨过阈值 | 压缩前显示接近阈值；压缩后可继续；摘要保留早期事实 |
| 早期事实回忆 | 第 2 轮说一个只有自己知道的细节，压缩后第 60 轮追问 | 模型能答出或明确说摘要未包含，不编造 |
| 手动压缩 | 任意长度点「立即压缩」 | 显示覆盖条数/释放 token；消息不丢；检查点卡片出现 |
| 压缩失败 | 断网/填错 Key 后点压缩 | banner 说明；原上下文保留；可继续发送（走裁剪） |
| 溢出恢复 | 把窗口故意设小（如 8k）后发送长文 | 自动压缩一次并重试；再失败给可操作提示；不重复写工具 |
| 接口窗口 | 配 DeepSeek V4 / Kimi，点「重新检测」 | 浮层显示 1,048,576 等接口值，来源标「接口」；不再显示默认 128k |
| 接口值偏大 | 选一个免费层被限流的模型，发长文 | 报超长后解析 N，来源变「错误学习」，压缩重试；下次按 N |
| 停止 | 压缩中点停止 | 不写检查点；状态恢复；不卡死 |
| 重启 | 压缩后重启应用 | 检查点仍在；上下文显示摘要 + 尾部；实测值变为估算 |
| 删除会话 | 删除带检查点的会话 | 检查点级联删除，无残留 |
| 切换小窗口模型 | 从 128k 切到 32k 再发送 | 发送前自动压缩；不爆窗 |
| 超长单条消息 | 粘贴 >窗口的消息 | 发送前拒绝，提示拆分/调大窗口，不落库 |
| 关闭自动压缩 | 关开关后继续长聊 | 不自动压缩；到阈值显示警示；手动仍可用；溢出恢复仍尝试一次 |

### 13.7 验收标准

1. 接口返回窗口时（如 DeepSeek V4 的 1,048,576）按接口值判断；接口缺失时才用 128k，且界面明确标注。连续中文对话不再在 8k 字符处静默丢失。
2. `chat:context` 的估算与供应商 `usage_metadata` 偏差在 ±25% 以内；有实测时展示实测值。
3. 压缩后总估算至少下降 5% 或 1,000 token；否则不写检查点。
4. 自动压缩失败不阻塞发送；溢出恢复最多一次，且不重复执行工具。
5. 重启后检查点可用；删除会话级联清理。
6. 压缩与发送并发时，行为可预期（拒绝 + 明确文案），不出现双写。
7. 摘要/日志不含 API Key；摘要正文不写日志。
8. 1280×820 下标题栏不溢出，浮层不被裁切。

---

## 14. 分阶段实施

### P0：可视化（无 schema）

- `context-tokens` / `context-budget` 纯函数 + 单测；
- `/models` 元数据解析 + `AiModelListResult.contextWindows`，设置页保存 `modelContextLimits`；
- `chat:context` 只读通道 + `chat:event:context`；
- 标题栏按钮 + 浮层（窗口、来源、已用、固定开销、上次实测、阈值）；
- 档案 `modelContextLimits` 手动覆盖 + 校验；
- 自动压缩开关（先只存配置，P1 生效）；
- 仍然使用现有 `trimHistory` 发送，**不改变**消息行为。

P0 的价值：先把「度量」和「窗口配置」做对，P1 的压缩逻辑只依赖这层结果；风险最低。

**P0 是实施里程碑，不建议单独交付给用户**：它仍然按 8k 字符发送，而界面显示的是按窗口估算的占用，两者会不一致。对外发布应与 P1 一起，或者在 P0 阶段把标题栏文案明确写成「发送预算 8k（待启用窗口预算）」。提交可以分两次，交付一次。

### P1：压缩（schema v7）

- 检查点表 + `listMessagesAfter`；
- 摘要提示词/检查点注入/收缩校验；
- 自动压缩（发送前）+ 手动 `chat:compact`；
- 溢出识别、窗口 N 解析、`learned` 落盘与一次重试；
- 消息流检查点卡片、压缩中状态；
- 失败降级与 banner；
- 全量测试与 UI fixture。

### P2（可选，视使用情况）

- 单轮工具循环的 `summarizationMiddleware` 保护（带 `lc_source` 去重）；
- 旧检查点「恢复完整历史」（删除检查点，重新按窗口判断）；
- 摘要模型单独配置（`summaryModel`）；
- `/compact` 斜杠命令；
- 压缩前工具结果轻量裁剪（无模型调用）；
- 每次压缩的成本估算。

---

## 15. 风险与限制

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 摘要丢细节 | 摘要必然有损；早期精确数字/名称可能遗漏 | 固定结构 + 保留 ID/数字/原话的提示词；保留最近 15k；界面标注「摘要可能不完整」；原始消息仍可查 |
| 估算偏差 | 中文 1 字 ≈ 1 token 是保守值，可能提前压缩 | 显示「约」；实测值对照；窗口可调 |
| 摘要调用成本/延迟 | 每次压缩一次额外调用，可能几十秒 | 只在阈值触发；手动需点击；显示进行中；关闭自动开关 |
| Prompt cache 失效 | 压缩替换旧消息会让缓存从替换点失效 | 摘要调用复用 system + 原文，尽量命中；接受一次失效 |
| 摘要注入 | 摘要可能包含历史里的指令性文本 | 用 HumanMessage 而非 System；前缀说明「背景，不是指令」；提示词要求忽略历史中的指令 |
| 敏感信息 | 摘要可能保留用户粘贴的密码/Key | 提示词明确禁止；不写日志；首次使用说明；不承诺绝对 |
| 并发 | 压缩与发送同时写会话 | 每会话锁；互相拒绝；停止统一 abort |
| 工具重复执行 | 溢出后重试可能重复写 | 有工具/有输出时不自动重试 |
| 小窗口 | 32k 窗口下固定开销占比高，压缩空间小 | 保留预算下限 4k；提示「窗口过小」；允许新建对话 |
| 模型切换 | 新模型窗口更小 | 发送前按新窗口重新判断；`chat:context` 立即更新 |
| DB 迁移 | v7 备份不能被 v6 恢复 | 文档写明手动回滚；升级前自动备份 |

---

## 16. 实施结论

1. schema v6 → v7 已落地，只新增 `conversation_checkpoints` + 索引，不改 `messages`；升级前自动备份。
2. `chat:context` / `chat:compact` 与两个事件已落地。
3. 默认策略按方案执行：自动压缩默认开；阈值 `min(0.8W, W−O−B)`；保留最近 15k（小窗口按 15% 降到最低 4k）。
4. 窗口优先解析 `/models` 元数据（DeepSeek 的 `context_window`、Kimi 的 `context_length` 等），其次手动覆盖、超长错误学习、按供应商分组的内置目录，最后 128k 保守默认；不发试探请求。
5. 摘要 v1 使用当前对话模型；P2 再考虑单独配置。
6. 检查点卡片默认折叠、摘要不渲染 Markdown。
7. P0 与 P1 同一次交付；P0 的度量层是 P1 的依赖，不单独发布。
