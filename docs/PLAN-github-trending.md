# 开发工作台：GitHub 开源热榜计划

日期：2026-11-11
状态：**已实施**（用户确认「按推荐开始」）。交付结果见第 0 节记录；本文保留原方案与已确认的边界。

> 2026-11-12：左侧入口迁至「AI 情报 → 开源热榜」，与「AI 模型世界」同级；页面、数据和 IPC 不变。

## 0. 实施记录

| 项     | 结果                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入口   | AI 情报 →「开源热榜」（原开发工作台），`AppView` 为 `trending`                                                                                                                                                   |
| 数据源 | `github.com/trending` 主源 + 官方 Search API 兜底；来源在页面标注                                                                                                                                               |
| 解析   | `src/main/services/github-trending/parse.ts`，fixture 覆盖正常/缺字段/实体/坏条目/0 条                                                                                                                          |
| 缓存   | 内存 + `userData/github-trending-cache.json`，10 分钟 TTL、7 天磁盘上限、60 条淘汰、tmp + rename                                                                                                                |
| 刷新   | 首屏 `allowStale` 读缓存后再 `force`；手动刷新、可见时自动刷新、F5；页面隐藏不轮询                                                                                                                              |
| IPC    | 新增 `trending:list` / `trending:open`；`open` 只接受 `owner/repo`，主进程拼固定 GitHub 地址                                                                                                                    |
| 界面   | 今日/本周/本月、语言筛选、当前列表搜索、来源标签、缓存/兜底提示、复制与打开                                                                                                                                     |
| 无变更 | 不改 schema、不新增依赖、不接触 GitHub Token                                                                                                                                                                    |
| 验证   | `npm run typecheck`、桌面 `lint`、桌面 `test`（159 files / 1177 tests）、`build` 通过；`node verify/desktop-ui/run.cjs --trending-only --screenshots` 3 项、页面异常 0 项；真实 Trending 页面一次性解析核对通过 |

实施偏差：计划中的「跟随重定向后校验 response.url」没有保留——Electron `net.fetch` 文档明确说明返回对象的 `url` 不可靠，代码改为固定请求 `github.com`、不接受用户 URL，不依赖该字段。自动刷新时每 10 分钟最多一个页面请求，未做后台推送。

## 0.1 结论摘要

建议在「开发工作台」新增独立入口 **开源热榜**，和编程 Agent、Token 统计、命令速查、工具并列。页面直接读 GitHub Trending 的 **今日 / 本周 / 本月** 榜单，展示排名、仓库、简介、语言、总 Star、本期新增 Star、Fork，并提供「复制链接 / 在浏览器打开」。

数据源采用 **Trending 页面为主 + GitHub 搜索兜底**：

- 主源：`https://github.com/trending?since=daily|weekly|monthly`，与用户浏览器里看到的榜单一致，能拿到「N stars today / this week / this month」；
- 兜底：GitHub 官方 Search API，按「时间窗口内新建 + 高星」返回近期新项目，并明确标注「搜索兜底」，**不伪造本期新增 Star**；
- 缓存 10 分钟，手动刷新 + 页面可见时自动刷新；缓存落 `userData` JSON，不改数据库、不加第三方依赖。

首版只读浏览，不做 GitHub 登录、Star、Issue、README 详情、收藏和通知。需要用户授权的部分只有 **2 个新 IPC 通道**（`trending:list`、`trending:open`），不涉及 schema、加密和第三方依赖。

## 1. 需求拆解

| 用户诉求                                 | 首版落地                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| 看 GitHub 今日 / 本周 / 本月最火的项目   | 三个页签，分别对应 Trending 的 `daily` / `weekly` / `monthly`                       |
| 不想打开 GitHub 网页                     | 工具内直接看榜单、简介、语言、Star、本期新增、Fork；需要细看时再点「打开」          |
| 想尽量实时                               | 首屏先显示缓存，再按 10 分钟 TTL 拉新；手动刷新；页面可见时自动刷新，离开页面不轮询 |
| 关心「最近比较火」而不是「总 Star 最高」 | 保持 GitHub Trending 的原顺序，不按总 Star 重排；显示本期新增 Star                  |
| 想按技术栈看                             | 语言筛选（全部 / TypeScript / Python / Go / Rust 等常用语言），切换后单独缓存       |

