# 私人百宝箱 · Tool_box

> 一个装在自己电脑上的个人工具箱：阅读、密码、笔记、待办、知识库、开发者工具和编程 Agent 共用一个窗口，数据默认不出本机。

![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)

**本机优先**：单个 SQLite 数据库，敏感字段 AES-256-GCM 加密，主密钥交给系统安全区（Windows DPAPI）保管，整库拷走也解不开。

**AI 可选**：不配 API Key 也能用全部本地功能；配置任意 OpenAI 兼容服务后，才会解锁对话、密码识别、语义检索与提示词美化。

**桌面主线**：当前只在 Windows PC 上验证；`mobile/` 是已冻结的 React Native 历史实现，不参与日常开发与验收。

## 功能

| 模块 | 说明 |
| --- | --- |
| AI 助手 | 多供应商配置档案一键切换；Agent 可查书架、改笔记、管待办、看统计；三档权限 + 人在环审批，流式输出、Markdown 渲染、上下文占用可视化与自动压缩 |
| 小说阅读 | TXT 导入（UTF-8 / GBK / UTF-16 自动探测）、章节解析、三种翻页、书签、书内搜索与阅读统计 |
| 密码箱 | 敏感字段加密落库、文本 / AI 双通道批量导入、拼音分组、重复与弱密码健康检查、密码生成器 |
| 记事本 | Markdown 左右分栏实时预览、标题与正文搜索、多篇合并、`- [ ]` 清单项一键转待办 |
| 待办清单 | 开始 / 截止时间提醒、优先级、筛选与归档、托盘驻留时照常提醒、本周完成一键生成周报笔记 |
| 本地知识库 | 导入 `.md` / `.txt`，按标题切段，关键词 + 向量 + 重排混合检索，回答附出处 |
| 开发者工具 | JSON、差异比较、数据脱敏、Java 日志、MyBatis SQL 还原、Cron、JWT / 证书、时区、编码哈希等成套本机工具，外加命令速查 |
| 编程 Agent | OpenCode / Codex / Claude Code / Claude Desktop / DeepSeek Harness 统一工作台：会话切换、审批、停止、消息转用、加密草稿 |
| Token 统计 | 直接读取 14 类本机 Agent 的用量记录，按周期 / 项目 / 模型筛选并导出 CSV，无需连接 Agent |
| AI 情报 | GitHub 开源热榜（含搜索兜底）与 AI 模型世界（models.dev + Epoch AI） |
| 全局搜索 | `Ctrl+K` 命令面板：跨模块搜数据、直接执行命令、跳转页面 |

## 技术栈

Electron 44 · React 19 · TypeScript（strict）· Zustand · Tailwind CSS · LangChain.js · better-sqlite3 · Vitest · electron-vite / electron-builder

## 快速开始

**环境要求**：Windows 10/11 x64、Node.js ≥ 20、npm。

```bash
# 1. 安装依赖（必须带 --ignore-scripts，原因见下方折叠块）
npm install --ignore-scripts

# 2. 手动补跑被跳过的安装脚本（下载 Electron 运行时、校验 esbuild）
node node_modules/electron/install.js
node node_modules/esbuild/install.js
node node_modules/vite/node_modules/esbuild/install.js

# 3. 启动
npm run dev
```

开发模式使用独立的 `-dev` 数据目录（`%APPDATA%\私人百宝箱-dev`），可与安装版同时运行，单实例锁、数据库和配置互不影响。

首次启动后到「设置 → AI 配置」填入供应商、接口地址与 API Key（可留空，只用离线功能）；按 `Ctrl+K` 可以试试全局搜索。

<details>
<summary>为什么不直接 <code>npm install</code></summary>

`better-sqlite3@13` 的 npm 包里同时有 `binding.gyp` 和预编译产物，npm 11 一看到 `binding.gyp` 就会合成 `node-gyp rebuild`，在没装 MSVC 的机器上直接失败。预编译文件本身够用，所以跳过安装脚本；代价是 Electron 的 `postinstall` 也被跳过，必须手动补跑上面第 2 步，否则 `npm run dev` 起不来。

⚠️ **不要执行 `npm run rebuild`**：better-sqlite3 13 起改用 Node-API 预编译，重编译出的 `build/Release/*.node` 永远不会被加载，只会白白引入 Python / MSVC 依赖。原因是 `lib/binding.js` 先找 `prebuilds/`，并忽略 ABI 校验。

</details>

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式启动 Electron 窗口 |
| `npm run build` | 构建主进程 / preload / renderer |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | TypeScript 全量校验 |
| `npm run lint` | ESLint（桌面范围建议加 `-- --ignore-pattern "mobile/**"`） |
| `npm run test` | Vitest（桌面范围建议加 `-- --exclude "mobile/**"`） |
| `npm run format` | Prettier 格式化 |
| `npm run dist` | 打包 Windows 安装包 → `release/私人百宝箱 Setup x.x.x.exe` |
| `npm run pack` | 只生成免安装目录（electron-builder `--dir`） |

