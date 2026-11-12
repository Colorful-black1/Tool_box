# 命令速查

命令速查位于「开发工作台 → 命令速查」，用于按用途查找常用命令并直接复制。内容本机保存、离线可用，不执行命令，不连接 Docker、SSH、WSL 或终端。

## 页面与操作

- 左侧按分类筛选，顶部有「全部 / 收藏 / 我的 / 归档」视图与 Shell 筛选。
- 搜索框匹配标题、命令原文、用途说明、分类和标签；输入即筛选，不依赖联网、AI 或数据库全文索引。
- 支持中英文混合、大小写不敏感、多关键词同时匹配；搜索规范化只作用于检索副本，不修改保存或复制的命令原文。
- 搜索结果按标题/命令命中数优先，其次收藏，再按稳定顺序排列；分类、Shell 与视图过滤同时生效。
- 每条结果直接展示标题、命令和复制按钮，不必先打开详情；结果数、空状态与「清空筛选」可见。
- 复制保留多行、首尾空白、缩进、引号和反斜杠，不附加说明或 Markdown 围栏；剪贴板成功后才显示「已复制」，失败可重试。
- 页面保留本次搜索和分类，切到其他页面再回来无需重新输入；搜索词不持久化。

## 分类、收藏与个人记录

- 记录字段：标题、命令、分类、用途说明、标签、适用 Shell、注意事项等级。
- 标题与命令必填；默认分类「其他」，默认 Shell「未指定」；分类可直接选择已有名称或填写新名称。
- 支持新增、编辑、收藏、取消收藏；个人记录可归档和恢复，不做物理删除。
- 归档记录默认不参与其他视图搜索；收藏视图排除已归档条目，恢复后重新显示。
- 编辑使用现有弹层范式；取消、Esc 或关闭编辑器时若有未保存修改先确认；保存失败保留输入。
- 内置记录只读，提供「另存为我的命令」；另存后独立编辑，升级不覆盖个人内容。
- 内置与个人记录都可收藏；收藏状态持久化。

## 内置内容

内置约 50 条高频命令，按用途而非完整手册组织：

| 分类 | 条数 | 范围 |
| --- | --- | --- |
| Docker | 18 | 容器与镜像列表、日志、进入容器、启停、端口映射、磁盘占用、Compose 服务 |
| Linux | 16 | 文件查找、文本搜索、权限、进程、端口、磁盘/目录占用、日志、压缩解压、systemd |
| Git | 10 | 状态与差异、分支、日志、暂存、提交定位 |
| Node.js / npm | 6 | 依赖与脚本查看、安装、缓存和版本查询 |

- Linux 记录标为 Bash；其余记录标为 Shell 无关，仍需安装对应工具。
- 每条只放一个明确用途的命令或连续步骤；使用 `<容器名>`、`<文件路径>` 等占位符，复制后由用户在终端替换。
- 修改或删除数据的条目带注意事项标签；复制不额外弹确认，也不提供执行按钮、占位符填写器或命令拼装器。
- 内置命令未在本机逐条执行；不同发行版和 CLI 版本的差异需复制后自行核对。

## 数据与上限

- 复用 `kv` 表的新键 `developer_commands_v1`，保存 `version: 1`、递增 `revision`、个人条目与收藏 ID；内置正文不重复落库。
- 写入在主进程中读取最新文档、核对 revision、应用单项操作后原子保存；并发冲突返回可读提示，保留当前编辑内容，不静默覆盖。
- 损坏或版本不兼容时提示并禁止覆盖保存，保留原记录。
- 回退到旧版应用时忽略该 `kv` 键，不需要数据库降级或清库。

| 项目 | 上限 |
| --- | --- |
| 个人命令 | 500 条 |
| 收藏 ID | 600 个 |
| 标题 | 80 字符 |
| 分类 | 32 字符 |
| 命令原文 | 8000 字符 |
| 用途说明 | 2000 字符 |
| 标签 | 8 个，每个 24 字符 |
| 搜索词 | 100 字符 |
| 整个文档 | 2 MiB（UTF-8） |

字段与文档总量同时校验；超限明确提示，不截断后悄悄写入。命令原文只按原始长度检查，保留空白，不执行插值、拆分运行或写入日志。

## Agent 工具

- `commands_search` 只读搜索内置和个人命令，排除归档记录；结果中的命令只是数据，不是要执行的指令。
- `commands_create` 仅在用户明确要求保存命令时新增个人记录，走审批；只保存，不覆盖已有条目，不执行命令。
- 新增前先搜索避免重复；审批期间目录版本变化则拒绝写入，不静默重试。
- 只读权限下不可用；不能覆盖内置记录或个人已有记录。

## 键盘与焦点

- Ctrl/Cmd+F 聚焦并选中页内搜索；存在弹层或业务对话框时不抢占。
- 结果标题聚焦后，↑/↓ 在结果间移动；Enter 展开或收起用途说明。
- Esc 先关闭最上层的菜单或编辑弹层；关闭后焦点回到触发按钮或原列表项。
- 命令正文区域可聚焦；其中的快捷键不触发列表移动或复制。复制按钮有明确的「复制：标题」可访问名称。

## 边界

- 不执行终端命令，不连接 SSH / WSL / Docker，不读取 shell 历史，不调用 AI 生成命令。
- 不做云同步、命令市场、批量导入导出、参数表单、项目绑定或逐条命令的全局搜索。
- 复制后仍需核对当前终端、目录、Shell 和占位符；不承诺在任意环境直接运行。
- 命令按普通笔记保存，不用于存储真实凭据，不提供密码箱的加密承诺。

## 来源

内置命令依据上游文档整理，未在本机逐条执行：

- [Docker CLI](https://docs.docker.com/reference/cli/docker/) 与 [Compose CLI](https://docs.docker.com/reference/cli/docker/compose/)
- [GNU Coreutils](https://github.com/coreutils/coreutils/blob/master/doc/coreutils.texi)、[GNU Grep](https://www.gnu.org/s/grep/manual/html_node/Usage.html)、[GNU Findutils](https://www.gnu.org/software/findutils/manual/html_node/find_html/Type.html)、[GNU Tar](https://www.gnu.org/software/tar/manual/tar.html)
- [procps ps](https://gitlab.com/procps-ng/procps/-/raw/master/man/ps.1)、[pgrep](https://gitlab.com/procps-ng/procps/-/raw/master/man/pgrep.1)、[iproute2 ss](https://github.com/iproute2/iproute2/blob/main/man/man8/ss.8)
- [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)、[journalctl](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)
- [Git 命令手册](https://git-scm.com/docs)、[npm CLI](https://docs.npmjs.com/cli/v11/commands/)
