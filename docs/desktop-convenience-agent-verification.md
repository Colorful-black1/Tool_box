# 桌面便捷功能与 Agent 扩展交付记录

日期：2026-10-25。实施依据：[计划](PLAN-desktop-convenience-agent-expansion.md)。

## 范围、授权与现状

已实施 A–D：工具收藏／最近使用、编程草稿恢复、Claude Code 官方 SDK、DeepSeek Harness ACP。
用户分别同意了草稿新 IPC 与用途隔离加密、固定 `@anthropic-ai/claude-agent-sdk@0.3.310` 及必需依赖／Windows 原生组件、DSH“提交后更新、可续接但不回放旧消息”的限制。
只维护 Windows 桌面端；无 schema 迁移、手机适配、Kimi、自动团队、分支、提交或推送。本轮没有发送真实模型任务。

## 操作步骤

1. 打开「开发工作台 → 工具」，点击工具名称右侧星标收藏。顶部收藏和最近使用可直接打开工具，Ctrl+K 空输入优先显示这些入口。输入搜索词后仍按原全局搜索处理；原组内排序保留。
2. 打开「编程 Agent」，选择 OpenCode、Codex、Claude Code 或 DeepSeek Harness，再选择项目。输入文字后可看到保存状态；约 500ms 后加密落库。
3. 退出后重新打开，恢复 Agent、项目和新对话草稿；不会自动连接或发送。历史草稿在点选相应历史后恢复。
4. 原生历史失效时打开「管理草稿」，找到项目和文字预览，点击「取回」为新对话草稿；原历史草稿保留。清除单条／全部需确认。
5. 准备执行时点击「开始对话」。已完成回复可用「用于 Codex／OpenCode」或「其他 Agent」选择目标；内容只进入目标草稿，需再次点击发送。已有会话仍从「改用已有会话」选择。
6. 未检测到程序时展开「连接设置」重新检测或选择官方程序。Claude 可用随包原生组件；DSH 可选择官方 CLI、npm `dsh.cmd` 或 Desktop 的 `DeepSeek Harness.exe`。

## 实现位置与行为

| 模块 | 主要文件 | 行为 |
| --- | --- | --- |
| 快捷入口 | `shared/tool-shortcuts.ts`、`tool-shortcut-store.ts`、工具目录、命令面板 | 复用注册表 ID 和 config；收藏 30、最近记录 20／显示 8；串行保存，失败回退／重试，不记录取消跳转 |
| 草稿契约 | `shared/agent-drafts.ts`、bridge／ipc-contract／preload／validation | 独立 DTO 与通道；不持久化连接引用、运行状态、审批或完整聊天 |
| 密文记录 | `agent-draft-service.ts`、`chat-store.ts`、`safe-storage-secret-box.ts` | 既有 kv 的独立密文，CAS 修订号，解密失败阻止覆盖，旧密码兼容 |
| 草稿协调 | `agent-draft-sync.ts`、`coding-agent-store.ts`、`agent-draft-recovery.tsx` | 读取合并、输入优先、防抖／串行保存、管理取回、正常退出有界刷新 |
| Claude | `claude-runtime.ts`、`claude-adapter.ts` | 官方原生组件与 SDK；初始化、增量、审批、停止、原生历史／模型 |
| DSH | `dsh-runtime.ts`、`dsh-adapter.ts` | 官方 CLI 固定参数，ACP 能力协商、会话／取消／审批，真实限制提示 |
| 共享 ACP | `stdio-rpc-connection.ts`、`coding-agents/acp-codec.ts` | 提取通用传输与 codec；OpenCode 包装保留原文案／退出语义，原测试继续覆盖 |

## 草稿契约与加密边界

