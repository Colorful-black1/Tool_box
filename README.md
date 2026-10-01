# Tool_box

AI 优先的本地个人工具箱。桌面端采用 **Electron + React 19 + TypeScript**，数据全部留在本机。

## 工具

| 模块 | 说明 |
| --- | --- |
| AI 对话 | 设置页内置 8 家供应商预设（DeepSeek / 智谱 GLM / 小米 MiMo / OpenAI / OpenCode Go / Kimi / 通义千问 / 硅基流动）+ 自定义；**多套配置档案一键切换**，一键「获取模型」下拉选择；LangChain.js 流式对话、多会话、停止生成 |
| 小说阅读 | TXT 导入（UTF-8 / BOM / UTF-16 / GBK 探测）、章节解析、书架分组与排序、三种翻页模式、目录、书内搜索、书签、阅读统计 |
| 密码箱 | 敏感字段 AES-256-GCM 加密落库；固定格式 / AI 识别双通道批量导入；重复检测、拼音分组、字母索引 |
| 记事本 | Markdown 编辑与预览、导入导出 `.md` |

### AI 供应商配置

设置页采用**档案制**：每套档案独立保存供应商、接口地址、模型与 API Key，列表点选即可切换「使用中」的那套，AI 对话与密码箱识别都走当前启用档案。

- 选择内置供应商会自动填入官方端点与推荐模型；下拉里没有的服务商选「自定义」手填 `baseUrl` 即可。
- 点「获取模型」调用供应商的 `GET {baseUrl}/models` 拉取实时列表并以下拉呈现；**拉取失败时自动降级为该供应商的内置推荐模型**并提示原因，不会阻断配置流程。
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
npm install
npm run rebuild       # 重建 better-sqlite3 到 Electron ABI（首次必做）
npm run dev           # 开发模式（Electron 窗口）
npm run build         # 构建主进程 / preload / renderer
npm run preview       # 预览构建产物
npm run pack          # 打包免安装目录（release/win-unpacked，快速验证）
npm run dist          # 打包 Windows 安装包（release/私人百宝箱 Setup x.x.x.exe）
npm run typecheck     # TypeScript 校验
npm run lint          # ESLint
npm run test          # Vitest 单元测试
npm run format        # Prettier
```

## 打包（electron-builder + NSIS）

打包配置在 `package.json` 的 `build` 字段。`npm run pack` / `npm run dist` 都会自动调用 `@electron/rebuild` 把 `better-sqlite3` 重编译到 Electron ABI，无需手动 `npm run rebuild`。

要点：

- `asarUnpack: ["**/*.node"]` —— `better-sqlite3` 的原生二进制不能进 asar，否则运行时报错找不到模块。
- `files` 只收 `out/`、`assets/`、`package.json`；`assets/prompts/password_import.txt` 在运行期通过 `app.getAppPath()` 读取，必须打进包内。
- 应用图标为 `assets/icon.png`（512×512，electron-builder 自动转 `.ico`）。

安装包为 `perMachine: false`（免管理员权限）、`oneClick: false`（带安装向导，可自选安装目录），并创建桌面与开始菜单快捷方式。

### 国内镜像

首次打包需要下载 Electron 运行时与 nsis / winCodeSign / 7-zip 等打包工具，国内网络建议先设置镜像环境变量。

PowerShell（仅当前会话生效）：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

PowerShell（永久生效，需重开终端）：

```powershell
setx ELECTRON_MIRROR "https://npmmirror.com/mirrors/electron/"
setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

cmd：

```cmd
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

bash / Git Bash：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist
```

| 变量 | 作用 |
| --- | --- |
| `ELECTRON_MIRROR` | Electron 运行时二进制（约 130 MB / 次） |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | nsis、winCodeSign、7-zip 等打包工具 |

仅首次打包需要下载，之后走本地缓存（`%LOCALAPPDATA%\electron\Cache`、`%LOCALAPPDATA%\electron-builder\Cache`），清掉缓存才会重新拉取。

## 目录

