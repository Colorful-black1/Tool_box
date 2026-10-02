# Roadmap：Tool_box 待办与验收清单

本文件记录**当前状态、尚未验证的风险、以及后续要做的事**。
与 `SPEC-chat-mvp.md`（聊天功能的原始需求规格）不同，这份是滚动更新的执行清单。

最近更新：M3 / M4 / M5 三个界面全部完成并通过自动化验证，**M1–M5 均未经过真机验收**。

---

## 1. 当前状态

| 里程碑 | 内容                                                              | 状态                   |
| ------ | ----------------------------------------------------------------- | ---------------------- |
| 桌面端 | 设置多档案、OpenCode Go 会话头、封面相对路径、schema v4           | 已完成                 |
| M0     | 手机端骨架：5 个 Tab、主题令牌、跨目录复用、Metro 配置            | 已完成                 |
| M1     | 数据层与加密：11 张表、分段迁移、AES-256-GCM、双 SecureStore 密钥 | 已完成，**未真机验收** |
| M2     | 流式对话：自写 SSE、档案管理、会话列表、消息流、设置页            | 已完成，**未真机验收** |
| M3     | 记事本界面：列表、编辑、防抖自动保存、删除                        | 已完成，**未真机验收** |
| M4     | 阅读器界面：书架 / TXT 导入 / 分组 / 排序 / 阅读 / 书签 / 统计   | 已完成，**未真机验收** |
| M5     | 密码箱界面：首字母分组、编辑、批量导入、AI 识别、复制              | 已完成，**未真机验收** |

M3–M5 全程**零新增第三方依赖**：文件选择用 `expo-file-system@57` 自带的
`File.pickFileAsync`，剪贴板用 react-native core 的 `Clipboard`（已 `@deprecated`）。

自动化验证现状：

| 项           | 命令                                             | 期望                          |
| ------------ | ------------------------------------------------ | ----------------------------- |
| 单元测试     | `npm run test`                                   | 370 项通过                    |
| 数据层端到端 | `npm run mobile:verify:data`                     | 75 项通过                     |
| 类型         | `npm run typecheck` + `npm run mobile:typecheck` | 无错误                        |
| 规范         | `npm run lint`                                   | 无告警（0 errors / 0 warnings） |
| 打包         | `npm run mobile:bundle`                          | 成功（935 模块 / 2.3 MB）     |

---

## 2. 【最高优先级】真机验收（M1–M5 全部未验）

**这是当前唯一的阻塞项。** M1–M5 的运行时行为全部只在
「真实 SQLite + 真实 AES-256-GCM」的 Node/Electron 环境验证过，
**三个原生模块从未在真机上执行过**。M3–M5 的界面代码一行都没在真机跑过。

### 前置

```bash
npm run mobile:start
```

手机装 Expo Go（SDK 57），与电脑同一局域网。二维码用**手机相机**扫，
或手填 `exp://<电脑IP>:8081`。

> 终端里的 `Web Bundling failed ... react-native-web` 是**无关噪音**。
> 本项目不做 web，`react-native-web` 未安装；只要 Android bundle 能构建即可。

### 逐项检查

每一步都对应一个本地无法覆盖的风险点，请按顺序走并记录结果。

