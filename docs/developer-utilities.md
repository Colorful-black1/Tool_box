# 开发者工具扩展

本批新增三个工具入口，并在「我的 IP」内增加端口查询，不改变已有工具顺序偏好。

## 能力与边界

* Cron：Unix 五段、Spring 六段、Quartz 六/七段，区分星期编号及日/星期匹配规则（Unix 的日/星期均不含 `*` 才使用或匹配）；支持列表、升序区间、字段跨度内的正整数步长、英文月份/星期及 Spring/Quartz 的 L、W、#，Quartz 特殊日期条件不与列表混用。显示字段含义及起点之后十次执行时间，最多搜索八年。首版提供 UTC 与北京时间两个固定时区，不模拟夏令时，也不实际创建定时任务。
* Spring 配置：本地 YAML / Properties 双向转换、展平字段比较。支持缩进映射、块列表、字符串、普通标量、Properties 转义及续行；保留占位符和数值文本。拒绝重复键、路径冲突、YAML 锚点/标签/流式集合/多行标量/多文档，不静默丢弃数据。转换不保留注释，不解析 Spring 运行时环境优先级，不解析占位符。
* JWT / 证书：JWT 三段解码，展示头、载荷及时间声明；JSON 最多 32 层、10000 节点，明确未验证签名，不据此认定可信。证书支持 PEM 链或单张 DER 文件，展示 X.509 元数据和有效期；拒绝私钥及混合内容，不验证证书信任链。输入仅存组件内存，不保存、不发送给 AI。
* 我的 IP：手动获取 Windows TCP/UDP 端口快照，显示地址、端口、状态、PID、进程名，支持筛选与复制。仅执行固定只读系统命令，限制运行时间与输出，不暴露进程参数，不终止进程；非 Windows 明确提示暂不支持。进程名称查询失败时保留端口数据并提示。

## 接口与影响

新增 `tools:certificate:inspect` 和 `system:network:ports` 两个只读 IPC，分别传受限长度证书文本和无参数请求；由主窗口主 frame 调用，返回普通视图对象。同步 shared 类型、bridge、preload、主进程校验及调用方，不修改数据库、安全基线、AI 或加密链路，不新增依赖。

## 验收

关注 Cron 方言差异、闰日/月底/最近工作日、非法表达式；配置转义/列表/大整数/路径冲突及不支持语法；JWT 非法编码及过期状态；证书私钥拒绝与有效 PEM/DER；IPv6、UDP、进程消失、命令失败；工具搜索和拖拽顺序兼容、1280×820 布局与三套主题。测试执行遵守 AGENTS.md 的代码量与文件数门槛。

隔离界面验收命令：先 `npm run build`，再 `node verify/desktop-ui/run.cjs --developer-utilities-only --screenshots`；全部开发工具回归使用 `--tools-only`。使用合成配置和临时用户目录，不调用 AI、不接触用户数据库；真实 Windows 查询另由单元测试临时监听回环 TCP / UDP 端口验证。

语义依据：[Spring CronExpression](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html)、[Quartz CronTrigger](https://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html)、[Java Properties](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html)、[Node X509Certificate](https://nodejs.org/api/crypto.html#class-x509certificate)、[Windows netstat](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netstat)。
