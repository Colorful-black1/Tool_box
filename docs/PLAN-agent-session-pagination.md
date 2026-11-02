# 编程 Agent 会话正文分页与懒加载

日期：2026-11-02
状态：**已实施**。用户已授权：新增 1 个 IPC 通道、会话事件负载结构变更、四家适配器的显示上限改为截断而非停止任务。不改 schema、不新增依赖。

## 1. 要解决的问题

现状：会话消息在渲染层只能看到最早的 200 条 / 20 万字符，撞上限后主进程直接 `stop()` 任务并报「请新建会话」。用户想看前几轮必须打开原生客户端，违背"本地工作台"的定位。

目标：界面可以向上滚动逐个加载更早的消息，直到第一轮；撞上限不再杀任务。

## 2. 设计

### 2.1 数据分层

| 层 | 内容 | 上限 |
| --- | --- | --- |
| 适配器（原生会话） | 完整消息数组 | 存储预算 4000 条 / 4,000,000 字符，超出丢最旧并计数 |
| 服务（`CodingAgentSessionView`） | 完整消息 + `seq` | 同上，`truncatedMessages` 记录丢弃数 |
| 事件 / IPC | 最近一页 | 每页 40 条 / 30,000 字符 |
| 渲染层 | `earlier` 已加载页 + 事件里的尾页 | 仅当前会话 |

### 2.2 seq

主进程为每条消息分配会话内单调递增的 `seq`，按消息 id 复用以保证流式追加时稳定。分页游标用 `seq`，不用 id（ACP 的 `native-*` id 可能缺失或重复）。

### 2.3 分页协议

新通道 `coding-agent:session:messages`：

```ts
{ runtimeId, sessionId, beforeSeq? } → { messages, hasMore, truncated }
```

- 不带 `beforeSeq`：返回尾页。
- 带 `beforeSeq`：返回该 seq 之前的一页。
- 页大小按「条数或字符」双约束，先到者为准。

### 2.4 事件

`CodingAgentSessionView.messages` 的语义改为**尾页窗口**，新增 `messageWindow: { hasMore, earliestSeq, latestSeq, totalMessages, truncated }`。渲染层把 `earlier` 与尾页按 id 合并渲染。

### 2.5 界面

- 首屏只取尾页并定位到底部。
- 消息区滚动到顶部附近自动请求上一页；加载中显示占位，失败可重试，到顶显示「已到最早」。
- 插入更早内容前记录 `scrollHeight`，插入后补偿 `scrollTop`，阅读位置不跳。
- `truncated > 0` 时在顶部说明「更早的 N 条已超出本机缓存」。

## 3. 代码落点

| 文件 | 改动 |
| --- | --- |
| `src/shared/coding-agent-messages.ts` | 新增：分页/合并/裁剪纯函数 + 常量 |
| `src/shared/coding-agent-messages.test.ts` | 新增：分页边界、双约束、合并去重、裁剪计数 |
| `src/shared/coding-agents.ts` | 消息窗口类型、分页输入/返回类型 |
| `src/shared/ipc-contract.ts` | 新增通道 |
| `src/shared/bridge.ts` / `src/preload/index.ts` | 暴露 `sessionMessages` |
| `src/main/ipc/validation.ts` / `coding-agents-ipc.ts` | 入参校验与 handler |
| `src/main/services/coding-agents/adapter.ts` | `NativeCodingSession` 排除 `messageWindow` |
| `src/main/services/coding-agents/coding-agent-service.ts` | seq 分配、尾页投影、`messages()` 分页 |
| `acp-codec.ts` / `codex-codec.ts` / `claude-adapter.ts` | 上限改为裁剪，不再抛错 |
| `opencode-service.ts` / `dsh-adapter.ts` | 去掉因上限停任务的 catch |
| `coding-agent-store.ts` | `earlier` 页缓存与 `loadEarlier` |
| `opencode-messages.tsx` | 顶部哨兵、滚动补偿、截断说明 |

## 4. 验收

1. 500 条历史会话：首屏 40 条，连续上滚可到第 1 条，位置不跳、无重复遗漏。
2. 运行新消息：已加载窗口不重置，底部跟随不变。
3. 撞存储预算：顶部出现「更早 N 条超出本机缓存」，任务继续运行。
4. 四个入口（OpenCode / Codex / Claude / DSH）行为一致。
5. 单次 IPC 负载 ≤ 约 100KB。

## 5. 风险

- 主进程内存随会话增长；预算兜底 + 显式提示。
- 滚动补偿做不好会跳动；插入后按高度差补偿，且只在用户位于顶部时生效。
- 事件仍带尾页全量文本；后续可再改为增量差分（本批次不做）。

## 6. 实施结果（2026-11-02）

- 新增 `coding-agent:session:messages` 通道与 `sessionMessages` 桥接，入参走 `ipc/validation.ts` 校验（游标只接受非负整数）。
- 服务层：`seq` 按消息 id 复用；`publishSession` 只投影尾页并附 `messageWindow`；`openSession` / `setOption` / `revert` 返回值同样只含尾页。
- 适配器：`acp-codec` / `codex-codec` / `claude-adapter` 改为「丢弃最旧 + 计数」，OpenCode、DSH、Claude 不再因上限停止任务；OpenCode 发送前的 198 条 / 18 万字符拦截一并移除。
- 渲染层：`earlier` 分页缓存 + `loadEarlier`；滚动到顶部附近自动预取，插入后按 `scrollHeight` 差值补偿；尾页滑出的消息降级进 `earlier`，不会凭空消失；截断与到顶各有独立提示。
- 验证：`npm run typecheck`、`npm run lint -- --ignore-pattern "mobile/**"`、`npm run test -- --exclude "mobile/**"`（1031 项通过）、`npm run build`、`node verify/desktop-ui/run.cjs --coding-agents-only`（17 项通过、页面异常 0 项）。
- 未做：事件增量差分（仍推送尾页）、虚拟滚动、滚动到顶时自动触发以外的手势。

