# Claude Code 与 Claude Desktop 分开接入

日期：2026-10-25。用户已确认 Claude Code 供应商可用，要求像 CC Switch 一样分开支持 Desktop。

## 目标与边界

- 工作台新增独立的 Claude Desktop 入口，现有 `claude` 标识与 Code 配置保持兼容；新增 `claude-desktop` 标识。
- Desktop 入口复用官方 Agent SDK 执行编程任务，只沿用 Desktop 第三方网关配置，不声称接管 Desktop 窗口、原有聊天或官方订阅认证。
- 不要求打开 Desktop 窗口；网关模式需要 CC Switch 保持运行。没有可用第三方 profile 时明确报错，不回退到 Code 或官方供应商。
- 两入口的运行状态、程序／项目偏好和加密草稿独立。Desktop SDK 会话仅在新入口历史出现；既有 Code 历史继续可用。Desktop 原有聊天不导入。

## 配置契约

主进程只读 `Claude-3p/configLibrary/_meta.json` 的 `appliedId`，并读取该 ID 对应的 profile；不扫描猜测其他 profile。Windows 位于 `%LOCALAPPDATA%`，macOS 位于 `~/Library/Application Support`，Linux 位于 `~/.config`；本轮交付平台仍为 Windows。

只接受 `inferenceProvider=gateway`、受支持的认证方式、有效 HTTP(S) 地址与有界模型列表。读取只提取网关地址、认证和模型，不导入权限、MCP、hooks、shell 或任意环境变量。HTTP 仅允许回环地址；拒绝 URL 内嵌凭据和跳转。

优先使用 profile 的 `inferenceModels`（`name`、`labelOverride`）；未提供列表时，通过同一网关的只读 `/v1/models` 获取有界列表。连接／发送重读 profile；默认采用配置列表首个模型，显式选择仍优先。显式模型不再可用时停止发送，提示同步模型。不会自动发送验证任务。

Desktop 子进程清除继承的 Code 供应商、模型与 OAuth 环境变量，再应用 profile 白名单；凭据只留在子进程环境内，不写日志、IPC、命令行或工具箱配置。

在既有配置 kv 的 `claudeDesktop` 项保存独立程序／项目偏好，以及本入口创建的 SDK 会话 ID 索引；不保存正文或供应商凭据，不改表或 schema。历史通过官方 SDK 读取并按索引过滤，Code 排除这些 ID；损坏索引不静默混合历史。

## 调用链与兼容

工作台通用切换器 → 既有 `codingAgents` bridge／preload → 既有 IPC 参数校验 → 注册独立 Claude 适配器实例 → Desktop profile 读取／SDK → 原生会话。

IPC 通道、方法及对象结构不变，仅 `CodingAgentId` 增加可接受值；既有 `CODING_AGENT_IDS` 校验、草稿解析及四层调用自动采用该类型。无依赖、加密算法、主密钥、schema 或手机变更。共享顶层任务互斥与单次审批继续生效。

## 实施顺序

1. 配置读取：有界 JSON、profile 选择、网关与模型校验；使用合成数据覆盖异常和凭据边界。
2. 适配与契约：独立标识／实例／偏好、环境隔离、模型列表和会话来源隔离。
3. UI：复用工作台按钮、Dropdown、提示样式；明确 SDK 执行与历史边界；消息转用自动纳入新入口。
4. 验证与说明：跨入口 IPC、草稿、异步状态及历史归属；按本任务增量统计判断验证门槛。

## 风格与验证

沿用 TypeScript strict、无分号、单引号与既有星轨组件，不改无关代码。配置和适配器测试与源文件同目录；IPC／Zustand／草稿测试扩展现有合成用例。

仅当本任务同时超过 500 有效代码行、10 个修改文件，才按顺序执行 `npm run typecheck`、`npm run lint -- --ignore-pattern "mobile/**"`、`npm run test -- --exclude "mobile/**"`；不能计入之前任务的工作区改动。不满足门槛仅静态审查并交用户手动验证，不执行 `npm run rebuild`。满足门槛并构建后，才使用既有合成 UI 预览检查 1280×820 排布。

## 验收条件

- 可分别选择 Code／Desktop；切换后草稿、连接状态及历史来源不串用。
- Desktop 请求使用当前 profile 的地址、认证和模型，不受 Code 环境污染；切换供应商后下次任务重读。
- 恶意 profile ID、损坏／超限／无权配置、无模型、无效认证或协议、失效显式模型均清楚失败且不泄密。
- Desktop 历史只读本入口 SDK 会话，无法恢复其他来源 ID；停止／断开准备中的任务不迟到执行。
- 不写入 CC Switch 或 Desktop 配置，不自动测试模型，不提交代码。

参考：[CC Switch Desktop 配置](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/2-providers/2.6-claude-desktop.md)、本机 profile 的字段形状、固定 SDK `0.3.310` 类型。
