# Capability Map: Tool_box

AI 优先的个人工具箱。当前版本只承诺 Windows 桌面端与 AI 对话 MVP。

| Module id | Responsibility | Depends on |
|---|---|---|
| electron-shell | Electron 主进程入口、窗口生命周期、安全基线、IPC 装配 | ai-gateway, settings, persistence, shared |
| renderer-ui | React 19 + TS + Tailwind 界面层：对话、会话管理、设置 | shared |
| ai-gateway | LangChain.js 统一网关：OpenAI 兼容对话、流式输出、取消、错误转换 | settings, persistence, shared |
| settings | AI 配置读写；API Key 使用 Electron safeStorage 加密 | shared |
| persistence | 本地 SQLite：会话、消息、迁移 | shared |
| agent-usage | 14 类本机 Agent 的只读用量采集、去重与筛选；落盘统计缓存，仅显示 OpenCode 原生上报花费 | shared |
| shared | 双进程共享的纯 TS 类型、IPC 协议、常量 | — |

依赖方向：

```text
renderer-ui → preload bridge → electron-shell
electron-shell → ai-gateway / settings / persistence
ai-gateway → settings / persistence / shared
settings → shared
persistence → shared
```

Build order:

1. electron-shell / renderer-ui 基础骨架
2. shared IPC 协议
3. settings + safeStorage
4. persistence + SQLite
5. ai-gateway + LangChain.js
6. AI 对话 UI
7. 静态检查、测试、手动验收

延后能力：生图、Agent 工具调用、RAG、移动端、云同步、自动更新。

## 2026-10-23 编程工作台主线

上表保留最初 MVP 的模块 ID；本次扩展按下表索引。PC 优先，手机暂停维护。

| Module id | Responsibility | Depends on | Spec |
|---|---|---|---|
| coding-agent-contract | 运行时、原生会话归属、能力、事件与审批契约 | shared | [契约](docs/SPEC-coding-agent-contract.md) |
| coding-agent-runtime | 原生适配、连接所有权、顶层运行互斥与生命周期 | coding-agent-contract | [运行时](docs/SPEC-coding-agent-runtime.md) |
| coding-agent-workbench | 统一入口、会话、审批和原生子代理观测 | coding-agent-runtime | [工作台](docs/SPEC-coding-agent-workbench.md) |
| agent-role-handoff | 消息转用与可选来源总结；旧模块 ID 保留，角色管理已取消 | coding-agent-workbench | [消息转用](docs/SPEC-agent-role-handoff.md) |

当前主线：统一工作台 → 按需开始对话 / 历史列表 → 原生执行详情 → 消息转用。易用性调整见 [方案](docs/PLAN-coding-agent-usability.md)。
自动团队、并行工作区、Paperclip 另行选择，不随主线完成自动启动。
