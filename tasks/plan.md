# 当前执行计划

更新：2026-10-30。只维护 Windows PC；手机暂停。当前状态以任务清单、有效规格与交付记录为准，已删除被新流程替代的旧交接／角色计划。

## 当前批次

用户要求清理过期文档并实施两个 P0：

1. 原生对话回退、回退并取回编辑。先交付原生协议支持的 Codex 分页会话，包含完整轮次锚点、受影响尾部预览、单次确认凭据、执行前历史核对、执行后权威回读和未知结果恢复；文件不恢复。
2. OpenCode 表单与 Codex MCP elicitation。复用现有问答卡片和答复通道，支持受限平面 schema，逐字段校验、取消和失效；秘密／URL／未知 schema 回原生客户端。

详细范围、协议和验收见 [基础能力计划](../docs/PLAN-coding-agent-basic-features.md)。实施顺序为表单 → 原生历史 → service／IPC → UI／草稿 → 回归／记录。不自动提交、推送、调用真实付费模型或修改真实用户会话。

## 已交付功能索引

| 功能 | 当前依据 |
| --- | --- |
| 统一工作台、按需发送、原生历史、消息转用 | [工作台规格](../docs/SPEC-coding-agent-workbench.md)、[交付](../docs/coding-agent-verification.md) |
| 工具收藏／最近使用、加密草稿、Claude／DSH | [交付](../docs/desktop-convenience-agent-verification.md) |
| Token 统计 | [交付](../docs/agent-token-usage-verification.md) |
| 待办与首批转换工具 | [交付](../docs/tool-expansion-first-batch-verification.md) |
| 对话工具扩展 | [交付](../docs/chat-priority-tools-verification.md) |
| 命令速查 | [交付](../docs/developer-command-library-verification.md) |
| 首批基础交互 | [交付](../docs/coding-agent-basic-features-verification.md) |
| Claude Desktop 供应商／历史／退出 | [历史交付](../docs/claude-desktop-history-verification.md)、[供应商交付](../docs/claude-desktop-provider-verification.md) |

## 后置可选，未启动

- Kimi：先核对 Windows 原生程序、协议与登录前提；不因保留枚举就自动安装。
- 自动串行团队：先确定任务规格、独立持久化／敏感字段、schema 迁移回滚，再考虑幂等状态机、审批、取消、恢复和限额。运行结果未知必须核对，不重复执行。
- 并行独立工作区：先确认 Git／worktree 策略，再实现工作区分配、单写入租约、无环 DAG、整队限制和人工集成。worktree 不等于系统沙箱，不自动合并或改写历史。
- WorkBuddy：分别确认本地与云端 API、认证、数据边界和许可。CodeBuddy Code 需独立 ACP 验证，不与 WorkBuddy 混用。
- Paperclip：用户先选择本机或自有服务器实例及 API，可替代自建调度；单独试点，不自动部署或接管当前会话。
- DSH ACP 已完成接入；流式分片、历史回放等超出当前协议的扩展仍须独立验证 SDK／host 方案。

这些方向可独立选择，不要求先完成自建团队；本批不会启动上述可选项目。

## 执行纪律

既有未提交变更不计入本批增量、不覆盖或暂存。无新增依赖／数据库／加密变更。编译测试只在本批有效代码 >500 行且文件 >10 个后执行，按 typecheck → 桌面 lint → 桌面 test，再按需 build／隔离 UI。未达门槛只做静态审查，遵守 AGENTS.md；禁止 rebuild。真实模型、权限和 Desktop 互见验收与合成证据分开。
