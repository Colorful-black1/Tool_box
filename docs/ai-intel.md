# AI 情报：开源热榜与 AI 模型世界

「AI 情报」下两个只读页面：开源热榜看 GitHub 近期走红的项目，AI 模型世界看模型价格、上下文与评测成绩。
两者都不登录、不写数据库、不调用 AI；数据由主进程采集、归一化并缓存，页面标注来源与时间。

## 1. 入口与共同边界

- 入口：左侧「AI 情报 → 开源热榜」「AI 情报 → AI 模型世界」，页面标识分别是 `trending` 与 `ai-world`。
- 只读浏览：不登录、不收藏、不写 `toolbox.db`、不调用模型、不接触 GitHub Token。
- 采集由主进程发起，渲染层只拿视图对象；缓存是派生数据，不进入数据库、备份或加密链路。
- 网络失败一律显式提示或回退旧缓存，不伪造数据与更新时间。

## 2. 开源热榜：数据源与兜底

- 主源：`https://github.com/trending?since=daily|weekly|monthly`，与浏览器看到的榜单一致，能拿到「N stars today / this week / this month」。
- 兜底：GitHub 官方 Search API，按「窗口内新建 + 高星」返回近期项目；来源明确标注「搜索兜底」，本期新增显示 `—`。
- 今日 / 本周 / 本月对应 GitHub 的 daily / weekly / monthly 滚动窗口（约最近 24 小时 / 7 天 / 30 天），不是自然日、自然周、自然月。
- 保持 GitHub 返回顺序，不按总 Star 重排。
- 主源请求失败、非 200、超时或解析出 0 条时走兜底；两者都失败且有缓存时返回缓存并标 `stale`，无缓存才报错。
- 任何情况下都不把兜底数据说成「GitHub 今日热榜」。

## 3. 开源热榜：请求与解析

- 请求固定 `github.com`，不接受用户传入 URL；`net.fetch` 可用时优先，回退全局 `fetch`；测试注入 `fetchImpl`。
- 不依赖 `net.fetch` 返回的 `response.url` 做重定向校验（该字段不可靠），改为只请求固定域名。
- 请求头：浏览器形态 UA 并附应用标识、`Accept: text/html,application/xhtml+xml`、`Accept-Language: en-US,en;q=0.9`。
- 超时 12 秒；5xx 约 800ms 后重试一次；4xx 与超时不重试；单次查询总预算约 25 秒。
- 解析是纯函数：HTML ≤ 2 MB，按 `</article>` 切分，匹配包含 `Box-row` 的 article；最多保留 50 条，简介截断到 300 字符。
- 仓库名从 `<h2>` 取第一个 `href="/owner/repo"`，必须正好两段，拒绝 `..`、空段与查询串；缺 Star 或仓库名的条目跳过。
- 语言取 `itemprop="programmingLanguage"`；语言色只接受 `#rgb` / `#rrggbb`，否则为 `null`。
- Star / Fork 从 `<a>` 起始匹配（不能从 `href` 匹配，否则会把属性里的数字带进来）；数字支持千分位。
- 本期新增取 `([\d,]+)\s+stars\s+(today|this week|this month)`，缺失为 `null`，不补 0。
- 解析出 0 条按失败处理，交给兜底，不显示空榜单。
- Search 兜底：每次刷新最多一次请求；`language:` 用显示名映射，带空格的加引号；`periodStars` 恒为 `null`；403 / 429 统一提示「请求过于频繁」，不暴露响应体。

## 4. 开源热榜：缓存与刷新

| 项 | 行为 |
| --- | --- |
| 内存 key | `period|language` |
| TTL | 10 分钟 |
| 并发 | 同一 key 共用一个 Promise（in-flight 去重）；`force` 只绕过 TTL，不绕过去重 |
| 磁盘 | `userData/github-trending-cache.json`，`{ version: 1, entries }` |
| 磁盘上限 | 最多 60 条；超过 7 天的条目不使用；文件 ≤ 2 MB |
| 写入 | tmp + rename；损坏 / 版本不符直接丢弃 |
| 首屏 | 先 `allowStale` 只读缓存（毫秒级，无缓存返回 `null`），过期或没有才 `force` 拉新 |
| 自动刷新 | 页面可见时 10 分钟一次；隐藏或卸载停止计时；重新可见且过期立即刷新 |
| 失败 | 有缓存则显示缓存 + `stale` 提示 + 重试；无缓存显示错误态，不显示空列表 |

- 偏好存 `localStorage`：`toolbox.github-trending.prefs.v1`，字段 `period` / `language` / `refreshInterval`（0 / 5 / 10 / 30 分钟），逐字段校验，非法值回退默认。
- 搜索只过滤当前已加载列表（名称、简介、语言），不重新请求；搜索词不持久化。

## 5. 开源热榜：IPC 与安全

