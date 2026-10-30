# 命令速查交付与验证

日期：2026-10-29

## 交付内容

用户要求先提交现有改动，再实施 [命令速查计划](PLAN-developer-command-library.md)。既有 Agent 工作区与计划已提交为 `6659a21`；下述命令速查改动留在工作区，未追加提交。

- 开发工作台独立「命令速查」入口，Ctrl+K 可搜索打开，页面内 Ctrl+F 聚焦搜索。
- 按标题、命令原文、用途、分类和标签检索，多关键词同时匹配，支持分类、Shell、全部／收藏／我的／归档过滤。
- 50 条内置记录：Docker／Compose 18 条、Linux 16 条、Git 10 条、npm 6 条。标题可展开说明，聚焦标题后上下键移动、Enter 展开。
- 每条结果直接复制，保留多行、首尾空白、缩进和引号；复制成功后才显示反馈。
- 标题、命令为必填，分类默认「其他」。支持个人记录新增编辑、收藏、归档恢复；内置记录只读，可另存为个人命令。
- 编辑时取消、Esc 或点击外部需确认放弃；保存失败保留输入。新旧 revision 冲突时拒绝覆盖，刷新后展示最新记录供核对，再明确采用当前编辑。

不执行命令，不连接远程服务，不读取 shell 历史，不调用 AI；没有新增依赖或手机端改动。

## 实现与影响范围

| 位置 | 内容 |
| --- | --- |
| `src/shared/developer-commands.ts`、`developer-command-presets.ts`、`developer-command-validation.ts` | 类型、稳定内置目录、有界搜索与字段／快照校验 |
| `src/main/services/developer-command-service.ts`、`chat-store/chat-store.ts` | 独立 kv 读改写、revision 冲突与损坏记录保留 |
| `src/shared/bridge.ts`、`ipc-contract.ts`、`src/preload/index.ts` | 四项命令库桥接与通道 |
| `src/main/ipc/developer-commands-ipc.ts`、`validation.ts`、`register-ipc.ts` | 主窗口顶层 frame 校验、入参校验和注册 |
| `src/renderer/src/stores/developer-command-store.ts`、`components/commands/` | 单项写入串行化、过滤、列表、复制和编辑模态框 |
| `App.tsx`、`app-store.ts`、`command-palette.tsx`、`global.css` | 工作台导航、Ctrl+K 入口与三主题样式 |
| 相邻测试、`verify/desktop-ui/`、README 和任务文档 | 异常回归、隔离 SQLite／界面与使用说明 |

复用桌面 schema v5 的 `kv` 表，新键 `developer_commands_v1`，不改表或 user_version。内置内容不重复落库；个人内容和收藏作为版本化文档保存。回到旧应用会忽略此独立键，无需清库或降级。

所有写入先读取并校验原文档，损坏／未知版本不转换为空库；单行参数化 UPSERT 保持写入原子性。个人命令最多 500 条，字段与 2 MiB UTF-8 文档总量同时受限。命令仅作为文本渲染和复制，SQL、日志、shell 均不拼接命令正文。

**既有复制行为修正**：原 `system:copy` 经 `requireString` 会 trim。现改用独立 `validateClipboardText` 保留原文；接口和通道不变，其他功能复制时也保留首尾空白。补充专门校验回归，不改变剪贴板用途或渲染安全设置。

## 内置内容来源与环境边界

依据上游文档整理用途与常用写法，命令未在本机执行：