* `AgentDraftDocument.version = 1`；保存所选运行时／项目，以及 `{ runtimeId, directory, nativeSessionId, content }` 草稿数组。新对话的原生会话 ID 为 null；路径规范化，Windows 大小写／分隔符统一，身份键为 JSON 元组。
* `agent-draft:read` 返回 `{ revision, document }`；`agent-draft:save` 接受相同结构，以当前 revision 为期望值。主进程同步串行写入并递增 revision，冲突需重读合并；参数由 `ipc/validation.ts` 校验，解密后的内容也经纯解析器检查。
* 每条 1–50,000 字符、最多 100 条，完整文档 UTF-8 最多 2 MiB。达到限额不静默淘汰；保留内存输入并显示错误。未选项目的文字仅在内存，退出刷新不能误报已保存。
* 数据位于既有 kv 的 `agent_drafts_v1`，普通 `read_config` 不含正文。整体使用 v2 草稿信封，AES-256-GCM、每次随机 IV，AAD 固定用途 `toolbox:agent-drafts:v1`；只在受控 IPC 返回解密文档。
* 密码仍使用 v1 载荷和同一个受系统保护的 `password-master-key.json`。新文本接口遇到已存在但损坏／不可读的密钥会失败，不生成替代密钥、不覆盖文件；解密时密钥缺失也不创建。系统安全存储不可用不降级为明文。
* 读取期间按身份追踪修改和清空，迟到加载不覆盖用户输入；发送确认后仅清理对应旧文字。旧版程序会忽略独立 kv 记录，schema 仍为 v4，无升级／回滚脚本；旧密码格式、算法和主密钥位置兼容。
* 正常退出通过 `agent-draft:event:flush` 请求窗口刷新，使用 `agent-draft:flushed` 确认，校验窗口／主 frame／请求 ID，最多等待 2 秒。未确认时提供返回／仍然退出；原生服务改在 `will-quit` 清理，取消退出后仍可继续操作。
* 异常终止、操作系统强制结束或选择“仍然退出”可能丢失尚未保存的最后一段文字。密钥绑定本机系统安全存储，不承诺跨机器迁移。

## 原生能力与限制

| 项目 | Claude Code | DeepSeek Harness |
| --- | --- | --- |
| 本机版本 | SDK 0.3.310，随包 CLI 2.1.310 | Desktop／ACP 0.2.1-rc.3 |
| 连接 | 官方 SDK 空输入初始化／模型目录；无模型消息 | 官方 Desktop 固定 CLI 入口，`--profile acp`，initialize／session/list |
| 输出 | SDK 真实 partial events 合并完整快照，约 40ms 合并投递；不混入子任务正文 | 只显示协议提交的消息，无原始 Token 分片，不增加逐字动画 |
| 历史 | 官方 listSessions／getSessionMessages；项目内选择和 resume；显示前 200 条、最多 200,000 字符 | 项目摘要列表与 resume；恢复上下文但不回放旧正文，独立 acp profile 可能不含 Desktop 历史 |
| 默认权限 | plan；可选择 default。原生已允许操作不一定进入审批回调 | 沿用原生配置与规则，无虚构只读档位或模式选择 |
| 认证／配置 | 官方程序处理认证；`settingSources: []`，不自动加载用户／项目／local settings 中的 hooks／MCP，不复制凭据，不保证订阅额度 | 官方 acp profile 配置与认证；不复制其他 Agent 凭据，不读私有 WebSocket |
| 审批／停止 | 单次允许／拒绝；等待审批时也能停止；结构化问答／计划确认明确结束并提示原生继续 | 仅 allow_once／reject_once；取消等原生结算，超时关闭自有连接，只关闭本连接打开的会话 |
| 未提供 | 用户问答、单独子任务展示／停止、Desktop 实时同步 | 旧正文回放、实时 Token 分片、DSH 专有卡片／问答／子任务详情、额外目录 |

所选目录不构成操作系统沙箱。两者的真实生成、实际文件权限、账号额度和 Desktop 互见仍需手动验收，不能以合成测试或初始化探针代替。

## 验证结果

本任务新增有效代码已超过 500 行且涉及超过 10 个文件，满足仓库验证门槛；未计入实施前已有的计划文档改动。

