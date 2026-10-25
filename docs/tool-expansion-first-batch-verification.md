# 首批工具与待办提醒交付记录

日期：2026-10-25。依据用户选择及 [规格](SPEC-tool-expansion-first-batch.md) 实施。用户已单独同意待办 schema v5、新增 IPC／通知事件及应用驻留期间提醒的边界。未新增依赖、未改加密、未修改手机端、未暂存或提交。

## 操作步骤

1. 开发工作台 → 工具 → **MyBatis SQL 还原**：粘贴完整 Preparing／Parameters 日志，选择数据库方言，检查结果后复制。可批量处理；缺行、参数类型不支持、同源配对歧义、数量不符会显示对应行错误，不混入成功结果。只还原文本，不执行查询。
2. 工具 → **颜色工具**：输入 HEX／RGB／HSL，自动显示三种格式；另一侧输入背景色，查看两色预览和 WCAG 2.x 对比度。
3. 工具 → **单位与进制换算**：选择类别、源和目标单位，输入数字；下方支持 2–36 进制带符号大整数，输入不带 0x／0b 前缀。KB 与 KiB 分开。
4. 工具 → **时间戳换算**：顶部新增时区区域，选择来源／目标 IANA 时区，输入来源时区的日期时间。夏令时不存在的时间拒绝；重复时间先提示，明确选较早或较晚时刻后再转换。原时间戳功能保留。
5. 个人管理 → **待办清单**：只填标题即可添加；需要提醒时补开始／截止的日期和具体时间，并勾选提醒。可编辑、完成／重开、归档／恢复；按标题／备注搜索，筛选未完成、今日、待开始、逾期、已完成、归档。
6. 点击 **测试通知** 确认系统通知可用。应用关闭窗口后驻留托盘仍可提醒，从托盘退出后不提醒。开始／截止各一次，每 30 秒检查；重启或唤醒后补检，已过截止只补截止，不再同时补开始。点击单条通知定位该事项，多条汇总通知打开清单。

工具均复用现有目录、收藏、最近使用和 Ctrl+K；Ctrl+K 也可执行“切换到待办清单”。计算不联网，待办不默认注册到 AI 工具。编辑中的待办仅在本次运行保留，退出前需保存。

## 主要文件与影响范围

| 文件／目录 | 改动 |
| --- | --- |
| `src/shared/mybatis-sql.ts` | 日志来源配对、参数解析、SQL 引号／注释扫描、方言转义、输入限制 |
| `src/shared/local-converters.ts`、`timezone-tools.ts` | 不透明 sRGB／对比度、单位、BigInt 进制、DST 映射 |
| `components/tools/panels/*`、`registry.tsx` | 新工具与既有时间戳扩展；沿用 Dropdown 和 Workbench |
| `src/shared/types.ts`、`bridge.ts`、`ipc-contract.ts`、`src/preload/index.ts` | 待办 DTO、五个 invoke 通道、一个窗口事件和桥接 |
| `src/main/ipc/validation.ts`、`todos-ipc.ts` | 标题／日期／状态／分页校验，受管窗口及主 frame 校验，错误不返回 SQL 或栈 |
| `src/main/services/chat-store/chat-store.ts` | schema v5、升级前一致备份、参数化待办 SQL、提醒去重状态 |
| `src/main/services/todo-reminder-service.ts` | 有界通知批次、系统显示确认、失败限速重试、退出清理 |
| `src/main/index.ts` | Windows AppUserModelID 对齐安装包 ID，数据初始化失败显示可读提示 |
| `stores/todo-store.ts`、`components/todos/`、`App.tsx`、`shell.tsx`、`icons.tsx` | 待办页面、过期查询防护、草稿保留、集中事件订阅、通知定位和独立导航图标 |
| `styles/global.css` | 复用星轨令牌，1024 宽度仍让列表与编辑区并排可见 |

新增通道：`todos:list`、`todos:save`、`todos:complete`、`todos:archive`、`todos:notification:test`；窗口事件 `todos:event`。通知只含标题，不含备注；单次处理最多 200 项，合并一条通知，避免启动时连续弹窗。列表每页最多 100 条，默认 30 条。

## 数据升级与回滚

