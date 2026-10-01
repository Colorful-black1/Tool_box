# AGENTS.md

> 约束所有 AI 代理与人类协作者在本仓库中的行为。
> 技术栈：Electron + electron-vite + React 19 + TypeScript strict + Tailwind + Zustand + LangChain.js + better-sqlite3 + Vitest。
> 详细目录与功能说明见 `README.md`，本文件只讲协作与改动纪律。

---

## 回复约束

每次回复必须以 `(∠・ω＜ )⌒☆` 开头。

## 常用命令

```bash
npm run dev         # 开发模式（Electron 窗口）
npm run build       # 构建 main / preload / renderer
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint（同时覆盖 src 与 mobile）
npm run test        # Vitest 单元测试
npm run rebuild     # 重建 better-sqlite3 到 Electron ABI（改依赖后必做）

npm run mobile:typecheck   # 手机端（Expo）类型校验
npm run mobile:bundle     # 跑 Metro 打包，无需真机即可验证跨目录引用
npm run mobile:start      # 手机端开发（Expo Go 扫码）
```

---

# 工作原则

* 先理解需求和现有代码，再动手；不重新设计已有实现。
* 最小改动：只改与需求直接相关的内容。禁止顺手优化、顺手重构、风格统一、大规模格式化（`npm run format` 会波及全仓库）。
* 保持风格一致：Prettier 无分号、单引号、行宽 100、无尾随逗号。
* 未经授权不改无关文件、不新增第三方依赖。

## 影响分析

以下改动必须在动手前说明影响范围：

* `shared/types.ts` / `shared/bridge.ts` 接口变更
* `shared/ipc-contract.ts` 通道变更
* SQLite 表结构 / schema 版本变更
* 渲染进程安全基线（`contextIsolation` / `sandbox` / `nodeIntegration`）
* 加解密链路变更
* 业务流程变更

## 执行流程

1. 阅读相关代码 → 2. 分析调用链（renderer → preload → ipc → service → store） → 3. 评估影响范围 → 4. 实施 → 5. 验证 → 6. 输出变更说明。

改之前优先读：`shared/types.ts`（契约源头）→ `shared/bridge.ts` + `preload/index.ts`（桥接）→ `ipc/register-ipc.ts`（对应 handler）→ `chat-store/chat-store.ts`（数据层）→ 相关 `*.test.ts` 与调用方组件。禁止在不了解上下文时直接改。

## 输出要求

每次任务完成后说明五项：**改动内容**（哪些文件、什么逻辑）、**改动原因**、**影响范围**、**验证方式**、**潜在风险**（边界场景）。

## 信息不足

需求不明确时，先给默认方案、备选方案与差异分析，再提出关键问题。禁止直接猜测业务逻辑。

---

# 验证与编译策略

编译、测试、`npm run dev` 都是高成本操作，按改动规模评估，禁止无意义编译。

**必须验证**（任一命中）：改主进程服务或 IPC handler / 改数据层或 SQL / 跨进程多模块（shared + preload + renderer）/ 新增类接口类型 / 改依赖版本（改完 `npm run rebuild`）/ 改配置文件（`electron.vite.config.ts`、`tailwind.config.cjs`、`tsconfig.json` 等）/ 改加解密与密钥逻辑 / 改文件 ≥ 5 个 / 改动 ≥ 500 行。

顺序：`npm run typecheck` → `npm run lint` → `npm run test`。

**可跳过**：注释、文档（含本文件）、日志文案、常量描述、类型字段注释、纯样式（`global.css` / Tailwind class）。

**结果说明**：执行了要写明命令、结果、有无警告与失败项；未执行要写「本次修改影响范围有限，未执行编译验证。」

---

# Git 操作规范

## 默认禁止

未经用户明确授权（明确的「可以提交 / 提交吧」等指令）禁止执行：

```bash
git add -A          # 禁止一次性全量暂存，必须显式指定文件
git commit  git commit --amend  git push  git push --force
git reset --hard    # 丢弃工作区改动
git checkout -- .   # 丢弃工作区改动
git clean -fd  git rebase
git stash           # 需先说明原因
```

同样禁止：改 `.gitignore` 让本地产物入库；提交 `node_modules/`、`out/`、`release/`、`.idea/`、`.env` 或任何含密钥的文件；未获授权时建分支、tag、PR；改写已有历史。

## 提交流程

改完先给「改动内容 / 影响范围 / 风险分析 / 验证结果」，用户明确允许后才可提交。

提交前检查：

* `git status` + `git diff` 逐项确认，只暂存本次相关文件
* `git log --oneline -10` 确认历史风格
* 确认无密钥、Token、密码、`.env`、`toolbox.db` 被暂存
* 确认无调试残留（`console.log`、`debugger`、注释掉的死代码）

## Commit 消息规范

**描述一律使用中文**：`type` 用英文关键词，冒号后的 subject 与 body 必须中文。

格式：`<type>(<scope>): <中文描述>`