说明：GitHub Trending 的「今日 / 本周 / 本月」是 GitHub 自己的热度排序，并不是「按总 Star 数取前三名」；页面顺序就是榜单顺序，本功能不重新定义排名。三个页签沿用 GitHub 的滚动窗口口径（daily / weekly / monthly，约最近 24 小时 / 7 天 / 30 天），不是自然日、自然周、自然月。

## 2. 现状审计与可复用件

当前仓库没有 GitHub Trending 相关代码，也没有通用外链打开能力。可复用的部分：

| 位置                                                                         | 现状                                                                | 本功能的用法                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `src/renderer/src/App.tsx`                                                   | `PAGE_META` + `RAIL_ITEMS` 定义开发工作台入口                       | 新增 `trending` 页面与入口                      |
| `src/renderer/src/stores/app-store.ts`                                       | `AppView` 是渲染层页面联合类型                                      | 只扩展导航标识，不把榜单塞进全局 app-store      |
| `src/renderer/src/components/shell.tsx`                                      | `RailIcon` 按名字返回图标                                           | 新增 `flame` 图标映射                           |
| `src/renderer/src/components/agent-usage/agent-usage-page.tsx`               | 已有加载竞态号、可见性轮询、F5 刷新、错误/空态                      | 直接借鉴它的刷新与竞态处理，不重复造轮子        |
| `src/renderer/src/lib/usage-prefs.ts`                                        | `localStorage` 持久化筛选和刷新间隔                                 | 新增一份 trending 偏好，沿用同样的容错读取      |
| `src/main/services/agent-usage/cache.ts`                                     | 缓存版本、原子写入（tmp + rename）、损坏回退                        | 缓存文件按同样方式落盘                          |
| `src/main/services/ai-gateway/model-fetcher.ts`                              | 主进程 `fetch`、超时、错误收敛、错误文案                            | 沿用超时与错误处理习惯                          |
| `src/renderer/src/components/dropdown.tsx`                                   | 深色主题下拉，禁止原生 `<select>`                                   | 语言筛选、刷新间隔都用它                        |
| `src/renderer/src/styles/global.css`                                         | `.segmented` / `.segment`、`.btn-ghost`、`.status-banner`、`.glass` | 页签、按钮、告警、卡片直接复用                  |
| `src/renderer/index.html`                                                    | CSP `img-src 'self' data:`                                          | 不加载 GitHub 头像/远程图片，榜单做成纯文字卡片 |
| `src/shared/bridge.ts` / `ipc-contract.ts` / `preload/index.ts` / `main/ipc` | 四处同步的桥接模式                                                  | 新能力按同样四处补齐                            |

## 3. 数据源方案比较（关键决策）

### 3.1 三个可选方案

| 方案                          | 能拿到今日/本周/本月新增 Star       | 稳定性                               | 代价                     | 结论     |
| ----------------------------- | ----------------------------------- | ------------------------------------ | ------------------------ | -------- |
| 抓 `github.com/trending` 页面 | 能，页面原生字段                    | 中：HTML 结构变化或反爬会失效        | 需要自己解析，无官方契约 | **主源** |
| GitHub Search API             | 不能，只能按创建时间 + 总 Star 近似 | 高：官方 JSON、有限流                | 口径和 Trending 不同     | **兜底** |
| 第三方 Trending API / 镜像    | 通常能                              | 低：随时停服、数据滞后、隐私 unknown | 新增依赖或外部服务       | 不采用   |

合规提示：Trending 页面没有官方 API 契约，自动抓取属于非官方用法。本方案只做个人使用的低频只读请求，不批量抓取、不再分发数据，但仍可能受 GitHub 条款或反爬策略影响；如果这一点不可接受，应改选「仅 Search API」，代价是拿不到每日新增 Star、榜单口径会变。

### 3.2 已核对的事实

