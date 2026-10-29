# 编程 Agent 基础交互首批交付与边界

日期：2026-10-29

用户要求「先 commit，然后开始实现」。实施前基线已分功能提交：
`6ffc8f5`、`64e40b8`、`de96d98`、`69de5bb`、`7bdd994`。
本轮新实现保留在工作区，未再次提交、推送或创建分支。

## 1. 已交付范围

| 能力 | 本轮行为 | 边界 |
| --- | --- | --- |
| 用户原文操作 | 用户消息复制、取回编辑、覆盖确认、取消取回、输入框聚焦 | 发送为追加，不改原历史；引用重选；原文超过 50,000 字符时拒绝取回 |
| 草稿保护 | 取回前草稿和转用标记在内存保留，取消时恢复；确认期间选择／草稿变化则放弃覆盖 | 当前草稿继续走既有加密保存；取回前的取消备份不新增持久化 |
| 上下文读数 | ACP 原生用量、Codex 最近请求、Claude 活跃 Query 的 summary；显示来源／窗口／时间、近似值、旧快照、超限 | 缺失分母不造百分比；不主动开模型请求；不展示累计消耗作为占用 |
| 压缩入口 | 详情中准备 `/compact`，覆盖草稿先确认，用户发送才执行原有命令流程 | 仍需实时目录校验；DSH 禁用；不自动压缩 |
| Claude 问答 | AskUserQuestion 单选／多选／自由文本，ExitPlanMode 显式确认 | Code 与 Desktop 复用；不自动批准下一项工具；未知结构／秘密信息拒绝并回原生 |
| Codex 问答 | `item/tool/requestUserInput`（兼容旧名称）；按原生问题 ID 返回答案 | 不覆盖 MCP elicitation；处理原生已解决事件，数字／字符串请求 ID 分离 |
| 失败恢复 | 失败／停止提供取回最近提问和历史核对；未知结果只提供历史核对 | 取回的是已显示的最近用户提问，未提交成功的输入仍在草稿；读取失败不新建、不重发，不保证读取就能判定未知任务结果 |
| 本轮耗时 | 从主进程任务占位到终态／断连，单调时钟计算耗时，UI 只本地刷新 | 包含等待审批和问答，不等于纯模型生成时间；旧历史不补造 |

所有入口都可使用取回编辑，但有无上下文数据由原生实际上报决定。
等待问答时卡片内部滚动，输入区收紧以保留停止入口；后台任务同时显示「等待回答」。

对应计划：A1 已完成；A2 完成可选会话元数据与 ACP 已有原生消息 ID 的分片归并，**完整消息／轮次锚点及细分能力门尚未完成**；A3 已完成本轮快照链路；B1 完成 Claude 与 Codex 用户问题，OpenCode 表单待接入；B2 完成现有终态分类下的安全恢复和计时。C0 已核对协议／类型，尚未完成隔离会话的原生变更行为验证。C1、C2、D、E 未交付。

## 2. 调用链与影响

会话：adapter → `NativeCodingSession` → `CodingAgentService` → 原有 session 事件 → renderer store → 消息／输入区。

新增可选字段 `contextUsage`、`timing`、`questions`，兼容缺失字段的旧事件；旧 OpenCode 会话类型也保留可选字段，未变更其既有 IPC 通道。

答复：renderer `answerQuestion` → bridge／preload → `coding-agent:question:answer` → validation → service 归属／运行校验 → adapter 待回答回调。

- 入参只接受 runtimeId、sessionId、requestId、cancelled 和逐题文本答案；最多 4 题、每题 12 项、单项 4,000 字符。
- 主进程校验窗口、连接、会话、当前 run、请求是否仍在等待，再逐题校验单／多选、空值、重复值和合法选项。
- 回答属于控制请求，不被正在等待原生响应的发送操作锁阻塞。
- 回调、原生 schema／完整请求、认证和进程对象留在主进程，不经 IPC 透传。
- 超过 5 分钟、主动取消、原生取消信号、任务结算、停止与断线释放回调；旧答案不可重复提交。
- Claude summary 最长等待 1.5 秒，只查询当前 Query；失败不改已完成任务结果，不新建 Query。

修改范围为 shared 契约、preload／IPC 校验、编程运行时／store／组件／样式、对应测试与隔离 UI。数据库仍为 v5，无新表、新依赖、加密变更、原生配置改写或手机改动。

## 3. 真撤回的原生能力核对

本轮没有调用任何真实会话回退／分叉接口，没有发送真实模型任务，也没有修改用户的原生历史或工作文件。

### Codex

本机 `codex-cli 0.164.0-alpha.11.1`，执行只读协议导出：

```text
codex app-server generate-json-schema --out <独立临时目录>
```

导出文件确认：