打包配置在 `package.json` 的 `build` 字段，安装包免管理员权限（`perMachine: false`）、带安装向导，创建桌面与开始菜单快捷方式。

## 目录结构

```text
src/
├── main/            Electron 主进程：窗口、托盘、快捷键、IPC 注册
│   └── services/    chat-store（SQLite）· ai-gateway · agent · coding-agents
│                    knowledge-base · crypto · backup · agent-usage · files …
├── preload/         contextBridge 白名单桥
├── renderer/        React 界面：routes / components / stores / lib / styles
└── shared/          双进程共享的类型、IPC 协议与纯逻辑（含单元测试）
verify/              隔离验收脚本（Playwright + 合成数据，不碰真实数据库与 AI）
docs/                规格、方案与交付记录
assets/              图标与打包资源
mobile/              已冻结的 React Native 手机端（历史资料）
```

## 数据与隐私

- 数据库：`%APPDATA%\私人百宝箱\toolbox.db`（开发模式为 `-dev` 后缀的同级目录）。
- 加密：密码箱的账号 / 密码 / 备注、AI 的 API Key 均以 AES-256-GCM 落库；主密钥经 `safeStorage`（DPAPI）封装，绑定当前系统用户，**换机或重装系统后可能无法解密**。
- 网络：只有你主动发起的 AI 请求、开源热榜、模型世界、公网 IP 查询会联网；其余功能（Token 统计、密码健康检查、重复文件查找、开发者工具）全部在本机完成。
- 进程边界：渲染进程没有 Node 权限，只能通过 preload 暴露的白名单 IPC 访问数据。
- 备份：「设置 → 数据与备份」生成的是**本机快照**，用于同机回滚，不是跨设备迁移格式；快照含加密配置与主密钥文件，请勿上传网盘。

## 已知限制

- 仅 Windows 桌面端验证通过；macOS / Linux 未做真机验证。
- 手机端自 2026-10-23 起冻结，与桌面端数据互相独立、密文不互通。
- AI 功能需要自备模型服务（OpenAI 兼容接口）；`apiKey` 只在本机保存。
- 安装包未做代码签名，首次安装可能触发 SmartScreen「未知发布者」提示。
- 局域网同步、老板键 / 伪装皮肤、启动锁尚未实现（`shared/constants.ts` 里对应的 `SYNC_*` 常量是遗留占位）。
- 编程 Agent 依赖本机已安装的对应程序（OpenCode / Codex / Claude / DeepSeek Harness），部分入口的能力受原生版本限制。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 协作与改动纪律：验证门槛、Git 规范、安全与数据库红线 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 当前状态、待人工验收项、环境与已知坑、后续能力 |
| [`docs/coding-agent.md`](docs/coding-agent.md) | 编程 Agent 五个入口的契约、交互、边界与未验收项 |
| [`docs/claude-providers.md`](docs/claude-providers.md) | Claude Code / Desktop 双入口、历史续接与 CC Switch 排障 |
| [`docs/chat.md`](docs/chat.md) | 对话工具、内部引用、审批与流式约定 |
| [`docs/context-management.md`](docs/context-management.md) | 上下文占用、压缩阈值与检查点 |
| [`docs/knowledge-base.md`](docs/knowledge-base.md) | 知识库分块、检索、降级与外发边界 |
| [`docs/token-usage.md`](docs/token-usage.md) | 14 类本机来源的统计口径与上限 |
| [`docs/ai-intel.md`](docs/ai-intel.md) | 开源热榜与 AI 模型世界的数据链路 |
| [`docs/developer-utilities.md`](docs/developer-utilities.md) | 开发者工具边界与输入上限 |
| [`docs/developer-command-library.md`](docs/developer-command-library.md) | 命令速查的内置库与编辑规则 |
| [`docs/ui-controls.md`](docs/ui-controls.md) | 下拉、日期、弹窗等公共控件行为 |
| [`docs/todo-reminders.md`](docs/todo-reminders.md) | 待办字段、提醒与迁移回滚 |
| [`docs/user-data.md`](docs/user-data.md) | 密码健康、剪贴板、查重与快照的隐私边界 |
| [`docs/mobile-frozen.md`](docs/mobile-frozen.md) | 手机端冻结说明（恢复维护前先读） |

专题按主题拆分；不保留「计划 / 交付记录」类过程文档，实现过程见 git 历史。

## 贡献

接受 PR 前请先读 [`AGENTS.md`](AGENTS.md)，改动需要附带最小可验证路径：

```bash
npm run typecheck
npx vitest run <受影响文件>
```

涉及 IPC 契约、preload、数据库 schema、加解密或进程边界的改动，需额外跑全量 `lint` 与 `test`，并在提交说明里写清影响范围、回滚方式与验证结果。

## 许可

仓库暂未附带开源许可证，默认保留所有权利。如需复用代码，请先与作者联系。