- [Docker CLI](https://docs.docker.com/reference/cli/docker/) 与 [Compose CLI](https://docs.docker.com/reference/cli/docker/compose/)。
- [GNU Coreutils 官方手册源码](https://github.com/coreutils/coreutils/blob/master/doc/coreutils.texi)、[GNU Grep 用法](https://www.gnu.org/s/grep/manual/html_node/Usage.html)、[GNU Findutils 类型](https://www.gnu.org/software/findutils/manual/html_node/find_html/Type.html)、[GNU Tar 手册](https://www.gnu.org/software/tar/manual/tar.html)。GNU 部分完整页面直读超时，结合官方搜索摘要核对相应基本参数，未对照发行版逐一执行。
- [procps ps](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)、[pgrep](https://gitlab.com/procps-ng/procps/-/raw/master/man/pgrep.1)、[iproute2 ss](https://github.com/iproute2/iproute2/blob/main/man/man8/ss.8)。
- [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)、[journalctl](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)。
- [Git 命令手册](https://git-scm.com/docs)、[npm CLI 手册](https://docs.npmjs.com/cli/v11/commands/)。

Linux 记录标注 Bash，procps、iproute2、systemd 等前提写在用途说明。其他记录标为 Shell 无关，仍需安装对应工具。修改／删除类命令带短标签与注意事项，未增加危险操作执行入口。尖括号参数需用户替换；目录含空格时还需按所在 Shell 正确加引号。

## 验证

本功能相对 `6659a21` 独立统计，仅新增代码文件就超过 10 个、有效行超过 500 行，未计入此前 Agent 改动，满足仓库编译测试门槛。

- `npm run typecheck`：通过。
- `npm run lint -- --ignore-pattern "mobile/**"`：通过。
- `npm run test -- --exclude "mobile/**"`：119 文件、899 项通过；本功能新增 25 项。既有 Node `--localstorage-file` 路径警告仍存在，无测试失败。
- `npm run build`：通过，无构建失败。
- 首次单元测试发现新 store 的运行期 `@shared` 别名在 Vitest 中未配置；改为既有相对导入后重跑通过。
- 初轮界面验收发现已有正文参与 textarea 隐式标签名称，影响精确定位；补充可访问名称。弹层也补充更具体选择器，避免通用抽屉规则覆盖居中布局。
- `node verify/desktop-ui/run.cjs --commands-only --screenshots`：最终 10 项通过、页面异常 0 项；包含 Ctrl+K 入口、用途搜索、原文复制、收藏、编辑取消、保存失败重试、revision 冲突、归档恢复、内置另存、非法输入、标题键盘导航、三主题双尺寸和完整退出重启。补充 Ctrl+K 场景时初次在页面初始化前触发，增加等待主界面就绪后重跑通过。
- `node verify/desktop-ui/run.cjs --sidebar-only`：11 项通过、页面异常 0 项；更新新入口对应数量，保留分组折叠、键盘、搜索导航、全部旧页面、窄栏和三主题。
- 使用临时 userData、真实命令库 IPC 和 SQLite，复制用合成剪贴板；不会修改日常用户库或覆盖系统剪贴板。

单元覆盖目录 ID／参数上限、搜索排序、首尾空白、UTF-8 总量、无效字段、未知版本、悬空收藏、重复 ID、归档保护、旧 revision、磁盘失败、损坏记录、并发 store 写入及 IPC 窗口／frame 边界。

已目视检查 1280×820 纸白列表与 1024×680 编辑器菜单，另有深空／石墨和双尺寸截图。窄窗编辑器内部可滚动，菜单通过现有 Popover 定位并保持在窗口内。

## 风险与后续

- 不承诺不同发行版和 CLI 版本完全一致；复制后仍需核对终端、目录与占位符。
- 内容按普通笔记保存，不用于存储真实凭据；未扩展加密链路。
- 个人条目采用归档恢复，尚无物理删除、导入导出、参数填写器或云同步。
- 损坏记录会阻止写入并保留，不自动修复或覆盖；需另行定位恢复。
- 列表有 500 条个人记录和 2 MiB 文档上限，没有无界导入或虚拟滚动。

## AI 对话新增命令补充（2026-10-30）

用户发现问答能生成命令，但不能保存到速查。现补充 `commands_search` 与 `commands_create`，接入统一 Agent 工厂与权限过滤，复用 `DeveloperCommandService`、目录搜索和字段校验。新增审批显示完整命令、分类、Shell 与说明；只保存个人记录，不覆盖、不执行。审批期间版本变化则拒绝写入，不静默重试；重复的未归档命令不再新建。

更新系统提示和审批卡中文标题。用户可说「把刚才的命令加入命令速查，分类 Linux」；只读档位需先改为写操作确认或完全访问。返回命令速查页面时沿用已有加载流程读取最新内容，没有新增事件、IPC、数据库结构或依赖。

新增回归用例覆盖搜索与归档、只读过滤、完整审批原文、拒绝／停止、并发冲突、重复／非法输入和长搜索结果截断，尚未执行。本次自身改动不足 500 有效行且未超过 10 个文件，按仓库规则只做静态审查。本次修改影响范围有限，未执行编译验证。前述 899 项测试与界面验收属于此前命令速查页面的结果，不代表本补充已经运行验证。
