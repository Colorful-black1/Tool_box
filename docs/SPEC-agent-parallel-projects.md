# 编程 Agent 独立项目与并行任务

日期：2026-10-28。用户明确要求修复 DSH 连接，并允许不同 Agent 同时执行不同项目任务。

状态：项目隔离、并行任务、传输诊断和合成验收已完成；DSH 项目 `.env` 启动冲突已定位，改用独立启动 cwd 解决；Desktop 历史标题、空白会话过滤与重连补读已验证。未提交。

## 范围与模块

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| dsh-connect | 定位原生启动失败，保留无模型握手及安全诊断 | 既有 DSH ACP |
| agent-projects | 切换恢复目标 Agent 的项目、会话与草稿 | 既有分运行时工作台 |
| agent-parallel | 前后端分别按运行时管理任务及发送准备；后台任务可查看和停止 | agent-projects |

实施顺序：确认 DSH 原因 → 项目隔离 → 并发控制及界面 → 回归。

## 行为

- Agent 已选项目不再被来源项目覆盖。首次使用可继承当前项目作为起点；检测到自己的已保存项目时优先恢复，用户明确选择的项目优先。
- 不同 Agent、不同项目可同时准备、执行及接收结果；同一个 Agent 仍一次一个任务。同一规范项目路径不并发执行顶层任务，避免同时写入。
- 查看后台任务、停止、取消发送准备、权限审批均指定运行时和会话。某个任务结束、失败或断开，只释放其自身状态。
- 后台任务展示 Agent、项目和状态；存在审批时可直接进入对应会话。切换页面不停止、重发或新建任务。
- 原生事件沿用 connectionId / sessionId / runId / revision 检查；旧连接和迟到事件不得清除其他任务。
- 文件候选与未发送引用必须随 Agent / 项目切换失效，不能把来源项目引用带入目标任务。
- 开发工作台切换只改变当前查看的 Agent，不改变其他 Agent 的项目、历史、草稿或运行状态。
- DSH 历史与 Desktop 共用 `~/.dsh/sessions`；列表读取 Desktop 单会话缓存的标题，隐藏空白或无提问会话；断开重连后历史面板自动补读。空白新会话在 Desktop 仍显示“未命名”，首条消息生成标题后成为历史；ACP 不回放旧正文。

## 实现与边界

- `coding-agent-service.ts`：运行槽改为按 Agent 的 `Map`；发送前同步占位，同一 Agent 串行、同一规范项目路径互斥。结算、断开、停止、审批、初始化目标检查和旧 OpenCode 入口均按对应任务处理。
- `coding-agent-store.ts`：按 Agent 保存工作区、发送准备和运行任务；`runs` 同时记录 `sessionId` 与 `runId`，迟到的旧结算不能清除新运行。首次继承只作为起点，明确选择的项目优先。
- 工作台、输入、历史、连接、扩展和草稿取回使用当前 Agent 的状态；`agent-running-tasks.tsx` 展示后台 Agent、项目、审批提示与停止入口。向运行中的目标转用消息会被阻止；审批和停止属于控制请求，不受发送确认的 `busy` 锁阻塞。
- `stdio-rpc-connection.ts`：区分进程退出、启动错误、输入管道关闭、输出超限和协议格式异常；日志只保留安全原因、退出码和未决数量，不回显原始 stderr。正常以 `close` 等待输出管道排空，`exit` 只作为管道未关闭时的有界兜底。
- `dsh-runtime.ts`：DSH 宿主使用独立启动目录；读取 `~/.dsh/storages/session_projcache/sessions/<id>.json` 的单会话标题和空白标记，不读消息正文，缓存缺失/版本不符时回退通用标题。
- `opencode-sessions.tsx`：历史面板在 connectionId 变化或重连后自动补读；当前选中的旧连接会话保留为“已断开”本地视图，用户需明确恢复，不自动复用或发送。
- 沿用现有 Electron、React、Zustand 和适配器；IPC 已含运行时/会话标识，协议不变。不改数据库、加密、认证或依赖，不恢复手机端维护。
- 工作区中同时存在本轮开始前的桌面 UI 精修（README、dropdown、icons、agent-composer、opencode-connection、opencode-sessions、opencode-workbench、global.css、旧 UI 验收、`docs/desktop-ui-refinement.md`、`opencode-more-menu.tsx`）。这些改动必须保留，不计入本轮代码增量；提交时分清两批，CSS 没有基线快照，不能整文件回退。

## DSH 排查记录

