# Spec: Tool_box AI Chat MVP

## Objective

构建一个本地优先的 Windows 桌面 AI 对话工具：

- 用户可在设置中配置 OpenAI 兼容接口：`baseUrl`、`model`、`apiKey`。
- 用户可创建、重命名、删除多个会话。
- 用户可发送消息，并看到流式回复。
- 用户可停止生成。
- 应用重启后，AI 配置与会话历史仍然可用。
- API Key 不允许明文落盘，也不允许写入日志。

非目标：生图、Agent、RAG、联网搜索、移动端、云同步、自动更新。

## Tech Stack

- Electron
- electron-vite
- React 19 + TypeScript strict
- Tailwind CSS 3
- Zustand
- LangChain.js：`@langchain/core` + `@langchain/openai`
- better-sqlite3
- Electron safeStorage
- Vitest

## Commands

```bash
npm install
npm run rebuild       # 重建 better-sqlite3 到 Electron ABI
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run format
```

## Project Structure

```text
src/
├── main/                  Electron 主进程
│   ├── index.ts
│   ├── ipc/
│   ├── db/
│   └── services/
│       ├── ai-gateway/
│       └── settings/
├── preload/               contextBridge 安全桥
├── renderer/
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── routes/
│       ├── stores/
│       └── styles/
└── shared/                纯 TS 类型与 IPC 协议
```

## UI Design Tokens

以根目录 `index.html` 设计稿为准：

- 深空底色：`#080b16`
- 玻璃面板：`rgba(20, 26, 48, .72)`
- 金色主色：`#e8c98a`
- 金色弱化：`#b89b62`
- 鎏金描边：`rgba(232, 201, 138, .35)`
- 青色点缀：`#7fe7ff`
- 高亮文本：`#f4eedd`
- 次级文本：`#a9b0c8`
- 弱化文本：`#5d6480`
- 标题字体：Noto Serif SC / Source Han Serif SC / SimSun
- 正文字体：PingFang SC / Microsoft YaHei / Noto Sans SC

## Code Style

- TypeScript strict。
- 组件使用 PascalCase，函数与变量使用 camelCase，常量使用 UPPER_SNAKE_CASE。
- IPC 事件名必须集中在 `shared` 中。
- 主进程持有敏感信息，渲染进程只拿遮蔽后的配置。
- SQL 一律参数化。
- 日志禁止输出 API Key。

示例：

```ts
export async function saveSettings(input: SettingsInput): Promise<SettingsView> {
  const normalized = normalizeSettingsInput(input)
  await settingsService.save(normalized)
  return settingsService.getView()
}
```

## Testing Strategy

- Vitest 覆盖纯逻辑：baseUrl 规范化、错误映射、settings 序列化。
- 主进程服务使用注入依赖，避免测试依赖真实 Electron。
- SQLite 数据层以手动验收为主；如后续引入跨 ABI 测试方案再补自动化。
- UI 首期以 `npm run typecheck`、`npm run build` 和手动验证为主。

## Boundaries

- Always:
  - 校验用户输入。
  - 参数化 SQL。
  - 隐藏 API Key。
  - 提交前跑 typecheck / lint / test。
- Ask first:
  - 新增依赖。
  - 修改数据库结构。
  - 修改 IPC 协议。
  - 引入自动更新或打包发布。
- Never:
  - 明文保存 API Key。
  - 在日志中输出 API Key。
  - 修改同级 `novel_read` 项目。
  - 未经授权执行 git commit / push。

## Success Criteria

- `npm run dev` 可打开桌面窗口。
- 设置页可保存 OpenAI 兼容配置。
- 重启后配置仍在，且 API Key 为密文。
- 可创建、重命名、删除会话。
- 可发送消息并看到流式回复。
- 可停止生成。
- 应用重启后历史会话与消息仍存在。
- `npm run typecheck`、`npm run lint`、`npm run test` 通过。

## Open Questions

- 是否需要默认系统提示词。
- 是否需要在 MVP 中显示 token 用量。
- 是否需要消息重新生成与编辑。