- 截至本次核对，GitHub 没有公开的 Trending REST / GraphQL 接口；`github.com/trending` 是服务端渲染的公开页面。
- 页面支持 `?since=daily|weekly|monthly`，也支持语言路径，例如 `/trending/typescript?since=weekly`、`/trending/c%23?since=weekly`。
- 单条 `<article class="Box-row">` 内能稳定拿到：仓库 `href`、简介 `<p class="...color-fg-muted...">`、语言 `itemprop="programmingLanguage"`、语言色 `repo-language-color` 的内联色值、Star / Fork 链接、`N stars today|this week|this month`。
- 本次实测（2026-11-11）同一天不同时间抓取，daily 返回 10 条、weekly 13 条、monthly 16 条；**条目数不固定，不能假设 25 条**。
- 未认证 GitHub API：核心接口 60 次/小时，Search 10 次/分钟。Trending 页面不需要 Token，但请求可能超时、被重定向到不含榜单的页面，或被反爬降级；解析器必须把「0 条」当失败并走兜底，不能显示空列表当成功。
- GitHub 页面本身也不是秒级更新；「实时」做到 10 分钟级缓存 + 手动刷新即可，不承诺秒级。

### 3.3 推荐策略

1. 先请求 Trending 页面，解析成功且 `items.length > 0` 才采用；
2. 请求失败、非 200、超时、解析 0 条时，调用 Search API 兜底；
3. 两者都失败时，如果有缓存就返回缓存并标记 `stale`，没有缓存才报错；
4. 界面显示数据来源：
   - `GitHub Trending`：主源，有本期新增 Star；
   - `GitHub 搜索兜底`：按「时间窗口内新建 + 高星」找近期新项目，本期新增 Star 显示 `—`，不冒充 Trending；
5. 任何情况下都不把兜底数据说成「GitHub 今日热榜」。

Search 兜底查询示例：

```text
GET https://api.github.com/search/repositories
  ?q=created:>=2026-11-04 stars:>=30 language:TypeScript
  &sort=stars&order=desc&per_page=25
```

- daily 用最近 1 天、weekly 用最近 7 天、monthly 用最近 30 天；
- 星数阈值按窗口调整（例如 5 / 30 / 50），避免全是刚建的空仓库；
- 只取一页 25 条，不翻页、不批量抓取；
- 带空格的显示名（如 `Jupyter Notebook`）在 `language:` 后加引号，避免被拆成两个词；
- 返回内容按官方 JSON 字段映射，`periodStars` 明确为 `null`。

## 4. 目标与非目标

### 目标

1. 开发工作台里能直接看 GitHub 今日 / 本周 / 本月热榜，不需要打开浏览器。
2. 首屏尽量快：有缓存先显示缓存，再后台更新；失败时明确告诉用户「这是缓存 / 这是兜底」。
3. 手动刷新可靠；页面可见时按间隔刷新；切换页签、语言不闪空屏。
4. 解析器、缓存、兜底都有单测，HTML 结构变化时能快速定位。
5. 不新增数据库表、不新增第三方依赖、不接触任何 GitHub 凭据。

### 非目标（首版不做）

- GitHub 登录、Star / Fork / Watch、Issue / PR、通知；
- 站内 README 渲染、Topic、Release、贡献者详情；
- 收藏、订阅、每日推送、长期 Star 历史曲线；
- 跨设备同步、导出 CSV、自定义榜单算法；
- 代理设置界面（先依赖系统代理 / Electron 网络栈）。

## 5. 技术设计

### 5.1 调用链与模块

```text
TrendingPage (renderer)
  → trending-store (Zustand，局部状态)
  → window.toolbox.trending.list(query)
  → preload → IPC trending:list
  → main/ipc/trending-ipc.ts
  → GithubTrendingService
      → TrendingFetcher（固定 github.com）
      → parseTrendingHtml（纯函数）
      → SearchFallback（api.github.com，仅失败时）
      → TrendingCache（内存 + userData JSON）
```

新增文件建议：

