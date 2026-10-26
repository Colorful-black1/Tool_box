# Claude Desktop 历史读取与续接可行性评估

日期：2026-10-25。范围：只读评估，不改业务代码、不写外部数据、不发送模型请求。

2026-10-26 实施后续：用户已要求执行，具体边界见 [实施规格](SPEC-claude-desktop-history.md)，结果与手动步骤见 [交付记录](claude-desktop-history-verification.md)。以下保留原评估与证据，不将合成验证视作真实第三方续接或 Desktop 回显的证明。

## 结论

可以实现一部分，不能把所有 Desktop 对话承诺为与 OpenCode 相同的完整同步：

| 对象／能力 | 判断 | 依据及边界 |
| --- | --- | --- |
| 本机 Desktop Code 页签会话列表与正文 | 可行性高 | 本机元数据的 `cliSessionId` 已匹配到 Claude 原生 JSONL；SDK 有公开读取接口 |
| 在工具箱续接这些已结束的 Code 会话 | 有条件可行，建议推进 | SDK 提供 `resume`；需验证当前 Desktop／SDK 版本、第三方网关和消息回显 |
| 同一 Code 会话在两边刷新后读取新增记录 | 有条件可行，尚未验证 | 共用原生日志有基础，但 Desktop 另有列表／游标／状态元数据，不能只看 JSONL 就保证 UI 双向更新 |
| 接管 Desktop 正在运行的任务、实时流与审批 | 不纳入首期 | 当前没有接入原进程控制通道；不能用新 SDK 任务冒充接管原任务 |
| 普通 Chat 历史导入查看 | 取决于来源 | 官方账户有导出渠道；CC Switch 第三方 profile 的完整普通聊天存储本轮未确认 |
| 普通 Chat 在两边继续同一对话并实时同步 | 暂不推荐承诺 | 本轮未找到面向第三方的官方会话读写／订阅接口；API 消息历史不等于 Desktop Chat 会话 |
| Cowork、云端、SSH 会话 | 暂不纳入 | 执行环境和状态不同，需要独立评估 |

之前「当前不支持同步」描述的是现有实现范围，不表示所有 Desktop 会话在技术上均无法接入。对本机 Code 会话，本轮已补充明确的正面证据。

## 已核实的本机证据

只读检查 `%LOCALAPPDATA%/Claude-3p` 的目录、有限元数据与日志结构：

- 存在 `claude-code-sessions`，其中找到含 `sessionId`、`cliSessionId`、`cwd` 的会话描述。
- 至少一条描述中的 `cliSessionId` 与 `~/.claude/projects` 下原生日志匹配；对应日志包含用户和助手消息，并有匹配的会话标识。
- Desktop 本机还存在其他会话、缓存和运行状态目录；未由此推断普通 Chat 的完整正文一定保存在某个数据库，未把元数据或缓存当作完整会话。
- 固定安装的 `@anthropic-ai/claude-agent-sdk@0.3.310` 类型中存在 `listSessions`、`getSessionMessages`、`resume`、`forkSession`。
- 工具箱现有 Desktop 入口按 `claudeDesktop.sessionIds` 筛选历史，只包含本入口创建的 SDK 会话；还没有将外部 Desktop Code 描述纳入来源集合。这是可以改造的实现限制。

没有输出聊天标题、正文、项目路径、账号标识或凭据；没有读取或复用 Cookie／OAuth 登录信息。文件内容仅在本机用于提取结构和核对标识，不写入评估文档。

## 官方资料与推断范围

