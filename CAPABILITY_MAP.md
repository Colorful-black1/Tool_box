# Capability Map: Tool_box

## 2026-10-25 首批工具与待办提醒

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| mybatis-sql | MyBatis 日志配对、类型化参数与 SQL 还原预览 | renderer-ui, shared | [首批规格](docs/SPEC-tool-expansion-first-batch.md) |
| local-converters | 颜色、单位、大整数进制、IANA 时区与 DST 换算 | renderer-ui, shared | 同上 |
| todo-list | 桌面 v5 待办、分页、完成／归档、受校验 IPC | persistence, shared, renderer-ui | 同上 |
| todo-reminders | 开始／截止系统通知、补检去重、通知点击定位 | todo-list | 同上 |

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

## 2026-10-25 桌面便捷功能与原生 Agent 扩展

| Module id | Responsibility | Depends on | Spec |
|---|---|---|---|
| tool-shortcuts | 工具收藏、最近使用、Ctrl+K 优先入口；仅持久化工具 ID | renderer-ui, persistence, shared | [实施记录](docs/desktop-convenience-agent-verification.md) |
| agent-draft-recovery | 未发送文字加密保存、修订号合并、恢复／管理与退出刷新 | coding-agent-workbench, persistence, shared | [草稿契约](docs/desktop-convenience-agent-verification.md#草稿契约与加密边界) |
| claude-runtime | 官方 SDK 的增量、审批、停止、模型及原生历史；结构化问答明确降级 | coding-agent-runtime | [能力与验证](docs/desktop-convenience-agent-verification.md) |
| dsh-runtime | 独立 ACP、受控 CLI 启动、单次审批／取消；提交后更新，不回放旧消息 | coding-agent-runtime | [能力与验证](docs/desktop-convenience-agent-verification.md) |

本轮 schema 保持 v4；手机、Kimi 和自动团队不扩展。真实模型任务未执行，连接证据与合成验证分别记录。