```text
src/shared/github-trending.ts              # 周期、语言、类型、常量
src/main/services/github-trending/
  parse.ts                                 # HTML → TrendingRepo[]
  parse.test.ts
  service.ts                               # 编排：缓存、抓取、兜底
  service.test.ts
  cache.ts                                 # 内存 + 磁盘缓存
  cache.test.ts
  search-fallback.ts                       # Search API 适配
  search-fallback.test.ts
src/main/ipc/trending-ipc.ts               # handler + 校验 + openExternal
src/renderer/src/components/trending/
  trending-page.tsx
  trending-toolbar.tsx
  trending-card.tsx
src/renderer/src/stores/trending-store.ts
src/renderer/src/lib/trending-prefs.ts
```

改动文件：

- `src/shared/ipc-contract.ts`：新增 2 个通道；
- `src/shared/bridge.ts`、`src/preload/index.ts`：暴露 `trending.list/open`；
- `src/main/index.ts`：初始化 `GithubTrendingService`；
- `src/main/ipc/register-ipc.ts`：注册新 IPC；
- `src/main/ipc/validation.ts`：新增查询与仓库名校验；
- `src/renderer/src/App.tsx`：`AppView`、`PAGE_META`、入口、页面渲染；
- `src/renderer/src/components/shell.tsx` + `icons.tsx`：火苗图标；
- `src/renderer/src/components/search/command-palette.tsx`：导航项；
- `src/renderer/src/styles/global.css`：页面样式；
- `README.md`、`docs/ROADMAP.md`、`CAPABILITY_MAP.md`：能力说明。

### 5.2 类型

```ts
export type TrendingPeriod = 'daily' | 'weekly' | 'monthly'
export type TrendingSource = 'trending' | 'search'

export interface TrendingRepo {
  /** 页面原始顺序，从 1 开始；筛选后仍保留原排名 */
  rank: number
  /** owner/repo */
  fullName: string
  url: string
  description: string
  language: string
  /** 已校验为 #rgb / #rrggbb；无语言时为 null */
  languageColor: string | null
  stars: number
  forks: number
  /** 本期新增 Star；Search 兜底时为 null，不能显示成 0 */
  periodStars: number | null
}

export interface TrendingResult {
  period: TrendingPeriod
  /** null 表示全部语言 */
  language: string | null
  source: TrendingSource
  items: TrendingRepo[]
  fetchedAtMs: number
  /** 数据已超过 TTL；只用于首屏占位，不代表请求失败 */
  stale: boolean
  /** 请求失败后回退旧缓存时的用户提示；成功或纯缓存读取时为 null */
  warning: string | null
}

export interface TrendingQuery {
  period: TrendingPeriod
  language?: string
  /** 手动刷新：绕过 TTL，但仍复用同 key 的进行中请求 */
  force?: boolean
  /**
   * 只读缓存、不发起网络请求；没有缓存时返回 null。
   * 渲染层用它先出首屏，再决定是否 force 拉新。
   */
  allowStale?: boolean
}
```

周期与语言常量放在 `shared/github-trending.ts`：

```ts
export const TRENDING_PERIODS = [
  { value: 'daily', label: '今日' },
  { value: 'weekly', label: '本周' },
  { value: 'monthly', label: '本月' }
] as const

export const TRENDING_LANGUAGES = [
  { value: '', label: '全部语言' },
  { value: 'typescript', label: 'TypeScript' }
  // ... 常用语言，路径片段单独维护
] as const
```

语言路径片段是白名单映射，不把用户输入直接拼进 URL：`c++` → `c%2B%2B`、`c#` → `c%23`、`jupyter-notebook` → `jupyter-notebook`。Search API 的 `language:` 使用显示名，单独映射。

### 5.3 HTML 解析器

`parseTrendingHtml(html, period)` 是纯函数，不读网络、不写文件。

解析步骤：

