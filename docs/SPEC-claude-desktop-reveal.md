# 将工具箱会话交给 Claude Desktop 登记

日期：2026-10-26。用户要求实现工具箱新建 Code 会话在 Desktop 可见。此前实现只有 Desktop 来源发现与 SDK 续接，不能把它称为自动双向同步。

**用户后续选择：要求无感后台同步，继续评估；未接受一键打开，也未批准本规格的 IPC 扩展。** 本文保留为已排查的备选，不进入实施。最新结论见 [后台同步评估](ASSESSMENT-claude-desktop-background-sync.md)。

## 已核实的路径

- 本机 Windows Desktop MSIX `3.6556.2.0` 的安装包只读静态检查：接收 `claude://resume?session=<CLI UUID>`，由 Desktop 的 `importCliSession`／`adoptCliSession` 自己登记 Code 会话。
- 当前版本导入时沿用传入的 `cliSessionId` 与原生日志，自己生成列表记录；当前已加载会话的 CLI 身份可被识别，旧版本存在重复登记、旧 lineage ID 等问题，不能据此承诺跨版本兼容。
- 本机入口需要有效的 Desktop account／org 初始化状态；第三方 profile 当前已有本机 Code 记录，说明存在相应记录结构，但未用真实会话触发本次导入。
- 该深链会启动／打开 Desktop，不能用它实现 Desktop 关闭时的无感后台登记，也不保证实时双向消息推送。调用操作不附带 prompt、凭据或任意文件路径，不要求工具箱模拟点击发送。
- 官方 CLI `/desktop`／`--desktop --resume` 有订阅登录限制，不直接套用于 CC Switch 场景。现有版本中的 `resume` 深链未在通用深链帮助页列为稳定公共契约，需按当前安装版本说明兼容风险。

依据：[官方 Desktop 会话迁移](https://code.claude.com/docs/en/desktop#coming-from-the-cli)、[官方深链格式](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)、本机安装包中的路由和会话登记实现。公开问题 [80773](https://github.com/anthropics/claude-code/issues/80773) 提供了旧版本及 lineage 重复登记报告，不能代替本机验证。

## 建议交互与安全边界

优先提供当前会话上的「在 Claude Desktop 中打开」：任务结束后用户点一次，由 Desktop 接收并登记。默认不在每次对话完成后抢占焦点，不为后台静默同步直接创建、覆盖或拼造 Desktop 私有 JSON。

主进程必须校验连接所有者、当前会话引用、Claude Desktop 入口、有效 CLI UUID、任务已结束、来源属于当前项目且已有 SDK 原生日志；拒绝未发送的新对话、运行／停止／准备中的任务、失效引用及未知结果。不接受 renderer 传任意 URL、路径、命令或原生 ID。

深链只由主进程用白名单模板生成；外部应用打开失败返回面向用户的错误。系统成功交付 URL 仅表示打开请求已发送，不能显示“同步成功”。用户仍需核对 Desktop 的列表与正文，不能自动启动模型或强制扩大权限。

## 待确认的接口影响

实现准确选中会话需要在现有 `codingAgents.openDesktop` 增加可选的本地会话引用，并同步 shared bridge、preload、IPC 入参校验与 renderer 调用；旧 OpenCode 单参数行为保留。主进程仍从其会话状态解析 CLI ID，不把 renderer 的原生 ID 直接用于深链。

依据仓库 `AGENTS.md` 的「未经用户同意禁止修改 IPC 协议」，该协议扩展需先确认。无需新增依赖、数据库表／schema、凭据、加密或 Desktop 私有元数据写入。

若用户接受一键打开并批准接口扩展，再实施完整调用链及对应合成回归。若要求完全自动后台同步，现有证据不足以安全承诺，需要重新选择机制，不能把打开窗口或复制上下文冒充已完成。

## 验证边界

本次尚未触发真实深链、登记真实会话或调用模型。源码／安装包／SDK 类型与公开资料只读核对不等于真实兼容验证；遵循本任务独立增量的编译测试双门槛，不计入已有未提交改动。
