# Capability Map: Tool_box

AI 优先的个人工具箱。当前版本只承诺 Windows 桌面端与 AI 对话 MVP。

| Module id | Responsibility | Depends on |
|---|---|---|
| electron-shell | Electron 主进程入口、窗口生命周期、安全基线、IPC 装配 | ai-gateway, settings, persistence, shared |
| renderer-ui | React 19 + TS + Tailwind 界面层：对话、会话管理、设置 | shared |
| ai-gateway | LangChain.js 统一网关：OpenAI 兼容对话、流式输出、取消、错误转换 | settings, persistence, shared |
| settings | AI 配置读写；API Key 使用 Electron safeStorage 加密 | shared |
| persistence | 本地 SQLite：会话、消息、迁移 | shared |
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