1. 限制 HTML 最大 2 MB，按 `</article>` 切分，匹配 `<article ... class="...Box-row...">`；
2. 每条从 `<h2>...</h2>` 取第一个 `href="/owner/repo"`，校验正好两段，拒绝 `..`、空段、查询串；
3. 简介取 `<p class="...color-fg-muted...">`，去标签、解码 HTML 实体、压缩空白；缺失时用空串；
4. 语言取 `itemprop="programmingLanguage"`；语言色取 `repo-language-color` 的 `background-color`，只接受 `#rgb` / `#rrggbb`，否则 `null`；
5. Star / Fork 取 `<a ... href="/owner/repo/stargazers|forks" ...>` 内的可见数字；注意从 `<a>` 开始匹配，不能从 `href` 开始，否则会把属性里的数字带进来；
6. 本期新增取可见文本的 `([\d,]+)\s+stars\s+(today|this week|this month)`；缺失时为 `null`；
7. 数字解析支持千分位逗号；仓库名或 Star 数缺失的条目跳过，不因为一条坏数据拖垮整页；
8. `items.length === 0` 时抛 `TrendingParseError`，交给上层兜底；
9. 最多保留 50 条，简介截断到 300 字符。

选择器不能只认一种写法：用「包含 `Box-row` 的 article」而不是精确字符串；字段缺失按空值处理；解析结果做基本合法性校验。测试用固定 HTML fixture，不跑真实网络。

### 5.4 抓取与超时

- 主源 URL：`https://github.com/trending${languagePath}?since=${period}`；
- 请求头：
  - `User-Agent` 用浏览器形态并附应用标识，例如
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 ToolBox/0.3.0`；
    浏览器形态 UA 更接近真实页面请求，可降低被返回降级页面的概率；
  - `Accept: text/html,application/xhtml+xml`；
  - `Accept-Language: en-US,en;q=0.9`，保持 `stars today` 等文案稳定；
- 超时 12 秒；5xx 重试 1 次（约 800ms 后），4xx 和超时不重试，避免用户等两次超时；
- 单次查询总预算约 25 秒（主源 + 兜底），超过就按失败处理；
- 请求 URL 固定为 `github.com`，不接受用户传入 URL；Electron `net.fetch` 的 `response.url` 不可靠，不依赖它做重定向校验；
- 优先使用 Electron `net.fetch`（走 Chromium 网络栈和系统代理），不可用时回退全局 `fetch`；测试注入 `fetchImpl`，服务不直接依赖 Electron；
- 只请求固定的 `github.com` / `api.github.com`，不接受用户传入 URL；
- 只做低频只读抓取（10 分钟缓存、单次一个页面），不并发批量抓取、不再分发数据；仍应遵守 GitHub 条款，若被限制则降级到 Search API。

Search 兜底：

- `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`；
- 每次刷新最多一次 Search 请求；
- 403/429 统一提示「GitHub 接口请求过于频繁，请稍后再试」，不暴露响应体；当前没有解析 `X-RateLimit-Reset` 做倒计时。

### 5.5 缓存与刷新

**内存缓存**

- key：`period|language`；
- TTL：10 分钟；
- 同一 key 的并发请求共用同一个 Promise（in-flight dedupe），手动刷新也复用，避免连点造成并发抓取；
- `force` 只绕过 TTL，不绕过 in-flight 去重。

**磁盘缓存**

- 文件：`userData/github-trending-cache.json`；
- 结构：`{ version: 1, entries: Record<key, { items, source, fetchedAtMs }> }`；
- 最多 60 条，按 `fetchedAtMs` 淘汰最旧；超过 7 天的条目不使用；
- 写入用 `tmp` + `rename`，失败只记日志，不影响页面；
- 文件损坏 / 版本不匹配时丢弃，回退为空缓存；不写数据库，不需要 schema 迁移。

**首屏缓存优先的实现方式**

IPC 是请求 / 响应，没有服务端推送，所以不能「一次调用里先返回缓存、再自动更新」。渲染层分两步：

```ts
// 1. 只读缓存，不联网；没有缓存返回 null
const cached = await window.toolbox.trending.list({ ...query, allowStale: true })
if (cached) render(cached)