| type | 场景 | | scope | 场景 |
| --- | --- | --- | --- | --- |
| `feat` | 新功能 | | `chat` `reader` `bookshelf` | 对话 / 阅读器 / 书架 |
| `fix` | 缺陷修复 | | `password` `notes` `stats` | 密码箱 / 记事本 / 统计 |
| `refactor` | 不改行为的重构 | | `settings` `store` `ipc` | 设置 / 状态 / 通道 |
| `perf` | 性能优化 | | `shared` `crypto` `build` | 契约 / 加解密 / 构建 |
| `style` `docs` `test` | 样式 / 文档 / 测试 | | | |
| `refactor!` `feat!` | 破坏性变更，body 须写迁移方式 | | | |

示例：

```text
feat(reader): 补充封面翻页动画与章内比例书签定位
fix(password): 修复主密钥不可用时列表整体解密失败的问题
docs: 补充 better-sqlite3 ABI 重建说明
```

规则：subject 结尾不加句号、50 字以内；一个 commit 只做一件事；破坏性变更 body 写明升级与回滚；涉及数据库变更 body 写明 schema 版本变化与回滚方案。

---

# 安全与风险控制

## 高风险操作（需明确授权）

删除或重置 `toolbox.db`；批量删除数据；覆盖 `ai-settings.json` / `password-master-key.json`；强制推送；物理删除文件、清空表等不可逆操作；关闭或削弱 `contextIsolation` / `nodeIntegration`；修改加密算法或主密钥存储位置（会导致既有密文永久不可解）。

## 敏感信息（禁止输出）

API Key、Token / Secret、密码箱主密钥与密文信封、AccessKey、完整手机号 / 身份证号 / 银行卡号。

## 安全开发规范

**SQL**：一律参数化查询。禁止字符串拼接、动态拼接条件、把用户输入拼进表名 / 列名 / `ORDER BY`。动态排序必须走白名单映射。

**日志与错误**：必须脱敏，禁止记录 API Key（`describeAiError` 已做脱敏，新增错误分支需保持）、密码箱明文、完整密钥信封。`isDecryptable === false` 只展示占位提示，不暴露解密异常细节。

**加密**：敏感字段一律经 `SafeStorageSecretBox`（AES-256-GCM）落库；密钥用 `randomBytes`，IV 每次随机禁止复用；主密钥经 `safeStorage` 封装后落盘，禁止明文写盘或写日志；新增加密字段须考虑旧数据兼容与解密失败降级。

**进程边界**：渲染进程禁止直接访问 Node API，数据只能经 `window.toolbox`；新增能力必须同步改四处（shared 类型 → IPC 通道 → preload 暴露 → renderer 使用）；禁止在渲染进程引入 `fs` / `child_process` / `net`。

---

# 数据库规范

数据层统一在 `src/main/services/chat-store/chat-store.ts`，版本由 `SCHEMA_VERSION` + `user_version` pragma 管理（当前 v3）。

**表结构变更**必须提供：

* 升级脚本：提升 `SCHEMA_VERSION`，按 `current < N` 分段，幂等可重入（`CREATE TABLE IF NOT EXISTS`，`tableColumns` 判存在后再 `ALTER TABLE`）。
* 回滚脚本：降级方式（通常需从备份恢复 `toolbox.db`），并说明旧版本程序能否读取新库。
* 影响说明。

**未经用户同意禁止修改数据库结构。**

**事务**：多表写入包在 `this.db.transaction(...)()` 内；单表单条写入可不包。

**数据删除**：优先归档 / 逻辑删除，谨慎物理删除；需物理删除必须获得明确授权。

---

# 异常处理规范

* 业务异常与系统异常分离：业务异常用 `AiGatewayError` 等显式类型。
* 错误文案面向用户、可读、无内部细节；主进程抛出、preload 透传、渲染层统一收敛。
* 禁止向用户暴露异常栈或 SQL 原文；禁止吞异常（`catch {}` 内必须有注释说明为何可忽略）；禁止用 `any` 绕过类型。
* **流式取消语义**：`AiGateway` 用 `AbortController` 管理运行期请求——用户主动停止发 `stopped` 不报错，其他失败发 `error`，无论成败都必须在 `finally` 清理 `active` 表。

---

# IPC 与接口设计规范

* 接口职责单一、命名清晰、保持向后兼容。
* 通道统一 `域:动作` / `域:子域:动作`，集中在 `shared/ipc-contract.ts`；禁止在业务代码散落字符串字面量；新增事件同时定义在 `CHAT_EVENT` / `WINDOW_EVENT`。
* **参数校验**：所有外部输入统一走 `ipc/validation.ts`（非空、长度上限、枚举范围、数值范围，比例类必须 `requireRatio`，数组逐项校验）。禁止依赖前端校验。
* **响应**：只返回可序列化普通对象，禁止跨 IPC 传类实例 / Buffer / Error 实例；加密字段只传解密结果或脱敏视图（如 `AiConfigView.hasApiKey`）。
* **未经用户同意禁止修改 IPC 协议。**

---

# 类型安全与代码风格

## 命名

