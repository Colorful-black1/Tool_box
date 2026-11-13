# 路线图

本文件记录**当前状态、待办与待人工验收项，以及换机器必须知道的环境事实**。功能与安装见 [README](../README.md)，协作纪律见 [AGENTS.md](../AGENTS.md)。

> 维护范围（2026-10-23 确认）：PC 桌面端为主线，手机端暂停维护。`mobile/` 的代码与历史记录保留，范围与恢复条件见 [手机端冻结说明](mobile-frozen.md)。

## 1. 当前状态

| 项 | 值 |
| --- | --- |
| 版本 | 桌面 0.3.0 |
| 平台 | Windows 10/11 x64（当前唯一验证平台） |
| 数据库 | SQLite schema v7；升级前自动生成 `backups/toolbox-before-v7-*.db` |
| 密钥 | 主密钥经 Windows DPAPI 封装，绑定当前系统用户 |
| 导航 | 对话 · 开发工作台（编程 Agent / Token 统计 / 命令速查 / 工具）· 阅读空间（书架 / 统计）· 个人管理（密码箱 / 记事本 / 待办）· 知识库 · AI 情报 · 系统 |
| 编程 Agent | OpenCode / Codex / Claude Code / Claude Desktop / DeepSeek Harness；Kimi 只保留枚举 |
| 手机端 | 2026-10-23 起冻结，不参与构建、验收与发布 |

**已用真实环境验证**：Windows 安装后的日常使用；OpenCode Desktop 2.1.1 握手、模型目录与历史；Codex App Server 握手与项目历史；DSH 0.2.1-rc.3 初始化、历史读取与工作区归组；CC Switch 双路由；真实 TCP / UDP 端口查询；三套主题与 1280×820 / 1024×680 布局。

**只有合成数据验证**：AI 对话与工具调用、密码 AI 识别、向量 / 重排检索、流式输出、绝大多数 UI 交互（隔离 Electron + 合成桥接）。

**未实机验证**：真实模型任务下的 Claude / DSH / Codex 权限与停止、MCP 表单、开源热榜的页面结构变化与代理环境、模型世界的数据源变更、打包安装后的完整退出。

## 2. 待办与待验收

### 2.1 需要真实环境人工验收

- **编程 Agent**：真实供应商任务 + 允许 / 拒绝 / 停止；跨 Agent 审批不串会话；Claude 与 DSH 的历史续接在 Desktop 打开时的表现；打包安装后的三种退出状态（未连接 / 空闲 / 有运行任务）。
- **MCP 与结构化表单**：真实 MCP 服务触发的表单、超时与取消；Codex 原生权限映射的真机确认。
- **桌面通知**：正式安装版的通知送达、免打扰表现与点击定位；测试通知不能替代系统送达。
- **AI 与检索**：真实向量模型 / 重排模型的导入、补齐与检索；知识库回答与「仅关键词」降级提示是否符合预期。
- **数据安全**：在真实数据库上导出快照 → 改动 → 恢复的完整往返；恢复失败与中断回退。
- **安装包**：`npm run dist` 后的安装、升级、卸载与 SmartScreen 表现。

### 2.2 未开始或后置

- **Kimi 接入**：先核对 Windows 原生程序、协议与登录前提；不因保留枚举自动安装。
- **自动串行团队 / 并行独立工作区 / Paperclip**：需要先确定持久化、租约、DAG 与集成策略，均未授权实施；worktree 不等于系统沙箱。
- **WorkBuddy / CodeBuddy**：分别确认本地与云端 API、认证、数据边界与许可。
- **工具候选**：文档转换、批量重命名等新工具只做方向评估，未授权实施，也不因评估自动新增依赖。

### 2.3 工具候选（未授权）

以下方向评估过、但都没有实施；新增任何一项都要先确认 IPC、依赖与隐私边界：

- cURL → 代码、本地 HTTP 调试、TTS、EPUB 阅读、记账、在线泄露查询、数据库直连。
- 共同前提：能离线完成优先；需要联网的必须默认不发起、明确按钮触发并说明外发内容；涉及凭据的一律不落盘。

### 2.4 编程 Agent 后续能力（未排期）

已有编号、尚未实现；实施前先确认原生协议是否支持，不支持就不做按钮。

| 编号 | 能力 | 范围 |
| --- | --- | --- |
| F06 | 工具详情与文件 Diff | 工具入参与结果从摘要提升为可展开详情；按原生能力列文件改动，并区分「本任务 Diff」与「当前工作区 Diff」 |
| F07 | 会话正文查找 | 在已加载消息范围内查找与上 / 下一处跳转，可直接定位到某条用户提问 |
| F08 | 代码块与原文操作 | 代码块一键复制（不带语言标签）、长行换行开关、Markdown 与原文切换 |
| F09 | 图片与附件 | 粘贴截图、拖入图片与文件，带预览与移除；按模型与原生协议判断可用性，不支持时明确拒绝 |
| F10 | 按消息分叉 | 从选定提问处分叉出新原生会话并保留原会话；必须先在原生侧验证能力 |
| F11 | 会话整理与导出 | 重命名、归档与 Markdown 导出（导出需标明范围） |
| F12 | 运行中待发消息 | 运行中可写待发消息并修改 / 取消；先做单条，不做任务队列 |
| F13 | 思考与计划折叠 | 折叠展示思考过程、计划步骤与 Todo，只用原生公开事件，不推测隐藏推理 |
| F14 | 完成与待回答提醒 | 后台任务完成或等待回答时给应用内提醒并可一键定位；系统通知另行确认 |


- **手机端**：冻结中，恢复前需重新核对 schema、依赖、共享接口与加密格式。

