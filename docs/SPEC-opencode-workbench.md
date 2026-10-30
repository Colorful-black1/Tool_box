# OpenCode 工作台首版

> 2026-10-23：当前交互以 [统一工作台规格](SPEC-coding-agent-workbench.md) 为准。
> 首次发送按需连接 / 新建，历史直接点选，恢复保留原生模式；连接细节收进设置，旧交接表单已取消。
> 下文保留首版实现与历史修复记录；“读取历史 / 手动预建会话 / 打开后一律 Plan”等旧交互描述不再作为验收条件。

## 原生会话名称修复（2026-10-22）

- 根因：`session/load` 恢复时未沿用历史摘要的 title，ACP 解析也未消费 `session_info_update.title`。
- 上游存在不推送标题的情况，参见 [OpenCode 标题通知问题](https://github.com/anomalyco/opencode/issues/56894)。
- 服务缓存当前项目的有界标题摘要，恢复时优先使用；打开会话后通过 `session/list` 同步。
  点击现有「读取 OpenCode 历史」会刷新已打开会话，读取中收到较新的标题推送时保留新名称。
- 任务结算后读取一次名称，10 秒后再补读一次，不持续轮询；断连清理计时器与缓存，旧响应不能回写。
- 接收非空标题推送，最多 100 字符；名称与历史选项同步，仍按原有文本方式显示。
- 读取失败保留已有标题，不改变任务结果、不显示第三方错误、不修改 OpenCode 原生名称。
- 仅改 OpenCode 服务 / ACP 解析 / renderer store 及相关回归用例与文档；不改 schema、IPC 或依赖。
- 新增 6 项回归用例但未执行：本次未达到 AGENTS.md 的编译测试门槛，仅做静态调用链与 diff 审查。
  本次修改影响范围有限，未执行编译验证。
- 手动验收：分别恢复两个已有名称的原生会话，核对列表与顶部标题；在 Desktop 改名后读取历史；
  新会话完成任务后等待名称补读；断开并重连，确认无自动新建或历史响应串入。

## 当前补充需求（2026-10-22）

- 连接只完成握手与模型偏好读取，不自动创建或恢复会话；用户手动新建或选择历史。
- 模型下拉按 Desktop 的可见性规则过滤，不直接展示 ACP 的完整模型目录。
- 本机 Desktop 2.1.1 的规则已从安装包核对：显式 hide 优先，显式 show 显示；
  未指定时使用近期各供应商 / 家族 / 免费档最新模型，并保留无有效发布日期的默认可见项。
- 主进程只读 `ai.opencode.desktop/drafts.sqlite` 的 `state` 表中
  `name=opencode.global.dat`、`key=model`；只解析 user 可见性，不读取对话、草稿、登录或其他偏好。
- 复用已安装 CLI 的 `api model.list --param location[directory]=项目目录`，
  只提取 id、供应商、家族、发布日期和费用档位，原始头部及设置不跨 IPC、不记录。
- `OpenCodeInfo` 增加可见模型 id；沿用现有 inspect 同步偏好，界面提供「同步模型」。
  无法读取偏好时明确报错，不回退展示所有模型；当前模型被隐藏后需手动选择可见模型再发送。
- 不改 IPC 通道、数据库结构、加密或依赖，不安装运行时，不自动提交；保留未提交的工具导航工作。

实施顺序：模型读取 / 可见性纯函数与测试 → 连接和返回契约 → 手动会话与模型界面 → 隔离及只读实机验证。
验证运行 typecheck、lint、test、build；shared 类型变更后补充 mobile:typecheck 和 mobile:bundle。

补充需求验收：以上六个命令均通过，771 项单测 / 68 个文件（本轮新增 13 项）；
桌面端无编译告警，手机打包有已知 NO_COLOR / FORCE_COLOR 环境变量警告。
OpenCode 专项 UI 15 项通过、页面异常 0 项，覆盖首次连接及重连不自动开会话、手动新建 / 历史恢复、
仅列可见模型、同步隐藏当前模型后的发送拦截 / 草稿保留，以及三套主题和窄窗。
`node verify/opencode-smoke.cjs --connect-only` 在本机 Desktop 2.1.1 通过 3 项只读检查，
读取 23 个可见模型，重连 / 同步后原生会话列表不变，无会话更新事件；本轮未新建或发送真实会话。
读取失败时不回退全量模型。标准 profile 已验证，自定义 profile 和其他版本偏好格式尚未实机验证。

## 首版范围（历史）

用户已授权先接入已安装的 OpenCode Desktop，在 Tool_box 内使用编程 Agent 并保留外部入口。
本轮不实施 DeepSeek、工具搜索/排序，不安装 CLI 或第三方依赖，不自动提交。

## 能力与顺序

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| opencode-transport | 有界 JSON-RPC stdio、超时、取消与权限请求 | 无 |
| opencode-service | 检测桌面内置 CLI、选择目录、创建/恢复会话、生命周期 | opencode-transport |
| opencode-workbench | 独立入口、模型/模式、会话、文本/工具状态、操作审批 | opencode-service |
| prompt-handoff | 工具结果及 Prompt 填入编程草稿，用户手动发送 | opencode-workbench |

实现顺序：真实握手验证 → 协议/服务与单测 → IPC → 工作台 → Prompt 交接 → 隔离验收。

## 契约与范围

- 在 `shared/types.ts` 定义 OpenCode 入参与可序列化视图；同步 bridge、IPC 通道、preload。
- 新通道使用 `opencode:*`，事件集中定义；原项目助手的聊天接口与权限保持独立。
- renderer 仅经 `window.toolbox.opencode` 调用；进程由主进程以参数数组、无 shell、隐藏窗口启动。
- 自动检测标准桌面安装目录，支持文件选择；只允许 OpenCode 可执行文件，验证版本与 ACP 握手。
- 工作目录经系统选择框确定；配置只保存程序路径和目录，沿用现有 kv，无 schema 变化。
- 不读出或记录 OpenCode 登录凭据、进程环境与原始 stderr；沿用其自己的登录和模型配置。
- 工作目录不是安全沙箱。首版显示 OpenCode 模式与每次权限询问，不自动批准写操作。
- 初始 fs/terminal 客户端能力不宣称支持，文件与命令由 OpenCode 自有工具完成。
- 会话内容保留在 OpenCode；Tool_box 内存管理视图，恢复能力按握手声明启用。
- 不把外部 Agent 接到书架、密码箱等内部工具，不启用 webview 或更改安全配置。

## 交互与边界

- 入口「编程 Agent」复用星轨令牌、按钮、Dropdown、Markdown 和状态提示。
- 明确展示检测中、未发现运行时、未连接、已连接、运行中、待审批、停止中、断连与失败状态。
- Prompt/工具结果只填草稿；替换已有草稿前确认；只有用户发送才调用模型。
- 会话切换不能串流；运行中阻止更换目录/运行时，主动停止不报系统错误。
- 不支持的模型/模式/会话能力隐藏或说明，不编造状态；断线不自动重发已提交任务。
- 主进程拒绝未知会话/审批编号，取消及退出清理待审批与请求，仅结束自己启动的连接进程。
- IPC/协议输入有长度、数量和类型上限；协议错误不携带原始内容或第三方异常细节。

## 验证

- 单测验证拆包/粘包、未知/非法响应、输出上限、超时、取消、断连、审批与跨会话隔离。
- 服务测试用合成子进程/传输；界面用合成桥接，禁止访问真实 toolbox.db。
- 真实桌面内置 CLI 验证版本、握手与目录能力；真实模型验证只用合成短输入，不触发代码修改。
- 最终依次 `npm run typecheck` → `npm run lint` → `npm run test`，再 `npm run build`。
- shared 变更后执行 `npm run mobile:typecheck`、`npm run mobile:bundle`。
- 1280×820、1024×680 及三套主题目视检查；不运行 `npm run rebuild`。

## 首版验收记录（2026-10-22）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，无错误 |
| `npm run lint` | 通过，0 errors / 0 warnings |
| `npm run test` | 747 项 / 65 个文件通过，含新增 35 项 |
| `npm run build` | 主进程、preload、renderer 构建通过 |
| `npm run mobile:typecheck` | 通过 |
| `npm run mobile:bundle` | 通过，964 模块 / 2.4 MB；有 `NO_COLOR` 被 `FORCE_COLOR` 忽略的环境变量警告 |
| `node verify/desktop-ui/run.cjs --opencode-only --screenshots` | 12 项通过，页面异常 0 项，含连接引导、重新检测和紧凑配置展开 / 收起 |
| `node verify/desktop-ui/run.cjs --screenshots` | 首版全量 56 项通过，页面异常 0 项；覆盖原有工具、搜索、聊天、主题及重启恢复，本轮仅重跑 OpenCode 专项 |
| `node verify/opencode-smoke.cjs --prompt` | Windows Desktop 2.1.1，5 项真实检查通过 |

实机检查依次验证 Desktop 内置 CLI 握手、创建项目会话并切到 Plan、列出原生历史、
发送仅要求返回标记的合成短消息、断开重连并恢复该会话及历史。
未额外安装 CLI，未读取登录凭据或访问真实 toolbox.db；消息明确要求不调用工具、不读写文件。
检查会创建少量 OpenCode 原生验证会话，不删除或覆盖已有记录。

主要改动分布在 `services/opencode/`（传输 / 解析 / 运行时 / 生命周期）、
`ipc/opencode-ipc.ts` 与 shared / preload 契约、renderer 的工作台组件及状态管理，
工具结果仅新增草稿交接。未新增 npm 依赖、schema、加密改动或手机端入口。

边界：首版一次运行一个任务；工作目录不是沙箱；Build 沿用 OpenCode 的现有权限。
Windows 标准 Desktop 2.1.1 安装已验证，其他平台和自定义外部 Desktop 启动入口未实机验证。
ACP v1、配置选项或 Plan 缺失会拒绝创建可发送会话；没有完整终端、代码编辑器或 Diff 审批。
断线或超时后任务结果可能未知，界面保留提示且不自动重发。

收尾检查：按正确性、可读性、架构、安全、性能五项自查；契约与桥接一致，
外部文本复用安全 Markdown，未知客户端文件 / 终端能力拒绝执行，流式消息、请求和审批均有上限。
未发现阻塞首版试用的问题。`git diff --check` 无空白错误；Git 的 LF → CRLF 提示属于本机换行配置。
构建与截图产物保持在忽略目录；提交遵循用户明确授权。

## 连接引导修复（2026-10-22）

连接按钮的条件是检测到程序、选择项目且没有待处理操作；Desktop 窗口是否打开不是条件。
原界面未显示具体阻塞原因，程序检测结果也缺少手动刷新入口。
现在逐项说明准备状态并提供「重新检测」，刷新不会覆盖已选项目或草稿，也不连接或发送。
新增 2 项状态测试；缓存无法刷新的回归用例在修复前失败、修复后通过。
本轮 `typecheck`、`lint`、747 项单测及 `build` 均通过，无错误或告警；
隔离 Electron 专项 11 项通过、页面异常 0 项，1280×820 的缺少项目 / 程序提示已目视确认，
原有三套主题及 1024×680 布局检查通过。
没有 shared、preload、主进程、IPC、数据库、加密或依赖变更，因此不重复手机端与真实模型检查。

## 紧凑工作台美化（2026-10-22）

用户确认采用「缩小连接区，把空间留给对话」。本轮保留主题、文案与操作逻辑，
只调整四个工作台组件及 `global.css` 中的 OpenCode 作用域样式：

- `opencode-connection.tsx`：连接后约 74px 的项目状态栏，设置按需展开，未连接时保留完整引导。
- `opencode-sessions.tsx`：左对齐的会话条目、数量与状态，复用既有图标，选中态用主题金线。
- `opencode-workbench.tsx`：模型 / 模式显示标签；草稿正文与底部计数、发送 / 停止分层。
- `opencode-messages.tsx`：居中的首用提示，回复减少外框，用户输入保留有界背景，原滚动行为不变。

验证：`typecheck`、`lint`、747 项单测、`build` 全部通过，无错误或编译告警。
隔离 Electron 12 项通过、页面异常 0 项；1280×820 消息区超过 300px，
三套主题、1024×680、配置展开、草稿流转、历史、审批、停止均通过并目视确认截图。
窄窗和审批态允许必要的纵向滚动，按钮仍可访问；配置折叠仅属显示状态，不改变连接或项目。

Impeccable 扫描仅命中未改动的共享 Markdown 引用线（`global.css:2688`，warning）
和书架封面缓动（`global.css:1283`，advisory）；这两项属于既有系统且超出本轮范围，保留原样。
未增加依赖、主进程或接口改动。
