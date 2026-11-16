# 技能与 MCP：本机看板与在线发现

左侧「AI 扩展」下两个只读页面：**技能**看本机装了哪些 Skill、线上还有哪些；**MCP** 看各 Agent 配了哪些服务、线上目录里有什么。
两个页面都不安装、不启停、不改任何 Agent 配置：线上结果只给可复制的命令，由用户自己在终端执行。

## 1. 范围

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 本机技能盘点 | 已实现 | 默认 5 类常用来源；按 `SKILL.md` 的 realpath 归并，标出同名冲突与 Codex 自带项 |
| 自定义扫描路径 | 已实现 | 设置页可添加 `~/` 或绝对路径，写入 `userData/skill-roots.json` |
| 本机 MCP 盘点 | 已实现 | 读 9 类配置文件，9 个来源各自上报状态；只回命令名与变量名 |
| 在线搜技能 | 已实现 | `skills.sh` 匿名检索，返回安装命令 `npx skills add …` |
| 在线搜 MCP | 已实现 | 官方 MCP Registry，返回启动命令与可粘贴的 JSON 片段 |
| 安装 / 卸载 / 启停 | 未实现 | 写入别人家目录，单独评估；本版本一律不写 |
| 技能正文预览、详情抽屉 | 未实现 | 列表已给路径、来源 Agent、描述与内容摘要 |

- 入口：左侧「AI 扩展 → 技能」「AI 扩展 → MCP」，页面标识 `skills` / `mcp`；`Ctrl+K` 也能搜到。
- 只读：不写数据库、不写 `~/.cc-switch`、不改 `~/.claude.json` 或 `config.toml`。
- 网络只在用户点「搜索」时发起，不做后台轮询。

## 2. 本机技能

### 2.1 默认扫描的根（5 类）

| 根 | 归属 Agent | 备注 |
| --- | --- | --- |
| `~/.agents/skills` | 通用目录 | 多数 Agent 的共享根 |
| `~/.claude/skills` | Claude Code | 本机是指向其它目录的符号链接 |
| `~/.codex/skills` | Codex | 同上 |
| `~/.codex/skills/.system` | Codex | 自带技能，单独标「随 Codex 自带」，不算一类来源 |
| `~/.config/opencode/skills`（或 `$XDG_CONFIG_HOME`） | OpenCode | 不存在则跳过 |
| `~/.dsh/skills` | DeepSeek Harness | 本机不存在，按「存在才扫」处理 |

- `~/.cc-switch/skills` **不在默认列表**；需要统计时在「设置 → 技能扫描路径」里添加。
- 只认 `<root>/<目录>/SKILL.md` 这一层，不递归；`.system` 在父根里以 `.` 开头被跳过，避免重复计数。
- frontmatter 至少要有 `name` + `description`，`user-invocable: false` 视为不可见（沿用编程 Agent 的解析器）。
- 上限：单根 300 个目录、全局 600 条、单个 `SKILL.md` 512 KB、只读前 16 KB 解析头。

### 2.2 自定义扫描路径

