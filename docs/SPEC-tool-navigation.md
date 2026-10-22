# 开发者工具搜索与排序

## 目标与范围

用户已要求补齐工具搜索、拖动排序，并把常用工具放到前面。
保留当前工具分组与面板，不增加依赖，不修改数据库结构或 IPC 通道；
使用现有 `config:get/set` 保存 `toolOrder` 字段，主进程逐项校验。

| 能力 | 职责 | 依赖 |
| --- | --- | --- |
| tool-search | 按名称、描述、英文 id 搜索，多词同时匹配，保持用户顺序 | 现有 registry |
| tool-order | 组内拖放和 Alt+↑/↓，排序持久化及失败回退 | 现有 registry、配置桥接 |

顺序：导航纯函数及入参校验 → 配置状态与失败处理 → 搜索 / 拖放界面 → 隔离验收。

## 验收规则

- 搜索忽略大小写与全半角，最多 100 字符；清空或 Esc 恢复完整目录，Enter 打开首项。
- 搜索不会改变右侧面板；未命中有提示；切换工具继续保护未保存 Prompt 草稿。
- 搜索中禁用排序，避免对筛选后的部分目录产生歧义；空查询下通过右侧手柄拖动。
- 拖动只接受当前组的内部工具；上下半区决定插入位置，不响应外部拖入内容。
- 键盘聚焦手柄后 Alt+↑/↓ 移动；排序不切换工具、不丢失当前输入。
- 排序按工具 id 保存，经现有配置合并，仅写 `toolOrder`，不覆盖主题、阅读或模板设置。
- 保存中禁用再次排序；失败回退并可重试，配置加载失败时仍可使用和搜索默认工具。
- 损坏、重复、过期的顺序安全降级；新工具保留注册顺序并追加；重启后恢复。
- 不新增第三方依赖、手机入口、IPC 通道、数据库结构或提交。

## 实现与风格

纯函数放 `renderer/src/components/tools/tool-navigation.ts`，状态在 `stores/tool-order-store.ts`，
界面沿用 `tools-page.tsx` / `tool-tree.tsx`；主进程在 `ipc/validation.ts` 校验。
使用现有主题变量、按钮类与统一图标，保持无分号、单引号与 100 字符行宽。

```ts
const next = moveTool(order, sourceId, targetId, 'before')
await window.toolbox.config.set({ toolOrder: next })
```

## 验证

Vitest 验证过滤、排序、过期数据、配置校验、并发与失败回退；
依次运行 `npm run typecheck`、`npm run lint`、`npm run test`，再 `npm run build`。
隔离 Electron 验证真实拖动、键盘、草稿保护、保存失败及重启恢复，
在 1280×820、1024×680 和三套主题下目视检查；不访问真实 toolbox.db。

边界：当前为组内排序，不跨组；搜索词不保存；无桥接或配置读写失败时禁止保存顺序并给出恢复入口。

## 实现记录

- 通过现有 `ToolboxStore.configSet` 合并补丁，仅写 `toolOrder`，不改变其他配置。
- `tool-navigation.ts` 使用有界 id 和纯数组操作，不执行搜索表达式；旧顺序与分组保持兼容。
- 手柄原生拖动仅接受组件内部来源；键盘替代方式保留焦点，保存中拒绝后续排序。
- 搜索不自动切换工具；中文输入法组合态忽略 Enter / Esc，原 Prompt 草稿保护保持有效。
- 新增 11 项单测；`typecheck`、`lint`、758 项测试 / 67 文件、`build` 均通过，无最终错误或告警。
- 未改 `src/shared/`、手机端、schema 或协议，未新增依赖；手机端验证不重复执行。

## 验收结果（2026-10-22）

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 最终通过，0 errors / 0 warnings |
| `npm run test` | 758 项 / 67 文件通过，新增 11 项 |
| `npm run build` | 通过，无告警 |
| `node verify/desktop-ui/run.cjs --tool-navigation-only --screenshots` | 10 项通过，页面异常 0 项 |
| `node verify/desktop-ui/run.cjs --tools-only --screenshots` | 26 项通过，页面异常 0 项；含中文组合输入、原工具精度、跨工具流转、模板和重启恢复 |
| 最终样式检查 | 错误提示无横向溢出，Tab 导航目录焦点可见；截图已目视确认 |

截图位于忽略目录 `.playwright-mcp/desktop-ui/`，包括搜索、拖动后的目录、三套主题、
窄窗与保存失败。验收使用临时配置和合成桥接，没有读取真实用户数据库或启动模型请求。
本轮未重复无关桌面模块全量 UI 回归；原 OpenCode 实现已独立提交为 `6077279`，
当前搜索 / 排序改动按本轮范围保留未提交。
