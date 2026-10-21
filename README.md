# Tool_box

AI 优先的本地个人工具箱。桌面端采用 **Electron + React 19 + TypeScript**，数据全部留在本机。

## 工具

| 模块 | 说明 |
| --- | --- |
| AI 助手 | 设置页内置 8 家供应商预设（DeepSeek / 智谱 GLM / 小米 MiMo / OpenAI / OpenCode Go / Kimi / 通义千问 / 硅基流动）+ 自定义；**多套配置档案一键切换**，一键「获取模型」下拉选择；基于 LangChain.js `createAgent` 的 **Agent，可调用工具接管书架 / 分组 / 书签 / 密码箱 / 记事本 / 统计**；**三档权限（只读 / 写操作确认 / 完全访问）**，写与破坏性操作支持人在环审批；**工具调用不在界面上展示**（查书架、读分组这类是 AI 的后台动作，只有需要你点头的写操作才弹审批卡）；**回答按 Markdown 渲染**（粗体 / 列表 / 代码块 / 链接）；**长对话自动裁剪历史**（超预算时丢弃最早的部分并明确告知模型）；模型下拉**只列你在设置里勾选的模型**（带搜索）；流式输出、多会话、停止生成 |
| 小说阅读 | TXT 导入（UTF-8 / BOM / UTF-16 / GBK 探测）、章节解析、书架分组与排序、三种翻页模式、目录、书内搜索、书签、阅读统计（今日 / 累计 / **任意区间**） |
| 密码箱 | 敏感字段 AES-256-GCM 加密落库；固定格式 / AI 识别双通道批量导入；重复检测、拼音分组、字母索引；**随机密码生成器**（密码学安全随机数 + 拒绝采样，可调长度，带强度评估） |
| 记事本 | Markdown 编辑与预览、导入导出 `.md`；**支持按标题与正文搜索** |
| 开发者工具 | 树形目录下的 **JSON 工具箱、文本 / JSON 差异比较、数据脱敏、Java 日志整理、Prompt 模板库**，以及正则、Base64 / URL、时间戳、哈希、文本清洗、UUID；本机处理，不自动联网。结果可脱敏、填入 Prompt、保存笔记或放入对话草稿；输入输出框自适应高度并支持换行 |
| 编程 Agent | 独立的 **OpenCode 工作台**：复用 Desktop 内置 CLI，选择项目、模型和模式，支持文本回复、工具状态、单次审批、停止和原生会话恢复；Prompt 与工具结果可直接填入编程草稿 |
| 全局搜索 | **⌘K / Ctrl+K** 唤起命令面板：搜书架、记事本（正文也搜）、密码箱、分组、会话，并直接执行命令（切模块、开工具、新建对话）；数据全在内存，输入即出结果 |

### 桌面端常驻与快捷键

- **关闭窗口不退出**：应用缩到系统托盘，随时从托盘唤回；真正退出走托盘菜单的「退出」。
- **全局快捷键**：默认关闭（全局占用快捷键容易和别的程序打架），可在设置页开启并选择组合键
  （Ctrl+Shift+空格 / Ctrl+Shift+K / Ctrl+Alt+T / Alt+空格）；被别的程序占用时会明确提示。
  更换组合注册或保存失败时保留原快捷键；启动注册失败时设置页显示未启用，可重新开启。
- **超宽屏适配**：所有页面（设置 / 工具 / 密码箱 / 记事本）随窗口**铺开伸缩**，不居中也不限宽；
  只给单行输入、结果行这类不该被拉长的控件留了宽度上限。
- **左侧导航栏可折叠**：展开时是「图标 + 文字」的宽栏，点侧栏上方的 chevron 收成纯图标窄栏；
  窗口窄于 1120px 时**自动收成图标**，窗口变宽后恢复你手动的那份状态。

### 开发者工具的输入边界

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

这批工具输入最多 20 万字符，JSON 嵌套最多 64 层、节点最多 4 万；差异较大时文本回退为分段比较，
界面最多显示 500 行；JSON 差异最多 300 项，每项数值/路径仅展示有界预览，截断会明确标注。

模板经现有 kv 的 `promptTemplates` 字段保存，最多 20 个模板，每个正文最多 12000 字符、12 个变量，
保留最近 6 个历史版本，模板与历史总量最多 18 万字符。只保存模板定义，填入的变量值不落盘。
工具临时输入也不自动保存；点击「保存为笔记」会按现有记事本机制保存结果。