## 3. 环境与已知坑

### 3.1 安装

必须用 `npm install --ignore-scripts`，再手动补跑 Electron 与 esbuild 的安装脚本；原因与完整命令见 [README「快速开始」](../README.md)。`npm run rebuild` 是反效果的：better-sqlite3 13 起使用 Node-API 预编译，重编译产物会被 `prebuilds/` 抢先加载，永远不会生效。

### 3.2 运行时版本

`engines` 写 `>=20`，但实际要求更高：`better-sqlite3@13` 需要 Node ≥ 22，Electron 44 需要 Node ≥ 22.12。已验证组合为 **Node 24.21.0 + npm 11.19.0**；22.12 以下跑不起来。

### 3.3 打包实测（2026-10-25）

| 命令 | 结果 |
| --- | --- |
| `npm run pack` | 成功，`prebuilds/win32-x64.node` 进入 `app.asar.unpacked` |
| `npm run dist` | 成功，安装包 212,976,320 B（精简前 225,366,461 B，约 −5.5%） |
| 安装目录 | 656.70 MiB（精简前 739.64 MiB） |
| 打包产物加载 better-sqlite3 | `ASAR_LOAD_OK sqlite=3.53.4`（用打包后的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 直接 require asar 内模块） |

`npmRebuild: false`、`asarUnpack: ["**/*.node"]`、`files` 只收 `out/` / `assets/` / `package.json` 三条规则不能删：删掉后原生模块或 `assets/prompts/password_import.txt` 会在运行期失踪。安装包为 `perMachine: false` + `oneClick: false`，免管理员权限并带安装向导。

### 3.4 已解决的坑（桌面）

| 坑 | 后果 | 约定 |
| --- | --- | --- |
| 建表 DDL 里混入 `ALTER TABLE` 列补丁 | 真机首启崩溃 `duplicate column name` | 建表与列补丁分开，补丁先查列再执行 |
| 依赖 `npm run rebuild` | 无 MSVC 的机器必然失败，且产物不会被加载 | 不跑；见本节 3.1 |
| 用布尔 `dirty` 做自动保存 | 保存飞行中继续输入会永久丢字 | 用单调递增修订号，只标记「至少已存到该版本」 |
| 在渲染层读 `ref.current` 派生状态 | 值变化时拿不到新结果，`react-hooks` 报错 | 派生值放 state，用 `useEffect` 写入 |
| 在已中止时直接 reject 的 `raceAbort` | unhandled rejection | 原 promise 也要挂处理器 |
| 菜单 / 弹层随滚动容器被裁切 | 下拉被截断、位置错乱 | 走 Portal + 边界翻转，Esc 只关顶层 |

## 4. 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-11-12 | 新增「AI 情报」分类，含 GitHub 开源热榜与 AI 模型世界（models.dev + Epoch 原生采集，新增 `fflate` / `csv-parse`；含 ECI × 价格前沿视图） |
| 2026-11-11 | GitHub 开源热榜（Trending 解析 + Search 兜底）；对话上下文占用可视化与自动压缩（schema v7） |
| 2026-11-07 | 知识库 P2：向量模型 / 重排模型、RRF 融合与降级 |
| 2026-11-06 | 本地知识库 P1：导入、分块、FTS5 检索（schema v6） |
| 2026-11-02 | 编程 Agent 会话正文分页与懒加载，撞上限不再终止任务 |
| 2026-11-01 | 能力扩展第一批：密码健康、运行期剪贴板、只读重复文件查找、本机快照 |
| 2026-10-31 | 记事本清单转待办、整段会话存笔记、JSON → TypeScript、本周完成周报 |
| 2026-10-30 | 个人 Skill 索引合并；Codex 分页回退与 OpenCode / Codex 受限表单 |
| 2026-10-29 | 首批基础交互：取回编辑、上下文快照、Claude 问答 / 计划确认、Codex 用户提问 |
| 2026-10-28 | 项目隔离与并行任务；DSH 独立启动 cwd 修复 `.env` 冲突 |
| 2026-10-26 | Claude Desktop 独立入口、Codex 历史与退出修复 |
| 2026-10-25 | 桌面控件统一；MyBatis / 颜色 / 单位 / 时区 / 待办提醒（schema v5）；收藏与加密草稿；Claude 与 DSH 接入 |
| 2026-10-24 | Token 统计：14 类本机来源、筛选与 CSV 导出 |
| 2026-10-23 | 多 Agent 工作台主线：OpenCode / Codex 运行时、会话与审批 |
| 2026-10-22 | OpenCode 首版；树形侧栏；工具搜索与排序；三套主题 |
| 2026-10-21 | 开发者工具页、⌘K 全局搜索、托盘与全局快捷键；正则 Worker、输入校验、主题令牌 |
| 2026-10-01 | 全新机器实测，修正「必须 rebuild」的错误结论 |

## 5. 验证命令

按 [AGENTS.md](../AGENTS.md) 的「验证与编译策略」分级执行；打包与端到端验收需用户同意。

```bash
npm run dev
npm run build

npm run typecheck
npm run lint -- --ignore-pattern "mobile/**"
npm run test -- --exclude "mobile/**"
```

隔离 UI 验收（先 `npm run build`）：`node verify/desktop-ui/run.cjs --screenshots`，按 `--tools-only`、`--coding-agents-only`、`--context-only`、`--knowledge-only` 等参数收窄范围。截图写入忽略目录 `.playwright-mcp/desktop-ui/`，使用合成桥接与临时用户目录，不读取真实数据库、不调用 AI。

手机端命令（`npm run mobile:*`）只在明确恢复维护时执行，当前不属于验证流程。
