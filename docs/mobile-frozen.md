# 手机端历史规范（`mobile/`，已暂停维护）

> 本文件是从 `AGENTS.md` 拆出的归档条款，**仅在用户明确恢复手机端维护时生效**。
> 当前主线是 PC 桌面端（已验证平台 Windows），默认不开发、不升级、不验收、不打包手机端。
> 恢复维护前请重新核对本文每条规则是否仍适用，并继续遵守 `AGENTS.md` 的验证门槛。

## 冻结期规则

- 不因桌面改动 `src/shared/**`、schema、主题或 Agent 工具而启动手机工作。
- 既有手机测试 / 配置可能因桌面演进失配，需如实记录，不能伪造通过。
- 不自动删除手机代码、测试、依赖或用户数据。
- 桌面端可独立演进 schema 与共享接口，不承诺两端继续同构。

## 历史约束

- React Native + Expo，**独立 npm 包**：依赖装在 `mobile/node_modules`，不接入根 workspaces（重排根 `node_modules` 会危及 `better-sqlite3` 的 ABI 构建）。
- **跨目录复用只经 `mobile/src/shared-bridge.ts` 一个文件**，这也是手机端唯一允许出现 `../../src` 的地方；新增复用目标前先确认它没有 `import 'node:*'` / `'electron'` / `better-sqlite3`。
- 数据层在 `mobile/src/data/`：`MobileStore` 历史上对齐桌面端 `ToolboxStore`；恢复维护时重新比对 schema、设计迁移并更新合成 fixture，不能假设冻结期间仍保持一致。
- 依赖原生模块（expo-sqlite / crypto / secure-store）的代码无法在 vitest 中运行，因此要把可测逻辑拆成纯函数（如 `secret-envelope.ts`、`store.ts` 的行映射）。
- 恢复维护后改手机数据层，按验证门槛决定是否运行 `npm run mobile:verify:data`：用 esbuild + Electron 把真实数据层跑在真实 SQLite 与真实 AES-GCM 上（只 shim 三个原生绑定），覆盖 DDL、迁移与全部业务 SQL；当前桌面改动不触发该命令。
- Agent 工具放 `mobile/src/agent/tools/`：**工具名与 risk 分级必须与桌面端一致**（`域_动作`，如 `books_list`），新增前先看桌面端有没有同名实现；工具层**禁止引 zod / langchain**（Metro 只解析 `mobile/node_modules`），入参校验用 `tool-registry.ts` 的手写帮手。
- 写工具必须经过审批门，且只读档位**不下发**写工具；密码箱**不给「保存 / 覆盖」**（覆盖保存会把 `isDecryptable === false` 条目的密文替换成占位文本，见 `docs/ROADMAP.md`），但收藏与删除不经过加解密，可以给。
- 历史复用的**纯逻辑**放 `src/shared/`（无 node / electron / RN 依赖，如 `markdown.ts`、`notes-search.ts`、`reading-stats.ts`、`history.ts`、`book-cover.ts`）：手机端经 `shared-bridge.ts` 再导出，桌面端渲染层可直接 import。桌面改 `src/shared/**` 不再要求手机兼容、适配或验证；桌面进程边界与纯逻辑分层仍须保持。
- `transaction.ts` 单独成文件只为切断原生模块的运行期引用，勿合并回 `database.ts`。
- 手机设计令牌放 `mobile/src/theme.ts`；冻结期间不跟随桌面 `global.css` 配色更新，恢复时再评估主题对齐。
- 不把 LangChain 搬进手机端，流式对话用 `expo/fetch`（原生端已装成全局 fetch）自写 SSE 客户端。
- 手机端数据与桌面端互相独立，主密钥绑定设备，密码箱密文不互通 —— 不要在 UI 上暗示可同步。
- 写文件避免 `Out-File -Encoding utf8`（会加 BOM，`package.json` 带 BOM 会让 Expo 配置解析直接失败）。
- 恢复手机维护且达到验证门槛时，再按范围选择 `npm run mobile:typecheck`、`npm run mobile:bundle` 等验证，不纳入当前桌面默认流程。
