# Claude / CC Switch 供应商路由修复

日期：2026-10-25。用户反馈 Claude 可以连接但发送失败，原生 Desktop 经 CC Switch 路由第三方供应商可以对话。

## 原因与证据

适配器显式使用 `settingSources: []`，仅继承工具箱进程环境。SDK 文档说明此选项关闭文件设置；CC Switch 则将 Claude Code 的路由与认证写在用户 `settings.json`。本机只读检查确认该文件配置了路由地址和 Auth Token，而工具箱进程未继承对应环境变量；当前地址是本地回环代理。检查只输出字段是否存在，没有输出地址、端口或凭据，也未发送模型请求。

模型目录初始化成功不等于已验证认证和推理：连接阶段不发送用户消息。发送失败统一显示官方客户端提示，也没有说明路由配置缺失。

参考：[CC Switch 配置文件说明](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/5-faq/5.1-config-files.md)、[Claude 配置与优先级](https://code.claude.com/docs/en/settings)、固定 SDK `0.3.310` 本地 `Options.settingSources`／`env` 类型说明。

## 改动内容与影响

- 新增 `claude-provider-settings.ts`，只读取用户目录（默认 `~/.claude`，可用绝对 `CLAUDE_CONFIG_DIR` 指定）的 `settings.json`。文件最多 512 KiB；缺失时沿用原生认证，读取或格式错误时明确停止，不静默切换供应商。
- 仅提取固定的 Anthropic 路由、API Key／Auth Token 与模型环境字段，以及顶层模型。不加载项目／local 文件，不执行 `apiKeyHelper`，不导入 hooks、MCP、权限、插件、任意环境变量或关闭 TLS 校验的设置。
- 连接初始化及每次发送都重读。用户配置的白名单环境覆盖继承环境；模型优先级为工具箱手动选择 → `ANTHROPIC_MODEL` → 用户顶层 `model` → Claude 原生默认。组织管理策略仍由官方程序执行。
- 保持 `settingSources: []`、原审批和默认计划模式，新增准备阶段取消与重复发送保护。默认模型标签改为「沿用 Claude / CC Switch 配置」；错误提示覆盖第三方路由检查。
- 凭据只在内存中用于自有 Claude 子进程，不落库、不写日志、不经 IPC、不写命令行参数。不改用户配置、CC Switch 数据库或 OAuth 文件，不新增依赖、IPC、数据库 schema、加密改动或手机工作。

## 验证与边界

- 静态核对 SDK 参数、白名单、环境合并、模型优先级、取消与迟到连接保护；核对 diff，不回显原配置。
- 新增合成用例覆盖只读路径／BOM／缺失／损坏／权限错误／超限／危险字段隔离，适配器用例覆盖路由刷新、显式模型、凭据不落库、准备阶段停止／断开／并发；既有适配器测试改为注入合成配置，避免未来测试读取本机真实凭据。
- 本轮增量未同时超过 500 有效代码行和 10 文件。按仓库门槛，本次修改影响范围有限，未执行编译验证；新增与既有测试均未运行，未构建、打包或调用真实模型。不得引用前一轮验证作为本次修复已通过的证据。
- 当前只支持用户 Anthropic 兼容配置和模型映射。仅在 CC Switch 中配置 Claude Desktop、没有写入 Claude Code 用户配置的情况不自动推断；通过 `apiKeyHelper`／专有云身份配置的供应商也不在本轮自动接入。
- 修改在源码中，现有 EXE 不会自动更新。用户需重新构建打包并运行新版；本地代理模式保持 CC Switch 运行，在工具箱断开并重新连接 Claude，选择默认模型后发送短消息验证。任务仍失败时再依据新现象排查供应商协议与执行限制，不自动重发。

未提交；本机真实生成结果与安装包启动仍待用户验证。

## 后续反馈：代理返回 400，缺少上游地址

用户运行新版后，助手消息明确返回 `API Error: 400 配置错误: Claude Provider 缺少 base_url 配置`。
这说明原来的供应商读取修复只解决了工具箱如何取得 Claude Code 路由，不能证明代理上游本身可用；前次定位未继续核对 Code 与 Desktop 的独立路由。

本轮以 SQLite `mode=ro` 只读查询 CC Switch 本机数据并比对既有日志，确认：

- `live-state.json` 的 `claude` 路由指向 `Claude Official`，该供应商没有上游地址；Claude Code 分组只有官方配置。
- `claude-desktop` 路由指向已配置上游地址的第三方供应商，和 Code 的目标不同。
- 最近的 Code 请求记录为 400，错误匹配缺少 `base_url`，供应商与 Code 当前官方配置一致；Desktop 请求记录为 200，使用的是有地址的第三方配置。
- CC Switch [Claude 代理适配器](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/providers/claude.rs) 在无法从当前供应商配置提取上游地址时返回相同错误。[配置说明](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/5-faq/5.1-config-files.md) 区分 Code 用户配置与 Desktop 网关配置。

处理步骤：在 CC Switch 选择 **Claude Code** 应用，添加 Desktop 所用供应商对应的 Claude Code 预设，填写供应商原始认证与上游配置；进入路由页，实际执行「路由到此」或相应版本的启用操作，核对该卡片为「路由中」。模型映射按 Code 预设配置，不复制 Desktop 网关的本地地址作为上游。随后在工具箱保持默认模型并发送短消息验证；为方便核对，也可先断开重连。本轮配置问题不需要再次打包。

本轮只补充本文与 README，没有继续修改适配器，也没有写入 CC Switch 数据库、路由或用户认证配置。检查只输出状态、字段名和地址是否存在，不输出地址值、凭据、完整请求或响应，不发送新模型请求。修复结果仍需配置正确后手动确认；不会自动改用 Desktop 路由或切换到另一家供应商。

本次修改影响范围有限，未执行编译验证。文档变更经 diff 静态检查；没有运行编译、测试、打包或开发服务。
