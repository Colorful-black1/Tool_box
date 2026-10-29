# Tool_box

AI 优先的本地个人工具箱。桌面端采用 **Electron + React 19 + TypeScript**，数据全部留在本机。

> **维护重点（2026-10-23）：PC 桌面端为当前主线，手机端暂停维护。**
> 后续功能、修复、主题和编程 Agent 重点投入桌面端，当前已验证平台为 Windows。
> `mobile/` 现有代码与说明保留为历史资料，不继续功能同步、依赖升级、真机验收或发布保障；手机状态不阻塞 PC 交付。
> 桌面修改共享逻辑、schema 或主题时，不再强制同步 / 验证手机端。恢复维护需另行明确范围并核对兼容性。

## 工具

| 模块 | 说明 |
| --- | --- |
| AI 助手 | 设置页内置 8 家供应商预设（DeepSeek / 智谱 GLM / 小米 MiMo / OpenAI / OpenCode Go / Kimi / 通义千问 / 硅基流动）+ 自定义；**多套配置档案一键切换**，一键「获取模型」下拉选择；基于 LangChain.js `createAgent` 的 **Agent，可调用工具接管书架 / 分组 / 书签 / 密码箱 / 记事本 / 待办，查询阅读与 Token 统计、跨模块搜索并打开结果**；**三档权限（只读 / 写操作确认 / 完全访问）**，写与破坏性操作支持人在环审批；**工具调用不在界面上展示**（查书架、读分组这类是 AI 的后台动作，只有需要你点头的写操作才弹审批卡）；**回答按 Markdown 渲染**（粗体 / 列表 / 代码块 / 链接）；**长对话自动裁剪历史**（超预算时丢弃最早的部分并明确告知模型）；模型下拉**只列你在设置里勾选的模型**（带搜索）；流式输出、多会话、停止生成 |
| 小说阅读 | TXT 导入（UTF-8 / BOM / UTF-16 / GBK 探测）、章节解析、书架分组与排序、三种翻页模式、目录、书内搜索、书签、阅读统计（今日 / 累计 / **任意区间**） |
| 密码箱 | 敏感字段 AES-256-GCM 加密落库；固定格式 / AI 识别双通道批量导入，AI 流式展示脱敏预览、支持停止，完整校验后才可导入；重复检测、拼音分组、字母索引；**随机密码生成器**（密码学安全随机数 + 拒绝采样，可调长度，带强度评估） |
| 记事本 | Markdown 编辑与左右分栏预览（原文与渲染实时对照、滚动联动）、保存后留在编辑页、导入导出 `.md`；**支持按标题与正文搜索** |
| 待办清单 | 个人管理中的独立入口；开始／截止时间、优先级、搜索、完成／重开、归档／恢复；应用运行或驻留托盘时通知，重启／唤醒合并补提醒 |
| 开发者工具 | 树形目录下的 **JSON 工具箱、文本 / JSON 差异比较、数据脱敏、Java 日志整理、Prompt 模板库、我的 IP、提示词美化**，以及正则、Base64 / URL、时间戳、哈希、文本清洗、UUID；提示词美化仅手动调用 AI，其余工具本机处理。结果可脱敏、填入 Prompt、保存笔记或放入对话草稿；输入输出框自适应高度并支持换行 |
| 编程 Agent | **OpenCode / Codex / Claude Code / Claude Desktop / DeepSeek Harness 统一工作台**：首次发送按需连接与创建会话，历史列表直接恢复；Claude 两入口分别沿用 Code 与 Desktop 供应商配置；单次审批、停止、消息转用与加密草稿恢复；DSH 回复提交后更新，续接上下文但不回放旧消息 |
| Token 统计 | 独立读取 Codex、OpenCode、Claude Code、Kimi Code、Pi、WorkBuddy、DeepSeek Harness、ZCode 等 14 类本机来源，无需连接 Agent；支持周期 / Agent / 项目 / 模型筛选、趋势与排行、可排序明细和 CSV 导出；仅显示 OpenCode 原生上报花费，不做价格估算 |
| 全局搜索 | **⌘K / Ctrl+K** 唤起命令面板：搜书架、记事本（正文也搜）、密码箱、分组、会话，并直接执行命令（切模块、开工具、新建对话）；数据全在内存，输入即出结果 |

### 桌面端常驻与快捷键

- **单实例启动**：同一版本再次点击桌面或开始菜单快捷方式会显示并聚焦已有窗口；最小化时先还原，托盘隐藏时直接唤回，不重复创建窗口或托盘。
- **开发模式独立实例**：`npm run dev` / `npm run preview` 使用独立的 `-dev` 数据目录（Windows 通常为 `%APPDATA%\私人百宝箱-dev`），可与安装版同时运行，单实例锁、数据库、AI 配置和密码箱状态互不影响。
- **关闭窗口不退出**：应用缩到系统托盘，随时从托盘唤回；真正退出走托盘菜单的「退出」。
- **Esc 关闭窗口**：弹层、编辑框或阅读菜单优先处理 Esc；没有这些交互时关闭窗口，沿用缩到托盘的行为。
- **Token 统计 F5 刷新**：在 Token 统计页按 F5 更新统计数据，不重载页面；刷新过程中不会因长按重复扫描。
- **Token 统计自动刷新**：支持关闭、5 秒、10 秒、30 秒、60 秒，默认 60 秒并记住选择；离开页面或窗口隐藏时暂停，扫描中跳过定时刷新，关闭后仍可手动刷新。
- **全局快捷键**：默认关闭（全局占用快捷键容易和别的程序打架），可在设置页开启并选择组合键
  （Ctrl+Shift+空格 / Ctrl+Shift+K / Ctrl+Alt+T / Alt+空格）；被别的程序占用时会明确提示。
  更换组合注册或保存失败时保留原快捷键；启动注册失败时设置页显示未启用，可重新开启。
- **超宽屏适配**：所有页面（设置 / 工具 / 密码箱 / 记事本）随窗口**铺开伸缩**，不居中也不限宽；
  只给单行输入、结果行这类不该被拉长的控件留了宽度上限。
- **左侧树形导航**：AI 助手的「对话」保持独立；其余 TAB 分为「开发工作台」（编程 Agent、Token 统计、工具）、
  「阅读空间」（书架、统计）、「个人管理」（密码箱、记事本）和「系统」（设置）。
  点击大类只展开 / 收起子项，不切换页面或清空草稿；从全局搜索跳转会展开对应分类，阅读器归属书架。
  分类支持 Tab / Enter / Space，折叠状态仅在本次运行保留，重启默认展开。
- **导航栏可折叠**：点侧栏上方的 chevron 收成纯图标窄栏，所有 TAB 仍可直接访问；
  窗口窄于 1120px 时**自动收成图标**，窗口变宽后恢复手动侧栏偏好和分类状态。

### 桌面控件与键盘操作

下拉统一跟随应用主题，方向键切换、Home／End 跳到首尾、Enter 选择、Esc 取消并返回原按钮；长列表可输入过滤。菜单会避开窗口边缘，不受页面滚动容器裁切。

待办、Token 统计与 Cron 的日期支持直接键入，也可点日历按钮选择；日历支持方向键、PageUp／PageDown 换月、今天和清空。时间按分钟或秒精度输入，原有业务时区不变；不完整或无效的待办／Cron 日期需修正后才能提交。

业务确认和分组名称输入使用应用主题弹窗，Tab 在弹窗内循环、Esc 取消。分组旁的「⋯」可管理分组，书签右侧按钮可删除；系统文件选择、另存为、通知仍使用系统界面。控件专项验收：构建后运行 `node verify/desktop-ui/run.cjs --ui-controls-only --screenshots`，执行前遵守 `AGENTS.md` 的验证门槛。

编程 Agent 顶部使用已打开会话标签，支持方向键切换焦点、Enter 打开；旁边的搜索图标打开可搜索的原生历史。「更多」只保留会话操作。输入框底栏直接显示模式、模型和思考强度，原生提供的其他选项也直接可见；「＋」集中提供文件、命令、Skill 和 MCP。上下文、耗时及发送／停止收在右侧，快捷键放在悬浮提示，不常驻说明段落。公共按钮、下拉和折叠区域沿用三套主题令牌。

布局范围、验证及原生参数边界见 [编程 Agent 布局记录](docs/coding-agent-layout-verification.md)。

