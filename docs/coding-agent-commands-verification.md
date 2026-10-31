# 编程 Agent 快捷操作交付记录

日期：2026-10-27

依据：[实施计划](PLAN-coding-agent-commands.md)。用户已明确要求按计划实施；本轮扩展编程接口及输入流程，不修改依赖、数据库 schema、加密算法或主密钥，不提交 Git。

## 已实现

| 入口 | 行为 |
| --- | --- |
| `@` /「@ 文件」 | 搜索当前项目，返回相对路径候选；Enter / Tab 插入，引用可移除；发送前复核真实路径、归属、存在性及大小 |
| `/` /「/ 命令」 | 搜索中文用途及命令名；Enter 选候选，下一次 Enter 才执行；Shift + Enter 换行，中文输入法不误发，Esc 优先关候选 |
| `/skills` | Codex 发现并提交结构化 Skill；Claude SDK 的 Skill 与命令统一显示；OpenCode 按 ACP 公布条目展示；DSH 明确降级 |
| `/mcp` | Codex / Claude 查询可见服务与工具；选择工具只准备使用意图；原生公布的 MCP Prompt 按命令调用，不开放任意工具直接执行 |
| `/compact` | Codex 专门 RPC；OpenCode / Claude 使用已发现的原生命令；保留会话，等待终态，不以请求受理或普通摘要假报完成 |
| `/init`、`/agents` | 明示 `AGENTS.md` / `CLAUDE.md`；已有目标拒绝覆盖；工具箱工作流在计划 / 只读能力下仅输出建议，明确允许写入时才请求创建；成功后另查目标是否存在 |
| `/new`、`/history`、`/model`、`/permissions` | 工具箱本地快捷入口，复用已有会话 / 选项控件，不发模型任务，不通过字符串悄悄更换权限 |
| Claude 本机扩展设置 | 默认隔离；按入口和规范项目目录记录主动选择，首次开启说明 hooks / MCP / 原生规则等影响；不修改原生配置文件 |

为避免命令含义冲突，新对话、历史、模型、权限、Skill 选择与 MCP 查看名称由工具箱保留；对应的终端界面操作不另列成原生命令。退出、认证、删除、文件回滚、插件安装等不在本轮菜单中开放。

文件候选排除依赖 / 构建目录、已知凭据文件和符号链接；支持中文及空格路径。搜索有短防抖、条数 / 扫描量 / 时间上限，忽略过期返回。最多 20 个引用，单文件最多 2 MB。OpenCode 提交 ACP 文件链接；其他入口使用明确路径，由 Agent 按原生权限读取，不后台上传项目全文。

未知命令默认阻止发送，草稿保留；用户明确点击「作为普通文字发送」才按文本处理。原生条目执行前复核，Claude 还在实际执行 query 的初始化完成后校验命令，校验前不 yield 用户输入，降低未知命令回落为收费聊天的风险。

压缩不清空 UI 历史、不改写原生日志，也不生成交接说明。显示缓存已满时仍可执行原生压缩，压缩摘要不再塞入已满缓存。取消、失败和断连不伪装成功，不自动重试；Codex 压缩尚无 turnId 时仅关闭工具箱拥有的连接，保持结果未知。

## 代码与协议范围

- 契约：新增 `src/shared/agent-actions.ts`；增量扩展 bridge / IPC / preload。OpenCode 视图仅新增可选 `outcome`，旧桥接兼容缺失字段。
- IPC：`coding-agent:capabilities:read`、`coding-agent:files:search`、`coding-agent:command:execute`、`coding-agent:extensions:set`。发送增加可选引用和普通文字意图，旧普通发送形态保留。
- 主进程：统一服务保留所有权、连接 / 会话身份、顶层运行互斥、审批与停止；文件和扩展引用使用当前作用域中的不透明标识，不接受 renderer 伪造原生路径或任意 RPC。
- 适配器：OpenCode 缓存早于建会话响应的命令推送；Codex 显式 Skill / MCP 与原生压缩；Claude 公开 SDK 元数据、执行复核和配置来源；DSH 返回准确的能力限制。
- 渲染层：独立输入组件、候选 Popover、扩展开关，复用现有主题、按钮和弹层栈。新增 Popover 可选宽度行为不改变其他调用默认值。
- 草稿：仍使用原加密文本格式；重启后引用文字保留，临时绑定不假装有效，需重新选择。不新增表或保存聊天正文。

原有待办时间选择器的未提交修改保留；本轮仅向共享样式和 README 补充快捷操作内容。

## 验证结果