// 2. 缓存缺失或已过期，才 force 拉新；force 会复用进行中的同 key 请求
if (!cached || cached.stale || manualRefresh) {
  const fresh = await window.toolbox.trending.list({ ...query, force: true })
  if (fresh) render(fresh)
}
```

- 第 1 步只查内存 / 磁盘，速度是毫秒级；第 2 步才可能等网络。
- 缓存新鲜时不发请求；`stale` 只表示「年龄超过 TTL」，此时先展示旧数据并显示「更新中」。
- 请求失败时，服务返回旧缓存并带 `warning`；界面才显示错误横幅，不能把「缓存占位」误报成失败。
- 缓存也没有时，第 1 步返回 `null`，页面显示骨架屏直到第 2 步完成。

**刷新策略**

| 场景               | 行为                                                              |
| ------------------ | ----------------------------------------------------------------- |
| 首次进入页面       | 先 `allowStale` 读缓存立即显示；缓存过期或没有缓存则 `force` 请求 |
| 切换今日/本周/本月 | 有该 key 缓存先显示，再按 TTL 判断是否请求                        |
| 切换语言           | 同上，不预取所有语言                                              |
| 点「刷新」         | `force=true`；按钮在请求中禁用                                    |
| 自动刷新           | 默认 10 分钟；只在页面可见且没有进行中请求时触发                  |
| 页面重新可见       | 若缓存已超过 TTL，立即刷新一次；不等待下一个计时点                |
| 页面隐藏 / 卸载    | 停止计时器；不后台轮询                                            |
| 请求失败且有缓存   | 显示缓存 + `stale` 提示 + 重试按钮                                |
| 请求失败且无缓存   | 错误态 + 重试；不显示空榜单                                       |

「实时」的边界：GitHub 源自身更新频率未知，10 分钟是体验与请求礼貌的折中；手动刷新可随时拉新。

### 5.6 IPC 与安全

新增通道：

```ts
trendingList: 'trending:list'
trendingOpen: 'trending:open'
```

桥接：

```ts
trending: {
  /** allowStale：只读缓存，可能返回 null；普通查询返回最新结果或抛错 */
  list(query: TrendingQuery): Promise<TrendingResult | null>
  open(fullName: string): Promise<void>
}
```

校验（`validation.ts`）：

- `period` 必须是 `daily | weekly | monthly`；
- `language` 必须是语言白名单中的值或空；
- `force` / `allowStale` 必须是 boolean；
- `fullName` 必须匹配 `^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`，且不能含 `..`、不能有第三段；
- `open` 不接收 URL，只接收 `owner/repo`，主进程自己拼 `https://github.com/${fullName}`，再用 `shell.openExternal` 打开；
- `shell.openExternal` 失败返回用户可读错误，不把原始异常抛给渲染层。

安全边界：

- 只访问固定域名，不接受任意 URL / 代理地址；
- 不读取、不存储 GitHub Token；
- 描述只作为纯文本渲染，禁止 `dangerouslySetInnerHTML`；
- 语言色先做十六进制校验再放进 `style`；
- 日志只记录条数、来源、耗时、HTTP 状态，不记录页面正文。

### 5.7 页面与交互

入口：开发工作台 → **开源热榜**（`view: 'trending'`），排在「编程 Agent」之后。

```text
┌ 开源热榜 ─────────────────────────────────────────────────────────┐
│ [今日] [本周] [本月]   语言：全部 ▾   搜索当前榜 [        ]        │
│ 更新于 23:25 · GitHub Trending · 10 个项目        [10 分钟 ▾] [刷新] │
├──────────────────────────────────────────────────────────────────┤
│ 01  meta / astryx                                   [复制] [打开]  │
│     An open source design system that's fully ...                │
│     ● TypeScript   ★ 32.4 万   +2,842 今日   Fork 3.2 万          │
├──────────────────────────────────────────────────────────────────┤
│ 02  ...                                                           │
└──────────────────────────────────────────────────────────────────┘
```

