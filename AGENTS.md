# AGENTS.md

> 约束所有 AI 代理与人类协作者在本仓库中的行为。
> 本文件只讲**协作与改动纪律**；技术栈、常用命令、安装步骤、目录结构、功能与已知限制见
> `README.md`，待办与真机验收清单见 `docs/ROADMAP.md`。

## 适用范围与优先级

冲突时按此顺序取舍：**用户在当前对话中的明确指令 > 本文件的安全红线 > 验证门槛 > 本文件其他条款**。
用户说「跑一下测试」「提交吧」就是当场授权，不需要再确认一次。

本文件点名的类名、函数名、版本号以代码为准，重构重命名后应同步更新对应条目。

## 展示偏好（非工程约束）

每次回复以 `(∠・ω＜ )⌒☆` 开头；这条只影响展示，不参与上面的优先级判断。

---

# 维护范围与当前优先级（2026-10-23 用户确认）

**Tool_box 当前以 PC 桌面端为维护主线，手机端暂停维护。** 后续功能、修复、主题和编程 Agent 均优先服务桌面端（现阶段已验证平台为 Windows）。

* `mobile/` 代码、历史文档和脚本保留；默认不开发、不修复、不升级手机依赖，不安排真机验收、打包或发布。
* 桌面端改 `src/shared/**`、数据库 schema、主题或 Agent 工具时，不再强制同步手机端、更新手机 fixture 或执行 `mobile:*` 验证；手机兼容性不作为桌面交付门槛。
* 不为冻结手机端阻塞桌面工作，也不自动删除手机代码、测试、依赖或用户数据。既有手机测试 / 配置可能因桌面演进失配，需如实记录，不能伪造通过。
* 仅在用户明确要求手机端任务或恢复维护时，重新评估共享接口、schema、加密、依赖和验证范围。手机端历史要求不因桌面改动自动恢复生效。

本节优先于历史规格中的手机同步与验收要求；数据库、IPC、安全、Git 授权及下方验证门槛保持有效。

---

# 工作原则

* 先理解需求和现有代码，再动手；不重新设计已有实现。
* 最小改动：只改与需求直接相关的内容。
* 保持风格一致：Prettier 无分号、单引号、行宽 100、无尾随逗号。
* 未经授权不改无关文件，也不新增第三方依赖；确需新依赖先说明用途与替代方案，等用户同意。
* 多个 agent 并行时不要同时改同一文件或同一模块，先对齐再动手。
* **不要跑 `npm run rebuild`**（原因见 `README.md`）。

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

**完成定义**：改动已落地、受影响的用户路径能走通、五项说明齐全才算完成，改完文件不算。验证方式一栏写实际执行的命令与结果，没执行要写原因。

## 信息不足

需求不明确时，先给默认方案、备选方案与差异分析，再提出关键问题。禁止直接猜测业务逻辑。

---

# 验证与编译策略

目标是用最低成本尽早拿到反馈：能在 1 分钟内给出确定结论的检查默认允许，只有真正昂贵的动作才设门槛。本节优先于其他章节里「必须执行某某命令」的表述；与用户指令冲突时以用户指令为准。

## 默认允许

| 改动 | 执行 |
| --- | --- |
| 任何代码改动 | `npm run typecheck` |
| 改了 `src/**` 的 `.ts` / `.tsx` | 追加受影响用例：`npx vitest run <相关文件>` |
| UI 改动需要目视确认 | `npm run build` + 静态预览截图，或 `npm run dev`（只用于看界面，不等于交付验证） |

## 必须执行

| 触发条件 | 执行 |
| --- | --- |
| 触碰 IPC 契约 / preload / schema / 加解密 / 进程边界 | `npm run typecheck` + `npm run lint -- --ignore-pattern "mobile/**"` + `npm run test -- --exclude "mobile/**"` |
| 用户明确要求验证 | 按用户说的范围执行，不再套用任何门槛 |

## 需用户同意

`npm run dist` / `npm run pack`、全量 `verify/` 端到端脚本、手机端任何命令。只在用户明确要求、或本次任务本身就是发版 / 验收时执行。

## 不触发验证

文档、注释、日志文案、常量描述、类型字段注释、纯样式（`global.css` / Tailwind class）不单独触发编译；样式仍按 UI 章节目视确认。

## 结果说明