| 命令／检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern "mobile/**"` | 通过，0 警告／失败 |
| `npm run test -- --exclude "mobile/**"` | 84 个文件，641 项通过；Node 有既有 `--localstorage-file` 路径警告，无测试失败 |
| `npm run build` | 主进程、preload、renderer 通过 |
| `node verify/desktop-ui/run.cjs --convenience-only --screenshots` | 16 项通过、页面异常 0；真实 SQLite＋系统加密，包含完整 Electron 重启 |
| `node verify/desktop-ui/run.cjs --coding-agents-only --screenshots` | 12 项通过、页面异常 0；保留首次发送、停止、历史与转用流程 |
| `node verify/desktop-ui/run.cjs --tool-navigation-only --screenshots` | 10 项通过、页面异常 0；原搜索、真实拖动、键盘排序与重启保持 |
| `node verify/agent-runtime-connect-smoke.cjs` | Claude 2.1.310、DSH 0.2.1-rc.3 初始化及项目摘要通过；摘要均 0 条，无创建／恢复／发送 |
| `node verify/dev-start-smoke.cjs` | 真实开发配置及桥接启动通过，数据隔离；5173 已占用，自动使用 5174；结束后恢复正式 out 构建 |
| Windows x64 目录打包 | 最终代码使用下方隔离输出／本地 Electron 命令通过；`npmRebuild=false`，未重建 SQLite；Claude 原生程序解包到 `app.asar.unpacked` |
| 打包后 SDK 探针 | 从新包的 ASAR 导入 SDK，使用解包后的原生程序初始化，模型目录 5 项；无 Prompt／模型任务 |
| 静态差异审查 | SQL 参数化、IPC 主 frame／窗口、密钥／日志、四层契约、手机范围、Git 状态检查完成；未暂存或提交 |

截图位于忽略目录 `.playwright-mcp/desktop-ui/convenience-{tools,agents}-{starry,graphite,paper}-{1280,1024}.png`。
三主题覆盖 1280×820／1024×680，已目视检查代表截图，并保留原工作台三主题菜单／输入布局检查。
所有 UI 与开发启动均使用临时数据目录，不修改日常 toolbox.db、主密钥或 Agent 认证。

最初验证发现并修复了测试路径别名、未加载状态的写队列释放等问题；最终结果以表中复验为准。
静态审查还补充了两种新适配器的迟到初始化隔离、Claude 启动确认后才接受发送、停止后的未消费输入关闭；新增回归覆盖。另行检查 DSH 1024×680 的输出限制、草稿和发送按钮均可见，打包后 Claude 原生程序 `--version` 为 2.1.310。
开发启动探针首次使用过早的 Node preload 包装导致 `electron` 未就绪，已改为 Vite 临时入口并复验通过，不作为产品缺陷或成功启动证据。
打包仍提示已有 `@electron/rebuild` 冗余及重复依赖引用；没有采用自动重建建议，也没有新增 postinstall。

默认 `npm run pack` 首轮通过；最终复验遇到 Windows 提取目录重命名 EPERM，随后远程运行时下载等待未完成，已停止本次检查进程。使用相同已安装 Electron 44.5.1 绕过下载／旧输出目录后通过，未修改项目打包配置：

```powershell
npm run build
node node_modules/electron-builder/cli.js --dir "--config.directories.output=release/desktop-agent-verification" "--config.electronDist=node_modules/electron/dist"
```

最终目录为 `release/desktop-agent-verification/win-unpacked/`；未生成或发布安装器。PowerShell 使用带引号的长参数，避免短 `-c` 被解析成配置文件路径。原安装器未覆盖。

## 依赖审查与包体影响

SDK 精确固定 0.3.310；必需 peer 由锁文件固定，Windows 原生组件与 SDK 同版。安装使用 `--ignore-scripts`，未改系统 PATH、未安装 DSH CLI、未启用依赖安装脚本。
对比原锁文件，已有包的版本仅 `fast-uri 3.1.8 → 3.1.9`：SDK 必需 MCP peer 复用了这项旧传递依赖，按[上游安全补丁](https://github.com/fastify/fast-uri/releases/tag/v3.1.9)更新；没有执行 audit fix／force 或批量升级。

镜像 registry 不支持审计端点，改用官方 registry 只读审计：

* `npm audit --omit=dev --registry=https://registry.npmjs.org --json`：0 项告警。
* 全量审计：10 项既有告警（5 moderate、5 high），涉及 Electron、Vite、Vitest、Tailwind／PostCSS、node-gyp／undici 等。相关版本未由本轮引入或升级，不扩大本轮范围自动处理；需要单独维护任务。
* Electron 虽声明为开发依赖，仍是打包应用的运行外壳，因此不能把 omit-dev 为 0 解读为整个应用没有风险。当前 Electron 告警为 eMudhra 中间证书缓解项；打包发布前应评估并升级受影响的既有壳版本。本轮仅目录打包验证，未发布。

随包 Claude Windows x64 原生程序约 283 MiB，整体安装体积会增加。依赖下载、原生组件与官方认证可用性应在目标机器检查；其他系统与 WSL 没有实机验收。

## 待用户手动验收

- Claude：可用认证下的一次真实只读回复、标准模式单次允许／拒绝、等待审批时停止、普通生成时停止、真实原生历史续接。
- DSH：实际配置模型的提交后回复、单次允许／拒绝、取消与占用会话、确认 acp profile 与日常 Desktop 历史范围。
- 正常退出保存失败时选择返回／仍然退出，以及系统强制终止下的最后防抖窗口；已保存内容的重启恢复已有隔离验证。
- Desktop 实时互见、跨机器密钥迁移、未安装运行时、自定义安装／WSL 和其他操作系统，不因本轮代码／合成通过而承诺支持。
