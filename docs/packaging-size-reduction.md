# Windows 安装包精简

日期：2026-10-25。用户授权按保留全部功能的方案精简，继续随包携带 Claude Code，不制作外置运行时轻量版。

## 改动与原因

只调整 `package.json` 的 electron-builder 配置与说明文档：

- `electronLanguages: ["zh-CN", "en-US"]`，过滤多余 Electron 语言文件。
- `files` 排除依赖的 `*.map`、`*.d.ts`／`*.d.mts`／`*.d.cts`，以及依赖 `src/` 内的 `*.ts`／`*.tsx`／`*.mts`／`*.cts`；只过滤交付包，不删除开发目录中的文件。
- 不排除 JavaScript 运行文件、ESM／CommonJS 双入口、分词字典、SDK 原生程序或资源、Node-API 二进制和许可证。不切换模块打包策略、不改依赖或锁文件，也不使用 UPX 压缩可执行文件。
- 不提高 `compression` 等级；沿用 electron-builder 的正常压缩，避免为有限收益增加打包耗时。

## 基线与静态估算

检查对象为本机修改配置前的 `release/私人百宝箱 Setup 0.3.0.exe` 和 `release/win-unpacked`。下列数值是已有产物测量与过滤估算，不是新安装包实测结果。

| 项目 | 精简前 | 按规则可排除 |
| --- | ---: | ---: |
| 安装程序 | 225,366,461 字节，约 225 MB／215 MiB | 需要重新打包测量 |
| 安装目录 | 739.64 MiB | 预计约 81.97 MiB |
| Electron 语言文件 | 48.30 MiB | 保留中英文后约减少 47.17 MiB |
| 依赖 source map | 19.66 MiB | 约 19.66 MiB |
| 依赖 TypeScript 声明 | 6.04 MiB | 约 6.04 MiB |
| 依赖 `src/` 下 TypeScript 源码 | 9.09 MiB | 约 9.09 MiB |
| 内置 Claude Code 程序 | 283.04 MiB | 保留 |
| Electron 主程序 | 234.37 MiB | 保留 |

压缩后的安装程序降幅通常小于展开体积降幅，未承诺具体的新 EXE 大小。保留的 4.96 MiB 开发分支 JavaScript 也可能被依赖的运行期条件入口引用，不在本轮裁剪。

## 影响范围与静态审查

- 仅影响下一次桌面打包的文件集合；不改业务代码、数据库、IPC、加密、安全基线、手机端或已生成产物。
- 核对当前 electron-builder 26.15.3 的配置 schema 与语言过滤实现，确认配置受支持；依赖过滤使用 builder 原有 `files` 排除机制。
- 扫描旧 ASAR 内运行 JavaScript 的静态 import／require，未发现指向 TypeScript 文件的字面量导入；Node 标准运行入口采用现有 JavaScript。声明字段及 LangChain 的开发用 `input` 条件仍可留在包清单内，交付程序不使用它们。
- 静态过滤清单复核保留 Claude 原生程序、better-sqlite3、本机提示词、JavaScript 模块、分词数据与许可证。动态拼接文件读取不能仅凭静态扫描完全证明，需要新安装包验收。
- 基于旧 ASAR 的逐项静态匹配，三条新增规则可过滤 6848 个文件，与语言过滤合计约 81.97 MiB；核对 SDK 模块、Claude 原生程序、SQLite 原生模块和两种格式的分词数据仍在保留清单。`git diff --check` 通过，依赖锁文件和 Vite 构建策略未变。
- 本轮实际只增加少量打包配置，未达到 `AGENTS.md` 要求的“超过 500 有效代码行且超过 10 个文件”；不计入工作区里先前对话功能的改动。本次修改影响范围有限，未执行编译验证，也未重新打包或启动程序。未提交。

## 用户重新打包与验收

1. 执行 `npm run dist`；比较新安装程序与上方基线，并查看 `release/win-unpacked` 的占用。旧同名产物可能被打包命令覆盖，若需保留对比可先自行复制。
2. 检查 `release/win-unpacked/locales` 仅有 `zh-CN.pak`／`en-US.pak`；确认 `resources/app.asar.unpacked` 中 Claude Code 与当前架构的 SQLite 原生模块仍在。
3. 启动新版本检查页面、TXT 导入、待办和本地数据库；按原有认证状态检查对话工具调用、Claude 连接／模型目录及历史读取。不要把这份静态审查当成真实生成或安装包启动通过。
4. 若未来依赖新增 TypeScript 运行入口、专用加载器或 source map 驱动的能力，需重新评估排除规则；回退时只撤回本次 `electronLanguages` 和三条 `files` 排除规则，再重新打包。用户数据不受此回退影响。