执行了要写明命令、结果、失败项与警告；一条都没跑要写「本次修改影响范围有限，未执行编译验证。」并说明理由。
禁止为了让结果变绿去改测试、关规则或吞掉失败。

---

# Git 操作规范

## 默认禁止

未经用户明确授权（明确的「可以提交 / 提交吧」等指令）禁止：

* 暂存与提交：`git add -A`（必须显式指定文件）、`git commit`、`git commit --amend`、`git push`、`git push --force`
* 丢弃工作区改动：`git reset --hard`、`git checkout -- .`、`git clean -fd`
* 改写历史：`git rebase`
* `git stash`（需先说明原因）
* 改 `.gitignore` 让本地产物入库；提交 `node_modules/`、`out/`、`release/`、`.idea/`、`.env` 或任何含密钥的文件；未获授权时建分支、tag、PR。

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
| `style` `docs` `test` | 样式 / 文档 / 测试 | | `agent` `todos` `tools` | 编程 Agent / 待办 / 开发者工具 |
| `refactor!` `feat!` | 破坏性变更，body 须写迁移方式 | | `usage` `search` `backup` | Token 统计 / 全局搜索 / 备份恢复 |

示例：

```text
feat(reader): 补充封面翻页动画与章内比例书签定位
fix(password): 修复主密钥不可用时列表整体解密失败的问题
docs: 补充 better-sqlite3 ABI 重建说明
```

规则：subject 结尾不加句号、50 字以内；一个 commit 只做一件事；破坏性变更 body 写明升级与回滚；涉及数据库变更 body 写明 schema 版本变化与回滚方案。

---

# 安全与风险控制

需要授权的高风险操作集中在文末「红线规则」，本节只讲代码怎么写。

## 敏感信息（禁止输出）

API Key、Token / Secret、密码箱主密钥与密文信封、AccessKey、完整手机号 / 身份证号 / 银行卡号。

## 安全开发规范

**SQL**：一律参数化查询。禁止字符串拼接、动态拼接条件、把用户输入拼进表名 / 列名 / `ORDER BY`。动态排序必须走白名单映射。

**日志与错误**：必须脱敏，禁止记录 API Key（`describeAiError` 已做脱敏，新增错误分支需保持）、密码箱明文、完整密钥信封。`isDecryptable === false` 只展示占位提示，不暴露解密异常细节。

**加密**：敏感字段一律经 `SafeStorageSecretBox`（AES-256-GCM）落库；密钥用 `randomBytes`，IV 每次随机禁止复用；主密钥经 `safeStorage` 封装后落盘，禁止明文写盘或写日志；新增加密字段须考虑旧数据兼容与解密失败降级。

**进程边界**：渲染进程禁止直接访问 Node API，数据只能经 `window.toolbox`；新增能力必须同步改四处（shared 类型 → IPC 通道 → preload 暴露 → renderer 使用）；禁止在渲染进程引入 `fs` / `child_process` / `net`。

---

# 数据库规范

数据层统一在 `src/main/services/chat-store/chat-store.ts`，版本由 `SCHEMA_VERSION` + `user_version` pragma 管理（当前桌面 v5；手机冻结版本不随之更新）。

**表结构变更**必须提供：

* 升级脚本：提升 `SCHEMA_VERSION`，按 `current < N` 分段，幂等可重入（`CREATE TABLE IF NOT EXISTS`，`tableColumns` 判存在后再 `ALTER TABLE`）。
* 回滚脚本：降级方式（通常需从备份恢复 `toolbox.db`），并说明旧版本程序能否读取新库。
* 影响说明。

**未经用户同意禁止修改数据库结构。**

**事务**：多表写入包在 `this.db.transaction(...)()` 内；单表单条写入可不包。

**数据删除**：优先归档 / 逻辑删除，谨慎物理删除；需物理删除必须获得明确授权。

**跨端同步**：手机端暂停维护期间，桌面 schema 可独立演进，不强制改手机 schema 或生成 `desktop-schema.fixture.json`，不承诺两端继续同构。恢复手机维护时再核对版本差异、兼容与迁移；桌面表结构变更仍须用户授权。

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

# UI 风格规范（星轨设计系统）

新增或改造界面必须与现有视觉一致，**外观统一优先于实现便利**。判定标准：放进现有页面里看不出是「外来控件」。

## 令牌与配色