```text
src/
├── main/                 Electron 主进程
│   ├── index.ts          入口：窗口 + 服务装配
│   ├── ipc/              IPC 注册与入参校验
│   └── services/
│       ├── ai-gateway/   LangChain 流式对话与错误映射
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
| 已复用 | `src/shared/types.ts`（类型 / 供应商预设 / 阅读常量）、`ai-gateway/errors.ts`（错误映射与端点规范化）、`library/` 的章节解析、密码文本解析、拼音首字母 |
| 数据层 | `mobile/src/data/`：`expo-sqlite` + 与桌面端同构的 `MobileStore`；schema 与桌面端逐段对齐（v4，11 张表） |
| 加密 | `expo-crypto` AES-256-GCM + `expo-secure-store` 存主密钥；**密文信封格式与桌面端一致**（`{v,iv,tag,data}`） |
| 需重写 | AI 客户端（自写 SSE，不用 LangChain）、阅读器分页（RN 无 `scrollHeight`）、全部界面 |
| 数据 | **与桌面端各自独立**，主密钥绑定设备，密码箱密文不互通 |

**跨端对齐护栏**（防止两端 schema / 密文格式单边漂移）：

- `desktop-schema.fixture.json` 由真实桌面 `toolbox.db` 导出，`schema.test.ts` 拿它与手机端 DDL 逐表逐列比对。
- `desktop-envelope.fixture.json` 由桌面端 `SafeStorageSecretBox` 真实实现产出，`secret-envelope.test.ts` 验证手机端能解析同一信封。

改动桌面端 schema 或信封格式后，需重新生成这两个 fixture。

```bash
npm run mobile:typecheck   # 手机端类型校验
npm run mobile:bundle     # 跑 Metro 打包，无需真机即可验证跨目录引用
npm run mobile:start      # 启动 Expo Dev Server
```

`shared-bridge.test.ts` 在 vitest 里校验复用面：桌面端若删改某个导出，手机端会立刻失败，而不是等真机运行时才发现。

### 在手机上跑起来

当前进度是 **M0**：只有底部导航与 5 个占位页，**还没有任何可用功能**，数据层与各模块界面在 M1–M5 实现。

1. 手机装 **Expo Go**（应用商店搜 Expo Go）。
2. 手机与电脑连同一个 Wi-Fi。
3. 电脑执行 `npm run mobile:start`，终端会显示二维码。
4. 手机 Expo Go 扫二维码即可。

若 Expo Go 提示「SDK 版本不支持」，说明手机端 Expo Go 版本落后于本项目的 SDK 57，改用自建开发版：`cd mobile && npx expo run:android`（需要 Android Studio + Android SDK + JDK 17）。

### 打包成 APK

两条路，按是否愿意折腾本地环境选：

**A. EAS 云端构建（推荐，无需本地装 Android Studio）**

```bash
cd mobile
npx eas-cli login          # 需要免费 Expo 账号
npx eas-cli build --profile preview --platform android
```

- `preview` profile 用 `distribution: internal` + `buildType: apk`，产出**可直接安装的 APK**，适合自用侧载。
- 构建完成会给一个下载链接，APK 传手机「允许安装未知来源应用」后点击安装即可。
- 首次构建会询问是否在 `app.json` 写入 `extra.eas.projectId`，同意即可。
- `production` profile 产出 AAB，用于 Google Play 上架。

**B. 本地构建（需要 Android Studio + SDK + JDK 17）**

```bash
cd mobile
npx expo prebuild --platform android   # 生成 android/ 原生工程（已生成过可跳过）
npx eas-cli build --profile preview --platform android --local
```

或直接用 Gradle 打 debug 包：`cd android && gradlew.bat assembleDebug`，产物在 `android/app/build/outputs/apk/debug/`。

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

- 桌面端仅 Windows；手机端处于 M1（数据层 + 加密已完成，界面仍是占位页）。
- 手机端与桌面端数据互相独立，密码箱密文不互通（主密钥分属 DPAPI 与系统钥匙串）。
- 安装包未做代码签名，首次安装 Windows SmartScreen 可能提示「未知发布者」。
- 局域网同步、PC 摸鱼（老板键 / 伪装皮肤）、启动锁尚未迁移。
- 密码箱 AI 识别需先在「设置 → AI 配置」中配置接口。