# 本地 Agent Token 统计交付记录

日期：2026-10-24。Windows 桌面端，手机保持暂停维护。

## 2026-10-24 优化轮（本轮）

用户确认参考 CC Switch 的用量看板优化展示，但维持「不做价格表、不做费用估算」的边界，只额外显示
OpenCode 原生上报的单条 `cost`。本轮未改 `toolbox.db`、IPC 通道、加密或渲染安全基线。

参考方式：只读查看本机 CC Switch 4.0.16 的数据库结构与看板信息组织（KPI、按 Agent / 模型趋势、
请求明细、单文件同步状态），只借鉴展示与交互，不复制其代理、价格表、SQLite 统计库或采集实现；
未修改 CC Switch 的任何文件或数据。

### 修复的数据问题

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| OpenCode 新版 `session_message.data.model` 是对象，SQL 取 `$.model.modelID` 得到整段 JSON | 明细「模型」列被 JSON 撑开、模型筛选与排行失效 | 改取 `$.model.id`，并保留旧字段回退 |
| OpenCode 推算总量未含缓存写入，且「有缓存写入就标不完整」 | 无原生 total 的 v2 记录少计缓存写入，页面常驻「部分可用」 | 推算时计入缓存写入；移除误报；空 usage 消息不产生记录 |
| OpenAI 系 provider 的推理已包含在输出 | 缺原生 total 时会把推理重复加进总量 | 按 provider 区分推理语义；有原生 total 时始终优先使用 |
| WorkBuddy 只读下划线 `input_tokens_details` / `output_tokens_details` | 本机 192 条记录的输入、缓存、推理全为 null，来源一直「部分可用」 | 同时兼容驼峰与下划线字段；本机来源恢复为「已读取」 |
| 趋势图按「有记录的日期」取 7 / 30 / 90 条 | 历史有间断时 30 天会跨出自然日窗口，合计大于 KPI | 改为按自然日窗口截取，与「近 N 天」共用日历边界 |

本机只读扫描结果（不输出正文、项目或会话）：Codex 233、OpenCode 5030、Claude Code 1、
WorkBuddy 192、DeepSeek Harness 688、ZCode 939，全部 `ready`；扫描耗时约 671ms。

### 展示与性能调整

- 指标卡：总 Token、请求数、会话数、缓存命中率、缓存写入、推理；有原生花费时增加「原生上报花费」，
  并显示上报条数 / 总条数。
- 趋势：按 Agent 堆叠，支持 7 / 30 / 90 天；不受日期范围限制，但受 Agent / 项目 / 模型筛选影响。
- 排行：按模型、按项目 Top 8，可点击转为筛选条件。
- 明细：支持服务端排序（时间 / 各 Token 字段 / 花费）、粘性表头、会话详情抽屉、CSV 导出（最多 50,000 行）。
- 来源管理：有数据 / 异常来源置顶，未发现来源收进折叠区；显示记录数与耗时，支持单来源重扫。
- 周期与筛选（含排序）写入 `localStorage`，换页返回后保留。
- 统计缓存落到应用数据目录 `agent-usage-cache.json`（版本 1、原子写、0600、只含 Token 元数据）；
  启动先展示上次结果，再按需增量扫描。缓存损坏、版本不符或超限时静默回退到重新扫描。
- 单来源重扫只扫描该来源；页面可见时每 60 秒检查一次，不再每次强制全量扫描。

### 本轮验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern "mobile/**"` | 通过，0 警告 |
| `npm run test -- --exclude "mobile/**"` | 74 个文件、599 项通过 |
| `npm run build` | main / preload / renderer 通过 |
| `node verify/agent-usage-smoke.cjs` | 6 类实际来源全部 ready；缓存查询一致；仅只读 |
| `node verify/desktop-ui/run.cjs --agent-usage-only --screenshots` | 10 项通过，0 页面异常；三主题 × 1280 / 1024 |
| 缓存回读（本机 7,105 条记录 / 2.46 MB） | 45 ms，总量与重新扫描一致；全量扫描 681 ms |

新增用例覆盖：`model.id` 与花费投影、缓存写入计入推算总量、OpenAI 推理语义、空 usage 跳过、
WorkBuddy 驼峰明细、花费覆盖度、趋势与日期筛选隔离、排序与导出上限、缓存读写 / 版本 / 损坏 / 超限、
单来源重扫与缓存恢复。