| #   | 操作                                | 期望                                 | 验证了什么                                                          |
| --- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| 1   | 启动 App                            | 底部 5 个 Tab 都在                   | 开库 + 迁移在真机不崩；`expo-sqlite` 可用                           |
| 2   | 设置 → 新建档案，填地址与 Key，保存 | 列表出现该档案且标「已启用」         | `expo-secure-store` 读写、`expo-crypto` 加解密                      |
| 3   | 重启 App                            | 档案仍在，`hasApiKey` 为真           | 密钥真正落盘且能重新解出                                            |
| 4   | 编辑该档案，API Key 留空保存        | 不报错，Key 未被清空                 | 「留空沿用旧 Key」语义                                              |
| 5   | 点「拉取模型列表」                  | 实时列表，或明确标注的推荐列表       | 网络 + `expo/fetch` 基本可用                                        |
| 6   | 对话 → 新建 → 发一条                | **逐字出现**回复                     | SSE 解析、`expo/fetch` 的流式 body、`x-opencode-session` 是否被放行 |
| 7   | 生成中点「停止」                    | 立刻停住，不报错；会话不残留半截消息 | 停止语义                                                            |
| 8   | 同一会话连发两条                    | 提示「正在生成回复」                 | 并发保护                                                            |
| 9   | 用 OpenCode Go 档案发一条           | 不报 400 missing session             | `x-opencode-session` 在 RN 下真实生效                               |
| 10  | 断网后发一条                        | 提示「无法连接 AI 服务」             | RN 网络错误文案映射                                                 |
| 11  | 记事本 → 新建 → 写几行 → 等 1 秒    | 顶部显示「已保存」；**杀掉 App 重进仍在** | 防抖自动保存真落库                                          |
| 12  | 记事本 → 写完立刻点「返回」          | 内容不丢                              | 返回前兜底落盘生效                                                  |
| 13  | 书架 → 导入 → 选一个 UTF-8 的 TXT   | 出现在列表，章节数合理                | `File.pickFileAsync` 系统文件选择器真机可用                        |
| 14  | 书架 → 导入 → 选一个 **GBK** 的 TXT | 明确提示「转存为 UTF-8」，不乱码      | 自写编码探测的拒绝分支                                             |
| 15  | 点开一本书 → 左右翻页 → 退出 → 重进 | 回到上次那页                          | 分页 + 进度换算 + 落盘                                             |
| 16  | 阅读器 → 切「上下滚动」→ 滚到中间退出 | 重进后停在原处                        | 滚动比例换算与 `scrollTo` 挂起跳转                                 |
| 17  | 阅读器 → 改字号                     | **页码不跳回第一页**                  | 「只有换章才兑现进度」的判重逻辑                                   |
| 18  | 阅读器 → 点「☆」→ 目录 → 书签      | 书签在列表里，片段正确                | 书签写入与列表展示                                                  |
| 19  | 书架 → 统计                         | 今日时长 / 字数大于 0                | `addStatsToday` 在切章与退出时结算                                 |
| 20  | 密码箱 → 新建 → 保存 → 复制密码     | 剪贴板里是明文密码                    | **core `Clipboard` 在 RN 0.86 上真机可用**（见下方风险）           |
| 21  | 密码箱 → 导入 → 「按格式」→ 填示例   | 解析出 2 条，预览正确                 | `parsePasswordText` 跨端复用                                       |
| 22  | 密码箱 → 导入 → 「AI 识别」         | 识别出条目并可导入                    | `complete()` 非流式链路真机可用                                   |

| 23  | 对话 → 点输入框弹键盘                          | 输入框与发送按钮浮在键盘上方；消息列表不被遮 | 自建 `useKeyboardInset` 避让       |
| 24  | 逐页翻看：设置 / 书架 / 密码箱 / 记事本        | 标题不被状态栏压住；右侧按钮完整；书架筛选片是正常高度的小圆角，不是巨大椭圆 | 安全区 + `ChipRow` + `ScreenHeader` |
| 25  | 密码箱 → 导入 → 多行文本框                      | 能滚到输入框上方，底部按钮可点                  | 滚动容器按键盘高度补底部内边距     |

### 已知需要重点观察的风险

- **⚠️ `User-Agent` 可能被原生网络栈覆盖。**
  RN 的 `fetch` 由 OkHttp / NSURLSession 发出，`User-Agent` 多数平台会被改写。
  OpenCode Go 强校验的是 `x-opencode-session`（第 9 项），UA 只是「别用通用 SDK 名」，
  风险可控但需实测。若确认被覆盖，方案是改用支持自定义 UA 的网络层，
  或在文档里标注该供应商在手机端的限制。
- **⚠️ 剪贴板用的是 core `Clipboard`（已 `@deprecated`）。**
  官方建议迁到 `@react-native-clipboard/clipboard`，本项目为避免新增原生依赖
  仍用 core 版本（第 20 项）。若真机上复制无效，第一个要换的就是它。
- **⚠️ 分页是估算的，不是测量出来的。**
  按「字宽 ≈ 字号、行高 = 字号 × 行距」估算每页容量，页面尾部可能有留白，
  换字号时页边界会变。这是有意的取舍（避免测量→二分→重排的异步竞态）。
- **原生 API 的实际行为**：SQLite 的 WAL、SecureStore 的钥匙串条目、
  解密失败时的降级路径，这些在 shim 环境里是模拟的。