| 类型 | 规范 | | 类型 | 规范 |
| --- | --- | --- | --- | --- |
| 组件 / 类 / 接口 / 类型 | PascalCase | | IPC 通道 | kebab 语义（`chat:send`） |
| 函数 / 变量 / 属性 | camelCase | | 数据库列名 | snake_case |
| 常量 | UPPER_SNAKE_CASE | | CSS 类名 | kebab-case |

视图对象后缀约定：`Input`（入参）、`View`（脱敏出参）、`Summary`（聚合摘要）、`Draft`（导入草稿）。

## 分层与依赖方向

```text
renderer-ui → preload bridge → main → services → shared
```

Controller = `ipc/register-ipc.ts` handler；Service = `services/*`；Repository = `ToolboxStore`；Entity / DTO / VO = `shared/types.ts` 的 interface；Enum = union type + 常量数组（`READER_THEMES`、`FONT_OPTIONS`）；Util = `services/library/*`、`renderer/src/lib/*`。禁止反向引用。

## 类型与方法

* 优先具体类型；集合显式标注元素类型；固定选项用 union type + 常量数组，禁止魔法值。
* 外部数据先 `assertObject` / `requireString` 收窄再使用；避免 `any`。
* `tsconfig` 保持 strict，禁止 `@ts-ignore` 绕过。
* 单一职责、高内聚低耦合、可读性优先；避免超长方法（`chat-store.ts` 按业务域分节，新方法归入对应分节）、深层嵌套、重复代码。

## 注释

必须写类 / 接口注释与复杂业务逻辑注释（分页测量、加密信封、迁移分支尤为需要）。避免无意义注释与代码重复的注释；注释与代码矛盾时以代码为准并顺手修正。

---

# 渲染层规范

* 函数式组件 + `JSX.Element` 返回类型，与现有文件保持一致。
* Zustand **按字段订阅**：`useStore((state) => state.foo)`。整店订阅（`useStore((s) => s)`）会让每次 setState 返回新对象，导致依赖它的 `useCallback` / `useEffect` 反复重建并触发渲染循环。
* `useEffect` 必须返回清理函数（事件监听、计时器）；IPC 订阅在 `App.tsx` 统一挂载并统一 dispose。
* 数据加载全部经 `window.toolbox`；`window.toolbox` 未就绪时要有降级提示。
* 样式优先复用 `styles/global.css` 的既有设计系统类（`.btn-ghost`、`.status-banner` 等）。
* 老板键、伪装皮肤、启动锁、局域网同步等可选能力需先确认需求；`shared/constants.ts` 中 `SYNC_*` / `WINDOW_IPC` 是**未实现的遗留常量**，不要当作可用功能。

---

# 手机端规范（`mobile/`）

* React Native + Expo，**独立 npm 包**：依赖装在 `mobile/node_modules`，不接入根 workspaces。
  原因是 workspaces 会重排根 `node_modules`，可能覆盖 `better-sqlite3` 的 Electron ABI 构建。
* **跨目录复用只经 `mobile/src/shared-bridge.ts` 一个文件**。新增复用目标时先确认它没有
  `import 'node:*'` / `'electron'` / `better-sqlite3`；手机端只有这一处允许出现 `../../src`。
* 设计令牌放 `mobile/src/theme.ts`，与 `global.css` 的 `:root` 变量一一对应；改色需两边同步。
* 不把 LangChain 搬进手机端，流式对话用 `expo/fetch`（原生端已装成全局 fetch）自写 SSE 客户端。
* 手机端数据与桌面端互相独立，主密钥绑定设备，密码箱密文不互通 —— 不要在 UI 上暗示可同步。
* 验证跑 `npm run mobile:typecheck` 与 `npm run mobile:bundle`（后者无需真机即可证明跨目录引用能解析）。

---

# 日志规范

| 级别 | 场景 | | 级别 | 场景 |
| --- | --- | --- | --- | --- |
| ERROR | 系统异常 | | INFO | 关键业务 |
| WARN | 潜在风险 | | DEBUG | 调试信息 |

关键业务流程要留可追踪、可排查、可定位的日志；禁止输出密钥与明文密码。

---

# Code Review 检查清单

* 功能是否正确，是否影响现有功能
* 异常场景是否覆盖，`window.toolbox` 未就绪时是否有降级
* 并发：`AiGateway.active` 与流式事件竞态
* 性能：分页测量、搜索结果截断、大列表渲染
* SQL 全参数化；密钥、加密、进程边界无泄漏
* 必要日志与注释是否补充
* `shared/types.ts` / `bridge.ts` / `ipc-contract.ts` / `preload` 四处是否同步
* 是否提供验证方案；是否需同步更新 `README.md`（命令、目录、已知限制）

---

# 红线规则

禁止：擅自修改业务逻辑 / 数据库结构 / IPC 协议；擅自新增第三方依赖；擅自删除代码；**擅自执行 `git commit` / `git push` / `git commit --amend`**；使用英文写 commit 描述；擅自执行不可逆操作；泄露敏感信息；绕过入参校验；绕过加密存储直接落库明文密码；绕过异常处理吞掉错误；修改无关代码；修改同级 `novel_read` 等其他项目。