### 边界与未验证项

- 原生花费只有 OpenCode 提供；其它来源显示「未上报」，不做价格表或估算，也不能把已知花费当成全部费用。
- 趋势按自然日窗口（7 / 30 / 90 天）截取，与「近 N 天」使用同一日历边界；只为有记录的日期画柱，
  不为空白日补零。趋势最多保留最近 90 个有记录的日期。
- Codex 累计补差记录仍没有时间和模型，累计视图会提示字段不完整；不伪造每日或模型用量。
- CSV 导出按当前筛选分页取数，最多 50,000 行，超过时需缩小范围。
- 缓存只保存 Client、会话 ID、项目路径、模型、Token 与原生花费；不保存正文、标题、凭据。
- 统计缓存上限 64 MB / 200,000 条记录，超限时放弃写入并回退到重新扫描，不截断历史。
- 未实现按字节偏移尾读（CC Switch 的 `session_log_sync` 模式）；当前以文件指纹缓存整份替换，
  本机全量扫描约 681 ms、缓存回读约 45 ms，先以可接受的复杂度交付。
- 本轮未新增第三方依赖；未执行 rebuild / dev / 打包。

## 使用方式与交付

打开「开发工作台 → Token 统计」，自动扫描已知本地目录；也可通过 Ctrl+K 搜索 Token 统计。
支持今日、本月、累计、自定义日期，以及 Agent / 项目 / 模型筛选；每日趋势可点日期，会话按模型拆分并分页。
输入显示未缓存输入，另列输出、缓存读取 / 写入和推理；总量按各来源的原生语义计算，不把缓存和已包含的推理再次相加。
未知显示为未知，来源不完整显示提示。不存在价格表、费用估算、余额查询或付费模型请求。

「数据来源」区分已读取、部分可用、读取失败、未发现和暂无用量；允许选择目录 / 数据库并恢复自动发现。
来源路径保存在应用数据目录的 `agent-usage-sources.json`，原有 AI 配置、原生 Agent 配置和 toolbox.db 不变。
统计缓存仅在内存，退出后重新扫描；页面显示时每 60 秒刷新，隐藏 / 离开后停止周期扫描。
不变文件使用元数据缓存，变化文件重新解析并替换整份文件快照；目前不是按字节偏移尾读。

## 数据源与验证等级

参考 TokLens 本地源码的采集规则、Token 语义和测试边界，使用本项目的 TypeScript / Electron 实现，未修改参考项目。

| 来源 | 已实现的读取范围 | 本轮证据 |
| --- | --- | --- |
| Codex | CODEX_HOME 下 sessions / archived_sessions 的 JSONL；新版 token_usage_record、旧 token_count、累计补差 | 本机只读采集及合成用例通过 |
| OpenCode | OPENCODE_DB 或 `.local/share/opencode/opencode.db`，message / session_message；新旧表会话镜像只选一套 | 本机只读采集、SQLite / 活动 WAL 用例通过，部分字段缺失会显示部分可用 |
| Claude Code | CLAUDE_CONFIG_DIR/projects 或 `.claude/projects`，assistant usage，按原生消息身份去重 | 本机已存记录只读采集、流式与副本用例通过 |
| Kimi Code | `.kimi/sessions` / `.kimi-code/sessions` 的 wire.jsonl，协议 1.1 / 1.4 / 1.5；支持 KIMI_CODE_HOME | 合成新旧协议、去重与未知协议用例通过；本机未发现来源 |
| Pi | `.pi/agent/sessions` / `.pi-desktop/sessions`；嵌套 message usage、旧 meta usage、操作去重和聚合补差；支持 PI_DESKTOP_SESSIONS_DIR | 合成 CLI / Desktop 形状及操作聚合用例通过；本机未发现来源 |
| WorkBuddy | WORKBUDDY_CONFIG_DIR/projects 或 `.workbuddy/projects` 的用量 JSONL | 本机只读采集及合成用例通过，部分字段缺失会显示部分可用 |
| DeepSeek Harness / DSH | `.dsh/sessions`，v0–v4 明文与追加式 Zstandard 连续帧，继承段排除与重试归并 | 本机已保存记录只读采集；多帧、任意拆包、截断帧和继承 / 重试用例通过 |
| ZCode | `.zcode/cli/db/db.sqlite` 的 model_usage 请求表，关联项目；不叠加 turn_usage | 本机确认 schema 并采集；请求与汇总去重、只读用例通过 |
| Gemini CLI | `.gemini/tmp/*/chats` 中 JSON / JSONL，$set 替换与 $rewindTo；GEMINI_CLI_HOME 按上层 HOME 解释 | 合成 journal / JSON、缓存与推理用例通过；本机未发现来源 |
| GitHub Copilot CLI | `.copilot/session-store.db` 的 assistant_usage_events；支持 COPILOT_HOME | 合成 SQLite、缓存语义、UTC 时间用例通过；本机未发现该数据库 |
| Grok CLI | GROK_HOME/sessions 或 `.grok/sessions` 中 usage.json，逐轮优先，只有累计时不伪造日期 | 合成快照用例通过；本机未发现来源 |
| MiMoCode | XDG_DATA_HOME/mimocode/mimocode.db 或 MIMOCODE_DB，请求明细，排除已登记的外部导入消息 | 合成 SQLite 和导入后继续请求用例通过；本机未发现来源 |
| MCode | MINIMAX_DATA_DIR / MAVIS_DATA_DIR 或 `.minimax` 下 v2/sqlite/runtime-state.sqlite | 合成原生请求表用例通过；本机未发现来源，非零推理关系未确认时标记不完整 |
| Cline CLI | CLINE_SESSION_DATA_DIR 或 `.cline/data/sessions` 下 `.messages.json` 的 metrics；支持 CLINE_DATA_DIR / CLINE_DIR | 合成消息用量用例通过；本机未发现来源，不代表覆盖 VS Code 扩展的所有存储布局 |

