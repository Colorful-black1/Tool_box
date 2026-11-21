# AI Agent 排行

「AI 模型世界」内的第二视图：模型榜看模型本身，Agent 榜看 **Agent × 模型组合**。

不同榜单的任务、评分和版本不同，因此按来源分榜展示，不跨榜合并为单一分数。

## 来源与口径

| 来源 | 页面版本 | 主指标 | 官方口径 |
| --- | --- | --- | --- |
| CodeAgentBench | SWE-Bench-Pro | Final Score | Agent × 模型；151 个任务 × 3 次尝试 |
| Terminal-Bench | 当前页面显示 4.1 | Resolution Rate | 官方 rank / accuracy / Pass@k / 成本 / Token |
| FrontierHarness | live feed | Cost per pass | 官方效率榜；按 Cost per pass 升序，相同则通过率高者优先 |

EasyAI 当前没有数据，且数据源为 Artificial Analysis；与现有「不使用 Artificial Analysis 数据」的策略冲突，暂不接入。

### CodeAgentBench

直接使用页面 `data-rank` 和 `data-final-score`。官方公式：

```text
Final Score = 100 × S^0.55 × R^0.25 × A^0.20
S = (Pass^3)^(1/3)
R = 1 - (1 - Pass@3)^(1/3)
A = Attempt Score
```

### Terminal-Bench

页面是 Next.js 服务端渲染；数据在 RSC `rows` 数组中读取，不执行浏览器脚本。页面链接中的 `?version=2.1` 没有锁定旧版本，当前实际显示 Terminal-Bench 4.1。

### FrontierHarness

读取同站公开 live feed：

```text
https://frontierharness.org/api/live?since=0
```

主进程按官方 `cellOf` / `raceLine` / `rankPerPass` 口径聚合：

```text
Pass rate = 通过 attempt / 有效 attempt
Cost per task = 各任务平均成本，再对任务取平均
Cost per pass = Cost per task / Pass rate
Time per pass = Time per task / Pass rate

Pass@k = 1 - C(n-c, k) / C(n, k)
Pass^k = C(c, k) / C(n, k)
```

- `infra` 结果排除；
- reward-hacking 的 `lookup` 尝试按失败计；
- 排名按 Cost per pass 升序，相同则 Pass rate 高者优先；同值共享名次；
- 单模型筛选使用该模型内的官方排名，All models 使用汇总排名。

## 页面与交互

- 模型世界顶部切换「模型榜 / Agent 榜」；
- Agent 榜内按 CodeAgentBench / Terminal-Bench / FrontierHarness 切分；
- 主表是 Agent × 模型组合，支持搜索、按模型筛选、按官方指标排序、分页；
- 详情抽屉展示来源原始名次、完整指标、任务数、版本、数据时间和口径说明；
- 不显示跨榜综合冠军或综合总分。

## 缓存与自动更新

Agent 榜使用独立缓存文件：

```text
userData/ai-agent-arena-cache.json
```

各来源独立 TTL：

| 来源 | TTL |
| --- | --- |
| FrontierHarness | 15 分钟 |
| Terminal-Bench | 60 分钟 |
| CodeAgentBench | 12 小时 |

- 打开页面先显示缓存，再后台刷新过期来源；
- Agent 榜保持打开且窗口可见时，每 5 分钟检查一次；
- 手动刷新跳过 TTL；
- 单个来源失败保留上次成功数据，其他来源继续更新；
- 支持 ETag / Last-Modified；304 只更新检查时间；
- 页面区分「官方数据时间」和「最近检查时间」。

## IPC 与安全边界

| 通道 | 入参 | 返回 | 约束 |
| --- | --- | --- | --- |
| `ai-agent-arena:get` | `{ force?: boolean; allowStale?: boolean }` | `AiAgentArenaResult` | 只由主窗口主 frame 调用；只返回可序列化普通对象 |

- 网络请求、HTML/RSC 解析、Frontier 聚合全部在主进程完成；
- 渲染层不接触 `fs` / `net` / `child_process`；
- 来源页面与缓存路径固定，不接受用户输入 URL；
- 来源链接复用 `ai-world:open-source` 白名单，只打开三个榜单首页；
- 不新增数据库表，不修改加密链路。

## 已知限制

- CodeAgentBench 与 Terminal-Bench 没有稳定的公开 JSON API，页面改版会导致解析失败；失败时保留旧缓存并提示。
- FrontierHarness 的排名来自官方公开公式的本地复刻；上游算法变化时需要同步 `frontier-metrics.ts`。
- 各榜单 Agent / 模型命名不同，首版保留来源原始标签，不强行跨榜合并。
- 数据许可与转载要求需在正式发布前确认，并保留来源链接。
