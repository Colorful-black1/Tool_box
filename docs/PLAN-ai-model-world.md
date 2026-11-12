# AI 模型世界原生数据计划

## 状态

**已实施（2026-11-12）**。入口：`AI 情报 → AI 模型世界`；`开源热榜` 同时迁入 `AI 情报` 分类。

该项目只作为字段规则、选型与交互参考；模型数据由 ToolBox 主进程直接向原始来源采集。

## 目标与边界

- 在桌面端提供「今日格局 + 模型列表 + 模型详情」，不内嵌 Next.js 页面或像素素材。
- 只读浏览：不登录、不收藏、不写入数据库、不调用 AI。
- 数据由 ToolBox 自己抓取、归一化、校验、缓存；页面显示本次生成时间。
- 缺少成绩显示「未参赛 / 暂无数据」，不填 0；不同赛制、不同测量方的分数不混算。
- 不使用 Artificial Analysis 数据。

## 数据链路

```text
models.dev models.json + api.json
        ↓  模型身份、名称、价格、上下文、模态、开源信息
Epoch AI benchmark_data.zip
        ↓  ECI、核心评测、编程赛制、LiveBench 分项
ToolBox 原生采集器（主进程）
  fflate 解压 + csv-parse 解析
        ↓
  本次归一化 / 去重 / 匹配
        ↓
  AiWorldSnapshot
        ↓
  userData/ai-model-world-cache.json（12h TTL）
        ↓  IPC ai-world:get
渲染层 store + createAiWorldIndex()
        ↓
今日格局 / 模型列表 / 详情抽屉 / 数据来源弹层
```

- 两个来源并行抓取；models.dev 失败则本次失败，Epoch 失败则保留 models.dev 模型列表并在页面提示。
- 没有内置上游快照；首次运行需要联网，之后优先使用缓存。网络失败且无缓存时明确报错，不伪造数据。
- 缓存是派生数据，不进入数据库、备份或加密链路。

## 代码位置

| 文件 | 作用 |
| --- | --- |
| `src/shared/ai-model-world.ts` | 快照类型、模型类型推导、编程共识、能力分位、今日格局逻辑 |
| `src/main/services/ai-model-world/native/http.ts` | 原生来源 HTTP、超时、大小上限与错误封装 |
| `src/main/services/ai-model-world/native/models-dev.ts` | models.dev 事实表与 provider 报价合并 |
| `src/main/services/ai-model-world/native/epoch.ts` | Epoch zip 解压、ECI/评测/编程 CSV 解析 |
| `src/main/services/ai-model-world/native/build.ts` | 模型去重、Epoch 成绩合并、厂商与快照生成 |
| `src/main/services/ai-model-world/native/index.ts` | 两个来源并行采集与降级 |
| `src/main/services/ai-model-world/service.ts` | 原生快照缓存、TTL、旧缓存降级、来源白名单 |
| `src/main/ipc/ai-world-ipc.ts` | `ai-world:get` / `ai-world:open-source`，主 frame 校验 |
| `src/renderer/src/stores/ai-world-store.ts` | 两阶段读取、刷新、错误保留、来源打开 |
| `src/renderer/src/components/ai-world/*` | 页面、详情抽屉、数据来源弹层 |
| `src/renderer/src/lib/ai-world-format.ts` | 数量、价格、日期、分数与来源格式化 |

## 页面结构

1. **数据条**：生成时间、在役模型数、厂商数、在线更新 / 本地缓存状态、刷新与数据来源。
2. **今日格局**：最聪明、最会编程、最划算、最便宜、记性最好、最新发布、国内最强、开源最强。
3. **模型列表**：搜索、地区、类型、仅开源、排序、分页；ECI 与编程共识缺失时显示未参赛。
4. **详情抽屉**：四条能力条、规格、逐项成绩、每个成绩的来源链接。
5. **数据来源弹层**：models.dev、Epoch AI、LiveBench（经 Epoch 收录的同源 CSV）。

## 数据完整性约束

- `pct` / `elo` / `index` / `minutes` / `usd` 分别格式化，不把非百分数印成 `%`。
- 编程共识只在「赛制 + 测量方」池内取分位，且至少参加 3 个够大的第三方榜。
- 今日格局使用快照 `generatedAt` 作为时间基准，避免页面日期漂移。
- Epoch 的 0–1 准确率统一乘 100；Aider / LiveBench 的百分数原样保留；Arena 分保持 Elo。
- 同一模型同一赛制出现多条时保留最高分；不同赛制不合并。
- 快照结构异常时拒绝本次采集，回退旧缓存；没有旧缓存时明确报错。
- 厂商地区优先取 Epoch 的 organization country，缺失时使用内置主要厂商表；不把未知地区强行归入「国内」。

## 验证

已执行：

- `npm run typecheck`
- `npm run lint -- --ignore-pattern "mobile/**"`
- `npm run test -- --exclude "mobile/**"`：163 个文件、1194 项通过
- `npm run build`
- 原生真实采集：models.dev + Epoch 生成 1256 个模型、92 家厂商；Epoch 匹配出 Claude / Gemini / GPT / DeepSeek 等主力模型
- `node verify/desktop-ui/run.cjs --ai-world-only --screenshots`
- `node verify/desktop-ui/run.cjs --sidebar-only --screenshots`
- `node verify/desktop-ui/run.cjs --trending-only`

验收截图：`.playwright-mcp/desktop-ui/ai-world-page.png`、
`.playwright-mcp/desktop-ui/ai-world-page-1024.png`、
`.playwright-mcp/desktop-ui/ai-world-sources.png`。

## 风险与后续

- models.dev / Epoch 字段变化：适配器按可选字段降级；核心结构异常时回退缓存。
- 网络不可达：显示旧缓存并明确标注；没有缓存时提示联网，不伪造更新时间。
- Epoch 的 LiveBench CSV 是 Epoch 收录版本，不等同于直连 livebench.ai；若后续官方提供稳定 CSV，可替换为直连适配器。
- 原生匹配目前以名称 / ID 归一化为主，极端改名或缩写模型可能匹配不到 Epoch 成绩；页面会保留模型但显示未参赛。
- 首次联网采集约几秒；解压 6.5 MB CSV 在主进程异步执行，不阻塞渲染进程。
- 首版没有像素角色、时间线、排行榜全量赛道、模型对比和 B 站视频；这些可作为后续独立阶段。