- **系统文件选择器的 MIME 过滤**：`File.pickFileAsync` 本项目不传 `mimeTypes`
  （各家文件管理器把 `.txt` 报成 `text/plain` 还是 `application/octet-stream`
  并不统一，限死反而可能选不到）。若真机上根本列不出 txt，需检查系统选择器的过滤。

### 出问题时

请提供 Metro 终端里的完整错误/红屏堆栈。`verify:data` 的 shim 环境无法复现真机问题，
不要指望用它定位原生层故障。

---

## 3. M3 / M4 / M5 已完成

三个界面的**数据层在 M1 就已就绪**（`mobile/src/data/store.ts` 覆盖笔记、书籍、
章节、进度、书签、分组、统计、密码箱），本轮只补界面与所需的纯逻辑。
统一取舍：**零新增第三方依赖**。

### M3 记事本 — 已完成

- [x] 列表：展示标题与摘要，长按删除（`Alert` 二次确认）
- [x] 新建 / 编辑（标题 + 多行正文）
- [x] 防抖自动保存（700ms）+ 显式「保存」按钮 + 返回前兜底落盘
- [x] 删除（列表长按 / 编辑页按钮）
- 文件：`mobile/src/ui/notes/notes-list-screen.tsx`、`note-editor-screen.tsx`

> **排序说明**：数据层 `listNotes` 的 SQL 固定为 `updated_at_ms DESC`（最近更新优先），
> 与本节原先写的「按创建时间倒序」不同。**刻意不改数据层顺序** ——
> 它被 `verify:data` 与 `store.test.ts` 断言覆盖，且「刚编辑过的笔记在最上面」
> 对随手记的场景更有用。

> **自动保存的并发正确性**：不能用 `dirty` 布尔值。保存是异步的，用户在请求飞行
> 途中继续打字时新改动会把 dirty 置回 true，旧请求 resolve 时又抹成 false，
> 新内容就永远等不到下一次保存。改用单调递增的修订号，
> 保存回来只标记「至少已存到这个版本」。

### M4 阅读器 — 已完成

- [x] 书架：导入 TXT、分组增删改、归组、四种排序、搜索、删除
- [x] 排序：**↑↓ 按钮**（非拖拽，见下方取舍），仅在「手动」排序下可用
- [x] 章节列表与正文渲染
- [x] 两种阅读模式：上下滚动 / 左右翻页（切换时按百分比互换位置，不丢进度）
- [x] 阅读进度保存与恢复（含滚动模式的位置挂起跳转）
- [x] 书签：添加 / 删除 / 跳转
- [x] 阅读统计：今日 / 累计时长与字数 + 最近 7 天
- [x] 字体、字号、行距、主题（`READER_THEMES`）、夜间模式、翻页方式
- [x] 复用桌面端 `parseChapters`（已通过 `shared-bridge` 桥接）
- 文件：`mobile/src/ui/reader/`（`bookshelf-screen` / `book-reader-screen` /
  `reader-settings-sheet` / `reading-stats-screen`）+ 纯逻辑 `paginate.ts`、
  `bookshelf-sort.ts` + 数据侧 `text-decoder.ts`、`book-import.ts`、`reader-config.ts`

**本轮的取舍与已知限制**

| 项 | 决定 | 原因 |
| --- | --- | --- |
| 拖拽排序 | 改用 ↑↓ 按钮 | RN 无内置拖拽，`react-native-draggable-flatlist` 是新原生依赖 |
| ↑↓ 生效范围 | 仅「手动」排序 | `reorderBooks` 按传入顺序重写 `sort_index`；其他模式下按显示顺序回写会让「最近在读」与手动序互相打架 |
| 书籍封面 | **未做**，路径保持空 | 需要 `expo-image-picker`；`store.setBookCover` 已就绪，接上 UI 即可 |
| TXT 编码 | UTF-8 / UTF-16LE / UTF-16BE | Hermes 的 `TextDecoder` 只可靠支持 UTF-8；GBK/ANSI **明确报错**提示转存，不静默乱码 |
| 分页方式 | 估算每页容量，不做测量后切页 | 测量→二分→重排的异步竞态多；误差只影响页面尾部留白 |
| `pageMode: 'cover'` | 归一到 `'horizontal'` | 桌面端的覆盖层翻页依赖图片层与手势层，手机端没实现 |
| 字体选项 | 用 `serif` / `sans-serif` / `monospace` | 不复用桌面端 `FONT_OPTIONS`（SimSun 等是 Windows 字体名，Android/iOS 不存在，写进去只会静默回退，用户点了像没反应） |

