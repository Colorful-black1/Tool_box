# Tool_box

AI 优先的本地个人工具箱。桌面端采用 **Electron + React 19 + TypeScript**，数据全部留在本机。

## 工具

| 模块 | 说明 |
| --- | --- |
| AI 对话 | 用户配置 OpenAI 兼容接口（`baseUrl` / `model` / `apiKey`），LangChain.js 流式对话、多会话、停止生成 |
| 小说阅读 | TXT 导入（UTF-8 / BOM / UTF-16 / GBK 探测）、章节解析、书架分组与排序、三种翻页模式、目录、书内搜索、书签、阅读统计 |
| 密码箱 | 敏感字段 AES-256-GCM 加密落库；固定格式 / AI 识别双通道批量导入；重复检测、拼音分组、字母索引 |
| 记事本 | Markdown 编辑与预览、导入导出 `.md` |

## 技术栈

- Electron + electron-vite
- React 19 + TypeScript strict + Tailwind CSS
- Zustand
- LangChain.js（`@langchain/core` + `@langchain/openai`）
- better-sqlite3（SQLite，schema v3）
- Electron `safeStorage`（Windows DPAPI）保管 AI Key 与密码箱主密钥
- Vitest

## 常用命令

```bash
npm install
npm run rebuild       # 重建 better-sqlite3 到 Electron ABI（首次必做）
npm run dev           # 开发模式（Electron 窗口）
npm run build         # 构建主进程 / preload / renderer
npm run preview       # 预览构建产物
npm run typecheck     # TypeScript 校验
npm run lint          # ESLint
npm run test          # Vitest 单元测试
npm run format        # Prettier
```

## 目录

```text
src/
├── main/                 Electron 主进程
│   ├── index.ts          入口：窗口 + 服务装配
│   ├── ipc/              IPC 注册与入参校验
│   └── services/
│       ├── ai-gateway/   LangChain 流式对话与错误映射
│       ├── chat-store/   统一 SQLite 数据层（v3）
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
```

## 数据表（schema v3）

`conversations`、`messages`、`books`、`chapters`、`reading_progress`、`bookmarks`、`book_groups`、`reading_stats`、`password_entries`、`notes`、`kv`

## 安全说明

- AI `apiKey`：AES-GCM 加密后写入 `ai-settings.json`，主密钥由系统安全区（DPAPI）保管。
- 密码箱：`account` / `password` / `remark` 加密落库，`title` / `url` 明文以便搜索；主密钥绑定本机，整库拷走无法解密。
- 渲染进程无 Node 权限，仅通过 preload 暴露的白名单 IPC 访问数据。

## 已知限制

- 仅 Windows 桌面端；移动端（React Native / Expo）未实现。
- 局域网同步、PC 摸鱼（老板键 / 伪装皮肤）、启动锁尚未迁移。
- 密码箱 AI 识别需先在「设置 → AI 配置」中配置接口。