推荐流程：日志整理 → 用于脱敏 → 检查预览 → 填入 Prompt（`context` 变量）→ 放入对话草稿。
放入草稿不调用 AI，只有在对话页点击发送后才联网；替换已有草稿前会确认。
模板定义存在未保存修改时，切换模板/工具和通过命令面板跳转会提示。
本轮入口在桌面端，手机端未新增这五项界面。

### OpenCode 编程工作台

首版已在 Windows 的 **OpenCode Desktop 2.1.1** 上验证，无需另装 CLI 或新增 npm 依赖。
自动检测 `%LOCALAPPDATA%/Programs/@opencodedesktop/resources/opencode-cli.exe`，
自定义安装位置可通过「选择程序」指定原生 `opencode-cli.exe` / `opencode.exe`。
其他平台仅提供标准路径尝试和手动选择入口，尚未实机验证。

1. 打开左侧「编程 Agent」，选择项目目录并点击「连接 OpenCode」。
   按钮需检测到运行程序且已选择项目才会启用；灰色时旁边会说明缺少哪一步。
   如程序路径为空，可点击「重新检测」或「选择程序」；无需先打开 OpenCode Desktop 窗口。
2. 连接只创建/准备会话，新会话优先切到 **Plan**；支持的模型、思考强度和模式由 OpenCode 返回。
   连接成功后配置区收起为项目状态栏，点击「连接设置」可展开程序路径和目录；
   工作台把主要空间留给消息，输入框下方集中显示草稿计数与发送 / 停止操作。
3. 直接输入任务，或在 Prompt / JSON / 日志 / 脱敏 / Diff 结果下点击「用于编程 Agent」。
   内容只进入草稿，替换已有草稿前确认；点击「发送给 OpenCode」后才开始请求模型。
4. 需要改文件时可手动选择 **Build**。权限沿用 OpenCode 配置，可能直接执行已获允许的操作；
   出现审批询问时只提供单次允许或拒绝。所选目录不等于操作系统沙箱。
5. 可停止任务、读取当前项目的 OpenCode 历史并恢复；「打开 OpenCode Desktop」保留外部入口。

Tool_box 只保存运行程序和项目路径偏好，不读取或复制 OpenCode 登录凭据，
不将编程会话写入自身聊天表；完整记录由 OpenCode 管理。
模板变量不随模板定义保存，但发送后的内容属于 OpenCode 原生会话，会按其机制保存。
草稿仅在本次应用进程中保留。首次连接需要 OpenCode 支持 ACP v1、配置选项和 Plan 模式。

首版一次运行一个编程任务，每次任务最多 5 万字符；界面单会话最多显示 20 万字符、200 条消息，
最多保留最近 100 项工具状态、同时打开 20 个会话。达到上限会请求停止并提示新建会话。
断连或请求超时不会自动重发任务；需检查 OpenCode 中的实际结果再操作。
本轮不包含 DeepSeek Harness、完整终端/代码编辑器，也未扩展手机端入口。

验证：`node verify/desktop-ui/run.cjs --opencode-only --screenshots` 使用合成桥接，
不启动真实 Agent。`node verify/opencode-smoke.cjs` 复用已安装的桌面内置 CLI，验证握手、
Plan、会话列表和恢复；加 `--prompt` 才发送不读取/修改文件的合成短消息验证真实回复。
实机检查会在 OpenCode 中创建少量验证会话，不删除或覆盖既有会话。规格见 `docs/SPEC-opencode-workbench.md`。

### 桌面交互

- 全局搜索命中笔记后打开编辑页，密码条目打开详情，分组切换到对应书架筛选；加载失败可重试，已删除的目标会提示失效。笔记或密码编辑存在未保存内容时，通过命令面板跳转会先确认。
- 命令面板支持方向键选择并滚入可视区、Tab 保持焦点、Esc 只关闭顶层面板；取消面板后恢复原焦点。全局搜索只索引密码条目的标题与网址。
- 聊天在底部附近自动跟随新消息；向上查看历史后保持阅读位置，可点「回到最新」恢复跟随，切换会话后重新定位到末尾。
- 文本清洗保留原文，把结果放到可复制的输出栏；修改输入后结果按当前操作更新。工作台按可用空间切换并排或上下排列。