* 颜色、字体一律用 `styles/global.css` 的 `:root` 变量：`--bg-deep` `--bg-panel` `--gold` `--gold-dim` `--gold-line` `--cyan` `--pink` `--text-hi` `--text-mid` `--text-dim` `--serif` `--sans` `--mono`。
* 禁止硬编码十六进制颜色。半透明描边/底纹沿用既有惯用值：`rgba(232, 201, 138, 0.22)`（金线）、`rgba(255, 255, 255, 0.04)`（浅底）、`rgba(14, 18, 34, 0.97)`（弹层底）。
* 深色底 + 金色描边 + 圆角（按钮 9–10px、弹层 10px、卡片 14px）是本项目的基调。

## 组件复用（禁止重复造轮子）

* **原生 `<select>` 只允许用在设置页表单（`.field-select`）**；其余可见交互控件（对话区、工具条、弹层内）一律用 `components/dropdown.tsx` 的 `Dropdown`（对齐 `.sort-menu` / `.ui-dropdown` 范式），因为原生弹层无法跟随深色主题。
* 按钮只用既有类：`.btn-gold`（主操作）、`.btn-ghost`（次操作）、`.btn-danger`（危险）、`.icon-btn`（纯图标）；同一行主次分明，一屏内金色主按钮一般不超过一个。
* 提示/告警用 `.status-banner`（成功加 `.success-banner`）；标签用 `.field-label`，表单控件用 `.field-input` / `.field-select`（设置页专用，非对话区）。
* 图标统一放 `components/icons.tsx`，`svg` 必须 `stroke="currentColor"` + `aria-hidden="true"`，尺寸由容器 CSS 控制，不要内联 `width/height`。
* 弹层（菜单、抽屉、Sheet）沿用既有范式：深色面板、`1px` 金线描边、圆角、`box-shadow: 0 10px 30px rgba(0,0,0,0.5)`、`z-index ≥ 30`；Esc 关闭复用 `lib/use-overlay-dismiss.ts`，点击外部关闭用容器 `ref` + `mousedown` 监听。

## 交互与无障碍

* 可点元素必须是 `<button type="button">` 或带 `role`，禁止用 `<div onClick>`。
* 交互态要齐：`:hover`（提亮/金线）、`:focus`（`outline: none` + 金色描边）、`:disabled`（`opacity: .5` + `cursor: default`）；展开态用 `aria-expanded` 并让 caret 旋转。
* 文案用简体中文；装饰性英文大写小字（如 `STREAMING`）沿用现有 `letter-spacing` 风格，不要自创字号体系。

## 校验方式

* 改样式后至少目视确认：在 1280×820 下与相邻控件对齐、间距、字号、颜色一致；弹层不溢出窗口、不被 `overflow` 裁切。
* 能用 Playwright 起静态预览（`out/renderer` + 桩 `window.toolbox`）截图核对最稳妥；纯样式改动可不跑编译。

---

# 手机端（`mobile/`）

`mobile/` 已冻结，范围见上一节。历史约束全部归档在 [`docs/mobile-frozen.md`](docs/mobile-frozen.md)：跨目录复用、数据层、Agent 工具与设计令牌；恢复维护前先读它，并重新核对 schema、依赖与验证范围。

既有手机测试可能因桌面演进失配：跑不了就说跑不了，不能伪造通过。

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

## 绝对禁止（任何授权都不解除）

* 输出或记录密钥、Token、密码箱明文与密文信封、完整身份证 / 银行卡号
* 明文写盘、写日志、写 IPC，或把凭据放进命令行参数
* 用改测试、关规则、吞异常、伪造日志等方式让结果「变绿」
* `git push --force`、改写已推送的历史
* 修改同级 `novel_read` 等其他项目

## 需用户明确授权

* 修改数据库结构、IPC 协议
* 新增第三方依赖
* 删除或重置用户数据（`toolbox.db`、`ai-settings.json`、`password-master-key.json`、备份目录）：先确认备份可用，并说明哪些内容不可恢复
* 修改加密算法、更换主密钥存储位置，或关闭 / 削弱 `contextIsolation` / `sandbox` / `nodeIntegration`：会让既有密文无法解回或破坏进程边界
* 物理删除文件、清空表、批量删数据等不可逆操作
* `git commit` / `git push` / `git commit --amend` / 建分支、tag、PR
* 改变既有功能的对外行为（正常需求内的实现属于已授权；顺手改行为要单独说明并确认）