本轮代码修改超过 500 行有效代码且涉及超过 10 个文件，满足仓库编译测试门槛。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern "mobile/**"` | 通过，无 lint 警告 |
| `npm run test -- --exclude "mobile/**"` | 107 个文件、794 项通过 |
| `npm run build` | main / preload / renderer 构建通过 |
| `node verify/desktop-ui/run.cjs --agent-actions-only --screenshots` | 9 项通过，页面异常 0；文件、命令、Skill / MCP、未知命令、扩展开关与三套主题 |
| `node verify/desktop-ui/run.cjs --coding-agents-only --screenshots` | 17 项通过，页面异常 0；原会话、转用、历史、三主题 / 双尺寸、Claude 双入口和 Enter 行为 |
| `git diff --check` | 通过；另有仓库既存换行符转换提示 |

测试进程仍出现 `--localstorage-file was provided without a valid path` 的环境警告；无测试失败。首次新增接口曾导致两项旧发送形态断言失败，已保留旧调用并通过全量回归。UI 主题验收脚本曾误用主题简称，已按实际按钮名称修正后通过。

合成用例另外覆盖：无会话能力查询不创建会话、首发 Skill 绑定、未知命令拦截、跨窗口 / 旧连接拒绝、junction 越界、敏感路径、原生压缩受理与终态分离、显示上限、Claude 配置隔离及发现失败后仍可关闭扩展。

三套主题在 1280×820 下截图并检查；原工作台另覆盖 1024×680。截图在本地忽略目录 `.playwright-mcp/desktop-ui/agent-actions-*.png`，未提交产物。

## 无模型本机探针

命令：`node verify/agent-actions-connect-smoke.cjs`。配置选择仅留探针内存，不主动开启扩展；比较前后原生会话摘要，未创建、恢复或发送会话，模型任务为 0。

| 运行时 | 本轮观察 |
| --- | --- |
| Codex `0.163.0-alpha.10.2` | 连接及目录读取通过；观察到 65 个 Skill、5 个 MCP；会话事件 0 |
| Claude SDK / CLI `2.1.310` | 初始化及命令发现通过；观察到包含 compact / init 的可调用项，未开启用户 / 项目扩展；会话事件 0 |
| DSH `0.2.1-rc.3` | 连接及摘要读取通过；官方 ACP 未提供命令 / Skill / MCP 状态目录，按限制返回；会话事件 0 |
| OpenCode | 未通过现有 Desktop 模型勾选读取：提示“无法读取 OpenCode Desktop 模型勾选，请先打开桌面版后重试连接”；未发送模型任务，不宣称本机完整链路已通过 |

探针因 OpenCode 一项未通过而返回非零；这不是“所有运行时均通过”的结果。没有为了探针绕过既有模型可见性规则，也没有写入用户配置。计数是当时可见元数据快照，随本机配置变化。

## 限制与后续人工核对

1. 本轮不发送真实模型任务，因此真实文件读取、Skill / MCP 执行、上下文压缩和初始化写入仍需在用户当前供应商下验收；构建 / 合成测试不能代替这些结论。
2. OpenCode 真实连接受现有 Desktop 模型勾选读取影响，需先检查本机原应用配置，再测试新命令与引用；本轮未改动该读取策略。
3. DSH 官方 ACP 不提供手动压缩和目录查询；不引入社区替代运行时。自动上下文管理是否发生由原生引擎决定。
4. Claude Desktop 只启用项目 / 本地扩展，不加载 CLI 用户设置、Desktop 账户连接器或云端 Skill；它仍是 SDK Code 入口，不新增 Desktop 双向同步。
5. Claude 配置加载可能运行用户已选择的 hooks / MCP，并沿用原生规则；已被原生批准的工具不一定进入 Tool_box 审批回调。该开关默认关闭，不开启 Bypass。
6. 原生问答 / MCP elicitation 仍沿用现有支持边界；若初始化或扩展需要尚未支持的交互，会明确停止 / 失败，不用布尔审批冒充回答。
7. 长历史显示上限和引用重启后重新选择的限制保留。压缩不等于解除显示上限，MCP 元数据 / 使用意图不等于某次工具已经执行。

建议手动验证：选择真实项目 → `@` 选一个普通文本文件并提问 → `/skills` 选择本机可用项 → 在已结束会话执行 `/compact` → 在临时项目使用计划模式 `/init`，再按需要切换既有写入权限验证创建。检查已有 AGENTS.md / CLAUDE.md 不会被初始化覆盖；Claude 两入口分别核对项目、供应商和扩展范围。

## 个人 Skill 与斜杠检索补充（2026-10-30）

### 原因与改动

`/` 主列表原先只展示本地快捷操作与 `catalog.commands`，没有合并独立 Skill／MCP 目录。除此之外，OpenCode 的 ACP、DSH 没有原生 Skill 发现接口，Claude 扩展默认隔离；CC Switch 集中管理和链接分发的个人技能无法仅靠这些原生接口完整发现。

现在统一搜索快捷操作、原生命令、Skill 和 MCP，支持中文用途检索。新增主进程只读索引，按项目专用目录 → 项目 `.agents/skills` → 对应用户目录 → 用户 `.agents/skills` → `.cc-switch/skills` 顺序发现个人 Skill。读取有界 frontmatter，支持 Windows symlink／junction，规范路径必须位于已知技能根内；同名原生 Skill 优先，原生明确禁用项与 `user-invocable: false` 不被文件引用重新开放。

个人 Skill 标记「本机文件引用」。选择只加入临时引用，发送时重新检查规范路径与文件状态，由原生 Agent 按权限读取完整 `SKILL.md` 及相对资源；不是安装、复制或直接执行技能。Codex 原生 Skill 继续使用结构化引用，其他原生命令保留。目录发现不启动 MCP、不加载 hooks、不改变 Claude 扩展开关，不修改用户配置。

MCP 合并原生状态与当前运行时的本机配置元数据：Codex `config.toml`，OpenCode 用户／项目 JSON(C)，Claude CLI `.claude.json` 与项目 `.mcp.json`。Claude Desktop 仅补充项目 `.mcp.json`，不混用 CLI 用户 MCP；DSH 无可靠的本机 MCP 配置发现接口。配置索引只返回名称／开关，绝不返回 command、URL、env、headers 或认证。未查询到工具列表的服务标注「仅发现配置 · 未验证连接」，选择只准备检查请求，不伪造可调用工具。

### 验证

本补充自身超过 500 行有效改动且超过 10 个代码文件，满足仓库验证门槛；不将已有 Token 统计改动计入门槛。

- `npm run typecheck`、`npm run lint -- --ignore-pattern "mobile/**"` 通过。
- `npm run test -- --exclude "mobile/**"`：个人技能与目录合并版 122 文件／922 项通过；其后补充隐私错误映射，最终结果见下方。
- `npm run build` 通过。
- `node verify/desktop-ui/run.cjs --agent-actions-only --screenshots`：12 项通过，页面异常 0；包含各 Agent 的个人技能、斜杠直接搜索、MCP 配置与调用意图区分、选择不发送和三套主题 1280×820。已目视检查弹层位于输入区上方、无窗口溢出。
- 本机只读核对：OpenCode、Codex、Claude Code、Claude Desktop、DSH 各发现截图中的全部 15 个个人 Skill，包括 CC Switch 集中管理的 `dogfood`、`impeccable`；无发现错误。只输出名称与状态，不读取凭据、不创建会话或发送模型任务。

边界：发现文件不代表原生 Agent 已执行；外部目录权限、模型是否可用、Skill 实际步骤仍由真实任务验证。链接被替换、文件删除或读取受限时保留草稿并提示刷新。少见 YAML／TOML 语法、嵌套技能目录不做推测解析。已有 Token 统计改动保留，未提交 Git。

### OpenCode Go 模型隐私限制

用户真实 Skill 测试被 Go 上游拒绝：`Account.TrainingNotAllowed`／`This Go model trains on request data.`，属于工作区模型隐私限制，并非 Skill 路径错误。参考 [OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)，用户可更换模型，或自行在控制台 Settings → Privacy 确认是否允许请求数据用于训练；工具箱不会修改这一设置。

ACP 以前将请求错误统一收敛为通用提示。现仅在 OpenCode 返回的 message／data.message／data.details 含已知标记时映射为固定中文说明；不透传其他正文、凭据或 stderr，不自动重发。若 ACP 只返回通用错误，仍需在原生客户端查看原因。新增两种错误载荷及脱敏回归。

补充映射后的最终检查：typecheck、桌面 lint、build 均通过；桌面单元测试 122 文件／924 项全部通过。测试进程仍有既有 `--localstorage-file` 路径警告，无失败项。`git diff --check` 通过，仅有工作区既有 LF／CRLF 转换提示。没有更改数据库、IPC、依赖、隐私设置或真实供应商配置。

### 后续余额不足报错（2026-10-30）

用户切换为 DeepSeek 后，原生客户端的新错误为 `Insufficient account funds`，与之前隐私限制不同。仅补充这一固定错误标记的中文映射，明确是当前模型供应商返回余额不足；保留未知错误脱敏、任务结果核对和不自动重发。修改 `opencode/acp-connection.ts` 并补充两种错误载荷的回归用例，不更改计费、供应商配置、IPC 或数据库。

本次增量只做静态调用链与 diff 检查；不足编译测试门槛，不运行新增用例或构建。**本次修改影响范围有限，未执行编译验证。** 上述 924 项历史结果不包含本次新增的两个用例。映射只有在 ACP 返回已知标记时可用；若仅返回通用错误，仍需在原生客户端核对。主进程变更需更新程序并重启后生效。

### 隐藏 Skill 读取说明（2026-10-30）

按用户要求，工具箱用户消息的展示、复制和取回编辑不再包含自动附加的本机 Skill 读取说明。仅识别消息末尾引用区中与现有生成文案完全匹配的行，保留用户提问、其他文件／工具引用和助手回答。发送载荷与原生历史不修改，因此原生客户端仍可能显示原始说明；这不是撤回或删除原生消息。临时 Skill 引用取回后仍需重新选择。

修改范围为渲染层正文处理、消息组件和取回草稿；没有新增 IPC、数据库或依赖。静态检查调用链及 diff；本次修改影响范围有限，未执行编译验证。不同版本或原生客户端改写过的说明不自动隐藏，避免误删普通内容。