本机只读 smoke 发现 6 类实际来源；采集时没有启动 Agent、连接原生运行时或发送模型请求。
smoke 仅输出来源状态和记录数量，不输出 Token 数值、项目、模型、正文或认证信息。
这不是对各原生应用界面总量的逐项对账，也不承诺不同版本 / 已清理的历史完整可恢复。

## 统计一致性与安全

- 同一原生请求的流式重复、日志副本、归档与可定位的继承记录去重；数据库新旧会话镜像不叠加。
- Codex 新旧事件共存优先请求明细，原生累计只补缺失差值。补差时间、模型无法确认时保持未知，仅纳入累计。
- Pi 聚合与操作明细不相加；聚合已知总量超过现存操作时只补差值，并标明不完整，不虚构请求数。
- Claude 的缓存属于独立输入桶；Codex / WorkBuddy 等输入中包含缓存；OpenCode 推理与输出独立。字段关系逐来源明确处理。
- 缺失不计为零，负数 / 非整数 / 超出安全整数范围不冒充有效计数；来源错误不阻塞其他工具。
- 只读 SQLite 事务读取已提交的主库与 WAL；不执行原生数据库迁移、写查询或清理。
- 只缓存统计元数据，JSONL 正文仅在单行解析期间短暂存在；SQLite 在 SQL 中仅投影所需字段，不取认证表和原始请求正文。
- JSONL 末尾半行延后，文件变化或锁定时显示不完整 / 失败；不跟随扫描入口和子项的符号链接。
- 当前上限：目录深度 10、单根发现文件数 30,000、单文件 / 解压输出 256 MiB、单行 8 MiB、JSON 32 MiB、单压缩帧 32 MiB；达到限制会报告来源问题，不能视为完整统计。
- IPC 仅接受受管窗口顶层 frame，筛选参数在主进程校验；路径只由原生文件选择器提供。来源配置写入串行，刷新请求合并。

## 验证与范围