- `ThreadRevertParams`：必填 `threadId`、`beforeTurnId`，移除该轮及之后的持久历史；文档明确 **不恢复本地文件**，适用于 paginated thread。
- `ThreadForkParams.lastTurnId`：可选，按包含该轮的边界分叉；目标轮次不能正在执行。
- `ThreadTokenUsageUpdatedNotification`：`threadId`、`turnId`、`tokenUsage.last`、`tokenUsage.total`、可空窗口。本轮只使用 `last`。
- `ToolRequestUserInputParams`／Response：原生问题与逐题答案映射，与本轮实现一致。

结论：具备后续实现依据，**schema 存在不代表所有旧会话和旧版本都可安全回退**。下一批需要完整分页历史与 turn ID、版本能力门、尾部预览、historyRevision／actionRef 失效校验，以及隔离数据上的真实回读。当前不提供撤回按钮。

### OpenCode

核对版本 `aaa0d7c8f6775a211185951a3f16fec840e648a4`：当前 ACP 入口没有可直接复用的消息级 revert；GUI 的 session revert 位于原生服务 API，含文件恢复语义，与 ACP 整会话 fork 不同。必须另评公开服务连接与 files 选项支持，不能以普通 `/undo` 文本冒充原生撤回。

结构化表单使用 `elicitation/create`、`clientCapabilities.elicitation.form`，并非当前 permission 请求。上游表单允许 optional／custom、枚举、数组与标量约束；本轮不声明支持，避免半实现后吞掉原生问题。依据：[连接方法](https://github.com/anomalyco/opencode/blob/aaa0d7c8f6775a211185951a3f16fec840e648a4/packages/cli/src/acp/connection.ts)、[表单映射](https://github.com/anomalyco/opencode/blob/aaa0d7c8f6775a211185951a3f16fec840e648a4/packages/cli/src/acp/elicitation.ts)。

### Claude Code / Desktop

安装 SDK `0.3.310` 的类型确认 `resumeSessionAt` 接受 chain UUID，不能用 API 正文 `message.id` 代替；`resumeDropsTurn` 会校验被丢弃尾部，拒绝后不能盲重试。工具结果、结构化附件与用户排队消息可能位于最后一条助手消息之后。`rewindFiles` 则为独立文件 checkpoint 操作。

结论：先补完整 chain 边界与本地 SDK 隔离行为验证，再开放原生回退／分叉；本轮保留现有 transcript，未写 Desktop 私有索引，也不改变 Desktop 互见限制。

### DeepSeek Harness

核对版本 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` 的 [ACP 契约](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/acp/acp/README.md#protocol-contract)：支持上下文用量，不支持回退、创建分叉或交互式 elicitation。沿用 ACP，本轮不新增其他私有通道。

## 4. 验证

本轮自身代码增量已超过 500 有效行，且涉及超过 10 个文件，满足仓库测试门槛。

- `npm run typecheck`：通过。
- `npm run lint -- --ignore-pattern "mobile/**"`：通过。
- `npm run test -- --exclude "mobile/**"`：114 文件／871 项通过。
- `npm run build`：通过。
- 单元覆盖原生用量／非法数字、累计与最近请求区别、问答选项／跨会话／取消／超时／已解决／断线、IPC 边界、草稿确认竞态、恢复不重发及终态计时。
- `node verify/desktop-ui/run.cjs --agent-basics-only --screenshots`：8 项通过，页面异常 0 项；在 1280×820 下检查深空／石墨／纸白三主题，问答卡片滚动且停止入口保持可见。
- `node verify/desktop-ui/run.cjs --agent-parallel-only`：6 项通过，页面异常 0 项；覆盖独立项目／草稿、并行回复、三主题后台任务条与分别停止。

测试有既有 Node `--localstorage-file` 未提供有效路径警告；不影响测试通过。构建无失败；Git 可能提示 LF／CRLF 转换，此提示不代表内容错误。

## 5. 剩余风险与人工验收

- 原生供应商、版本或模型不报告用量时显示未知；Claude summary 属原生估算，无法作为计费用量。DSH 是提交后快照。
- 原生回退及按消息分叉尚未开放；代码中的普通显示 ID 不构成可靠原生变更凭据。
- OpenCode 表单、Codex MCP elicitation 未接入；不能把本轮 Claude／Codex 问答测试视作所有问题协议都支持。
- 合成传输与隔离界面已验证应用分层，真实 Claude／CC Switch 和 Codex 的问题生成、计划后权限行为仍需用户在正常项目体验；没有为了验收发送额外模型请求。
- 暂停／失败前已写入的文件可能保留。取回、取消或历史重读不回滚文件。
- 不承诺更多 Agent 同时修改同一项目；既有顶层互斥保持。