- 本机注册安装位置：`E:\Codeing\deepseek harness`，版本 `0.2.1-rc.3`；Tool_box 配置仅保存项目 `E:\Codeing\ai-workspace\learn`，未保存显式程序路径，也没有读取或输出认证。
- `node verify/agent-actions-connect-smoke.cjs dsh` 通过：ACP 初始化、历史摘要和能力目录可读；会话事件 0、模型任务 0。
- 2026-10-28 继续排查：用当前源码执行 `npm run dev`，在真实窗口连续连接 / 断开 DSH 三次均通过，未出现断连错误。
- 用户随后在项目 `E:\Codeing\ai-workspace\study_tool` 复现：DSH 原生进程退出码 1。原始 ACP 进程的 stderr 显示该项目 `.env` 设置了 `DEEPSEEK_BASE_URL`，而 DSH 0.2.1-rc.3 只允许由启动环境提供网络启动变量，发现项目 `.env` 含该变量时直接拒绝启动；同一程序在无此变量的 `learn` 项目可正常初始化。
- 已改为独立启动 cwd：DSH 宿主进程使用 Tool_box 的固定临时空目录，项目路径继续通过 ACP 的 `session/new` / `session/resume` / `session/list` cwd 传入。这样项目 `.env` 的 `DEEPSEEK_BASE_URL` 不会被宿主读取，项目可以保留自己的 `.env`；不需要删除变量，也不需要把它复制到启动环境。
- DSH 历史与 Desktop 共用 `~/.dsh/sessions`。ACP `session/list` 能返回 Desktop 创建的非空会话；Tool_box 读取 `session_projcache/sessions/<id>.json` 的标题，隐藏 `blank` 或无标题且无 `lastPromptAt` 的空会话。Desktop 仍会把空会话显示为“未命名”，需在 Desktop 侧删除；Tool_box 不写或删 DSH 数据。
- 2026-10-28 实机 UI 验证：真实 `study_tool` 连接后历史显示 2 条非空会话（Desktop 与 ACP 各一，含标题）；断开重连后仍为 2 条，空白 `未命名` 会话不再进入 Tool_box 历史。未发送模型任务。
- ACP 恢复只续接上下文，不回放旧正文；在 Tool_box 打开 Desktop 历史会显示空会话视图，需要旧消息全文时不能依赖 ACP。
- 人为终止 DSH 子进程时记录到 `reason: 'process-exit'`、退出码和未决请求数，确认安全诊断可用；没有输出原始 stderr。
- 当前错误文案会附带原因（进程退出 / 启动失败 / 输入管道关闭 / 输出超限 / 协议不兼容）和退出码；若仍出现未覆盖的启动失败，先记录该文案，不要直接重装、改认证或重发任务。
- 真实模型任务、跨 Agent 审批 / 停止和 Desktop 互见仍需人工验收；本轮未发送模型任务。

## 验证记录

- `npm run typecheck`：通过。
- `npm run lint -- --ignore-pattern "mobile/**"`：通过，无警告。
- `npm run test -- --exclude "mobile/**"`：109 个测试文件、813 项通过；仍有既存 `--localstorage-file was provided without a valid path` 环境警告。
- `npm run build`：main / preload / renderer 全部通过。
- DSH 原始探针：项目 cwd 启动 `study_tool` 退出码 1（`.env` 的 `DEEPSEEK_BASE_URL`），`learn` 控制组 ACP 初始化成功；改用独立启动 cwd 后，`session/list`（cwd=study_tool）成功且项目 `.env` 保持不变。未发送模型任务。
- 真实 DSH UI：`study_tool` 连接后历史显示 2 条非空会话（Desktop / ACP 各一，均带缓存标题），断开重连后仍为 2 条；空白“未命名”会话不进入 Tool_box 历史。未发送模型任务。
- 回归测试覆盖：DSH 单会话缓存标题/空白过滤、独立启动目录、旧运行结算，以及断开重连后的历史恢复。
- `node verify/desktop-ui/run.cjs --coding-agents-only --screenshots`：17 项通过，页面异常 0。
- `node verify/desktop-ui/run.cjs --agent-parallel-only --screenshots`：6 项通过，页面异常 0。
- `node verify/desktop-ui/run.cjs --opencode-only --screenshots`：12 项通过，页面异常 0；同步修正下拉 caret 改为图标后的旧断言。
- `node verify/desktop-ui/run.cjs --convenience-only --screenshots`：16 项通过，页面异常 0。
- 截图位于忽略目录 `.playwright-mcp/desktop-ui/`；未执行打包或 Git 暂存 / 提交。

## 验收状态

- [x] OpenCode / Codex 各自选择不同项目，反复切换后目录、历史和草稿不串。
- [x] 两个不同项目任务同时运行，一方结算、断开、停止或审批不影响另一方。
- [x] 同一 Agent 重复发送和同一项目并发均被阻止（统一工作台接口；旧 OpenCode 兼容入口仅做发送前检查）。
- [x] 后台任务可准确定位、查看和停止；当前 Agent 的输入和历史不被其他项目锁住。
- [x] 统计仅本轮代码增量，满足 AGENTS.md 双门槛并完成 typecheck、桌面 lint、桌面 test、build 和四组定向 UI 验收。
- [x] DSH 本次断连根因确认：项目 `.env` 的 `DEEPSEEK_BASE_URL` 被 DSH 拒绝；宿主改用独立启动 cwd，项目 `.env` 原样保留。
- [x] DSH Desktop 非空历史可在 Tool_box 列出并显示标题；空白/无提问会话不进入 Tool_box 历史，断开重连后自动补读。
- [ ] DSH 旧正文回放与实时双向同步：ACP 不提供旧消息回放，Desktop 空会话仍会显示“未命名”，本轮不写或删 DSH 私有数据。
- [ ] 真实供应商任务、审批 / 拒绝 / 停止、Claude 与 Desktop 互见和打包安装包人工验收。

真实供应商执行和多任务资源消耗仍需人工核对。目录约束不构成操作系统沙箱。