会话标签右侧的「×」关闭标签，聚焦标签后也可按 Delete。关闭当前标签会切到相邻标签，全部关闭后显示新对话；原生历史和未发送草稿保留，可从历史面板重新打开。执行／停止中的标签需先结束任务再关闭，关闭操作不发送或停止任务。

### 开发者工具的输入边界

工具目录顶部支持按名称、功能描述和英文标识搜索，兼容大小写、全半角与多词匹配。
输入只过滤目录，不自动切换右侧工具；Enter 打开首项，Esc 或清空按钮恢复完整目录。
中文输入法确认候选词时不会触发打开工具，切换工具仍保留 Prompt 未保存修改的确认。

清空搜索后，拖动每项右侧的六点手柄即可调整组内顺序，也可聚焦手柄使用 Alt+↑/↓。
排序自动保存，重启后恢复；不会切换当前工具或清空其输入，保存失败会回退并提示。
新增工具按注册顺序追加，已移除工具自动忽略。搜索中暂停排序，搜索词不保存。

点击工具旁的星标可收藏，目录顶部提供收藏与最近 5 个工具；最近使用只在成功打开后更新。
收藏最多 30 个、最近记录最多 5 个，独立保存 ID，不保存工具输入输出，不改变组内排序。
Ctrl+K 空输入优先显示收藏与最近工具；输入后继续全局搜索，取消离开确认不会记录目标工具。

- 正则在独立 Worker 中执行，连续输入防抖 150ms；单次超过 1 秒会终止线程并提示，修改输入或离开页面会取消旧任务。无 `g` / `y` 时只返回首次匹配，最多展示 200 条。
- Base64 文本解码兼容空白、URL 安全变体与合法省略补位；拒绝非法长度、补位、非零填充位和非法 UTF-8。它是文本工具，不用于解码任意二进制文件。
- 日期时间按本地时区解释，拒绝越界日期、时分秒和超出 Date 范围的时间戳；夏令时跳过的本地时刻也会被拒绝。

### Java 与 AI 工具工作流

| 工具 | 能力与边界 |
| --- | --- |
| JSON 工具箱 | 无损保留 Java Long、小数及指数原文，支持格式化、压缩、字段排序、解除字符串转义与展开嵌套 JSON 字符串；重复键明确报错 |
| JSONPath | 支持 `$`、`.字段`、`["带点的键"]`、`['键']`、`[0]` 与 `[*]`；不支持过滤器、切片和递归下降，不执行表达式；通配符最多命中 4000 项 |
| 差异比较 | 文本保留两侧行号，可忽略空白；JSON 忽略对象字段顺序，保留数组顺序，可在所有层级忽略指定字段名；数字按原文比较，因此 `1` 与 `1.0` 会显示差异 |
| 数据脱敏 | 识别常见凭据字段、请求头、邮箱、中国手机号、身份证格式及 Luhn 银行卡候选；同值使用稳定替身，JSON 结构和未替换数字保留。规则可能漏报或误报，发送前需检查预览 |
| Java 日志整理 | 清理 ANSI 颜色、折叠连续重复行、显示异常链；可显式展开转义、按首行 traceId 筛选并保留对应堆栈续行。不使用模型猜测异常原因 |
| Prompt 模板库 | 内置异常分析、代码审查、保行为重构、SQL 优化、单测生成模板；支持 `{{变量名}}`，同名变量只填一次；历史版本只读，可比较或采用后保存为新版本 |
| 我的 IP | 查看非回环网卡 IPv4 / IPv6 与子网掩码；手动获取 Windows TCP / UDP 端口、PID、进程名快照，支持筛选、分页、复制，以及确认后停止指定进程；不查询公网 IP |
| MyBatis SQL 还原 | Preparing／Parameters 日志批量还原；支持 MySQL 默认转义、PostgreSQL 标准字符串、SQLite；缺行、未知类型、歧义及数量不符明确提示，不执行 SQL |
| 颜色工具 | 不透明 HEX／RGB／HSL 换算、两色预览与 WCAG 2.x 对比度，结果可复制 |
| 单位与进制换算 | 长度、质量、温度、时间、十进制／二进制字节；2–36 进制大整数与负数；不做汇率或浮点进制 |
| 时区换算 | 在时间戳工具顶部，按源／目标 IANA 时区换算；夏令时缺口拒绝，重复时间明确选较早／较晚时刻 |
| Cron 计算器 | 区分 Spring / Quartz / Unix，支持范围、步长及 L / W / # 等日期条件；可视化逐字段生成秒 / 分 / 时 / 日 / 月 / 周（Quartz 含年），可选每、范围、间隔、指定，实时预览未来十次，也可按具体时刻一键填入；保留表达式解析模式，首版提供 UTC / 北京时间 |
| Spring 配置工具 | YAML / Properties 转换与字段比较，保留长整数和占位符；支持常用缩进映射、块列表、Properties 续行/转义，拒绝重复键、冲突与不支持的 YAML 语法；转换去除注释并统一为字符串，不模拟 Spring 环境合并 |
| JWT／证书查看器 | JWT 本地解码、时间声明提示，不验证签名；查看 PEM 链 / DER 文件的 X.509 元数据和有效期，不验证信任链；拒绝私钥，不保存或发送 AI |
| 提示词美化 | 手动使用设置中启用的 AI 配置润色，原文与结果对照；严格保留模板占位符及次数，结果可复制、转为新模板草稿或放入对话 / 编程 Agent 草稿 |

本批工具的详细语法边界与接口说明见 [开发者工具扩展](docs/developer-utilities.md)。配置输入最多 10 万字符、2000 字段、24 层；JWT 最多 32768 字符；证书文本最多 128 KiB、文件最多 96 KiB、一次最多 10 张；端口快照最多返回 1000 项，超出明确提示。

端口列表的「停止进程」会先确认进程名、PID 与端口，并提示未保存数据可能丢失；执行前重新核对端口归属和进程创建时间。停止整个目标进程、不结束进程树、不自动提权；系统关键进程、工具箱自身及无法核实身份的进程禁用操作。停止引用五分钟有效，重新查询后旧引用失效；执行后自动刷新列表。被服务或守护程序重启的进程可能重新占用端口。

JSON、差异、脱敏和日志工具输入最多 20 万字符，JSON 嵌套最多 64 层、节点最多 4 万；差异较大时文本回退为分段比较，
界面最多显示 500 行；JSON 差异最多 300 项，每项数值/路径仅展示有界预览，截断会明确标注。

模板经现有 kv 的 `promptTemplates` 字段保存，最多 20 个模板，每个正文最多 12000 字符、12 个变量，
保留最近 6 个历史版本，模板与历史总量最多 18 万字符。只保存模板定义，填入的变量值不落盘。
工具临时输入也不自动保存；点击「保存为笔记」会按现有记事本机制保存结果。

推荐流程：日志整理 → 用于脱敏 → 检查预览 → 填入 Prompt（`context` 变量）→ 放入对话草稿。
放入草稿不调用 AI，只有在对话页点击发送后才联网；替换已有草稿前会确认。
模板定义存在未保存修改时，切换模板/工具和通过命令面板跳转会提示。
本轮入口在桌面端，手机端未新增这五项界面。

提示词美化支持直接输入、从模板载入，或在模板库点击「美化模板正文」/「美化生成的 Prompt」。
只有点击「开始 AI 润色」才发送原文，结果流式显示并支持停止；完成变量校验后才可复制或交接。
不执行其中任务、不写入聊天记录；需要先配置 AI，
润色内容会发给该配置的模型服务。输入与结果各限 12000 字符，输入变化时不采用旧请求的结果。
含变量的结果可「转为新模板草稿」，检查后手动保存，原模板保留；填写变量后再交给 Agent。
临时原文与结果只保留在本次应用内存中；AI 改写后的语义仍需检查。

验证：`npm run build` 后运行 `node verify/desktop-ui/run.cjs --ip-prompt-only --screenshots`，
使用合成地址和模型返回，不读取真实网卡、不调用真实 AI。规格见 `docs/SPEC-ip-prompt-tools.md`。

### 待办与提醒

打开「个人管理 → 待办清单」，只填标题即可添加。需要提醒时设置开始／截止的日期和具体时间，并勾选通知；开始与截止各提醒一次，完成或归档后停止提醒。筛选支持未完成、今日、待开始、逾期、已完成和归档。