- 位置：设置页「技能扫描路径」；只管理**额外目录**，默认 5 类来源固定且不可删。
- 输入：`~/...` 或绝对路径（Windows 盘符路径原样保存）；统一把 `\` 换成 `/`，保存为 `~/.cc-switch/skills` 这种形式。
- 校验：路径必须存在且是文件夹、`realpath` 可解析；不能与默认来源重复、不能重复添加，最多 20 条。
- 存储：`userData/skill-roots.json`（`{ version: 1, roots: [...] }`，tmp + rename 原子写）；不进 `toolbox.db`、不进备份。
- 生效：添加/删除后清空扫描缓存；技能页点「刷新」即可看到新目录。
- 目录丢失时列表仍保留并标「路径不存在」，扫描时按 `missing` 跳过，不影响其它来源。

### 2.3 归并与冲突

- 身份是 `realpath(SKILL.md)`：同一个物理目录被链接进多个 Agent 只算一条，`agents` 记录「被哪些 Agent 读取」。
- `root` 显示**物理位置**（例如 `.cc-switch/skills`），不显示链接来源，避免把链接误当成安装位置。
- 同名但物理路径不同 → 两条记录，界面按名称分组并标「同名 N 份 · 内容相同 / 内容不同」。
- 内容摘要只对冲突组计算（`SKILL.md` 的 SHA-256 前 12 位），普通技能不算，避免无谓 IO。
- 指向扫描根之外的软链不列出，也不在页面上提示；需要统计时到设置里添加目录。

## 3. 本机 MCP

### 3.1 读取的配置

| 来源 | 文件 | 解析 |
| --- | --- | --- |
| Claude Code | `~/.claude.json`（全局 `mcpServers` + 每个项目最多 20 个 `projects[dir].mcpServers`） | JSONC |
| Codex | `~/.codex/config.toml` 的 `[mcp_servers.<name>]` 与 `.env` 子表 | 行扫描 |
| OpenCode | `~/.config/opencode/opencode.json[c]` 的 `mcp` | JSONC |
| DSH | `~/.dsh/profiles/{web,desktop}/cordis.patch.yml` 里 `@deepseek-ai/dsh-mcp-client` 插件条目 | 按缩进的行扫描 |
| Claude Desktop | `%APPDATA%/Claude/claude_desktop_config.json` | JSON |
| Gemini CLI | `~/.gemini/settings.json` | JSON |
| Cursor | `~/.cursor/mcp.json` | JSON |
| VS Code | `%APPDATA%/Code/mcp.json` 的 `servers` | JSON |

- 每个文件 2 MB 上限；读不了或解析失败只影响该来源，状态标「配置无法解析」，不当成 0 条。
- 只回可展示字段：名称、transport、可执行名、参数个数、URL 主机、来源文件、enabled、env / headers 的**键名**。
- `env` / `headers` 的**值永远不出主进程**；命令只保留 basename，不暴露完整路径。
- 同名服务出现在多个 Agent 时按名称分组；启动方式（transport / 命令 / 参数数 / 主机）不一致标「启动方式不同」。
- DSH 的 `args` 与 `env` 严格按缩进读，同级键（如 `toolCallTimeoutMs`）不会被误当成环境变量。

## 4. 在线搜技能（skills.sh）

- 端点：`GET https://skills.sh/api/search?q=&limit=&offset=`，匿名可用，12 秒超时，UA 标识应用。
- 官方 v1 API（`/api/v1/skills*`）需要 Vercel OIDC，桌面端不可用；CC Switch 用的也是上面这个匿名端点。
- 约束：`q` 至少 2 个字符；`count` 是本次返回条数而不是总数，翻页只能按「返回数 == limit」判断；不返回描述。
- 只接受 `owner/repo` 形式的来源与 `[A-Za-z0-9._-]` 的技能名，非法条目直接丢弃——命令是拼给用户复制的，不能带转义风险。
- 安装命令固定为 `npx skills add <owner/repo> --skill <skill> -g`（全局安装，由用户自己执行）。
- 失败文案：400 → 关键词太短；429 → 请求过于频繁；网络失败 → 无法连接 skills.sh。

## 5. 在线搜 MCP（官方 Registry）

- 端点：`GET https://registry.modelcontextprotocol.io/v0/servers?search=&limit=&cursor=`，匿名可用，分页用 `metadata.nextCursor`。
- 只取 `_meta` 里 `isLatest !== false` 的条目；`packages[0]` 生成 stdio 命令，`remotes[0]` 生成 http 配置。
- 命令拼接规则：npm → `npx -y <id>@<version>`；pypi → `uvx <id>==<version>`；oci → `docker run -i --rm <id>:<version>`；只有 `runtimeHint` 时用 `runtimeHint`。
- 配置片段是 `{ "mcpServers": { "<短名>": … } }` 的 JSON；必填环境变量留 `<在此填写>` 占位，不猜值。
- 所有拼进命令的片段都要过 `[A-Za-z0-9@._:/-]` 白名单，仓库返回的文本不会被当命令执行。

## 6. 契约与缓存

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `skill-hub:list` | `{ refresh?: boolean }` | `SkillScanResult` |
| `skill-hub:search` | `{ query, limit?, offset? }` | `SkillSearchResult` |
| `skill-hub:roots:list` | — | `SkillRootsView` |
| `skill-hub:roots:add` | `{ path }` | `SkillRootsView` |
| `skill-hub:roots:remove` | `{ path }` | `SkillRootsView` |
| `mcp-hub:list` | `{ refresh?: boolean }` | `McpScanResult` |
| `mcp-hub:search` | `{ query, limit?, cursor? }` | `McpSearchResult` |