- 页签用现有 `.segmented` / `.segment`；
- 语言、刷新间隔用 `Dropdown`，不用原生 `<select>`；
- 搜索框只过滤当前已加载列表（名称、简介、语言），不重新请求；
- F5 只刷新榜单，`preventDefault` 阻止整页重载，和 Token 统计页保持一致；
- 前三名排名用金色，其余用 `--text-dim`；
- 每行展示：排名、`owner / repo`（owner 次要色）、简介两行截断（为空显示「暂无简介」）、语言色点 + 语言、总 Star、本期新增、Fork；
- 操作：复制仓库链接（`window.toolbox.system.copyText`）、在浏览器打开（`trending.open`）；
- 不加载头像/截图，避免 CSP 和额外网络请求；
- 空态：
  - 搜索无匹配：「没有匹配的项目，清空搜索试试」；
  - 主源和兜底都为空：「GitHub 暂时没有返回榜单，请稍后刷新」；
- 降级态：
  - `stale` 且 `warning` 非空：`status-banner` 显示「网络请求失败，正在显示 23:15 的缓存」+ 重试；跨天时显示 `11-09 23:15`，不能只显示时间让人误以为是今天；
  - `stale` 但 `warning` 为空：只是首屏缓存占位，显示轻量「更新中」提示，不弹错误横幅；
  - Search 兜底：来源标签显示「GitHub 搜索兜底 · 近期新建项目」，本期新增显示 `—`；
- 无障碍：页签用 `role="tablist"` / `aria-selected`，列表用 `<ol>`，按钮有 `aria-label`，焦点态沿用全局 `:focus-visible`；
- 宽度 1024 时工具栏换行，列表操作按钮不挤压标题。

### 5.8 偏好持久化

`localStorage` key：`toolbox.github-trending.prefs.v1`

```ts
interface TrendingPrefs {
  period: TrendingPeriod
  language: string
  refreshInterval: '0' | '5' | '10' | '30'
}
```

读取时逐字段校验，非法值回退默认；默认 `daily` / 全部语言 / 10 分钟。搜索词不持久化，避免下次进入看到被过滤的榜单。

### 5.9 日志

- INFO：`[GithubTrending] 榜单更新`，记录 period、language、source、count、durationMs；
- WARN：主源解析 0 条 / 请求失败转兜底 / 缓存损坏；
- ERROR：主源与兜底都失败且无缓存；
- 不输出 HTML、仓库简介全文、任何凭据。

## 6. 实施步骤（P0）

1. **共享契约**：新增 `shared/github-trending.ts`，补 `ipc-contract.ts` 两个通道；跑 typecheck。
2. **解析器**：实现 `parse.ts` + fixture 测试，覆盖正常条目、缺简介/语言、HTML 实体、坏条目、0 条。
3. **缓存**：实现 `cache.ts` + 原子写入/版本/淘汰测试。
4. **服务**：实现 `service.ts`、`search-fallback.ts`，注入 `fetchImpl`，覆盖主源成功、主源失败转兜底、双失败用缓存、并发去重、force 绕过 TTL。
5. **IPC**：新增 `trending-ipc.ts`，补 `validation.ts`、`register-ipc.ts`、`main/index.ts`、`bridge.ts`、`preload/index.ts`；跑桌面全量 test/lint。
6. **渲染层**：`trending-prefs.ts`、`trending-store.ts`、页面/工具栏/卡片组件、`AppView`/入口/图标/命令面板；跑 typecheck。
7. **样式**：`global.css` 新增 `/* ============ 开源热榜 ============ */`，用现有令牌；1280×820 与 1024×680 目视核对。
8. **文档与验证**：更新 README / ROADMAP / CAPABILITY_MAP；补 `verify/desktop-ui/trending.cjs` 的桩数据用例（是否跑全量 verify 由用户确认）。

预计工作量：P0 约 1.5–2 个工作日；不新增依赖，不需要数据库迁移。

## 7. 测试与验收

### 自动化