开始／截止时间可直接输入，也可打开日历选日期，再在时间页点选小时和分钟，点击「确认」应用；支持任意分钟。编辑已有时间时可直接切到时间页，方向键调整选项；清空可取消时间，Esc 或点外部放弃本次弹层选择。设置后仍需添加／保存待办，时间按本机时区解释。

提醒由主进程每 30 秒检查，关闭窗口到托盘后仍工作；从托盘退出应用后不提醒，重新打开或系统唤醒时合并补发未提醒事项。点击通知打开对应待办；Windows 免打扰可能把提醒收进通知中心，可用页面的「测试通知」确认。正式安装版的开始菜单快捷方式用于 Windows 通知识别，开发／便携运行需实机确认。

待办按本机时区输入，保存的是具体时刻；更换系统时区后显示会随之变化。日期不填则不提醒。编辑草稿仅在本次运行保留，退出前请保存。待办与普通笔记一样是本地普通数据，不用于保存密码；现已支持用户通过对话查询和操作，遵循当前 Agent 权限和审批。

桌面数据库升级到 v5，旧库升级前自动生成 `backups/toolbox-before-v5-*.db` 一致备份；备份失败停止启动并提示。回滚需退出所有使用数据库的应用，由用户手动从备份恢复 `toolbox.db`（升级后新增内容会丢失）；不要在运行时覆盖数据库或把旧 WAL 文件与备份混用。旧程序能读取原表但看不到待办。规格与验证见 [首批工具扩展](docs/tool-expansion-first-batch-verification.md)。

### 在对话中管理待办、笔记与用量

配置支持工具调用的模型后，在「对话」直接提出要求即可，例如：

- 「列出今天和逾期的待办」「明天下午三点提醒我检查发布结果」。支持修改时间／优先级／提醒、完成／重开、归档／恢复；修改前先定位确切事项，同名不自动选。
- 「查看本周 Codex 用量，和前一个等长区间比较」「近七天哪个项目用的 Token 最多」。统计与页面共用来源和缓存；未知／覆盖不完整会说明，不估算费用。
- 「把这段结论追加到部署笔记」「只替换其中的启动命令」「把这篇笔记改名」。局部编辑始终先显示逐行差异并请求确认，即使选择完全访问也一样；确认期间原文变化则拒绝覆盖。单篇局部编辑上限 20000 字符，差异过多时需在记事本页面处理。
- 「找一下和发布有关的笔记、待办、书籍和分组」。待办包含已完成／归档，书籍搜索书名和作者；不搜索密码箱或聊天历史。

工具成功后，回答末尾提供「打开…」按钮，直接定位笔记、待办、书籍／具体章节、分组或带原筛选的 Token 统计。入口随消息保存，重启后仍可使用；对象被删除会提示重新查询。点击仅打开页面，不执行任务或修改数据；进入阅读器后仍按原有规则记录阅读。待办编辑草稿跨页面保留。

只读权限不提供写工具；写操作确认沿用审批卡，拒绝或停止不继续写入。待办提醒仍仅在应用运行／托盘驻留时工作。需要被查询的普通笔记、待办和用量元数据会作为工具结果交给当前配置的模型，不发送密码箱明文或 Agent 会话正文。

实现边界及验证见 [对话扩展规格](docs/SPEC-chat-priority-tools.md) 与 [交付记录](docs/chat-priority-tools-verification.md)。隔离验收命令：`node verify/desktop-ui/run.cjs --chat-tools-only --screenshots`（先按仓库门槛构建）。

### AI 流式输出

AI 助手、OpenCode、提示词美化以及桌面 / 手机密码识别均使用流式链路。
密码识别在每个条目对象闭合后显示脱敏预览（最多 200 条），仅展示账号信息和「密码已填」状态，
完整 JSON 校验成功后再确认导入。停止、失败或关闭识别页时不会保存未完成结果。
提示词修改输入后会忽略旧分片，切换工具后返回可继续查看生成；新增工具请求超时会清理资源，不自动重发。
使用的模型服务需支持流式响应；该功能实现时未发起真实模型请求，手机界面属于冻结的历史实现，真机验收已暂停。
规格与验证记录见 `docs/SPEC-ai-streaming.md`，专项命令为
`node verify/desktop-ui/run.cjs --ai-stream-only --screenshots`（先构建）。

### 多 Agent 统一工作台

顶部直接切换 OpenCode / Codex / Claude Code / Claude Desktop / DeepSeek Harness，同项目无需重复选择目录；会话和草稿按 Agent / 项目 / 原生会话隔离。
输入任务后点击「开始对话」，按需连接、新建并发送；「新对话」先准备草稿，首次发送才创建原生记录。
连接、切换、读取历史和转用消息不发送任务；历史列表点选后恢复，恢复失败不补建。
不同 Agent 可分别选择项目并同时执行任务，切换时各自保留项目、会话与草稿。每个 Agent 在目录选择器确认后立即记住项目，无需先连接；重启时优先恢复各自项目，仅从未选择过的 Agent 继承当前项目。恢复只选择目录，不连接或读取历史；目录失效会提示重新选择。后台任务列出 Agent、项目和状态，可分别查看或停止，等待审批时可进入对应会话处理。
同一个 Agent 一次一个任务；相同规范项目路径的顶层任务仍互斥，避免同时写入。取消准备、停止、断连及结算仅影响对应 Agent，目标 Agent 正在执行时不接收会切换项目的消息转用。
Kimi 尚未接入，不占用日常选择器，不会自动安装。原生内部子代理仍由原生 Agent 调度。
助手回复和原生历史共用 Markdown 展示：支持表格及列对齐、标题、列表、只读任务标记、删除线、引用和带语言标签的代码块；宽表格与代码块可横向滚动。复制和转用仍使用原始 Markdown，不改写历史记录。普通对话与笔记预览共用这些格式支持。

用户消息可「复制」「取回编辑」：取回后聚焦输入框，发送会作为新消息追加；不修改原历史或撤回文件操作。已有草稿覆盖前确认，取消取回可恢复原草稿；历史文件、Skill 等引用需重新选择。超过 50,000 字符的原文只提供复制。取回前草稿的取消备份仅在本次工作台内存中保留，重启恢复的是当前输入框内容。

输入区的「上下文」展示原生报告的用量与窗口，点击查看来源、测量时间和窗口口径；新任务、切模型和断线后的旧值标为上次快照。OpenCode / DSH 使用 ACP `usage_update`，Codex 使用最近请求用量，Claude 在活跃 Query 结束前只读 summary；没有有效数据或窗口时显示「未提供」，不使用累计消耗或模型名估算。这里是原生快照，不是逐字刷新；Claude / DSH 标为近似值。「准备压缩上下文」只填入 `/compact`，仍需发送并通过现有原生命令校验，DSH 不提供此入口。

Claude 两入口支持原生 AskUserQuestion 单选、多选、补充文字，以及 ExitPlanMode 计划确认；Codex 支持 `item/tool/requestUserInput`。选择不会立即提交，回答只结算当前请求，不批准后续工具；取消、停止、断线、超时及原生已解决会使旧回答失效。OpenCode 表单、Codex MCP elicitation 和 DSH 结构化问题尚未接入，不声明这些能力。

本轮耗时为工具箱观测到的执行时间，不补造历史耗时。任务失败或停止后可取回最近的用户提问；尚未成功提交的输入仍保留在草稿中。结果未知时先「核对原生历史」，恢复失败不新建替代会话，不自动重发。真正的原生回退、编辑重发与分叉仍未开放；能力核对和本轮范围见 [基础交互交付记录](docs/coding-agent-basic-features-verification.md)。

#### 草稿恢复

选择项目后的未发送文字约 500ms 防抖，加密保存到既有 kv 的独立记录；不新增表或升级 schema。
沿用密码箱受系统保护的主密钥，使用独立用途的 AES-256-GCM 文本信封，旧密码密文保持兼容。
重启恢复 Agent、项目和新对话草稿；历史草稿在点选相应历史后恢复，不自动连接、发消息或恢复运行态。
「管理草稿」可取回已失效历史的文字，也可确认后清除单条或全部草稿；取回只准备新对话输入。
每条最多 50,000 字符、100 条、总明文 UTF-8 体积 2 MiB，超限不静默删除。
读取或解密失败保留原记录，保存失败保留内存文字并提供重试，不降级为明文。
正常退出先有界刷新，未确认保存时可返回应用或仍然退出；异常终止可能丢失最后一个防抖窗口的内容。
未选择项目的文字仅存内存，界面会提示；退出前需选择项目保存，不承诺跨机器解密或迁移。

