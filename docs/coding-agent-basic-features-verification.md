# 编程 Agent 基础交互首批交付与边界

## 2026-10-30 两个 P0 与文档清理

用户要求清理过期文档，并先实施原生回退／编辑重发和剩余结构化表单。以下是当前增量；下方 2026-10-29 记录保留为历史证据，不代表这些能力仍未交付。实现完成后用户已授权提交，提交记录以 Git 历史为准；未推送、建分支或修改真实用户会话。

### 当前行为与原因

| 范围 | 已交付 | 边界 |
| --- | --- | --- |
| 原生能力门 | 所选 Codex CLI 只读导出 schema，确认 `thread/revert`、两个锚点参数、文件保留语义及分页接口；成功按可执行文件大小／修改时间缓存 | 旧版、未知 schema、探测失败和非分页历史均不开放回退，不从版本号猜能力 |
| 真回退 | 用户消息“回退到此处”“回退并编辑”；完整有界分页快照、原生 turn 映射、全部受影响可见消息摘要、五分钟单次凭据、执行前复核、执行后权威回读 | 删除所选提问所在轮次及之后的原生对话；文件始终保留；同轮多条用户输入暂不开放单消息回退 |
| 编辑后续接 | 确认回退并成功回读后取回原文、聚焦输入区；保留原草稿供恢复 | 不自动调用模型；用户再次发送才继续新历史；恢复草稿不会恢复已回退历史；引用需重新选择 |
| 失败与竞态 | 历史变化拒绝执行；提交后失败／超时／回读不符显示未知并阻止盲重试，先核对原生历史；旧正文／上下文事件不能覆盖新历史 | 不先删 UI、不自动重发；不同 Agent 同项目在回退期间同样互斥；确认／返回期间的新草稿不被覆盖 |
| 结构化表单 | OpenCode `elicitation/create` 和 Codex `mcpServer/elicitation/request` 的 form；文本、数值／整数、布尔、枚举／多选、可选字段、长度／范围／数量约束；保留选项原值 | 最多四字段、每字段十二选项；主进程复核并转换原生类型。空的必填数组按原生 minItems=0 返回 `[]`，可选空字段省略 |
| 表单生命周期 | 复用现有问答卡片、答复 IPC、五分钟超时、取消／停止／断线清理；Codex 已解决请求使旧答案失效 | URL、秘密提示／字段、嵌套、正则、未知约束和复杂格式拒绝并提示回原生，不执行原生正则、不保存秘密答案、不打开 URL |

需要这些改动的原因：普通“取回编辑”不能改变模型下一轮上下文；遗漏原生表单会让 Agent 在追问时中止或迫使用户切回原应用。用原生协议和受限视图补齐这两个缺口，保留原有运行时与草稿架构。

### 文件与影响

- 契约／桥接：`src/shared/agent-session.ts`、`coding-agents.ts`、`types.ts`、`bridge.ts`、`ipc-contract.ts`，以及 `src/preload/index.ts`、`src/main/ipc/{coding-agents-ipc,validation}.ts`。新增 `coding-agent:history:preview-revert`／`coding-agent:history:revert`，问题答复继续用原通道；可选字段兼容旧事件，旧 preload 明确提示重启。
- 原生／服务：新增 `codex-history.ts`、`codex-revert-capability.ts`、`agent-elicitation.ts`，修改 Codex／OpenCode 适配器、OpenCodeService、AgentQuestions 和 CodingAgentService。原生轮次与回调留主进程，窗口／连接／会话／运行／项目校验继续收敛到服务层。
- 界面：现有 `coding-agent-store.ts`、`coding-agent-client.ts`、用户消息操作、问答卡片与 composer；复用已有确认框、按钮和主题，没有新增样式或依赖。
- 文档：删除 `PLAN-coding-agent-usability.md`、`SPEC-agent-role-handoff.md`，有效交互合并到 `SPEC-coding-agent-workbench.md`；重写 `tasks/plan.md` 为当前索引、移除 `tasks/todo.md` 旧交接／角色历史任务，保留后置选项与验证证据；更新 README、路线图、能力图和引用，修正收藏、Claude／DSH、项目并行等过期状态。
- 数据库仍为桌面 v5；无新表、加密／主密钥／安全基线／依赖变更。手机暂停。已将其他任务的未提交内容与开工快照比较，相关内容未被本轮改动覆盖。