| 通道 | 入参 | 返回 | 约束 |
| --- | --- | --- | --- |
| `trending:list` | `{ period, language?, force?, allowStale? }` | `TrendingResult \| null` | `allowStale` 只读缓存，无缓存返回 `null` |
| `trending:open` | `fullName: string` | `void` | 只接受 `owner/repo`，主进程拼固定 GitHub 地址 |

- 校验：`period` 枚举；`language` 必须在白名单或为空；`force` / `allowStale` 必须是布尔。
- `fullName` 必须匹配 `^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`，不能含 `..`、不能有三段。
- `open` 不接收 URL，主进程自己拼 `https://github.com/${fullName}` 再 `shell.openExternal`；失败返回可读错误，不抛原始异常。
- 描述按纯文本渲染，禁止 `dangerouslySetInnerHTML`；语言色先校验十六进制再放进 `style`。
- 日志只记条数、来源、耗时与 HTTP 状态，不记页面正文。

## 6. AI 模型世界：数据链路

```text
models.dev models.json + api.json   → 身份、名称、价格、上下文、模态、开源信息
Epoch AI benchmark_data.zip         → ECI、核心评测、编程赛制、LiveBench 分项
        ↓ 主进程原生采集（fflate 解压 + csv-parse 解析）
   归一化 / 去重 / 匹配 → AiWorldSnapshot
        ↓ userData/ai-model-world-cache.json（12 小时 TTL）
   IPC ai-world:get → 渲染层 store + createAiWorldIndex()
        ↓
   今日格局 / 模型列表 / 详情抽屉 / 数据来源弹层
```

- 两个来源并行抓取：models.dev 失败则本次失败；Epoch 失败则保留 models.dev 的模型列表并在页面提示。
- 没有内置上游快照：首次运行需要联网，之后优先用缓存；网络失败且无缓存时明确报错，不伪造数据。
- 不使用 Artificial Analysis 数据。
- 快照结构异常时拒绝本次采集并回退旧缓存；没有旧缓存时明确报错。
- 页面显示本次生成时间；数据来源弹层列出 models.dev、Epoch AI 与经 Epoch 收录的 LiveBench 同源 CSV。

## 7. AI 模型世界：降级与完整性

- 缺少成绩显示「未参赛 / 暂无数据」，不填 0；不同赛制、不同测量方的分数不混算。
- 编程共识只在「赛制 + 测量方」池内取分位，且至少参加 3 个够大的第三方榜。
- 今日格局用快照 `generatedAt` 作时间基准，避免页面日期漂移。
- Epoch 的 0–1 准确率统一乘 100；Aider / LiveBench 的百分数原样保留；Arena 分保持 Elo。
- 同一模型同一赛制出现多条时保留最高分。
- `pct` / `elo` / `index` / `minutes` / `usd` 分别格式化，不把非百分数印成 `%`。
- 厂商地区优先取 Epoch 的 organization country，缺失时用内置主要厂商表；未知地区不强行归入「国内」。
- 原生匹配以名称 / ID 归一化为主，极端改名或缩写可能匹配不到 Epoch 成绩；此时保留模型并显示未参赛。

## 8. AI 模型世界：IPC 与来源链接

| 通道 | 入参 | 返回 | 约束 |
| --- | --- | --- | --- |
| `ai-world:get` | `{ force?: boolean }` | `AiWorldView` | 无缓存且采集失败时报可读错误 |
| `ai-world:open-source` | `{ url: string }` | `void` | 只允许当前快照与固定来源中的 HTTPS 地址 |

- 两个通道都做窗口与主 frame 校验。
- 来源链接白名单：当前快照里出现的来源 URL 与固定来源列表，其它地址一律拒绝。
- 缓存文件与快照都在应用数据目录，不写数据库、不进备份。

## 9. 依赖与数据落点

- 新增两个纯 JS 依赖：`fflate`（解压）与 `csv-parse`（解析 CSV），在 `package.json` 的 dependencies 中。
- 不改 schema、不需要 API Key、不写 `toolbox.db`。
- 缓存文件：`userData/github-trending-cache.json`、`userData/ai-model-world-cache.json`。

## 10. 验证状态与已知限制

- 解析、缓存、兜底与降级用合成 fixture 覆盖（正常、缺字段、HTML 实体、坏条目、0 条、损坏缓存、版本不符）。
- 开源热榜的真实页面结构与网络代理仍需在真实环境观察；GitHub 改版时只需修 `parse.ts`。
- 模型世界做过一次真实采集生成快照；模型数与厂商数随上游变化，不作为固定指标。
- 首次联网采集约需数秒；解压后的 CSV 在主进程异步处理，不阻塞渲染。
- 未做：GitHub 登录 / Star / Issue / README 详情 / 收藏 / 推送，以及模型对比、全量排行榜、时间线与像素角色。