- 桌面 schema v4 → v5，新增 `todos` 与两个索引，不改旧表。迁移及 user_version 在事务内，DDL 使用 IF NOT EXISTS；旧版本程序仍可访问原表，但不支持待办。
- 对已有版本的文件数据库，升级前用参数化 `VACUUM INTO ?` 生成含已提交 WAL 数据的一致快照：`backups/toolbox-before-v5-时间戳-随机ID.db`。备份不覆盖已有文件，备份失败停止升级并提示；新空库不生成无意义的升级前备份。
- 回滚由用户手动操作：完全退出所有读写该库的应用；先把当前 `toolbox.db` 及其 `-wal`／`-shm` 文件一起移到独立备份目录，再把选定升级前快照复制为数据目录下的 `toolbox.db`。保持原主密钥文件和数据目录其他文件不变，之后用旧版启动确认。不要把旧 WAL／SHM 留在恢复的快照旁，也不要在应用运行时覆盖数据库。
- 回滚会丢失快照之后的新数据，操作前应保留当前库。实现不会自动执行降级、删表或重置用户数据库。
- 待办与普通笔记同样是本地普通数据，不用于保存秘密。未改密码箱格式、算法、主密钥存放位置或已加密的 Agent 草稿。

## 验证

本次代码增量超过 500 个有效行且代码文件超过 10 个，达到仓库验证门槛；未计入任务开始前已有的 ROADMAP／候选计划改动。

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern "mobile/**"` | 通过，无警告 |
| `npm run test -- --exclude "mobile/**"` | 91 文件、665 测试通过；Node 仍有既有 `--localstorage-file` 参数警告 |
| `npm run build` | 通过，生产 out 已更新；未重新制作安装包 |
| `node verify/todo-store.cjs` | 4 组真实 Electron ABI／SQLite 检查通过：WAL 一致备份、旧数据、提醒状态、筛选分页、时间竞态、重启幂等、备份失败停止升级 |
| `node verify/todo-notification-smoke.cjs` | 当前 Windows 通知接口触发 show，显示一条合成测试提醒；未创建真实待办 |
| `node verify/desktop-ui/run.cjs --tool-expansion-only --screenshots` | 12 项通过、页面异常 0；三主题、1280×820／1024×680、完整退出重启持久化 |
| `node verify/desktop-ui/run.cjs --sidebar-only` | 11 项通过、页面异常 0；新增待办入口与原导航、键盘、窄栏、矮窗和三主题均可用 |

新增单元用例覆盖字符串／注释问号、大整数、日志交错／缺失、颜色边界、绝对零度、DST 缺口和重叠、待办校验、通知显示确认／超时／失败／去重／停止、重复提交和旧查询竞态。UI 完成条目会立即离开未完成列表，脚本按实际列表变化断言，避免继续等待已移除的复选框。

最终静态审查补充“在已完成或搜索筛选中新建待办后回到未完成列表”的回归用例，避免保存成功却看不到新事项；665 项测试和构建覆盖最终代码。

截图位于 `.playwright-mcp/desktop-ui/expansion-*.png`，已目视检查三主题代表图及窄窗口。所有 SQLite／UI 验证使用脚本创建的临时目录，不触碰用户日常数据库；无模型调用、无原生依赖重建、无手机验证。

## 边界与手动验收

- Windows 通知 show 表示系统接受显示，不保证用户看到浮窗；免打扰、通知中心和正式安装环境仍需用户确认。正式安装包提供开始菜单快捷方式；开发／便携运行的表现不代表所有安装环境。
- 时间按本机时区输入、保存具体毫秒时刻。系统时区变化后显示会变化；待办输入中的 DST 缺口／重复时间拒绝，不默猜。时区工具另提供较早／较晚的显式选择。
- 提醒检查允许约 30 秒延迟；应用退出后没有系统计划任务。进程在通知显示和落库标记之间崩溃，可能在下次启动时重复一次。
- MyBatis 日志不是无损序列化协议：SQL 多行被截断、字符串伪装为类型边界、数据库特殊 SQL 模式等可能无法精确重建。必须检查预览；首版不支持 Blob／数组、通用格式化、数据库直连和执行。
- 单位换算最多 12 位有效数字；进制换算仅整数、不支持浮点与前缀；颜色仅不透明 sRGB，不做系统取色或透明混合。
- 待用户确认：真实提醒浮窗与声音、免打扰行为、从托盘驻留收到通知并点击定位、修改开始／截止后的提醒时机。其他候选工具未随本轮扩展。

技术依据：[SQLite 一致备份](https://www.sqlite.org/backup.html)、[Electron 通知接口](https://www.electronjs.org/docs/latest/api/notification)、[Windows 通知安装条件](https://github.com/electron/electron/blob/main/docs/tutorial/notifications.md)。
