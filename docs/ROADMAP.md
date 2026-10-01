# Roadmap：Tool_box 待办与验收清单

本文件记录**当前状态、尚未验证的风险、以及后续要做的事**。
与 `SPEC-chat-mvp.md`（聊天功能的原始需求规格）不同，这份是滚动更新的执行清单。

最近更新：M2（流式对话）代码完成并提交，**尚未经过真机验收**。

---

## 1. 当前状态

| 里程碑 | 内容                                                              | 状态                   |
| ------ | ----------------------------------------------------------------- | ---------------------- |
| 桌面端 | 设置多档案、OpenCode Go 会话头、封面相对路径、schema v4           | 已完成                 |
| M0     | 手机端骨架：5 个 Tab、主题令牌、跨目录复用、Metro 配置            | 已完成                 |
| M1     | 数据层与加密：11 张表、分段迁移、AES-256-GCM、双 SecureStore 密钥 | 已完成，**未真机验收** |
| M2     | 流式对话：自写 SSE、档案管理、会话列表、消息流、设置页            | 已完成，**未真机验收** |
| M3     | 记事本界面                                                        | 数据层就绪，界面未做   |
| M4     | 阅读器界面                                                        | 数据层就绪，界面未做   |
| M5     | 密码箱界面                                                        | 数据层就绪，界面未做   |

自动化验证现状：

| 项           | 命令                                             | 期望                         |
| ------------ | ------------------------------------------------ | ---------------------------- |
| 单元测试     | `npm run test`                                   | 232 项通过                   |
| 数据层端到端 | `npm run mobile:verify:data`                     | 75 项通过                    |
| 类型         | `npm run typecheck` + `npm run mobile:typecheck` | 无错误                       |
| 规范         | `npm run lint`                                   | 无告警                       |
| 打包         | `npm run mobile:bundle`                          | 成功（约 918 模块 / 2.2 MB） |

---

## 2. 【最高优先级】M2 真机验收

**这是当前唯一的阻塞项。** M1 与 M2 的运行时行为全部只在
「真实 SQLite + 真实 AES-256-GCM」的 Node/Electron 环境验证过，
**三个原生模块从未在真机上执行过**。

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

### 已知需要重点观察的风险

- **⚠️ `User-Agent` 可能被原生网络栈覆盖。**
  RN 的 `fetch` 由 OkHttp / NSURLSession 发出，`User-Agent` 多数平台会被改写。
  OpenCode Go 强校验的是 `x-opencode-session`（第 9 项），UA 只是「别用通用 SDK 名」，
  风险可控但需实测。若确认被覆盖，方案是改用支持自定义 UA 的网络层，
  或在文档里标注该供应商在手机端的限制。
- **原生 API 的实际行为**：SQLite 的 WAL、SecureStore 的钥匙串条目、
  解密失败时的降级路径，这些在 shim 环境里是模拟的。

### 出问题时

请提供 Metro 终端里的完整错误/红屏堆栈。`verify:data` 的 shim 环境无法复现真机问题，
不要指望用它定位原生层故障。

---

## 3. 后续里程碑

M3–M5 的**数据层都已就绪**（`mobile/src/data/store.ts` 已覆盖笔记、书籍、章节、
进度、书签、分组、统计、密码箱），缺的只是界面。

### M3 记事本

- [ ] 列表：按创建时间倒序，展示标题与摘要
- [ ] 新建 / 编辑（多行输入、自动保存或显式保存）
- [ ] 删除（`Alert` 二次确认）
- [ ] 数据层方法已存在：`listNotes` / `saveNote` / `deleteNote`

### M4 阅读器（本项目最重的一块）

- [ ] 书架：导入书籍、封面、分组、拖拽排序
- [ ] 章节列表与正文渲染
- [ ] 阅读进度保存（已实现 `progressSave`，需接 UI）
- [ ] 书签（已实现 `toggleBookmark`，需接 UI）
- [ ] 阅读统计（已实现 `addStatsToday` / `statsSummary`）
- [ ] 字体、字号、主题、翻页方式（`READER_THEMES` / `FONT_OPTIONS` 已在共享桥导出）
- [ ] 复用桌面的 `parseChapters` 与 `parseChapters` 已通过 `shared-bridge` 桥接

### M5 密码箱

- [ ] 列表 + 分组（已实现拼音首字母分组 `pinyinFirstLetter`）
- [ ] 新建 / 编辑 / 删除 / 收藏
- [ ] 复用桌面的 `parsePasswordText` 做文本批量导入
- [ ] 复制到剪贴板
- [ ] 可选：AI 识别（桌面的 `AiGateway.complete` 是非流式一次性调用，手机端需单独实现）

---

## 4. 待用户决策

| 事项         | 说明                                                                                                          | 状态           |
| ------------ | ------------------------------------------------------------------------------------------------------------- | -------------- |
| 是否出 APK   | `mobile/eas.json` 已配好 `preview`（APK）/ `production`（AAB），但**从未执行过 EAS 构建**，需要免费 Expo 账号 | 待定           |
| 局域网外调试 | `npx expo start --tunnel` 会引入新依赖 `@expo/ngrok`                                                          | 未授权         |
| web 端       | 终端一直报 web 打包失败。补 web 需新增 `react-native-web` + `react-dom` + `@expo/metro-runtime`               | 用户已决定忽略 |
| M3–M5 优先级 | 三个界面都未做，先做哪个由用户定                                                                              | 待定           |
| 真机自检屏   | 是否在设置页加一个「跑一遍原生绑定自检」按钮，方便换机后快速验证                                              | 待定           |

---

## 5. 环境注意事项（换机器必读）

```bash
npm install
npm run rebuild            # ⚠️ 必须！better-sqlite3 要编译成 Electron ABI
npm install --prefix mobile # ⚠️ 手机端是独立包，未接入根 workspaces
```

- **`npm run rebuild` 不能省**：跳过后跑桌面端或 `mobile:verify:data` 会报
  `NODE_MODULE_VERSION` 不匹配。
- **手机端必须单独 `npm install`**：它故意不接 workspaces。接了会重排根
  `node_modules`，覆盖 `better-sqlite3` 的 Electron 构建。

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