#### Claude Code

使用固定版本 `@anthropic-ai/claude-agent-sdk@0.3.310`，Windows x64 原生组件随应用解包，
也可在连接设置选择官方 `claude.exe`。登录与订阅认证交给官方程序，不读取或复制 OAuth 登录文件，不保证订阅额度可用。
连接只初始化并读取原生模型目录，发送时才启动任务；支持真实增量、单次审批、停止及官方会话 API 的历史读取与续接。
默认计划模式，打开会话后支持 Auto（自动）、Manual（手动）、Accept edits（接受编辑）、Plan（计划）四种模式，Code 与 Desktop 两入口一致。Auto 是否可用取决于原生程序、模型与供应商；原生降级时界面同步实际模式并提示。Accept edits 的文件操作由原生权限系统决定，未解决的审批仍在工具箱确认；不提供 Bypass。项目目录不等于操作系统沙箱。模式说明见 [官方权限文档](https://code.claude.com/docs/en/agent-sdk/permissions)。
SDK 使用 `settingSources: []`，不自动加载用户／项目／local settings 中的 hooks、MCP，不改写原生配置；
连接与每次发送会单独读取 Claude 用户 `settings.json` 的供应商环境白名单（`ANTHROPIC_BASE_URL`、API Key／Auth Token、模型映射）及顶层默认模型，兼容 CC Switch 写入的第三方路由。支持 `CLAUDE_CONFIG_DIR` 绝对路径；凭据仅用于当前 Claude 子进程环境，不写入工具箱配置、日志、IPC 或命令行参数，也不导入用户 hooks、权限和 `apiKeyHelper`。默认模型选择「沿用 Claude / CC Switch 配置」，手动选择模型则覆盖默认。切换供应商后下次发送重读；已运行的任务不切路由。使用本地代理路由时需保持 CC Switch 运行，Claude Desktop 无需打开。
这里沿用的是 CC Switch 的 **Claude Code** 配置与路由，Claude Desktop 使用独立的供应商和路由。
若提示 `Claude Provider 缺少 base_url 配置`，请在 CC Switch 的 Claude Code 页面检查实际「路由中」的供应商是否配置了上游地址；只配置 Desktop 不会同步给 Code。使用第三方供应商时，应在 Claude Code 页面添加对应预设并路由到它，不能把 Desktop 的本地网关地址当成供应商上游。
官方认证及组织策略仍由官方程序处理。已支持受限的结构化问答和计划确认；格式无法识别或需要秘密信息时明确停止并提示回原生客户端，不猜选项。
模型及思考强度来自原生目录，历史显示前 200 条、最多 200,000 字符；不承诺与 Desktop 实时同步。

#### Claude Desktop

独立入口沿用 **CC Switch 的 Claude Desktop 第三方配置**，不要求再在 Claude Code 页面添加同一供应商。
主进程只读 `Claude-3p/configLibrary/_meta.json` 当前 `appliedId` 对应的 profile，读取网关地址、Bearer 认证与模型列表；不修改 Desktop 或 CC Switch 配置。Windows 使用 `%LOCALAPPDATA%/Claude-3p`；其他平台仅按标准路径尝试，尚未真机验证。
任务由与 Code 相同的官方 SDK 执行；无需打开 Desktop 窗口，本地网关模式需要 CC Switch 保持运行。没有可用第三方 profile 时明确停止，不借用 Desktop 官方登录，也不回退 Code 路由。

在 CC Switch 的 **Claude Desktop** 页面启用第三方供应商后，回工具箱选择 **Claude Desktop**，选择项目并发送即可。
模型菜单沿用 profile 的模型 ID 和显示名；未配置列表时只读查询同一网关的 `/v1/models`，不发送模型任务。默认使用列表首个模型，也可手动选择。切换供应商后下次发送重读；显式模型已移除时需同步模型并重新选择，不自动换模型。
程序／项目偏好、连接、草稿与 Code 分开；凭据只用于子进程环境，不保存到工具箱。Desktop 历史合并本入口创建的 SDK 会话和本机 **Desktop Code 已结束会话**，使用桌面描述中的 `cliSessionId` 关联原生记录，Code 历史排除这些来源；两入口各显示近期最多 200 条（在最近 2000 项原生目录中筛选）。归档、等待处理、结束状态无法确认或缺少 SDK 记录的会话不提供续接。

查看原有 Code 历史：选择 **Claude Desktop → 原项目 → 历史会话 → 点选会话**，即可查看正文，不会自动发送。
继续提问前，请**完整退出外部 Claude Desktop 和其他 Claude 任务**；只关闭窗口可能仍驻留托盘。工具箱在每次续接前检查 Windows 进程，发现 Claude 或无法确认状态就保留草稿、不发送。使用本地网关时保持 CC Switch 运行。本入口新建的 SDK 会话无需这一步。
续接仍使用同一原生 ID、Desktop 网关和工具箱的权限选项，默认计划模式。进程检查是发送前的快照，不能阻止之后重新打开外部程序，请顺序切换使用；macOS／Linux 原会话续接暂未开放。
不包含普通 Chat、Cowork、远程会话或运行中任务接管；不重写 Desktop 列表与状态，返回 Desktop 后的新增消息回显尚未实机确认，不承诺实时双向同步。
工具箱新建的 SDK 会话没有 Desktop 的列表记录，**不会自动出现在 Desktop**。Desktop 已有 Code 会话只会在相同项目目录下列出；列表缺失时先核对顶部项目路径，再切换到原目录并刷新历史，不能只比较模型或供应商配置。
每次展开「历史会话」都会重新读取原生目录；列表已展开时可点击标题旁的刷新按钮，获取 Desktop 后来新增的记录。
Claude 已打开的历史在刷新列表或空闲时再次点选后会重读正文，保留草稿、模型与模式，不要求断开重连。已连接且历史展开时，从外部应用返回工具箱也会刷新；任务运行或准备期间不刷新，不接管外部正在执行的任务。编程输入框统一使用 Enter 发送、Shift+Enter 换行，中文输入法确认文字的 Enter 不发送。
本轮刷新、快捷键与四种模式的改动和手动验收见 [交互调整记录](docs/claude-workbench-interactions.md)。
配置见 [独立入口规格](docs/SPEC-claude-desktop-provider.md)，历史、退出修复与操作步骤见 [本轮交付记录](docs/claude-desktop-history-verification.md)。

#### DeepSeek Harness

使用官方 `dsh --profile acp`，支持 PATH 的 CLI、官方 npm `dsh.cmd` 或 Desktop 的固定 CLI 入口。
Windows 可从安装记录定位 `DeepSeek Harness.exe`，也可手动选择；通过固定程序与参数数组启动，不执行 shim 的任意 shell 内容。
本机 Desktop **0.2.1-rc.3** 的初始化和历史摘要探针通过，无需先打开 Desktop 窗口。
ACP 只推送已提交回复，**没有实时 Token 分片；可续接上下文，但暂不回放旧消息**。
历史与 Desktop 共用 `~/.dsh/sessions`；Tool_box 读取 Desktop 单会话缓存中的标题，隐藏空白或无提问会话，断开重连后自动补读。打开历史时会只读解析 `~/.dsh/sessions/<cwd>/<id>/session.v4.jsonl.zstd`，恢复用户和助手文本（跳过注入消息、推理与工具块）；格式或版本不匹配时回退为空，不影响续接。若会话正在 Desktop 中使用，历史仍会加载并标记为已断开，提示关闭 Desktop 会话后重试。需要手动归组时，在会话「更多 → 归入 DSH 工作区」；Tool_box 按当前项目路径匹配工作区，备份 `workspace.json` 后原子追加会话 ID，并取消该会话归档；版本不支持、路径不匹配或文件被占用时拒绝写入。写入的是 DSH 私有工作区数据，需重启或刷新 DSH Desktop 后才可见。Desktop 对尚未发送消息的空会话仍显示“未命名”，首条消息生成标题后可见。需要列举、resume、close 能力，旧版本缺失会明确报错。
模型／思考强度按原生选项展示，权限遵循原生规则，支持单次允许／拒绝和停止；只关闭 Tool_box 自己打开的会话。
项目 `.env` 中的 `DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、代理、证书、`DSH_*` / `XDG_*` / `DYLD_*` 等启动变量会被 DSH 拒绝并导致原生进程退出。Tool_box 以独立空目录作为 DSH 宿主的启动 cwd，项目路径通过 ACP 的 `session/new` / `session/resume` / `session/list` cwd 传入；项目可以保留自己的 `.env` 供开发使用，宿主不会读取它。
不提供 DSH 专有卡片、子任务详情、问答或额外目录能力，不读取私有 WebSocket 或伪造流式。

本轮没有发送真实模型任务；真实生成、实际文件权限、付费认证与各 Desktop 历史互见需手动验收。
实现、授权与验证见 [桌面便捷功能交付记录](docs/desktop-convenience-agent-verification.md)。
无模型探针：`node verify/agent-runtime-connect-smoke.cjs`；隔离 UI：
`node verify/desktop-ui/run.cjs --convenience-only --screenshots`（先构建）。
依赖变更后的开发启动验证：`node verify/dev-start-smoke.cjs`（使用隔离数据目录与临时开发入口）。

#### Codex

自动检测 PATH 中的原生 `codex.exe` / `codex`，以及 Windows Desktop 的
`%LOCALAPPDATA%/OpenAI/Codex/bin/<版本>/codex.exe`，也可手动选择原生 CLI。
通过 `app-server --stdio` 使用其原生 profile 和认证；请先在 Codex 完成登录，再连接 Tool_box。
不会把 Tool_box 的模型密钥或其他 Agent 的认证文件复制给 Codex。

直接输入任务开始，或打开当前项目历史并点选恢复。模型目录来自原生 `model/list`；
推理深度在输入框底栏按原生选项直接显示。新会话默认**只读，升级需单次审批**。
恢复历史保留已支持的只读 / 项目写入档位；其他原生策略也能打开历史，但继续前需明确选择「只读」或「项目写入」。
打开历史不会自动改写原生权限；后续按用户所选档位请求 `on-request` 审批，原生配置与组织策略仍可能限制操作。
不接管原入口正在执行的会话；首次恢复会先检查项目归属。长历史达到显示限额时提示处理，不自动补建。

公开协议提供子任务时展示其原生身份、状态与结果；不在此单独重试或停止子任务，
父任务停止后无法确认的子任务状态显示未知。用量归集尚未接入。需要交互式问答、MCP elicitation
或额外权限类型的反向请求暂不支持，原生操作可能返回失败，需在 Codex 原入口处理。

本机 **Codex CLI 0.163.0-alpha.10.2** 已通过无模型握手、模型目录、项目历史与重连探针；
真实生成、实际文件权限和 Desktop 会话互见仍待用户验证，不承诺 Desktop 实时双向同步。
专项合成验收：`node verify/desktop-ui/run.cjs --coding-agents-only --screenshots`（先构建）。
连接探针：`node verify/codex-connect-smoke.cjs`，只读取运行时元数据，不创建或发送会话。

#### 文件引用与快捷命令

在编程任务输入区键入 `@`，或点击「＋ → 引用文件」，可按名称 / 路径搜索当前项目文件。
方向键选择，Enter / Tab 插入，Esc 关闭候选；候选关闭后 Enter 发送、Shift + Enter 换行。
一次最多 20 个引用，单文件上限 2 MB；依赖、构建目录和明显的密钥文件默认不列出。
发送前重新检查路径归属和文件状态，正文由原生 Agent 按其权限读取。

键入 `/` 或点击「＋ → 命令」可搜索快捷操作。`/skills` 选择 Skill，`/mcp` 查看能查询的服务及工具；
Codex 使用结构化 Skill 引用，Claude SDK 的 Skill 与命令统一显示。
MCP 工具选择仅填入使用意图，实际调用以原生工具事件为准，不绕过原生权限。
`/new`、`/history`、`/model`、`/permissions` 复用工作台已有入口，不发送模型任务。
未识别的命令会保留草稿；确需发送斜杠文本时点击「作为普通文字发送」。

`/compact` 使用当前 Agent 的原生压缩能力；仅压缩已有会话，受理后等待原生终态。
OpenCode 以 ACP 公布的命令为准，Codex 使用专门 RPC，两个 Claude 入口在执行前复核 SDK 命令。
DSH 官方 ACP 未提供手动压缩、Skill 列表和 MCP 状态查询，界面会说明限制。
`/init` 标明目标文件；Claude 原生为 `CLAUDE.md`，工具箱工作流和 `/agents` 为 `AGENTS.md`。
目标文件存在时拒绝覆盖；计划 / 只读模式只给建议，写入仍遵守当前原生权限与审批。

Claude「连接设置」可按入口和项目开启本机扩展配置，默认关闭。开启可能加载 hooks、插件、MCP
及原生权限规则；Desktop 入口仅加载项目 / 本地配置，不加载 CLI 用户设置或账户连接器。
不会自动安装扩展或修改原生配置。重启恢复的草稿保留引用文字，临时引用需要重新选择。

接入范围、限制与验证见 [快捷操作交付记录](docs/coding-agent-commands-verification.md)。
无模型能力探针：`node verify/agent-actions-connect-smoke.cjs`；隔离交互验收：
`node verify/desktop-ui/run.cjs --agent-actions-only --screenshots`（构建前遵守仓库验证门槛）。

#### 消息转用与交接说明

在完整助手回复下点击「用于 Codex / OpenCode」，或从「其他 Agent」选择 Claude / DSH 等目标，内容直接进入同项目的目标新对话草稿；
目标未连接也可准备草稿，检查后点击发送才连接、建会话并执行。需要沿用历史时展开「改用已有会话」。
草稿确实将被替换时询问确认，其他会话和其他项目的未发送内容会保留。
目标已在不同项目时，先确认再切项目，取消不改变目标状态；原连接在明确发送时才替换。转用后提示来源及目标原项目，并提供「返回原项目」：只切回目录并恢复原项目新对话草稿，不连接、恢复会话或发送；历史草稿需明确重开对应历史后恢复。正在运行的目标不接收转用。

需要完整上下文时，在会话「更多」菜单点击「生成交接说明」，由来源 Agent 在当前会话总结；
这是一次用户主动发起的模型请求，结果为普通回复，可直接转用，当前输入框内容保留。
已有合适回复或文档时直接转用 / 提供路径，不必生成摘要。工具箱不自动写交接文件或同步代码。

旧交接表单、来源引用队列和交接角色管理已取消。普通 Prompt 模板库保留，旧 `agentRoles` 配置不自动清空。
待转用内容作为未发送草稿参与加密保存；已发送记录由原生 Agent 保存，不把完整编程会话另存进工具箱聊天表。
规格及边界见 [消息转用](docs/SPEC-agent-role-handoff.md)、[项目记忆与跨项目转用](docs/SPEC-agent-project-memory-handoff.md)、[易用性方案](docs/PLAN-coding-agent-usability.md)。

#### OpenCode

首版已在 Windows 的 **OpenCode Desktop 2.1.1** 上验证，无需另装 CLI 或新增 npm 依赖。
自动检测 `%LOCALAPPDATA%/Programs/ai.opencode.desktop/resources/opencode-cli.exe`（Desktop 2.2.0 的标准位置），
同时兼容旧版 `@opencodedesktop` / `OpenCode` 安装目录；每次连接前重新检测，更新移除旧程序后会回退到当前安装位置。
自定义安装位置可通过「选择程序」指定原生 `opencode-cli.exe` / `opencode.exe`。
其他平台仅提供标准路径尝试和手动选择入口，尚未实机验证。

1. 打开左侧「编程 Agent」，选择项目目录，输入任务并点击「开始对话 · OpenCode」。
   程序未发现时在「连接设置」重新检测或选择原生程序；无需先打开 OpenCode Desktop 窗口。
2. 新会话使用 **Plan**；恢复历史保留原生模式。历史入口直接列出当前项目会话，点选即可恢复。
   模型按 OpenCode Desktop 的勾选与默认可见规则过滤；更改勾选后，在会话「更多」点击「同步模型」。
   模型不可用时停在已建会话供选择，保留草稿；不会静默换模型。
   连接细节默认收起，主要空间留给消息与输入；按需展开设置可手动连接 / 断开。
3. 直接输入任务，或在 Prompt / JSON / 日志 / 脱敏 / Diff 结果下点击「用于编程 Agent」。
   内容只进入草稿，替换已有草稿前确认；点击「发送给 OpenCode」后才开始请求模型。
4. 需要改文件时可手动选择 **Build**。权限沿用 OpenCode 配置，可能直接执行已获允许的操作；
   出现审批询问时只提供单次允许或拒绝。所选目录不等于操作系统沙箱。
5. 可停止任务、读取当前项目的 OpenCode 历史并恢复；「打开 OpenCode Desktop」移入连接设置。
   会话列表和顶部标题使用原生会话名称，打开会话及任务结束后同步，任务结算 10 秒后再补读一次。
   在 Desktop 修改名称后，可点击历史区域的刷新按钮；名称读取失败会保留已有名称。

Tool_box 只保存运行程序和项目路径偏好，不读取或复制 OpenCode 登录凭据，
不将编程会话写入自身聊天表；完整记录由 OpenCode 管理。
模型偏好从 Desktop 的 `ai.opencode.desktop/drafts.sqlite` 固定模型键只读获取，
目录元数据通过内置 CLI 的 `api model.list` 读取，原始设置与请求头不进入渲染层。
此偏好格式已在 Windows Desktop 2.1.1 验证；其他版本或自定义 profile 可能不兼容，读取失败会提示重试。
模板变量不随模板定义保存，但发送后的内容属于 OpenCode 原生会话，会按其机制保存。
未发送草稿按上述机制加密保存。首次连接需要 OpenCode 支持 ACP v1、配置选项和 Plan 模式。

每个 Agent 一次运行一个编程任务，每次任务最多 5 万字符；界面单会话最多显示 20 万字符、200 条消息，
最多保留最近 100 项工具状态、同时打开 20 个会话。达到上限会请求停止并提示新建会话。
断连或请求超时不会自动重发任务；需检查 OpenCode 中的实际结果再操作。
本轮不包含完整终端/代码编辑器，也未扩展手机端入口。

验证：`node verify/desktop-ui/run.cjs --opencode-only --screenshots` 使用合成桥接，
不启动真实 Agent。`node verify/opencode-smoke.cjs` 复用已安装的桌面内置 CLI，验证握手、
Plan、会话列表和恢复；加 `--prompt` 才发送不读取/修改文件的合成短消息验证真实回复。
加 `--connect-only` 只验证连接、模型同步、重连及原生列表保持不变，不创建会话或发送消息。
其余实机检查会在 OpenCode 中创建少量验证会话，不删除或覆盖既有会话。规格见 `docs/SPEC-opencode-workbench.md`。

### 本地 Token 统计

1. 打开左侧「开发工作台 → Token 统计」，自动读取本地记录，无需连接或打开 Agent。
   首次扫描结果会缓存到应用数据目录，之后启动先显示上次结果，再增量刷新。
2. 选择今日、近 7 天、本月、近 30 天、累计或自定义日期，再按 Agent、项目或模型筛选；
   周期与筛选会被记住，换页回来不会重置。
   Agent 筛选、来源、明细和趋势图例与编程 Agent 切换入口统一显示图标和名称，图标离线可用并跟随主题；Pi、WorkBuddy、ZCode 使用备用标识。
3. 页面提供总量 / 请求数 / 会话数 / 缓存命中率等指标卡、按 Agent 堆叠的 7 / 30 / 90 天趋势、
   模型与项目排行、可排序的会话明细（含详情抽屉）和 CSV 导出。
4. 没有发现记录时打开「数据来源」，选择对应会话目录或 SQLite 文件；自定义路径会保存，
   可恢复自动发现，也可以只重扫某一个来源。

支持 Codex、OpenCode、Claude Code、Kimi Code、Pi、WorkBuddy、DeepSeek Harness、ZCode、
Gemini CLI、GitHub Copilot CLI、Grok CLI、MiMoCode、MCode 和 Cline CLI 的已适配格式。
未安装来源只显示未发现；兼容范围和真机 / 合成验证区别见 [统计交付记录](docs/agent-token-usage-verification.md)。
数据库按只读事务读取已提交的 WAL 内容；日志以文件为单位缓存，未变化文件不重读，变化文件替换缓存，不累加旧快照。
日志末尾未补齐换行的记录、压缩日志的未完整帧暂不计入，也不因正常追加提示不完整；补齐后在下一次刷新计入。
扫描期间文件或 WAL 变化时保留上次确认值，不提交本次读取结果；真实读取失败、格式损坏或字段缺失仍提示。
页面可见时按所选间隔检查（默认 60 秒），隐藏或离开后停止；统计缓存写入 `agent-usage-cache.json`（只含 Token 元数据），
自定义路径保存在 `agent-usage-sources.json`，不改 `toolbox.db`。
不读取认证表、不保存正文、不启动模型。OpenCode 每条消息自带的原生 `cost` 会显示为「原生上报花费」，
其它来源显示未上报；不维护价格表、不做费用估算、不查询余额。未知字段不当作零；累计补差没有调用时间时
只计入累计，不伪造每日或模型用量。

### 桌面交互

- 全局搜索命中笔记后打开编辑页，密码条目打开详情，分组切换到对应书架筛选；加载失败可重试，已删除的目标会提示失效。笔记或密码编辑存在未保存内容时，通过命令面板跳转会先确认。
- 命令面板支持方向键选择并滚入可视区、Tab 保持焦点、Esc 只关闭顶层面板；取消面板后恢复原焦点。全局搜索只索引密码条目的标题与网址。
- 聊天在底部附近自动跟随新消息；向上查看历史后保持阅读位置，可点「回到最新」恢复跟随，切换会话后重新定位到末尾。
- 文本清洗保留原文，把结果放到可复制的输出栏；修改输入后结果按当前操作更新。工作台按可用空间切换并排或上下排列。

### 桌面主题

- 设置页「外观与主题」提供 **星轨深空 / 静夜石墨 / 晨光纸白**，也可跟随系统：深色使用石墨，浅色使用纸白。旧配置默认保持深空主题。
- 选择立即预览并自动保存，重启后恢复；保存失败会恢复上次外观并提示。外观存储在现有 kv 的 `appearance` 字段，首屏只缓存非敏感外观偏好。
- 「星空背景动效」控制深空主题的闪烁与流星；关闭后星点静止，系统启用减少动态效果时也会自动静止。石墨和纸白不显示星空。
- 阅读器的纸张、文字、字号独立设置。手机端主题实现已冻结，不再随桌面配色同步调整。

### AI 供应商配置

设置页采用**档案制**：每套档案独立保存供应商、接口地址、模型与 API Key，列表点选即可切换「使用中」的那套，AI 对话与密码箱识别都走当前启用档案。

- 选择内置供应商会自动填入官方端点与推荐模型；下拉里没有的服务商选「自定义」手填 `baseUrl` 即可。
- 点「获取模型列表」调用供应商的 `GET {baseUrl}/models` 拉取实时目录；**拉取失败时自动降级为该供应商的内置推荐模型**并写明原因，不会阻断配置流程。
- **模型清单由你自己勾**：拉到的模型列成可多选的清单，**只有勾选的模型会出现在对话页的下拉里**（外加当前正在用的那个）。供应商目录动辄三四十个，全塞进下拉既难看又难找，所以改成「要哪几个勾哪几个」；一个都没勾时回落到内置推荐，保证下拉不为空。
- **勾上即生效**：勾上任一模型，当前模型立刻切过去（就是实际发请求用的那个）；取消勾选当前模型时顺延到清单里剩下的第一个。设置页另有「当前模型」输入框，自定义供应商可直接手填模型名。
- 换供应商会重置勾选清单（上一个供应商的模型在新供应商里多半不存在）。
- 旧版本（单套配置）的 `ai-settings.json` 会自动迁移为唯一档案，并按 `baseUrl` 反查补全供应商，升级不丢数据。
- **OpenCode Go 特殊要求**：该网关要求客户端带自有 `User-Agent`，并为每个会话发送稳定的 `x-opencode-session`，否则返回 400。应用已自动注入这两个头（会话 ID 取会话 ID，逐轮稳定），无需手动配置。

## 技术栈

- Electron + electron-vite
- React 19 + TypeScript strict + Tailwind CSS
- Zustand
- LangChain.js（`@langchain/core` + `@langchain/openai`）
- better-sqlite3（SQLite，桌面 schema v5）
- Electron `safeStorage`（Windows DPAPI）保管 AI Key 与密码箱主密钥
- Vitest

## 常用命令

```bash
npm install --ignore-scripts   # 见下方「为什么不是普通 npm install」
npm run dev           # 开发模式（Electron 窗口）
npm run build         # 构建主进程 / preload / renderer
npm run preview       # 预览构建产物
npm run dist          # 打包 Windows 安装包（release/私人百宝箱 Setup x.x.x.exe）
npm run typecheck     # TypeScript 校验
npm run lint -- --ignore-pattern "mobile/**"  # 桌面 ESLint，排除冻结手机目录
npm run test -- --exclude "mobile/**"         # 桌面 Vitest，排除冻结手机用例
npm run format        # Prettier
```

验证执行须遵守 `AGENTS.md` 的代码量 / 文件数双重门槛。根 lint / test 配置仍含手机目录，以上参数限定桌面范围；本次未修改脚本或测试配置，`mobile:*` 不再属于默认验证流程。

桌面交互验收使用现有 Playwright 与 Electron，临时配置目录和合成桥接数据与日常应用隔离，
不读取真实数据库、不请求 AI、不写系统剪贴板：

```bash
npm run build
node verify/desktop-ui/run.cjs
node verify/desktop-ui/run.cjs --screenshots  # 可选：截图写入 .playwright-mcp/desktop-ui/
node verify/desktop-ui/run.cjs --tools-only --screenshots  # 工具导航与 Java / AI 首批工具
node verify/desktop-ui/run.cjs --tool-navigation-only --screenshots  # 工具搜索、排序及重启恢复
node verify/desktop-ui/run.cjs --opencode-only --screenshots  # 只验收 OpenCode 工作台
node verify/desktop-ui/run.cjs --sidebar-only --screenshots  # 树形侧栏、键盘、页面跳转及窄栏
```

覆盖搜索定位与草稿保护、顶层 Esc 与键盘焦点、流式滚动、窗口缩放、文本输出与复制，
以及三套主题、公共文字令牌对比度、系统主题跟随、动效、保存失败、缓存损坏、重启恢复、
阅读器独立配色、工具目录搜索 / 拖放 / 键盘排序、顺序保存失败回退与重启恢复，
Java / AI 工具的精度、流转、失败重试、模板历史与重启恢复，
OpenCode 工作台的连接、草稿交接、审批、停止、原生历史和主题，以及
1280×820 / 1024×680 / 1920×1080 布局；不能替代真实数据、AI 服务和手机真机验收。

> ⚠️ **不要跑 `npm run rebuild`。** 它在这台机器上必然失败，且对当前依赖毫无作用 ——
> 原因见下一节。要点已经写在 `docs/ROADMAP.md` 第 5 节。

### 为什么不是普通 `npm install`

`better-sqlite3@13` 的 npm 包里同时有 `binding.gyp` 和 `prebuilds/*.node`。
npm 11 的 `@npmcli/arborist` **只要看到磁盘上有 `binding.gyp` 就会合成一条
`install: node-gyp rebuild`**（`arborist/lib/install-scripts.js`），于是在没装
MSVC 的机器上直接失败：

```text
gyp ERR! find Python - THIS VERSION OF PYTHON IS NOT SUPPORTED
```

所以用 `--ignore-scripts`，再手动补跑被一并跳过的安装脚本（Electron 的
`postinstall` 负责下载运行时二进制，不补的话 `npm run dev` 起不来）：

```bash
node node_modules/electron/install.js          # 下载 Electron 运行时
node node_modules/esbuild/install.js           # 校验 esbuild 原生二进制
node node_modules/vite/node_modules/esbuild/install.js
```

## 打包（electron-builder + NSIS）

一条命令出安装包：

```bash
npm run dist          # → release/私人百宝箱 Setup x.x.x.exe
```

打包配置在 `package.json` 的 `build` 字段。

桌面安装包保留全部功能与内置 Claude Code，仅保留 Electron 的简体中文／英语语言文件；打包时排除依赖的 source map、TypeScript 声明和 `src/` 下的 TypeScript 开发源码，不删除本地 `node_modules`。JavaScript 运行文件、CommonJS／ESM 两种入口、分词数据、原生模块、许可证和 SDK 资源继续保留。

按 2026-10-25 的既有产物静态估算，可减少约 82 MiB 安装占用；安装程序本身已经压缩，不能直接减去这个数值。配置修改后需重新执行 `npm run dist` 测量安装包大小，旧 `release/` 产物不会自动变化。测量基线、兼容边界及人工验收见 [安装包精简记录](docs/packaging-size-reduction.md)。

要点：

- **`npmRebuild: false`** —— 跳过 `@electron/rebuild`。
  better-sqlite3 13 起改用 **Node-API 预编译**：`prebuilds/win32-x64.node`
  直接随 npm 包发布，且 `lib/binding.js` 只按 `process.platform-arch` 选文件、
  **不校验 ABI**，Node 与 Electron 通吃。所以既不需要重编译，重编译出来的
  `build/Release/*.node` 反而会被排在预编译之后**永远加载不到**。
  加上这个开关后，打包不再需要 Python 与 MSVC 编译工具链。
  （代价：日后若新增**确实需要**按 ABI 编译的原生依赖，得先把这个开关去掉。）
- `asarUnpack: ["**/*.node"]` —— `better-sqlite3` 的原生二进制不能进 asar，否则运行时报错找不到模块。
- `files` 只收 `out/`、`assets/`、`package.json`；`assets/prompts/password_import.txt` 在运行期通过 `app.getAppPath()` 读取，必须打进包内。
- 应用图标为 `assets/icon.png`（512×512，electron-builder 自动转 `.ico`）。

安装包为 `perMachine: false`（免管理员权限）、`oneClick: false`（带安装向导，可自选安装目录），并创建桌面与开始菜单快捷方式。

### 国内镜像

两端打包的下载源都已内置国内镜像，`npm run dist` 与 `npm run android:apk` 会自动走镜像，无需手动设置环境变量：

| 目标 | 镜像内容 | 配置位置 |
| --- | --- | --- |
| 桌面端 | Electron 运行时、nsis / winCodeSign / 7-zip 等打包工具 | `package.json` 的 `config` 字段（npm 注入为 `npm_package_config_*` 环境变量） |
| 手机端 | Gradle 发行包（约 130 MB） | `mobile/android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl`（腾讯云） |
| 手机端 | Gradle 依赖（google / mavenCentral / gradlePluginPortal） | `mobile/gradle-mirror.init.gradle`（阿里云，保留官方源回退） |

仅首次打包需要下载（Electron 约 130 MB、Gradle 约 130 MB），之后走本地缓存（`%LOCALAPPDATA%\electron\Cache`、`%LOCALAPPDATA%\electron-builder\Cache`、`%USERPROFILE%\.gradle`），清掉缓存才会重新拉取。

> ⚠️ `mobile/android/` 是 `expo prebuild` 生成的目录。改过 `app.json` 重新 prebuild 后，wrapper 的 `distributionUrl` 会被重置回官方源，需手动改回腾讯云镜像（`mobile/gradle-mirror.init.gradle` 在 `android/` 之外，不受影响）。

## 目录

> 待办、真机验收清单与环境注意事项见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

```text
src/
├── main/                 Electron 主进程
│   ├── index.ts          入口：窗口 + 服务装配
│   ├── ipc/              IPC 注册与入参校验
│   └── services/
│       ├── agent/        工具注册表 + Agent 循环 + 审批门
│       ├── ai-gateway/   LangChain Agent 编排、流式事件与错误映射
│       ├── chat-store/   统一 SQLite 数据层（桌面 v5）
│       ├── crypto/       safeStorage 主密钥 + AES-GCM
│       ├── library/      编码探测、章节解析、密码文本解析、拼音
│       ├── password/     密码箱 AI 识别
│       └── settings/     AI 配置（Key 加密存储）
├── preload/              contextBridge 安全桥
├── renderer/             React 界面
│   └── src/
│       ├── components/   bookshelf / reader / password / notes / stats
│       ├── lib/          paginator、markdown
│       ├── stores/       app / config / reader
│       └── styles/       设计系统（对齐 index.html 星轨风格）
└── shared/               双进程共享类型、IPC 协议、常量
mobile/                   已暂停维护的 React Native + Expo 手机端（独立包，历史资料）
```

## 手机端历史资料（React Native + Expo，已暂停维护）

> **本节为归档说明，不是当前开发 / 验收任务。** 自 2026-10-23 起暂停维护；以下结构、版本、命令和验证结果记录冻结前状态，不保证与后续 PC 版本兼容。保留代码与数据，不自动安装、启动、打包或更新手机端；用户明确恢复后再评估。

`mobile/` 是独立 npm 包（未接入 workspaces，依赖装在 `mobile/node_modules`），与桌面端**共用仓库根 `src/` 下的纯逻辑**，桌面端代码零改动。

| 项 | 说明 |
| --- | --- |
| 复用方式 | `mobile/metro.config.js` 把 `../src` 纳入 `watchFolders`；所有跨目录引用集中在 `mobile/src/shared-bridge.ts` 一个文件 |
| 已复用 | `src/shared/types.ts`（类型 / 供应商预设 / 阅读常量）、`src/shared/markdown.ts`（Markdown 解析）、`src/shared/notes-search.ts`（笔记搜索）、`src/shared/reading-stats.ts`（区间统计）、`src/shared/history.ts`（对话历史裁剪）、`src/shared/book-cover.ts`（占位封面）、`ai-gateway/errors.ts`（错误映射与端点规范化）、`library/` 的章节解析、密码文本解析、拼音首字母 |
| 数据层 | `mobile/src/data/`：`expo-sqlite` + `MobileStore`；冻结时按桌面 schema v4（11 张表）对齐，后续不保证同步 |
| 加密 | `expo-crypto` AES-256-GCM + `expo-secure-store` 存主密钥；**密文信封格式与桌面端一致**（`{v,iv,tag,data}`） |
| AI 助手 | 自写 Agent 循环（不搬 LangChain）：**14 个工具**（12 读 + `notes_save` + `passwords_delete`）；三档权限（只读 / 写操作确认 / 完全访问），写操作在对话页弹审批卡；**工具调用不在界面上展示**（与桌面端一致）；**密码箱不给「保存 / 覆盖」**（会毁掉解密失败条目的原密文），只给收藏与删除 |
| 需重写 | AI 客户端（自写 SSE，不用 LangChain）、Agent 循环与工具层、阅读器分页（RN 无 `scrollHeight`）、全部界面 |
| 数据 | **与桌面端各自独立**，主密钥绑定设备，密码箱密文不互通 |

**历史跨端对齐护栏**（暂停随 PC 改动更新）：

- `desktop-schema.fixture.json` 由真实桌面 `toolbox.db` 导出，`schema.test.ts` 拿它与手机端 DDL 逐表逐列比对。
- `desktop-envelope.fixture.json` 由桌面端 `SafeStorageSecretBox` 真实实现产出，`secret-envelope.test.ts` 验证手机端能解析同一信封。

当前桌面改动不再要求生成手机 fixture。恢复手机维护时，再基于临时合成数据重新比对共享接口、schema 和加密格式，并设计迁移；历史 fixture 不代表当前版本兼容。

```bash
npm run mobile:typecheck      # 手机端类型校验
npm run mobile:bundle        # 跑 Metro 打包，无需真机即可验证跨目录引用
npm run mobile:verify:data   # 数据层端到端验证（真实 SQLite + 真实 AES-GCM）
npm run mobile:start         # 启动 Expo Dev Server
```

`shared-bridge.test.ts` 历史上在 vitest 中校验手机复用面；桌面演进可能使冻结用例失配，当前桌面验证排除手机目录，不为恢复手机兼容而阻塞交付。

### 历史数据层验证（恢复手机维护时再评估）

手机端数据层依赖三个原生模块（`expo-sqlite` / `expo-crypto` / `expo-secure-store`），**vitest 装不了**，光靠单测无法覆盖 DDL、迁移与全部业务 SQL。

`mobile/verify/` 用 esbuild 把真实数据层打成 Node 包，只 shim 掉这三个原生绑定，再用 Electron 跑（`better-sqlite3` 是 Electron ABI）：

- schema / migrate / MobileStore / secret-box 全部是**真实代码**，不重写不模拟
- SQLite 是真实 SQLite，AES-256-GCM 走 Node WebCrypto（与 expo-crypto 的 Web 实现同源）
- 覆盖：建库、三段迁移、迁移幂等、v2→v4 旧库升级、全部业务 SQL、加密往返（含密文被篡改应失败）、级联删除、错误路径

```bash
npm run mobile:verify:data
# 通过 84 项，失败 0 项
```

**这套验证覆盖不到的部分**：真机上的原生绑定行为（expo-sqlite 的实际实现、系统钥匙串 Keychain/Keystore、解密失败时的降级路径）。这些只能在真机上验。

### 历史启动步骤（当前不安排）

冻结前记录为 **M1–M7 代码完成，尚未真机验收**（详见 `docs/ROADMAP.md` 第 2 节归档）：5 个 Tab、手机本地 Agent、阅读器和记事本等实现保留；当前不继续验收，也不据历史记录承诺可运行。

1. 手机装 **Expo Go**（应用商店搜 Expo Go）。
2. 手机与电脑连同一个 Wi-Fi。
3. 电脑执行 `npm run mobile:start`，终端会显示二维码。
4. 手机 Expo Go 扫二维码即可。

若 Expo Go 提示「SDK 版本不支持」，说明手机端 Expo Go 版本落后于本项目的 SDK 57，改用自建开发版：`cd mobile && npx expo run:android`（需要 Android Studio + Android SDK + JDK 17）。

### 历史 APK 打包步骤（当前不安排）

一条命令出安装包（本地 Gradle，release，仅 arm64-v8a）：

```bash
npm run android:apk --prefix mobile   # → mobile/android/app/build/outputs/apk/release/
```

- 前置（仅首次或改过 `app.json` 时）：`cd mobile && npx expo prebuild --platform android` 生成 `android/` 原生工程（已生成可跳过）。
- 环境：Android Studio + Android SDK + JDK 17，并设好 `ANDROID_HOME` / `JAVA_HOME`（环境变量是终端级的，设完需重开终端）。
- 安装：`adb install -r <上面的 apk>`。

> `android/` 是生成目录，已在 `.gitignore` 中，改 `app.json` 后需重新 `expo prebuild` 让原生配置同步。

**iOS 说明**：只能在 macOS 上构建，且上架 App Store 需要付费的 Apple 开发者账号。纯自用可走 TestFlight 或 Ad Hoc 侧载。

## 数据表（桌面 schema v5）

`conversations`、`messages`、`books`、`chapters`、`reading_progress`、`bookmarks`、`book_groups`、`reading_stats`、`password_entries`、`notes`、`kv`、`todos`

封面与背景图片只在库里存 `covers/`、`backgrounds/` 下的**文件名**，绝对路径在运行期按 userData 目录还原 —— 换机或目录搬迁后不会失效。

## 安全说明

- AI `apiKey`：AES-GCM 加密后写入 `ai-settings.json`，主密钥由系统安全区（DPAPI）保管；多套档案各自独立加密，渲染层只能读到 `hasApiKey` 布尔值。
- 密码箱：`account` / `password` / `remark` 加密落库，`title` / `url` 明文以便搜索；主密钥绑定本机，整库拷走无法解密。
- 渲染进程无 Node 权限，仅通过 preload 暴露的白名单 IPC 访问数据。

## 已知限制

- 当前维护已验证的 Windows PC 桌面端；手机端自 2026-10-23 起暂停维护，历史实现未完成真机验收，不保证后续兼容、构建或运行。
- 手机端的 AI 助手只能操作**手机本地**数据（书架 / 记事本 / 密码箱 / 统计），看不到也改不了电脑上的数据。
- 手机端与桌面端数据互相独立，密码箱密文不互通（主密钥分属 DPAPI 与系统钥匙串）。
- 安装包未做代码签名，首次安装 Windows SmartScreen 可能提示「未知发布者」。
- 局域网同步、PC 摸鱼（老板键 / 伪装皮肤）、启动锁尚未迁移。
- 密码箱 AI 识别需先在「设置 → AI 配置」中配置接口。