本轮新增 / 修改的代码跨 shared / preload / IPC / 采集器 / 统计页面 / 测试及验收脚本，独立超过 500 有效代码行和 10 个文件。
未把上轮已提交工作或方案文档计入门槛，因此允许执行桌面验证。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern "mobile/**"` | 通过，0 警告 |
| `npm run test -- --exclude "mobile/**"` | 71 个文件、575 项通过 |
| `npm run build` | main / preload / renderer 通过 |
| `node verify/agent-usage-smoke.cjs` | 本机 14 类来源检查、6 类有实际记录、缓存查询一致性通过；仅只读 |
| `node verify/desktop-ui/run.cjs --agent-usage-only --screenshots` | 最终构建 7 项通过，0 页面异常 |
| `node verify/desktop-ui/run.cjs --sidebar-only` | 11 项通过，0 页面异常；包含新增入口、折叠 / 窄栏、三种主题 |
| `node verify/desktop-ui/run.cjs --coding-agents-only` | 12 项通过，0 页面异常 |

用例覆盖计数关系、累计重置 / 补差、流式 / 副本去重、继承与重试、导入镜像、日期边界、未知值、分页、文件追加 / 截断 / 删除、半行、损坏记录、活动 WAL、只读性、受管窗口、错误脱敏、刷新合并与来源设置失败恢复。
界面使用临时 profile 和合成桥接，三主题 1280×820 / 1024×680，已目视检查深空宽窗与纸白窄窗；截图在忽略目录 `.playwright-mcp/desktop-ui/`。

最终检查均通过。中途类型、lint 和验收失败已定位并修正；静态差异检查未发现空白错误、调试残留或高置信密钥模式。
不运行 rebuild、dev、打包或手机命令，无新增第三方依赖、业务数据库 schema、加密或渲染进程安全基线修改。
新增 3 个统计 IPC（查询、选择来源、恢复自动）及对应 bridge / preload；既有聊天运行时与协议行为保持原范围。

## 潜在边界与手动验收

本地记录可能缺失、被裁剪或字段不完整；来源内部格式升级需要维护适配器，不能由日志统计推算订阅额度。
未适配的旧数据库 schema 会提示读取失败，路径存在但无用量不会伪装成已安装 / 已消费。
统计不区分所有工具的账户 / 供应商历史；模型直接使用原始标识，不维护外部模型列表。
超大变化日志当前需要整份重读，达到读取上限会提示，后续可按实际数据量评估偏移缓存或后台线程。
来源路径可持久保存，统计本身不持久化；首次启动的历史扫描成本取决于日志大小。
打开统计 → 切换累计及日期 → 按模型筛选 → 查看明细 → 数据来源选择 / 恢复 → 重启确认路径保存；
未安装工具安装并产生日志后需对真实版本逐项验收，不以合成样本替代。

## 今日持续不完整提示修复（2026-10-30）

只读检查安装版与开发版统计缓存，Codex 来源均为 partial，而缓存内记录没有字段缺失或单行解析问题；今日只有 OpenCode 的已缓存记录。随后仅检查 Codex 日志的行长度和根头部元数据，发现一条 8,668,545 字节的完整 `compacted` 记录，超过原 8 MiB 单行上限。旧逻辑在这一行尚未遇到换行时抛错，整份文件无法提交新快照，反复沿用旧数据，导致来源持续 partial，并通过来源状态影响「今日」提示。

修复 `scanner.ts`：超大行不再终止整份文件，以有界缓冲跳过本行并继续读取。只对 Codex 明确的 `compacted`／`response_item` 非统计正文免除缺失告警，且要求在 4096 字符内能解析完整根头部；不从嵌套正文猜测类型。未知／用量／无法识别的超大行仍标记不完整，前后已提交的有效用量保留。超大尾行尚未换行时延后判定。文件总量上限、指纹稳定检查、字段缺失告警和今日日期过滤均保持。

未改数据库、IPC、缓存结构或用户原始日志，未删除／重写日常缓存。现有旧快照指纹仍早于失败文件，更新代码后手动刷新会重新解析该文件。新增回归用例涵盖已缓存文件后追加超大压缩／消息正文、未知超大行、嵌套 type 伪装与未提交超大尾行，尚未执行。

本轮仅修改采集器、相邻测试与本文档，未满足仓库编译测试门槛。本次修改影响范围有限，未执行编译验证。已完成只读元数据排查、调用链和差异静态审查；实际更新后需按 F5 确认 Codex 今日用量恢复及提示状态，其他真实异常仍会提示。

### 页面提示调整（2026-10-30）

按用户要求移除统计主页的「部分来源或字段不完整，以下为已知用量」常驻横幅。只改 `agent-usage-page.tsx` 的提示展示，数据来源入口及其状态／详情、明细完整性标记、统计数据与计算逻辑保留。此前确认的压缩请求用量仍通过独立 `token_usage_record` 统计，不按压缩快照正文重复累加。该展示调整已做静态差异检查，本次修改影响范围有限，未执行编译验证，未提交 Git。