- 主进程校验：`query` 2–64 字符（MCP 允许空串表示浏览）、`limit` 1–50、`offset` ≤ 1000、`cursor` ≤ 256、路径 ≤ 1024 字符、布尔字段严格。
- 只接受受管窗口的顶层 frame；错误统一收敛成用户可读文案，不暴露路径与堆栈。
- 缓存：本机扫描内存缓存 60 秒（`refresh` 绕过）；在线结果内存缓存 10 分钟，最多保留 40 组，不落盘。

## 7. 本机实测（2026-11-16）

技能（默认 5 类来源）：

| 指标 | 数值 |
| --- | --- |
| 技能名 | 17 |
| 物理副本 | 18 |
| 同名冲突 | 1 组（`skill-creator`：通用目录 vs Codex 自带） |
| 覆盖 Agent | 通用目录、Codex |

- 默认统计 `.agents` 13 个 + Codex `.system` 5 个；`.claude` / `.codex` / `.opencode` 的 38 个链接指向 `.cc-switch`，不在默认范围内（页面不提示，需要时到设置里添加）。
- 在「设置 → 技能扫描路径」添加 `~/.cc-switch/skills` 后恢复到：**19 个名字 / 33 个副本 / 13 组冲突 / 3 个 Agent**。

MCP：

| 指标 | 数值 |
| --- | --- |
| 配置条数 | 5 |
| 不同服务 | 3 |
| 启动方式冲突 | 1 |

- `playwright` 在 Claude Code、Codex、OpenCode 各有一份（`cmd /c npx` 与 `npx`），标冲突；
- `node_repl` 在 Codex，`blender` 在 DSH desktop profile；
- 本机没有 Claude Desktop / Gemini / Cursor / VS Code 的配置，来源状态显示「未发现」。

## 8. 验证

- `npx vitest run src/main/services/extensions`：5 个文件 / 19 项通过（realpath 归并、同名冲突、`.system`、越界软链、自定义路径、TOML/JSON/DSH 解析、密钥不外泄、搜索映射与错误文案）。
- `node verify/desktop-ui/run.cjs --extensions-only --screenshots`：7 项通过，页面异常 0 项，覆盖冲突徽标、筛选、复制路径、在线搜索翻页、MCP 变量名与禁用态、复制配置、设置页添加/删除路径。
- 真机冒烟：默认 17 / 18 / 1 / 2；添加 `~/.cc-switch/skills` 后 19 / 33 / 13 / 3，与上表一致。
- `npm run typecheck`、`npm run lint -- --ignore-pattern "mobile/**"`、`npm run test -- --exclude "mobile/**"`（169 文件 / 1215 项）均通过。

## 9. 安全边界

| 项 | 规则 |
| --- | --- |
| MCP 密钥 | env / headers 的值不进入视图对象，也不写日志；界面只显示变量名 |
| 路径 | 先 `realpath`，必须落在已登记的根内；拒绝越界软链、非 `SKILL.md` |
| 命令拼接 | 技能来源与名称、MCP 包名与参数全部白名单校验，不把第三方文本当命令 |
| 只读 | 不写任何 Agent 配置、不写 CC Switch 目录、不执行安装；唯一的写入是 Tool_box 自己的 `skill-roots.json` |
| 网络 | 固定域名、HTTPS、12 秒超时、失败降级为可读错误；不做后台轮询 |

## 10. 后续可选项（未排期）

1. **安装 / 卸载 / 启停技能**：要写 `~/.agents/skills` 与各 Agent 目录，需先做备份、原子写与回滚。
2. **MCP 一键写入**：各 Agent 配置格式不同，且要处理用户手填的密钥，风险高于技能安装。
3. **技能详情抽屉**：展示 `SKILL.md` 前 N 行与完整 frontmatter。
4. **项目级扫描**：当前只看全局目录；项目 `.claude/skills` / `.agents/skills` 需要「当前项目」概念。
5. **离线缓存**：在线结果目前只在内存，重启后需要重新搜索。