| 范围                      | 用例                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse.test.ts`           | 两条正常条目；无简介/无语言；`&amp;` / `&#39;` 实体；仓库名带点/连字符；缺 Star 链接；0 条抛错；HTML 截断不崩                                                                                                                      |
| `cache.test.ts`           | 版本不匹配丢弃；损坏 JSON 回退；按时间淘汰；tmp 写入失败不影响返回值                                                                                                                                                               |
| `service.test.ts`         | 主源成功；主源 500 → 搜索兜底；主源 0 条 → 兜底；双失败 + 缓存 → `stale` + `warning`；双失败无缓存 → 抛用户可读错误；10 分钟内第二次调用不再请求；并发只请求一次；`force` 绕过 TTL；`allowStale` 只读缓存且不联网、无缓存返回 null |
| `search-fallback.test.ts` | 查询串日期/语言/阈值正确；JSON 映射；`periodStars = null`；403/429 文案                                                                                                                                                            |
| `validation.test.ts`      | 非法 period / language / force / allowStale；`owner/repo` 路径穿越、第三段、空段                                                                                                                                                   |
| IPC                       | handler 只调用服务，不把异常实例跨进程传；`open` 只接受合法仓库名                                                                                                                                                                  |

命令（按仓库验证门槛）：

```bash
npm run typecheck
npm run lint -- --ignore-pattern "mobile/**"
npm run test -- --exclude "mobile/**"
npm run build
```

UI 改动另做 1280×820 / 1024×680 截图核对；新增的 `verify/desktop-ui/trending.cjs` 若纳入全量脚本，运行前单独征求同意。

### 手工验收

1. 有网络：进入页面能看到今日榜单；切本周/本月，标题、本期新增文案随之变化。
2. 语言筛选 TypeScript / Python / Go，列表变化且不闪空屏；切回全部命中缓存。
3. 点刷新，时间戳更新；连续快点不产生并发重复请求。
4. 断网后刷新：有缓存时显示缓存 + 降级提示；无缓存时显示错误 + 重试，不崩溃。
5. 用浏览器开发者工具或临时改坏选择器，确认主源 0 条时走 Search 兜底且来源标注正确。
6. 点「打开」只打开 `https://github.com/owner/repo`；非法仓库名被拒绝。
7. 页面隐藏 10 分钟后回来，只有可见时才触发刷新；离开页面无定时器残留。

## 8. 风险与回滚

| 风险                    | 影响                  | 对策                                                                      |
| ----------------------- | --------------------- | ------------------------------------------------------------------------- |
| GitHub 改 HTML 结构     | 主源解析失败          | 容错选择器 + fixture 测试 + Search 兜底 + 来源标签；改版时只修 `parse.ts` |
| 反爬 / 限流 / 网络不通  | 请求失败或返回空页    | 低频缓存、超时重试、失败保留缓存、明确提示；不批量抓取                    |
| Search 兜底口径不同     | 用户误以为是 Trending | 来源标签写清「搜索兜底 · 近期新建」，本期新增显示 `—`                     |
| 10 分钟缓存不够「实时」 | 用户觉得旧            | 手动刷新随时可用；文案写明「更新于 HH:mm」；后续可调 TTL                  |
| 新增 IPC 漏改四处       | 运行时 `undefined`    | 按 shared → contract → preload → main 顺序改，typecheck 兜底              |
| 外链安全                | 打开任意 URL          | 只接受 `owner/repo`，主进程拼固定 GitHub 域名                             |
| 无系统代理时访问失败    | 国内网络不可用        | 优先 `net.fetch` 走系统代理；失败给可读提示，后续再做代理设置             |

回滚：删除页面入口和 IPC 注册即可恢复旧行为；缓存 JSON 留在 `userData` 不影响旧版本；无 schema 变更、无数据迁移。

## 9. 授权与已确认选择

### 已获授权（2026-11-11）

- 新增 2 个 IPC 通道：`trending:list`、`trending:open`，并同步 `shared/bridge.ts`、`preload/index.ts`、`register-ipc.ts`。
- 不修改数据库结构；不新增第三方依赖；不修改加密链路。

### 已按推荐项确认

1. **入口**：独立「开源热榜」页。
2. **数据源**：Trending + Search 兜底。
3. **首版范围**：榜单 + 复制/打开；不做站内 README、收藏、Star 历史。
4. **刷新**：默认 10 分钟，可手动刷新，可在 5 / 10 / 30 分钟与关闭之间切换。
