# Capability Map: Tool_box

## 2026-11-12 AI 模型世界

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| ai-model-world-native | 主进程直接采集 models.dev 与 Epoch AI，fflate 解压、csv-parse 解析、归一化匹配、结构校验、12 小时缓存与来源白名单 | electron-shell, shared | [AI 模型世界方案](docs/PLAN-ai-model-world.md) |
| ai-model-world-index | 今日格局、ECI 名次、编程共识、能力分位、模型类型推导 | shared | 同上 |
| ai-model-world-ui | 模型列表、筛选 / 搜索 / 排序 / 分页、详情抽屉、数据来源与许可 | renderer-ui, shared | 同上 |

## 2026-11-11 GitHub 开源热榜

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| github-trending | Trending 页面解析、10 分钟缓存、Search API 兜底、来源标注 | electron-shell, shared | [开源热榜方案](docs/PLAN-github-trending.md) |
| github-trending-ui | 今日/本周/本月、语言筛选、当前列表搜索、复制与打开 | renderer-ui, shared | 同上 |

## 2026-11-11 对话上下文管理

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| context-budget | 按模型窗口计算触发阈值、保留尾部与收缩校验 | shared | [上下文方案](docs/PLAN-context-management.md) |
| context-service | 读取检查点、估算占用、选段、调用摘要模型、写检查点 | persistence, settings, ai-gateway | 同上 |
| chat-context-ui | 标题栏占用、浮层分项、手动压缩、检查点卡片 | renderer-ui, shared | 同上 |
| model-context-limits | 从 `/models` 元数据、手动值与超长错误学习窗口 | settings, ai-gateway | 同上 |

## 2026-11-06 本地知识库（P1）

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| knowledge-base | `.md` / `.txt` 导入、标题分块、FTS5 关键词检索 + 向量语义召回 + RRF + 可选重排、分块详情与引用定位 | persistence, settings, shared, renderer-ui | [知识库方案](docs/PLAN-knowledge-base.md) |
| kb-agent-tools | `kb_search` / `kb_list_documents` 只读检索，`kb_add_document` / `kb_remove_document` 走审批 | knowledge-base, agent-tools | 同上 |

## 2026-10-31 能力扩展第一批

| Module id | Responsibility | Depends on | Spec |
| --- | --- | --- | --- |
| password-health | 渲染层健康分析、无明文报告、详情定位 | shared, renderer-ui | [批次计划](docs/PLAN-capability-batch-1.md) |
| clipboard-history | 默认关闭的内存纯文本历史、复制排除、暂停与忽略规则 | electron-shell, shared, renderer-ui | 同上 |
| duplicate-finder | 系统目录引用、只读枚举与流式哈希、取消与进度 | electron-shell, shared, renderer-ui | 同上 |
| local-snapshots | SQLite 一致快照、资源清单、前置快照、校验与恢复回退 | persistence, electron-shell, shared | 同上 |

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

Agent 工具调用已交付；生图、RAG、云同步和自动更新保留为候选，移动端暂停。

## 2026-10-23 编程工作台主线

上表保留最初 MVP 的模块 ID；本次扩展按下表索引。PC 优先，手机暂停维护。

| Module id | Responsibility | Depends on | Spec |
|---|---|---|---|
| coding-agent-contract | 运行时、原生会话归属、能力、事件与审批契约 | shared | [契约](docs/SPEC-coding-agent-contract.md) |
| coding-agent-runtime | 原生适配、连接所有权、顶层运行互斥与生命周期 | coding-agent-contract | [运行时](docs/SPEC-coding-agent-runtime.md) |
| coding-agent-workbench | 统一入口、会话、审批和原生子代理观测 | coding-agent-runtime | [工作台](docs/SPEC-coding-agent-workbench.md) |
| agent-role-handoff | 消息转用与可选来源总结；旧模块 ID 保留，角色管理已取消 | coding-agent-workbench | [消息转用](docs/SPEC-coding-agent-workbench.md) |

当前主线：统一工作台 → 按需开始对话 / 历史列表 → 原生执行详情 → 消息转用。当前交互见 [工作台规格](docs/SPEC-coding-agent-workbench.md)。
自动团队、并行工作区、Paperclip 另行选择，不随主线完成自动启动。

## 2026-10-25 桌面便捷功能与原生 Agent 扩展

| Module id | Responsibility | Depends on | Spec |
|---|---|---|---|
| tool-shortcuts | 工具收藏、最近使用、Ctrl+K 优先入口；仅持久化工具 ID | renderer-ui, persistence, shared | [实施记录](docs/desktop-convenience-agent-verification.md) |
| agent-draft-recovery | 未发送文字加密保存、修订号合并、恢复／管理与退出刷新 | coding-agent-workbench, persistence, shared | [草稿契约](docs/desktop-convenience-agent-verification.md#草稿契约与加密边界) |
| claude-runtime | 官方 SDK 的增量、审批、停止、模型及原生历史；已支持结构化问答／计划确认 | coding-agent-runtime | [能力与验证](docs/desktop-convenience-agent-verification.md) |
| dsh-runtime | 独立 ACP、受控 CLI 启动、单次审批／取消；提交后更新，不回放旧消息 | coding-agent-runtime | [能力与验证](docs/desktop-convenience-agent-verification.md) |

本轮 schema 保持 v4；手机、Kimi 和自动团队不扩展。真实模型任务未执行，连接证据与合成验证分别记录。
