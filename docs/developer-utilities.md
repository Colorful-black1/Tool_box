# 开发者工具扩展

本批新增三个工具入口，并在「我的 IP」内增加端口查询，不改变已有工具顺序偏好。

## 能力与边界

* Cron：Unix 五段、Spring 六段、Quartz 六/七段，区分星期编号及日/星期匹配规则（Unix 的日/星期均不含 `*` 才使用或匹配）；支持列表、升序区间、字段跨度内的正整数步长、英文月份/星期及 Spring/Quartz 的 L、W、#，Quartz 特殊日期条件不与列表混用。可视化逐字段生成秒 / 分 / 时 / 日 / 月 / 周 / 年（按方言显示），每个字段可选每、范围、间隔、指定；Quartz 的日与周强制一个为 `?`，切换时自动调整。支持按年月日时分秒一键填入具体时刻，生成结果实时预览未来十次执行时间，最多搜索八年。保留手动表达式解析模式。首版提供 UTC 与北京时间两个固定时区，不模拟夏令时，也不实际创建定时任务。
* Spring 配置：本地 YAML / Properties 双向转换、展平字段比较。支持缩进映射、块列表、字符串、普通标量、Properties 转义及续行；保留占位符和数值文本。拒绝重复键、路径冲突、YAML 锚点/标签/流式集合/多行标量/多文档，不静默丢弃数据。转换不保留注释，不解析 Spring 运行时环境优先级，不解析占位符。
* JWT / 证书：JWT 三段解码，展示头、载荷及时间声明；JSON 最多 32 层、10000 节点，明确未验证签名，不据此认定可信。证书支持 PEM 链或单张 DER 文件，展示 X.509 元数据和有效期；拒绝私钥及混合内容，不验证证书信任链。输入仅存组件内存，不保存、不发送给 AI。
* 我的 IP：手动获取 Windows TCP/UDP 端口快照，显示地址、端口、状态、PID、进程名，支持筛选、复制与确认后停止进程。只执行固定系统命令、限制运行时间与输出，不暴露进程参数；非 Windows 明确提示暂不支持。名称查询失败时保留端口数据并禁用停止。

端口 / PID / 进程名 / 地址输入不实时筛选：按 Enter 或点击「查询端口占用」后应用输入并读取新快照；修改输入时保留上次结果并显示待查询提示，读取期间不重复发起请求。停止进程后的自动刷新继续使用已提交条件，不应用尚未查询的输入。

## 接口与影响

新增 `tools:certificate:inspect` 和 `system:network:ports` 两个只读 IPC，分别传受限长度证书文本和无参数请求；由主窗口主 frame 调用，返回普通视图对象。同步 shared 类型、bridge、preload、主进程校验及调用方，不修改数据库、安全基线、AI 或加密链路，不新增依赖。

端口停止扩展：快照可选返回 `stopToken` / `stopBlockedReason`；新增 `system:network:process:stop`，仅接收主进程最近一次快照签发的 UUID，不接受 PID、路径或命令。引用五分钟有效且单次使用、最多保留 1000 个；主进程串行执行，重新检查端口归属。在同一原生句柄上核对进程创建时间、名称及关键进程标记，再终止目标，不结束进程树、不提权。系统关键进程、工具箱进程及身份不明项禁止停止。结果只返回白名单状态和中文说明，执行后刷新；权限不足、引用过期、端口易主和超时均不自动重试。旧查询调用兼容。

## 验收

关注 Cron 可视化字段、间隔/范围/指定、Quartz 日周问号、具体时刻回填、方言差异、闰日/月底/最近工作日、非法表达式；配置转义/列表/大整数/路径冲突及不支持语法；JWT 非法编码及过期状态；证书私钥拒绝与有效 PEM/DER；IPv6、UDP、进程消失、命令失败；工具搜索和拖拽顺序兼容、1280×820 布局与三套主题。测试执行遵守 AGENTS.md 的代码量与文件数门槛。

停止验收：确认取消、执行中禁用重复点击、成功后刷新、快照过期/端口易主拒绝、权限不足及受保护进程；进程创建时间不匹配不得终止，未保存内容风险需在确认中显示。自动化用例仅模拟系统执行，不终止真实进程；Windows 句柄终止路径和页面布局需人工验收。

隔离界面验收命令：先 `npm run build`，再 `node verify/desktop-ui/run.cjs --developer-utilities-only --screenshots`；全部开发工具回归使用 `--tools-only`。使用合成配置和临时用户目录，不调用 AI、不接触用户数据库；真实 Windows 查询另由单元测试临时监听回环 TCP / UDP 端口验证。

语义依据：[Spring CronExpression](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html)、[Quartz CronTrigger](https://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html)、[Java Properties](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html)、[Node X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate)、[Windows netstat](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netstat)。