### 桌面主题

- 设置页「外观与主题」提供 **星轨深空 / 静夜石墨 / 晨光纸白**，也可跟随系统：深色使用石墨，浅色使用纸白。旧配置默认保持深空主题。
- 选择立即预览并自动保存，重启后恢复；保存失败会恢复上次外观并提示。外观存储在现有 kv 的 `appearance` 字段，首屏只缓存非敏感外观偏好。
- 「星空背景动效」控制深空主题的闪烁与流星；关闭后星点静止，系统启用减少动态效果时也会自动静止。石墨和纸白不显示星空。
- 阅读器的纸张、文字、字号独立设置。手机端沿用默认色板，本轮仅同步辅助文字的对比度，尚未提供主题预设切换。

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
- better-sqlite3（SQLite，schema v4）
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
npm run lint          # ESLint
npm run test          # Vitest 单元测试
npm run format        # Prettier
```

桌面交互验收使用现有 Playwright 与 Electron，临时配置目录和合成桥接数据与日常应用隔离，
不读取真实数据库、不请求 AI、不写系统剪贴板：

```bash
npm run build
node verify/desktop-ui/run.cjs
node verify/desktop-ui/run.cjs --screenshots  # 可选：截图写入 .playwright-mcp/desktop-ui/
node verify/desktop-ui/run.cjs --tools-only --screenshots  # 只验收 Java / AI 首批工具
node verify/desktop-ui/run.cjs --opencode-only --screenshots  # 只验收 OpenCode 工作台
```

覆盖搜索定位与草稿保护、顶层 Esc 与键盘焦点、流式滚动、窗口缩放、文本输出与复制，
以及三套主题、公共文字令牌对比度、系统主题跟随、动效、保存失败、缓存损坏、重启恢复、
阅读器独立配色、Java / AI 工具的精度、流转、失败重试、模板历史与重启恢复，
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
│       ├── chat-store/   统一 SQLite 数据层（v4）
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
mobile/                   React Native + Expo 手机端（独立包，见下）
```

## 手机端（React Native + Expo）

`mobile/` 是独立 npm 包（未接入 workspaces，依赖装在 `mobile/node_modules`），与桌面端**共用仓库根 `src/` 下的纯逻辑**，桌面端代码零改动。

| 项 | 说明 |
| --- | --- |
| 复用方式 | `mobile/metro.config.js` 把 `../src` 纳入 `watchFolders`；所有跨目录引用集中在 `mobile/src/shared-bridge.ts` 一个文件 |
| 已复用 | `src/shared/types.ts`（类型 / 供应商预设 / 阅读常量）、`src/shared/markdown.ts`（Markdown 解析）、`src/shared/notes-search.ts`（笔记搜索）、`src/shared/reading-stats.ts`（区间统计）、`src/shared/history.ts`（对话历史裁剪）、`src/shared/book-cover.ts`（占位封面）、`ai-gateway/errors.ts`（错误映射与端点规范化）、`library/` 的章节解析、密码文本解析、拼音首字母 |
| 数据层 | `mobile/src/data/`：`expo-sqlite` + 与桌面端同构的 `MobileStore`；schema 与桌面端逐段对齐（v4，11 张表） |
| 加密 | `expo-crypto` AES-256-GCM + `expo-secure-store` 存主密钥；**密文信封格式与桌面端一致**（`{v,iv,tag,data}`） |
| AI 助手 | 自写 Agent 循环（不搬 LangChain）：**14 个工具**（12 读 + `notes_save` + `passwords_delete`）；三档权限（只读 / 写操作确认 / 完全访问），写操作在对话页弹审批卡；**工具调用不在界面上展示**（与桌面端一致）；**密码箱不给「保存 / 覆盖」**（会毁掉解密失败条目的原密文），只给收藏与删除 |
| 需重写 | AI 客户端（自写 SSE，不用 LangChain）、Agent 循环与工具层、阅读器分页（RN 无 `scrollHeight`）、全部界面 |
| 数据 | **与桌面端各自独立**，主密钥绑定设备，密码箱密文不互通 |

**跨端对齐护栏**（防止两端 schema / 密文格式单边漂移）：

- `desktop-schema.fixture.json` 由真实桌面 `toolbox.db` 导出，`schema.test.ts` 拿它与手机端 DDL 逐表逐列比对。
- `desktop-envelope.fixture.json` 由桌面端 `SafeStorageSecretBox` 真实实现产出，`secret-envelope.test.ts` 验证手机端能解析同一信封。