> **为什么不用桌面端的 `decodeText`**：它签名是 `decodeText(bytes: Buffer)`，
> 且 GBK 分支依赖 Node 的 `TextDecoder('gbk')`（需完整 ICU）。手机端没有 Buffer，
> 所以 `text-decoder.ts` 自己手写 UTF-16 解码与 UTF-8 合法性校验（纯函数，可单测）。

### M5 密码箱 — 已完成

- [x] 列表 + 拼音首字母分组（复用数据层算好的 `first_letter`，不在前端重算）
- [x] 搜索（名称 / 账号 / 网址）+ 收藏筛选
- [x] 新建 / 编辑 / 删除 / 收藏
- [x] 复用桌面端 `parsePasswordText` 做固定格式文本批量导入（带预览与重复标记）
- [x] 复制账号 / 密码到剪贴板
- [x] AI 识别：新增 `AiGateway.complete()`（非流式）+ `password-recognizer.ts`
- 文件：`mobile/src/ui/passwords/` + `mobile/src/ai/complete-chat.ts`、
  `password-recognizer.ts`

**本轮的取舍与已知限制**

- **AI 识别走非流式**：桌面端的 `complete` 是非流式一次性调用，手机端原先只有流式
  `send`。新写的 `completeChat` 刻意**不进 `active` 表**（否则同一会话正在流式时
  点识别会被误判成「正在生成回复」）、**不落库**、超时单独给 45s。
