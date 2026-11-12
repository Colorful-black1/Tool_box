# 我的 IP 与提示词美化

用户要求在开发者工具中新增本机 IP 与可配合 Prompt 模板的提示词美化，已选择手动触发 AI 润色。

| 模块 | 行为 | 依赖 |
| --- | --- | --- |
| local-ip | 展示非回环网卡的 IPv4 / IPv6、网卡名和子网掩码，可刷新与复制 | 主进程 os、只读 system 桥接 |
| public-ip | 分别查询当前公网 IPv4 / IPv6，显示地址、来源与时间，可分别复制；单协议缺失时保留另一项，失败可重试 | 主进程 net.fetch、第三方 HTTPS |
| prompt-polish | 复用启用的 AI 配置，手动润色、保护模板占位符 | AiGateway.complete、独立 tools 桥接 |
| prompt-handoff | 模板正文 / 生成结果送入润色面板，结果转为新模板草稿或 Agent 草稿 | 现有工具交接、模板保存机制 |

实施顺序：契约与主进程 → 两个面板 → 模板交接 → 静态审查与按仓库门槛决定验证。

## 验收与边界

- 本机地址不读 MAC 或登录数据，不声明某个网卡一定是默认出网网卡。
  公网 IP 只在用户点击后查询，IPv4 / IPv6 分别按顺序尝试第三方 HTTPS 服务；查询会向对应服务暴露出口地址，
  结果仅在本次页面内保留，不写数据库、日志或备份。查询走系统代理，关闭代理后重新查询可看到本机宽带出口。
  无网卡或无桥接有明确提示，读取失败可重试；地址仅在用户复制时进入剪贴板。
- AI 仅手动点击按钮才请求，使用已有配置、超时与脱敏错误映射；不启用 Agent 工具，不写聊天记录。
- 输入 / 输出最多 12000 字符；输出保留每个 `{{变量}}` 的原文与出现次数，丢失或新增时拒绝采用。
- 处理中不重复请求；输入改变时不应用旧响应，离开工具再返回仍保留本次输入与结果。
- 原文、润色结果并排展示，可复制、转成新模板草稿或放入对话 / 编程 Agent 草稿。
  转模板只创建未保存草稿，不覆盖旧模板；用户点击保存后才沿用原有版本机制落盘。
- 保持原有主题、搜索、组内排序和全局命令面板；不新增依赖，不改 schema 或加密链路。
- 新增 `system:network:addresses`、`system:network:public-ip` 与 `tools:prompt:polish`，同步 shared → IPC → preload → renderer；
  网络信息无输入参数，提示词经主进程 validation 校验；渲染进程不引入 Node API。
- 验证仅统计本次相对实施前快照的有效代码行与文件；只有超过 500 行且超过 10 文件才执行编译测试。

手动场景：多网卡 / VPN / IPv6、无可用地址、刷新 / 复制；公网 IPv4 / IPv6 分别显示、单协议缺失、
失败重试与第三方不可达；直接输入与模板载入、占位符保护、AI 失败 / 重试、输入变化、
润色结果新建模板及未保存确认；三套主题与 1024×680 窄窗。

## 实现与验证（2026-10-22）

| 文件 | 改动 |
| --- | --- |
| `src/main/services/developer-tools.ts` | 本机地址读取、无工具 AI 润色、变量原文与次数检查、并发限制和安全错误 |
| `src/shared/{types,bridge,ipc-contract}.ts`、`src/preload/index.ts`、`src/main/ipc/{register-ipc,validation}.ts` | 同步两项能力契约、通道、桥接、来源与入参校验 |
| `src/renderer/src/components/tools/panels/{ip,prompt-polish,prompt}-panel.tsx` | 地址表格、原文 / 结果对照、模板原文与生成结果交接、新模板草稿 |
| `src/renderer/src/stores/{prompt-polish,tool-transfer}-store.ts` | 内存状态、重复请求保护、输入修订与旧响应隔离 |
| `registry.tsx`、`output-actions.tsx`、`global.css` | 工具入口、结果操作说明、复用主题令牌的表格样式 |
| 对应单测与 `verify/desktop-ui/ip-prompt.cjs` | 合成地址、AI 回调、失败与重试、草稿交接和主题 / 窄窗检查 |

本次相对实施前快照的有效代码改动已超过 500 行、涉及超过 10 个文件，未计入此前任务的未提交改动，
因此按仓库规则执行验证：

- `npm run typecheck`、`npm run lint`：通过，0 错误 / 0 告警。
- `npm run test`：70 个文件、783 项通过；本轮新增 6 项，包含网卡过滤、占位符次数、重复请求、
  输入变更与旧响应、失败重试，以及 AI 异常不保留底层请求诊断链。
- `npm run build`：通过，无构建告警。
- `npm run mobile:typecheck`、`npm run mobile:bundle`：通过；打包 964 模块 / 2.4 MB，
  有既有 `NO_COLOR` 与 `FORCE_COLOR` 环境变量提示，不影响结果；未新增手机端工具入口。
- `node verify/desktop-ui/run.cjs --tools-only --screenshots`：34 项通过、页面异常 0 项；
  本轮 8 项覆盖 IP 刷新复制 / 失败重试、模板交接不自动请求、手动润色、新模板保存不覆盖原模板、
  Agent 仅填草稿、三套主题下的润色面板，以及两个面板的 1024×680 布局。
  已目视检查 1280×820 与窄窗截图，原有导航、排序、模板历史和重启恢复也通过。

自动化仅使用合成地址与 AI 返回，不调用真实模型或读取真实网卡；实际润色质量取决于所配置模型，
使用前需核对语义。默认路由判断与手机端工具入口不在首版范围内；公网 IPv4 / IPv6 已补充为手动查询。
提示词润色后续已补充流式输出与停止，见 `docs/SPEC-ai-streaming.md`。
未新增依赖，未改数据库结构、加密链路与生产渲染安全配置；未提交 Git。

## 公网 IP 补充（2026-11-12）

| 文件 | 改动 |
| --- | --- |
| `src/main/services/public-ip.ts`、`public-ip.test.ts` | IPv4 / IPv6 分别查询、顺序多服务、超时与响应上限、协议校验、并发去重、脱敏错误 |
| `src/shared/{types,bridge,ipc-contract}.ts`、`src/preload/index.ts`、`src/main/ipc/register-ipc.ts` | 新增 `PublicIpView`、`system:network:public-ip` 与主 frame 校验 |
| `src/renderer/src/components/tools/panels/ip-panel.tsx`、`global.css` | 公网出口卡片、IPv4 / IPv6 分行、查询 / 重试 / 复制、来源与时间提示 |
| `verify/desktop-ui/{fixture,ip-prompt}.cjs` | 合成公网地址、失败重试与窄窗布局检查 |

界面验收命令：`npm run build` 后执行 `node verify/desktop-ui/run.cjs --ip-prompt-only --screenshots`。