1. [Desktop 与 CLI](https://code.claude.com/docs/en/desktop#coming-from-the-cli)：官方说明两者共用底层引擎、各自维护会话列表，并支持将 CLI 会话带入 Desktop 后继续同一会话。文档中的 `/desktop`／`--desktop` 有平台、版本及 Claude 订阅登录要求，API Key／第三方网关不能直接套用这条官方迁移命令。本轮没有执行该命令。
2. [SDK 会话接口](https://code.claude.com/docs/en/agent-sdk/sessions)：提供本机会话列举、消息读取、按 ID 续接与分叉，并说明原生日志位于 `~/.claude/projects`。据此，加上本机 ID 匹配结果，判断 Desktop Code 历史读取与 SDK 续接有实现基础；真实第三方续接及 Desktop UI 回显仍是待验证项。
3. [官方数据导出](https://support.claude.com/en/articles/9450526-export-your-claude-data)：官方账户可导出聊天数据。这只证明导入查看有正规数据来源，不证明第三方 profile 支持相同导出，更不等于第三方可以实时读写原 Chat。
4. [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)：接口是无状态多轮调用，需要提供历史；供应商地址与 Key 不授予读取 Desktop 原有聊天的能力。导入旧消息后在工具箱继续，是新会话的上下文延续，不能标成原 Desktop Chat 双向同步。
5. [Desktop 深链](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)：可打开已知 Chat、预填新 Chat／Code／Cowork 输入；这是导航与输入预填能力，不是历史读取或后台消息同步接口。

## 建议首期范围

聚焦用户能直接感知的流程：选择 Claude Desktop → 选择项目 → 打开历史 → 查看原文 → 继续提问。

实现时复用现有工作台和 SDK，不重新设计对话系统：

1. 主进程只读当前 Desktop profile 的 Code 会话描述，使用 `cliSessionId` 映射到原生 SDK 会话；按项目和有效记录筛选，不读取账号认证，不暴露原始配置。
2. 现有来源筛选集合增加已核实的 Desktop Code ID；分别标明 Desktop 原生会话和工具箱新建的 SDK 会话，不把全部 Code 日志混入 Desktop。
3. 正文用官方 `getSessionMessages` 获取；保留当前分页／显示上限和草稿身份规则。
4. 用户明确选择续接后，对已结束、可恢复的会话使用同一原生 ID 的 `resume`，仍沿用已选择的 Desktop 网关、模型与工具箱权限策略。不要继承元数据中任意可执行配置或自动扩大权限。
5. 首期只支持顺序切换使用；原任务未结束或归属无法确认时不自动接管。需要并行处理时使用明确标注的新分支，不能同时写同一会话。
6. 真机验证 SDK 新增回复后，重新打开 Desktop 原会话能否读取新消息，以及标题、叶节点、分支、压缩后的上下文是否一致；未通过就不能宣传「双向同步」。

现有 SDK、IPC 方法与既有存储足以支撑原型，不需要先安装其他代理。若后续需新增状态事件、持久索引或协议字段，实施前单独说明实际影响；本评估不预先授权 schema／加密／依赖或外部配置变更。

## 验证闸口与风险

- 必须以实际使用的第三方 profile 验证，不能拿官方订阅迁移文档代替 CC Switch 场景的证据。
- 首先验证只读目录／正文与 ID 映射，再验证一次用户明确授权的真实续接；本轮没有做真实生成。
- 在另一端运行中、等待审批、异常中断、压缩或分叉的会话不能按普通已结束对话处理。工具箱自己的顶层互斥锁不能阻止外部 Desktop 进程写入。
- `.claude` 日志可续接不代表 Desktop 自有的列表状态和消息游标会自动更新；禁止靠重写 Desktop 内部元数据强行制造同步。
- Desktop 私有元数据格式可能随版本变化，需有识别与失败降级，不能静默恢复错误会话。
- 普通 Chat 的文本导入无法自动带齐附件、项目知识、工具环境和原客户端记忆，应明确标注为导入／新会话。

建议验收口径先定为「本机 Desktop Code 历史读取与已结束会话续接」；普通 Chat 完整实时双向同步暂不进入实施范围。

## 本轮变更与验证范围

仅新增本评估文档，未改业务代码、数据库、IPC、依赖、加密或外部配置。验证方式是公开资料核对、已安装 SDK 类型静态检查、本机目录／元数据／原生日志标识只读关联；没有运行 SDK 任务、网关请求、编译、测试或打包，也没有提交。