- **AI 识别要求模型只吐 JSON 数组**（不用 Markdown 表格：解析表格要处理对齐空格、
  转义竖线、模型多写的前言，脆得很）。解析前剥 ```` ```json ```` 围栏、
  逐字符跟踪括号与字符串状态，能吃下 `remark` 里带 `]` / `}` 的情况。
- **`complete()` 的一次性 sessionId 用 `Math.random` 生成**：它只是 OpenCode Go 的
  路由 / prompt 缓存键，**不是凭据**；这样就不必把 `expo-crypto` 引进要在 vitest
  的 node 环境跑的纯逻辑模块。对话链路仍用 `conversationId`（必须逐轮稳定）。
- **⚠️ 解密失败的条目禁止保存**：此时 `entry.password` 是占位提示而不是真实密码，
  `savePassword` 又会无条件重新加密后覆盖 —— 一次误存就会把原始密文永久替换成
  占位文本。编辑页直接拦住并提示「删除后重建」。
  要支持「只改元数据、保留原密文」，得给数据层加一条局部更新路径。
- **剪贴板用 core `Clipboard`**（已 `@deprecated`），见第 2 节第 20 项。

---

## 4. 待用户决策

| 事项         | 说明                                                                                                          | 状态           |
| ------------ | ------------------------------------------------------------------------------------------------------------- | -------------- |
| 是否出 APK   | `mobile/eas.json` 已配好 `preview`（APK）/ `production`（AAB），但**从未执行过 EAS 构建**，需要免费 Expo 账号 | 待定           |
| 局域网外调试 | `npx expo start --tunnel` 会引入新依赖 `@expo/ngrok`                                                          | 未授权         |
| web 端       | 终端一直报 web 打包失败。补 web 需新增 `react-native-web` + `react-dom` + `@expo/metro-runtime`               | 用户已决定忽略 |
| 书籍封面     | M4 未做封面。需要 `expo-image-picker`；`store.setBookCover` 已就绪                             | 未授权新增依赖 |
| 拖拽排序     | M4 用 ↑↓ 按钮替代。真拖拽需 `react-native-draggable-flatlist`                                  | 未授权新增依赖 |
| 剪贴板换实现 | core `Clipboard` 已 `@deprecated`，可换 `@react-native-clipboard/clipboard`                    | 未授权新增依赖 |
| GBK 解码     | M4 导入不支持 GBK/ANSI（明确报错）。支持它需新增解码库                                      | 未授权新增依赖 |
| 真机自检屏   | 是否在设置页加一个「跑一遍原生绑定自检」按钮，方便换机后快速验证                                              | 待定           |

> 「未授权新增依赖」= 已在实现前问过用户并选择不加。若真机验收（第 2 节）暴露问题，
> 优先回头看这几项，它们是已知的、可通过新增依赖解决的短板。

---

## 5. 环境注意事项（换机器必读）

> ⚠️ **本节在 2026-10-01 于一台全新 Windows 机器上实测重写。**
> 原先写的「`npm run rebuild` 不能省，跳过会报 `NODE_MODULE_VERSION` 不匹配」
> **是错的** —— 那条结论来自 better-sqlite3 12 及更早（靠 prebuild-install 下载
> 特定 ABI 的二进制）。13.x 改成 Node-API 预编译后已不成立。

### 桌面端

```bash
npm install --ignore-scripts
node node_modules/electron/install.js          # 装 Electron 二进制
node node_modules/esbuild/install.js           # 校验 esbuild 原生二进制
node node_modules/vite/node_modules/esbuild/install.js
```

**为什么不能直接 `npm install`**：

npm 11 的 `@npmcli/arborist` 会**在磁盘上存在 `binding.gyp` 时合成一条
`install: node-gyp rebuild`**（见 `arborist/lib/install-scripts.js`）。
`better-sqlite3@13` 的 npm 包里同时有 `binding.gyp` 和 `prebuilds/*.node`，
于是 npm 会去调 node-gyp，在没装 MSVC 的机器上直接失败：

```text
gyp ERR! find Python - THIS VERSION OF PYTHON IS NOT SUPPORTED
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c node-gyp rebuild
```

**为什么 `--ignore-scripts` 之后要手动补几条**：它会连 electron 的
`postinstall` 一起跳过，导致 `electron/dist` 不存在、`npm run dev` 起不来。
`esbuild` 的 install 脚本只做二进制校验，也一并补上。

**`npm run rebuild` 现在是反效果的**，已于 2026-10-01 从常用命令里移除，并在
`package.json` 的 `build` 字段加上 **`npmRebuild: false`** 让打包也跳过它
（`app-builder-lib/out/packager.js` 里 `config.npmRebuild === false` 会在调用
`installOrRebuild` 之前直接 return）。原因有两条，任一条都足以否掉重编译：

1. 它会触发源码编译，在没有 MSVC 的机器上必然失败；
2. **即使成功也没有用** —— `lib/binding.js` 先找 `prebuilds/` 再找
   `build/Release`，编译产物会被直接忽略。

已实测（无 Python、无 MSVC 的全新机器）：

| 命令                    | 结果                                                |
| ----------------------- | --------------------------------------------------- |
| `npm run pack`          | 成功，`prebuilds/win32-x64.node` 进 `app.asar.unpacked` |
| `npm run dist`          | 成功，产出 124.7 MB 的 NSIS 安装包                   |
| 打包产物加载 better-sqlite3 | `ASAR_LOAD_OK sqlite=3.53.4`（用打包后的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 直接 require asar 内的模块验证） |

### 手机端

```bash
npm install --prefix mobile   # ⚠️ 独立包，故意不接根 workspaces
```

接 workspaces 会重排根 `node_modules`，覆盖 `better-sqlite3` 的构建。

### Node 版本

`engines` 要求 `>=20`。已验证可用组合：**Node 24.21.0 + npm 11.19.0**。
`better-sqlite3@13` 要求 `node >=22`，Electron 44 要求 `node >=22.12`，
所以 22.12 以下跑不动。

### Tailscale 调试的坑

若继续用 Tailscale 让手机连开发机，注意：

- **系统代理绕过列表不含 `100.*`**。本机代理为 `127.0.0.1:7890`，
  `ProxyOverride` 只有 `localhost` / `127.*` / `10.*` / `172.*` / `192.168.*`，
  Tailscale 的 `100.x` 网段会被丢给代理，导致连接失败。
- 优先让手机走**中继以外**的直连；确实走 DERP 时延迟较高但通常仍可用。
- 备用方案：`expo start --tunnel`（需先授权新增 `@expo/ngrok`）。

---

## 6. 已解决但值得记住的坑

这些都真实发生过，改动相关代码时别踩回去。

| 坑                                              | 后果                                                        | 约定                                                         |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `schema.ts` 的建表列表混入 `ALTER TABLE` 列补丁 | 真机首启崩溃（`duplicate column name: author`）             | 建表 DDL 与列补丁分开，补丁先查列                            |
| 服务容器放在 `mobile/src/app/`                  | 触发「Using src/app as the root directory for Expo Router」 | `src/app` 是 Expo Router 路由目录约定，代码放 `src/runtime/` |
| 用 RN 全局 `fetch` 做流式                       | `response.body` 为 undefined，拿不到增量                    | 必须用 `expo/fetch`                                          |
| 中文字符跨 chunk 边界                           | 乱码                                                        | `TextDecoder` 必须 `{ stream: true }` 增量解码               |
| `raceAbort` 在已中止时直接 reject               | unhandled rejection                                         | 原 promise 也要挂处理器                                      |
| 直接跨目录 `import` 桌面模块                    | 违反单一引用点约定                                          | 一律经 `mobile/src/shared-bridge.ts`                         |
| 手机端直连 `../../src/main/services/...`        | Metro 解析不了 `node:crypto`                                | 只复用纯逻辑，Node 依赖部分在手机端重写                      |
| 桌面端 `decodeText(bytes: Buffer)` 直接搬来     | 手机端没有 Buffer；GBK 还依赖 Node 的完整 ICU               | 手机端重写纯字节版，只支持 UTF-8 / UTF-16                    |
| 分页用「测量后二分切页」                        | onLayout / onContentSizeChange 的异步竞态，跳页或死循环      | 按字宽 × 行高估算每页容量，误差只影响留白                    |
| 用 `dirty` 布尔值做自动保存                      | 保存飞行途中继续打字 → 新内容永久丢失且极难复现              | 用单调递增的修订号，回调只标记「至少已存到这个版本」          |
| 改字号时无条件重置页码                            | 用户每调一次字号就跳回第一页                                | 用「已兑现进度的章节 id」判重，只有换章才重置                |
| 把纯函数留在 `.tsx` 里                          | vitest 的 node 环境解析不了 `react-native`，无法单测         | 排序 / 分组 / 分页这类纯逻辑单独放 `.ts`                     |
| `Alert.prompt`                                  | **Android 上不存在**，直接抛错                              | 用自带的 `PromptModal`（`components/ui.tsx`）                |
| 沿用 README 的「`npm run rebuild` 必须」         | 无 MSVC 的机器上必然失败，且产物会被 `prebuilds/` 忽略       | 见第 5 节实测流程                                             |
| 只挂 `SafeAreaProvider` 而不消费 `useSafeAreaInsets` | 标题被状态栏压住、Tab 栏被系统导航栏压住                | 用 `Screen` 包 Tab 根节点 + Tab 栏「高度 + 底部内边距」       |
| 横向 `<ScrollView horizontal>` 直接写在 `flex:1` 纵向容器里 | RN 的 `ScrollView` 基础样式**横竖都带 `flexGrow: 1`**（`ScrollView.js` 的 `baseHorizontal`），会被拉高占满半屏 | 一律用 `components/ui.tsx` 的 `ChipRow`（内部 `flexGrow: 0`） |
| 页头文本块不加 `flex: 1`                        | 副标题按固有宽度撑开，右侧按钮被挤出屏幕（只剩半个）        | 统一用 `ScreenHeader`；按钮区 `flexShrink: 0`，标题单行截断  |
| Android 上用 `KeyboardAvoidingView` 避让        | 是否生效取决于宿主 `windowSoftInputMode`，Expo Go 不是 `adjustResize`，输入框被整块盖住 | 用 `useKeyboardInset()`：比对窗口高度自行判断要不要避让（见 `ui/keyboard.ts`） |
| 同向嵌套 `ScrollView`（设置页 → AI 配置区）      | RN 报 "VirtualizedLists should never be nested"，且外层滚动时内层抢手势 | 内层改用 `View`，滚动统一交给最外层                          |
| render 期间读 `ref.current`                     | 组件在该值变化时拿不到新结果；`react-hooks` 规则直接报错    | 派生值放 state，用 `useEffect` 写                             |

---

## 7. 命令速查

```bash
# 桌面
npm run dev
npm run build

# 验证（改动数据层或 AI 层后必跑）
npm run typecheck
npm run mobile:typecheck
npm run lint
npm run test
npm run mobile:bundle
npm run mobile:verify:data

# 手机端
npm run mobile:start
```