改动桌面端 schema 或信封格式后，需重新生成这两个 fixture。

```bash
npm run mobile:typecheck      # 手机端类型校验
npm run mobile:bundle        # 跑 Metro 打包，无需真机即可验证跨目录引用
npm run mobile:verify:data   # 数据层端到端验证（真实 SQLite + 真实 AES-GCM）
npm run mobile:start         # 启动 Expo Dev Server
```

`shared-bridge.test.ts` 在 vitest 里校验复用面：桌面端若删改某个导出，手机端会立刻失败，而不是等真机运行时才发现。

### 数据层验证（为什么需要单独一条命令）

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

### 在手机上跑起来

当前进度是 **M1–M7 代码全部完成，但都还没在真机上验收**（详见 `docs/ROADMAP.md` 第 2 节清单）：5 个 Tab 均有可用界面，AI 助手已能调用工具管理手机本地的书架 / 记事本 / 密码箱 / 统计；阅读器支持书内全文搜索，记事本支持搜索 / Markdown 预览 / 导入导出。

1. 手机装 **Expo Go**（应用商店搜 Expo Go）。
2. 手机与电脑连同一个 Wi-Fi。
3. 电脑执行 `npm run mobile:start`，终端会显示二维码。
4. 手机 Expo Go 扫二维码即可。

若 Expo Go 提示「SDK 版本不支持」，说明手机端 Expo Go 版本落后于本项目的 SDK 57，改用自建开发版：`cd mobile && npx expo run:android`（需要 Android Studio + Android SDK + JDK 17）。

### 打包成 APK

一条命令出安装包（本地 Gradle，release，仅 arm64-v8a）：

```bash
npm run android:apk --prefix mobile   # → mobile/android/app/build/outputs/apk/release/
```

- 前置（仅首次或改过 `app.json` 时）：`cd mobile && npx expo prebuild --platform android` 生成 `android/` 原生工程（已生成可跳过）。
- 环境：Android Studio + Android SDK + JDK 17，并设好 `ANDROID_HOME` / `JAVA_HOME`（环境变量是终端级的，设完需重开终端）。
- 安装：`adb install -r <上面的 apk>`。

> `android/` 是生成目录，已在 `.gitignore` 中，改 `app.json` 后需重新 `expo prebuild` 让原生配置同步。

**iOS 说明**：只能在 macOS 上构建，且上架 App Store 需要付费的 Apple 开发者账号。纯自用可走 TestFlight 或 Ad Hoc 侧载。

## 数据表（schema v4）

`conversations`、`messages`、`books`、`chapters`、`reading_progress`、`bookmarks`、`book_groups`、`reading_stats`、`password_entries`、`notes`、`kv`

封面与背景图片只在库里存 `covers/`、`backgrounds/` 下的**文件名**，绝对路径在运行期按 userData 目录还原 —— 换机或目录搬迁后不会失效。

## 安全说明

- AI `apiKey`：AES-GCM 加密后写入 `ai-settings.json`，主密钥由系统安全区（DPAPI）保管；多套档案各自独立加密，渲染层只能读到 `hasApiKey` 布尔值。
- 密码箱：`account` / `password` / `remark` 加密落库，`title` / `url` 明文以便搜索；主密钥绑定本机，整库拷走无法解密。
- 渲染进程无 Node 权限，仅通过 preload 暴露的白名单 IPC 访问数据。

## 已知限制

- 桌面端仅 Windows；手机端 M1–M6 代码完成，但**从未在真机上验收过**（`expo-sqlite` / `expo-crypto` / `expo-secure-store` 三个原生模块只在与真机同构的 Node 环境里验证过）。
- 手机端的 AI 助手只能操作**手机本地**数据（书架 / 记事本 / 密码箱 / 统计），看不到也改不了电脑上的数据。
- 手机端与桌面端数据互相独立，密码箱密文不互通（主密钥分属 DPAPI 与系统钥匙串）。
- 安装包未做代码签名，首次安装 Windows SmartScreen 可能提示「未知发布者」。
- 局域网同步、PC 摸鱼（老板键 / 伪装皮肤）、启动锁尚未迁移。
- 密码箱 AI 识别需先在「设置 → AI 配置」中配置接口。