### 最终验证

本轮自身增量相对开工快照超过 500 有效代码行且修改文件超过 10 个；不计既有未提交改动。按顺序执行：

- `npm run typecheck`：通过。
- `npm run lint -- --ignore-pattern "mobile/**"`：通过，0 errors／0 warnings。
- `npm run test -- --exclude "mobile/**"`：124 文件／944 项通过，无失败；仍有既有 Node `--localstorage-file` 无有效路径警告。
- `npm run build`：通过，无构建告警或失败。
- `node verify/desktop-ui/run.cjs --agent-basics-only --screenshots`：13 项通过，页面异常 0 项。目视核对 1280×820 三主题、1024×680 表单与停止入口、回退预览弹窗；取消不变更，确认只回退和填草稿，不自动发送。
- `node verify/desktop-ui/run.cjs --agent-parallel-only`：6 项通过，页面异常 0 项；验证独立项目／草稿／回复、后台状态与分别停止。
- PowerShell：`node verify/codex-revert-isolated.cjs (Get-Command codex).Source`：本机 Codex `0.164.0-alpha.11.1` 真实 CLI 通过。使用新建临时项目、独立 `CODEX_HOME` 和 127.0.0.1 的确定性 Responses 模型桩；生成两轮、回退第二轮，下一轮 HTTP 输入保留第一轮并排除第二轮，第二轮之后手动修改的文件保留，原生历史重读一致。没有访问用户账号、原生真实会话或外部模型；临时合成数据保留供排查。
- `git diff --check` 与本地 Markdown 链接检查通过，删除文档没有留下失效引用。Git 可能提示 LF／CRLF 转换，不是内容失败。未运行 rebuild、手机命令或打包安装程序。

### 剩余范围与风险

提交前按开工快照拆分暂存，保留其他任务的 Skill／MCP 目录、Token 统计等未提交改动；回退取回原文所需的 `agent-message-text.ts` 公共函数及引用作为必要内部依赖纳入。上述 944 项属于完整工作区；另外从暂存索引导出独立快照，依次执行同样的 typecheck、桌面 lint、桌面 test 与 build，122 文件／923 项测试通过，类型／lint／构建均通过，仅保留既有 Node 告警；该快照的真实 Codex 本机模型桩回退验证也通过。没有用其他任务的修改填充本次提交。

- Claude Code／Desktop、OpenCode ACP、DSH 的真回退仍未开放；Claude 链条／附带条目与恢复边界、OpenCode 服务 API 的文件语义需要分别验证。按消息分叉、执行／Diff、正文搜索与图片附件仍是后续批次，不能将本轮视作 C2／D／E 完成。
- 回退完整快照上限为 100 轮、200 条可见消息、200,000 字符和 2 MiB 原生分页内容。超过范围时拒绝回退；恢复分页会话先显示最近一页，预览另读完整有界历史，不把局部展示当成完整上下文。
- 原生接口没有跨独立进程的历史 CAS。Tool_box 内会复核完整快照并锁住同项目操作，但仍应避免在外部原生客户端同时修改同一会话；回读确认不等同于跨客户端事务隔离。
- 真实 OpenCode／Codex MCP 服务触发表单、其他安装版本、实际供应商问答和 Desktop 互见仍需正常使用验收。合成传输／本机模型桩不代表这些真实服务已通过。
- 只展示当前运行中的 Codex MCP form；无法关联当前运行的请求取消。秘密信息识别按明确提示／字段和受限 schema 拒绝，不将未知表单自动降级成通用输入。

协议依据：[Codex 官方 App Server 说明](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) 与所选本机 CLI 导出的 schema；[OpenCode 固定版本表单映射](https://github.com/anomalyco/opencode/blob/aaa0d7c8f6775a211185951a3f16fec840e648a4/packages/cli/src/acp/elicitation.ts)。运行时能力以实际本机协议与上述隔离行为验证为准。

---

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
