# 001 — UI 动效与点击反馈优化

- **Status**: TODO
- **Commit**: `8f5d8f5`
- **Severity**: HIGH（含 MEDIUM 项）
- **Category**: Physicality / Easing & duration / Cohesion / Accessibility
- **Estimated scope**: 2 个核心文件（`src/renderer/src/styles/global.css`、`src/renderer/src/components/popover.tsx`），约 250 行改动；其余为 CSS 补充。

## 目标

让高频点击有明确的按压反馈；让下拉、日期、更多菜单从触发点出现；让复选框、开关、弹窗、抽屉不再硬切；把动效曲线与时长收成一套令牌；补齐 `prefers-reduced-motion` 降级。

## 不在本次范围

- **命令面板开合动画**：`Ctrl/⌘ + K` 属于 100+ 次/天的高频键盘操作，保持即时出现；不要加 fade / scale。
- **聊天消息逐条入场**：消息频率高，逐条动效会变成噪音。
- **书架 / 列表 stagger**：大列表会放大等待感。
- **退场动画**：本轮只做进入。退场需要 presence / 延迟卸载，容易和焦点恢复、Esc、快速重开冲突，收益小于风险。
- **侧栏折叠、状态条、统计柱状条**：见文末「后续独立计划」。
- **不改 IPC / preload / schema / 主进程**；不新增依赖。

---

## 汇总

| Phase | 内容 | 对应问题 | 优先级 |
| --- | --- | --- | --- |
| A | Motion tokens + 按压反馈 + `transition: all` 清理 | 点击生硬、参数不统一 | P0 |
| B | Popover 进入动画与 origin | 浮层硬挂载 | P0 |
| C | 复选框 / 开关状态反馈 | 状态硬切 | P1 |
| D | 弹窗 / 抽屉进入动画统一 | 弹窗无动画、右抽屉方向错误 | P1 |
| E | `prefers-reduced-motion` 补齐 | 无障碍 | P2 |

实施顺序固定为 **A → B → C → D → E**。A 先落令牌，避免后续重复改时长和曲线。

---

## Phase A — Motion tokens 与按压反馈

### Problem

当前主要按钮只有 180ms 的 hover 抬起，按下时没有缩放；ghost、icon、下拉触发器按下只换背景色；tab、菜单行、关闭按钮、摘录 / 复制按钮甚至没有 transition。用户看到的是颜色硬切，而不是“按下去”的物理反馈。

```css
/* src/renderer/src/styles/global.css:1634 — current */
.btn-gold {
  transition:
    filter 0.18s,
    box-shadow 0.18s,
    transform 0.18s;
}

/* src/renderer/src/styles/global.css:1699 — current */
.btn-gold:active:not(:disabled) {
  transform: translateY(0);
  filter: brightness(0.96);
}

/* src/renderer/src/styles/global.css:1668 — current */
.btn-ghost,
.btn-danger {
  transition:
    border-color 0.18s,
    color 0.18s,
    background 0.18s;
}

/* src/renderer/src/styles/global.css:1704 — current */
:is(.btn-ghost:where(:not(.nav-group-toggle)), .icon-btn):active:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.15);
}
```

同时还存在这些问题：

- `src/renderer/src/styles/global.css:5757` 的下拉触发器只有 `border-color / color / background` 过渡，没有按下反馈。
- `src/renderer/src/styles/global.css:3399` 的 `.sheet-tab` 完全没有 transition。
- `src/renderer/src/styles/global.css:3421` 的 `.sheet-close` 没有 hover / active 样式，点击像死键。
- `src/renderer/src/styles/global.css:5835` 的 `.ui-dropdown-item`、`3148` 的 `.reader-excerpt-btn`、`6131` 的 `.message-copy` 都没有过渡。
- 全文件有 19 处 `transition: all`、7 种 transition 时长、3 条自定义贝塞尔，没有 motion token。
- `.icon-btn` 有两套定义（`1719` 与 `6376`），前者还保留 `transition: all 0.2s`。

### Target

在 `src/renderer/src/styles/global.css:1013` 的 `:root, .theme-preview` 块末尾追加令牌。曲线复用项目现有的 `cubic-bezier(0.22, 0.9, 0.3, 1)`（已在 `3117` 翻页、`3372` sheet-in、`6492` view-in 使用），不要另造一套。

```css
/* target — :root, .theme-preview 末尾 */
--ease-out: cubic-bezier(0.22, 0.9, 0.3, 1);
--dur-press: 120ms;
--dur-hover: 160ms;
--dur-pop: 180ms;
--dur-overlay: 220ms;
--dur-view: 260ms;
```

主按钮：按下 120ms，松开 160ms；按下 `scale(0.98)`，不要只把 `translateY` 归零。

```css
/* target — .btn-gold */
.btn-gold {
  transition:
    filter var(--dur-hover) var(--ease-out),
    box-shadow var(--dur-hover) var(--ease-out),
    transform var(--dur-hover) var(--ease-out);
}

.btn-gold:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
  filter: brightness(0.96);
  transition-duration: var(--dur-press);
}
```

次级控件：统一 `scale(0.97)`；菜单行 / tab 只做背景与颜色，不做缩放。

```css
/* target — 次级按钮 */
.btn-ghost,
.btn-danger {
  transition:
    border-color var(--dur-hover) var(--ease-out),
    color var(--dur-hover) var(--ease-out),
    background-color var(--dur-hover) var(--ease-out),
    transform var(--dur-hover) var(--ease-out);
}

:is(
  .btn-ghost:where(:not(.nav-group-toggle)),
  .btn-danger,
  .icon-btn,
  .ui-dropdown-trigger,
  .rail-toggle,
  .sheet-close,
  .reader-excerpt-btn
):active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: var(--dur-press);
}
```

`transition: all` 的替换映射见 **Appendix A**。不要只做字符串替换，必须确认 hover / active / focus 实际改变了哪些属性。

### Steps

1. 在 `global.css:1054`（`:root, .theme-preview` 块末尾）加入上面 6 个令牌。
2. 修改 `.btn-gold`（`1614`）的 `transition`，并替换 `1699` 的 `:active` 规则。
3. 修改 `.btn-ghost, .btn-danger`（`1652`）的 `transition`，把 `1704` 的 active 规则扩展到 `.btn-danger`、`.ui-dropdown-trigger`、`.rail-toggle`、`.sheet-close`、`.reader-excerpt-btn`。
4. 删除 `global.css:1730` 第一段 `.icon-btn` 里的 `transition: all 0.2s;`；把 `6376` 第二段 `.icon-btn` 的 transition 换成显式的 `border-color / color / background-color / transform`。
5. 修改 `.ui-dropdown-trigger`（`5742`）：transition 增加 `background-color`、`transform`。
6. 给 `.sheet-tab`（`3399`）加：
   ```css
   transition:
     background-color var(--dur-hover) var(--ease-out),
     color var(--dur-hover) var(--ease-out),
     opacity var(--dur-hover) var(--ease-out);
   ```
   并补一个 hover 态（未选中时 `color: var(--text-hi)`，背景 `rgba(var(--neutral-rgb), 0.04)`）。
7. 给 `.sheet-close`（`3421`）补 hover / focus / active：
   ```css
   .sheet-close {
     transition:
       border-color var(--dur-hover) var(--ease-out),
       color var(--dur-hover) var(--ease-out),
       transform var(--dur-hover) var(--ease-out);
   }
   .sheet-close:hover:not(:disabled) {
     border-color: var(--gold);
     color: var(--gold);
   }
   .sheet-close:focus-visible {
     outline: 1px solid var(--gold);
     outline-offset: 2px;
   }
   ```
8. 给 `.ui-dropdown-item`（`5835`）加 `background-color / color` 的 120ms 过渡，让 hover 和键盘 `highlighted` 不再瞬间跳变。
9. 给 `.reader-excerpt-btn`（`3148`）补 `border-color / color / transform` 过渡；给 `.message-copy`（`6131`）补 `color 120ms` 过渡。
10. 调整导航：
    ```css
    .nav-item {
      transition:
        color var(--dur-hover) var(--ease-out),
        background-color var(--dur-hover) var(--ease-out),
        border-color var(--dur-hover) var(--ease-out);
    }
    .nav-item svg {
      transition: opacity var(--dur-hover) var(--ease-out);
    }
    .nav-item:active {
      background-color: rgba(var(--accent-rgb), 0.12);
    }
    .nav-item.active {
      color: var(--gold);
      border-color: var(--gold-line);
      background-color: rgba(var(--accent-rgb), 0.08);
    }
    .rail-toggle {
      transition:
        border-color var(--dur-hover) var(--ease-out),
        color var(--dur-hover) var(--ease-out),
        background-color var(--dur-hover) var(--ease-out),
        transform var(--dur-hover) var(--ease-out);
    }
    ```
    选中态背景沿用 `.opencode-session-item.active`（`5053-5056`）的现有范式；`.rail-toggle` 的 `:active` scale 已包含在步骤 3 的统一规则里。
11. 按 Appendix A 替换其余 `transition: all`。没有对应状态变化的属性不要写进 transition。
12. 把 `.view-enter`（`6491`）改成 `animation: view-in var(--dur-view) var(--ease-out);`，并把 `@keyframes view-in` 的 `translateY(10px)` 改成 `translateY(6px)`。

---

## Phase B — Popover 进入动画与 origin

### Problem

所有 Dropdown、DatePicker、Agent 更多菜单、上下文菜单都复用 `Popover`。Portal 挂载后用 `visibility` 直接切成可见，没有 origin、没有 scale；触发器 caret 在 150ms 旋转，菜单却瞬间出现，空间关系断开。

```tsx
// src/renderer/src/components/popover.tsx:56-79 — current
const rect = trigger.getBoundingClientRect()
const box = element.getBoundingClientRect()
const below = innerHeight - rect.bottom - 14,
  above = rect.top - 14
const flip = placement === 'top' || (below < box.height && above > below)
const available = flip ? above : below
const maxHeight =
  placement === 'top'
    ? Math.max(0, Math.min(maxPanelHeight, available))
    : Math.max(80, Math.min(maxPanelHeight, available))
const left = Math.max(
  8,
  Math.min(align === 'right' ? rect.right - box.width : rect.left, innerWidth - box.width - 8)
)
const top = flip
  ? Math.max(8, rect.top - Math.min(box.height, maxHeight) - 6)
  : rect.bottom + 6
setPosition({
  top,
  left,
  maxHeight,
  minWidth: matchAnchorWidth ? Math.min(rect.width, innerWidth - 16) : 0,
  ready: true
})
```

```tsx
// src/renderer/src/components/popover.tsx:113-129 — current
return createPortal(
  <div
    ref={panel}
    className={`ui-popover ${className}`}
    data-overlay-owner={owner ?? undefined}
    style={{
      top: position.top,
      left: position.left,
      maxHeight: position.maxHeight,
      minWidth: position.minWidth,
      visibility: position.ready ? 'visible' : 'hidden'
    }}
  >
    {children}
  </div>,
  document.body
)
```

```css
/* src/renderer/src/styles/global.css:7521 — current */
.ui-popover {
  position: fixed;
  z-index: 1200;
  max-width: calc(100vw - 16px);
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--gold-line);
  border-radius: 10px;
  background: var(--bg-menu);
  box-shadow: var(--overlay-shadow);
  color: var(--text-hi);
}
```

### Target

定位测量改用 `offsetWidth / offsetHeight`，避免动画中的 `transform: scale()` 影响 `getBoundingClientRect()`，导致位置抖动。把 origin 放进 state，按对齐 / 翻转方向设置。

```tsx
// target — state
const [position, setPosition] = useState({
  top: 0,
  left: 0,
  maxHeight: 320,
  minWidth: 0,
  originX: '0%',
  originY: '0%',
  ready: false
})
```

```tsx
// target — update()
const rect = trigger.getBoundingClientRect()
const boxWidth = element.offsetWidth
const boxHeight = element.offsetHeight
const below = innerHeight - rect.bottom - 14,
  above = rect.top - 14
const flip = placement === 'top' || (below < boxHeight && above > below)
const available = flip ? above : below
const maxHeight =
  placement === 'top'
    ? Math.max(0, Math.min(maxPanelHeight, available))
    : Math.max(80, Math.min(maxPanelHeight, available))
const left = Math.max(
  8,
  Math.min(
    align === 'right' ? rect.right - boxWidth : rect.left,
    innerWidth - boxWidth - 8
  )
)
const top = flip
  ? Math.max(8, rect.top - Math.min(boxHeight, maxHeight) - 6)
  : rect.bottom + 6
setPosition({
  top,
  left,
  maxHeight,
  minWidth: matchAnchorWidth ? Math.min(rect.width, innerWidth - 16) : 0,
  originX: align === 'right' ? '100%' : '0%',
  originY: flip ? '100%' : '0%',
  ready: true
})
```

```tsx
// target — render
return createPortal(
  <div
    ref={panel}
    className={`ui-popover ${className}`}
    data-ready={position.ready ? 'true' : 'false'}
    data-overlay-owner={owner ?? undefined}
    style={{
      top: position.top,
      left: position.left,
      maxHeight: position.maxHeight,
      minWidth: position.minWidth,
      visibility: position.ready ? 'visible' : 'hidden',
      transformOrigin: `${position.originX} ${position.originY}`
    }}
  >
    {children}
  </div>,
  document.body
)
```

```css
/* target — global.css */
.ui-popover[data-ready='true'] {
  animation: popover-in var(--dur-pop) var(--ease-out);
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

不要做退场。菜单关闭立即卸载是正确的，退场会拖慢下一次操作。

### Steps

1. 在 `popover.tsx` 的 `position` state 中增加 `originX` / `originY`，初始值 `'0%'`。
2. 把 `update()` 里的 `getBoundingClientRect()` 宽高改为 `offsetWidth` / `offsetHeight`；保留触发器的 `getBoundingClientRect()`。
3. 在 `setPosition` 中写入 `originX` / `originY`，规则：`align === 'right'` 时 X 为 `100%`，否则 `0%`；`flip` 时 Y 为 `100%`，否则 `0%`。
4. 给 `panel` 加 `data-ready`，并给 `style` 加 `transformOrigin`。
5. 在 `global.css` 的 `.ui-popover` 规则后加 `popover-in` keyframes；不要加 `animation-delay`。
6. 如果首帧动画没有播放（Electron/Chromium 偶发），把 `data-ready` 的切换放到 `useEffect` 的 `requestAnimationFrame` 中；不要延迟 `onReady` 里的焦点。

---

## Phase C — 复选框与开关的状态反馈

### Problem

复选框的勾选标记从 `scale(0)` 直接到 1，且没有 transition；开关轨道从纯色切到 `linear-gradient`，CSS 无法在颜色和渐变之间插值，所以圆点在滑、底色在硬切。

```css
/* src/renderer/src/styles/global.css:7767 — current */
input[type='checkbox'] {
  appearance: none;
  display: inline-grid;
  place-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  margin: 0;
  vertical-align: middle;
  border: 1px solid var(--gold-line);
  border-radius: 4px;
  background: rgba(var(--neutral-rgb), 0.04);
  color: var(--bg-deep);
  cursor: pointer;
}

input[type='checkbox']::after {
  content: '';
  width: 7px;
  height: 4px;
  border-left: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: translateY(-1px) rotate(-45deg) scale(0);
}

input[type='checkbox']:checked {
  background: var(--gold);
  border-color: var(--gold);
}

input[type='checkbox']:checked::after {
  transform: translateY(-1px) rotate(-45deg);
}
```

```css
/* src/renderer/src/styles/global.css:2569 — current */
.toggle-switch {
  width: 44px;
  height: 24px;
  padding: 2px;
  border: none;
  border-radius: 12px;
  background: rgba(var(--neutral-rgb), 0.14);
  cursor: pointer;
  transition: background 0.24s;
}

.toggle-switch span {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.24s;
}

.toggle-switch.on {
  background: linear-gradient(90deg, var(--gold-dim), var(--gold));
}

.toggle-switch.on span {
  transform: translateX(20px);
}
```

### Target

复选框：勾选从 `scale(0.6) + opacity 0` 到 `scale(1) + opacity 1`，120ms；背景 / 边框同步过渡。

```css
/* target — checkbox */
input[type='checkbox'] {
  transition:
    background-color var(--dur-press) var(--ease-out),
    border-color var(--dur-press) var(--ease-out);
}

input[type='checkbox']::after {
  transform: translateY(-1px) rotate(-45deg) scale(0.6);
  opacity: 0;
  transition:
    transform var(--dur-press) var(--ease-out),
    opacity var(--dur-press) var(--ease-out);
}

input[type='checkbox']:checked {
  background-color: var(--gold);
  border-color: var(--gold);
}

input[type='checkbox']:checked::after {
  transform: translateY(-1px) rotate(-45deg) scale(1);
  opacity: 1;
}
```

开关：保留渐变视觉，用伪元素淡入，避免插值失败；圆点 160ms。

```css
/* target — toggle */
.toggle-switch {
  position: relative;
  overflow: hidden;
  background-color: rgba(var(--neutral-rgb), 0.14);
  transition: background-color var(--dur-hover) var(--ease-out);
}

.toggle-switch::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gold-dim), var(--gold));
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-out);
}

.toggle-switch.on::before {
  opacity: 1;
}

.toggle-switch span {
  position: relative;
  z-index: 1;
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--dur-hover) var(--ease-out);
}
```

### Steps

1. 替换 `global.css:7767-7796` 的复选框规则；确认 `background` 改成 `background-color` 后选中色仍然正确。
2. 在 `.toggle-switch`（`2569`）上加 `position: relative; overflow: hidden;`，把 `background` 改成 `background-color`。
3. 增加 `.toggle-switch::before` 与 `.toggle-switch.on::before`。
4. 给 `.toggle-switch span` 加 `position: relative; z-index: 1;`，把 transition 换成令牌。
5. 在待办、密码导入、AI 模型世界三个页面点一遍复选框；在设置页和阅读设置里点开关。

---

## Phase D — 弹窗与抽屉的进入动画

### Problem

确认弹窗和会话详情抽屉完全没有入场；能力抽屉是右侧面板，却复用了向下 24px 的 `sheet-in`，方向不对；所有 sheet 关闭都瞬间卸载。

```tsx
// src/renderer/src/components/app-dialog.tsx:26-33 — current
return createPortal(
  <div
    className="app-dialog-backdrop"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) answer(null)
    }}
  >
    <div
      className="app-dialog"
```

```css
/* src/renderer/src/styles/global.css:7725 — current */
.app-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}

.app-dialog {
  width: 420px;
  max-width: 100%;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--gold-line);
  border-radius: 14px;
  background: var(--bg-menu);
  box-shadow: var(--overlay-shadow);
  outline: none;
}
```

```css
/* src/renderer/src/styles/global.css:894 — current */
.usage-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(var(--backdrop-rgb), 0.55);
  backdrop-filter: blur(2px);
}

.usage-sheet {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(460px, calc(100vw - 32px));
  height: 100%;
  padding: 22px;
  overflow: auto;
  border-radius: 14px 0 0 14px;
  border-right: 0;
  background: var(--bg-deep);
}
```

```css
/* src/renderer/src/styles/global.css:3363 — current */
.sheet-panel {
  width: min(720px, 100%);
  margin-inline: auto;
  height: 70%;
  display: flex;
  flex-direction: column;
  border-radius: 16px 16px 0 0;
  border-top: 1px solid rgba(var(--accent-rgb), 0.25);
  overflow: hidden;
  animation: sheet-in 0.24s cubic-bezier(0.22, 0.9, 0.3, 1);
}

/* src/renderer/src/styles/global.css:8356 — current */
.sheet-panel.capability-sheet {
  position: fixed;
  inset: 0 0 0 auto;
  margin: 0;
  width: min(580px, 100%);
  height: 100%;
  background: var(--bg-panel);
  border: 1px solid var(--gold-line);
  border-radius: 10px 0 0 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
```

### Target

```css
/* target — overlay fade */
@keyframes overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.app-dialog-backdrop,
.sheet-backdrop,
.usage-sheet-backdrop {
  animation: overlay-fade-in var(--dur-overlay) var(--ease-out);
}

/* target — centered dialog: fade 由父层负责，面板只做位移 / 缩放 */
@keyframes dialog-in {
  from {
    transform: translateY(6px) scale(0.98);
  }
  to {
    transform: none;
  }
}

.app-dialog,
.command-editor {
  animation: dialog-in var(--dur-overlay) var(--ease-out);
}

/* target — right drawer */
@keyframes drawer-in {
  from {
    transform: translateX(24px);
  }
  to {
    transform: none;
  }
}

.usage-sheet,
.sheet-panel.capability-sheet {
  animation: drawer-in var(--dur-overlay) var(--ease-out);
}

/* target — bottom sheet 保持原方向，只换令牌 */
.sheet-panel {
  animation: sheet-in var(--dur-overlay) var(--ease-out);
}
```

`app-dialog` 是居中弹窗，`transform-origin: center` 默认即可，不需要改。`usage-sheet` / `capability-sheet` 是右侧抽屉，必须用 X 方向。

### Steps

1. 在 `global.css` 的动画区域（`6420` 附近）增加 `overlay-fade-in`、`dialog-in`、`drawer-in` 三个 keyframes。
2. 给 `.app-dialog-backdrop`、`.sheet-backdrop`、`.usage-sheet-backdrop` 加 `overlay-fade-in`。
3. 给 `.app-dialog` 与 `.command-editor`（`819`）加 `dialog-in`。
4. 给 `.usage-sheet` 加 `drawer-in`。
5. 把 `.sheet-panel` 的 `sheet-in` 时长换成 `var(--dur-overlay) var(--ease-out)`。
6. 给 `.sheet-panel.capability-sheet` 覆盖为 `drawer-in`，确认它不再向下滑。
7. 不要加退场；不要在 `app-dialog.tsx` 里增加卸载延迟。

---

## Phase E — reduced-motion 补齐

### Problem

现有 `prefers-reduced-motion` 只覆盖星空、`view-enter` 和少量按钮；sheet、翻页、开关、复选框、书封 hover、后续新增的浮层都没有降级。并且 `8338` 的规则直接 `transition: none`，会把颜色反馈也一起去掉。

```css
/* src/renderer/src/styles/global.css:1192 — current */
@media (prefers-reduced-motion: reduce) {
  .star,
  .shooting-star,
  .view-enter {
    animation: none !important;
  }

  .shooting-star {
    display: none;
  }
}
```

```css
/* src/renderer/src/styles/global.css:8338 — current */
@media (prefers-reduced-motion: reduce) {
  :is(
    .btn-gold,
    .btn-ghost,
    .btn-danger,
    .icon-btn,
    .ui-dropdown-trigger,
    .ui-dropdown-caret,
    .tool-segment-item
  ) {
    transition: none;
  }
  .btn-gold:hover:not(:disabled) {
    transform: none;
  }
}
```

### Target

保留 opacity / color 反馈，去掉位置与缩放；翻页直接跳转；不要全局 `animation: none`。

```css
/* target — 替换 8338 的块 */
@media (prefers-reduced-motion: reduce) {
  .btn-gold:hover:not(:disabled),
  .btn-gold:active:not(:disabled),
  .book-card:hover .book-cover,
  .theme-dot.active {
    transform: none;
  }

  :is(
    .btn-ghost:active:not(:disabled),
    .btn-danger:active:not(:disabled),
    .icon-btn:active:not(:disabled),
    .ui-dropdown-trigger:active:not(:disabled),
    .rail-toggle:active:not(:disabled),
    .sheet-close:active:not(:disabled),
    .reader-excerpt-btn:active:not(:disabled)
  ) {
    transform: none;
  }

  .ui-dropdown-caret,
  .nav-group-caret {
    transition: none;
  }

  .reader-page-slot {
    transition: none;
  }

  input[type='checkbox']::after {
    transform: translateY(-1px) rotate(-45deg);
  }
}
```

```css
/* target — 追加到 global.css 末尾 */
@media (prefers-reduced-motion: reduce) {
  .ui-popover[data-ready='true'],
  .app-dialog-backdrop,
  .app-dialog,
  .sheet-backdrop,
  .sheet-panel,
  .sheet-panel.capability-sheet,
  .usage-sheet-backdrop,
  .usage-sheet,
  .command-editor,
  .view-enter {
    animation: overlay-fade-in 120ms ease;
  }
}
```

同时把 `1192` 块里的 `.view-enter` 从 `animation: none !important` 移除，交给上面的淡入规则；`.star` / `.shooting-star` 保持原样。

### Steps

1. 修改 `global.css:1192` 的媒体查询：移除 `.view-enter`，保留星空规则。
2. 替换 `global.css:8338` 的媒体查询，只移除 transform，不把颜色 transition 一起关掉。
3. 在文件末尾追加新的 reduced-motion 块，覆盖所有新增动画。
4. 用 DevTools Rendering → `prefers-reduced-motion: reduce` 逐项验证。

---

## Repo conventions to follow

- 动效令牌放在 `global.css` 的 `:root` 令牌区，不要新建 CSS 文件或引入动效库。
- 现有强曲线是 `cubic-bezier(0.22, 0.9, 0.3, 1)`，已在 `3117`（阅读翻页）、`3372`（sheet-in）、`6492`（view-in）使用；本次把它提升为 `--ease-out`。
- 选中态背景范例：`.opencode-session-item.active`（`5053-5056`）使用 `border-color: var(--gold-line); background: rgba(var(--accent-rgb), 0.08);`，导航选中态照此处理。
- 书封 hover 的轻回弹 `cubic-bezier(0.34, 1.4, 0.5, 1)`（`2791-2793`）是刻意保留的活泼点，不要统一掉。
- 阅读器翻页 `transition: transform 0.24s cubic-bezier(0.22, 0.9, 0.3, 1)`（`3117`）手感已经正确，不要改。
- `data-background-motion` 只控制星空，不是全局 reduced-motion 的替代；两者不要混用。
- 弹层的焦点由 `onReady` / `useModalFocus` 管理，CSS 动画不得延迟焦点。

## Boundaries

- 只改 `src/renderer/src/styles/global.css` 与 `src/renderer/src/components/popover.tsx`。不要改 `app-dialog.tsx`、`shell.tsx`、任何页面组件。
- 不改 IPC、preload、`shared/**`、主进程、SQLite schema。
- 不新增依赖，不引入 Framer Motion / GSAP / Motion One。
- 不改主题色、字体、圆角、布局结构；只加 motion 属性。
- 不加命令面板动画、聊天消息入场、列表 stagger、退场动画。
- 如果发现行号或代码与 `8f5d8f5` 不一致，停止并报告，不要自行猜测。

## Verification

### Mechanical

```bash
npm run typecheck
npm run build
```

- `typecheck`：0 errors（`popover.tsx` 有 TSX 改动，必须跑）。
- `build`：成功产出 `out/`，无 CSS 解析错误、无 Vite 警告。

本次是 UI-only 改动，不触发 IPC / DB 测试门槛；如果顺手改了 `app-dialog.tsx` 或 `shell.tsx`（本计划不建议），再追加 `npm run lint -- --ignore-pattern "mobile/**"`。

### Feel check

在 1280×820 下用 `npm run dev` 或 `npm run build` 后的静态预览逐项检查：

- **按压**：点主按钮、ghost、icon、下拉触发器；按下应在约 120ms 内轻微缩小，松开约 160ms 回弹；不要出现布局位移或文字发虚。
- **Popover**：打开对话模型下拉、日期选择、Agent 更多菜单；菜单应从触发器一侧展开，而不是从中心放大。把窗口缩到接近底部 / 右侧，确认翻转后 origin 仍朝向触发器，位置没有 1px 抖动。
- **焦点**：打开下拉后键盘 ↑↓ / Enter / Esc 仍正常；动画不延迟焦点进入菜单。
- **复选框**：在待办、密码导入、AI 世界各点一次；勾选应“长出来”，不是硬切；取消勾选应缩回。
- **开关**：在设置页和阅读设置点开关；渐变轨道应淡入，圆点滑动，不再出现底色瞬间跳变。
- **弹窗**：触发删除确认；背景淡入、面板轻微上浮 + 缩放；Esc 仍然立即关闭。
- **抽屉**：Token 统计打开会话详情、技能 / MCP 打开能力面板；两者都应从右侧进入，不能向下滑。
- **慢放**：DevTools → Animations → 播放速度调到 10%，确认 popover / dialog / drawer 的 origin 和方向正确。
- **减少动效**：DevTools → Rendering → `prefers-reduced-motion: reduce`；位移 / 缩放消失，但颜色、透明度、焦点反馈保留；阅读翻页直接跳转。

### Done when

- 所有高频控件有可感知但不夸张的按压反馈。
- 所有 Popover 从触发点附近出现，关闭仍然即时。
- 复选框、开关、弹窗、右抽屉不再硬切。
- 三套主题下颜色、圆角、阴影没有回归。
- `prefers-reduced-motion` 下没有位移 / 缩放动画。
- `npm run typecheck` 与 `npm run build` 通过。

## Risks and rollback

- **Popover 测量**：`offsetWidth / offsetHeight` 会四舍五入，极端宽 / 高下可能有 1px 偏差；如果出现明显偏移，保留 `offset` 测量、把 scale 改成只做 `translateY(4px) + fade`，不要回到 `getBoundingClientRect()` 测量缩放中的元素。
- **全局 token 替换**：`transition: all` 替换可能漏掉 hover 实际改变的属性，导致某些 hover 硬切；按 Appendix A 逐项对照，不要盲替换。
- **按压缩放**：大段文字按钮可能发虚；本计划只给主按钮、图标按钮、下拉触发器、关闭按钮加 scale，不给导航项和大文本按钮加。
- **抽屉动画**：只做进入，关闭立即卸载；如果后续要退场，另开 presence 计划，不要在本计划里加 `setTimeout` 卸载。
- **回滚**：纯 CSS / 组件样式改动，回滚对应提交即可；无数据迁移、无 schema 变更。

## 后续独立计划

以下不在本计划内，等本轮验证完再单独排期：

1. **侧栏折叠 / 分组展开**：`shell.tsx:164-210`、`global.css:1277-1291`、`1378-1380`、`1464-1466`。需要 `grid-template-columns` 过渡和分组高度过渡，可能小改 DOM。
2. **状态反馈**：`.status-banner`（`4008`）、`.toast-inline`（`2387`）、`.reader-excerpt-flash`（`3175`）做 160ms fade + 4px 上浮。
3. **统计柱状条**：`.agent-usage-bar-track > span`（`258-269`）首次挂载 300ms 从左增长。
4. **主题预览卡**：只在设置页主题预览卡做 150ms 局部颜色过渡；整页主题切换不做。
5. **退场动画**：需要 presence 机制，单独评估。

---

## Appendix A — `transition: all` 替换映射

文件：`src/renderer/src/styles/global.css`。替换时保留原有属性集合中实际会变化的项；下面给的是推荐目标。

| 行 | 选择器 | 目标 transition 属性 |
| --- | --- | --- |
| `1413` | `.rail-toggle` | `border-color, color, background-color, transform` |
| `1446` | `.nav-item` | `color, background-color, border-color` |
| `1454` | `.nav-item svg` | `opacity` |
| `1730` | `.icon-btn`（第一段） | 删除这一行的 `transition`；以 `6376` 的第二段为准 |
| `1767` | `.field-input` | `border-color, box-shadow` |
| `2116` | `.memory-pin-toggle` | `border-color, color, background-color` |
| `2287` | `.profile-item` | `border-color, background-color` |
| `2336` | `.field-select` | `border-color, box-shadow` |
| `2420` | `.segment` | `color, background-color` |
| `2631` | `.group-chip` | `border-color, color, background-color` |
| `3256` | `.reader-icon-btn` | `border-color` |
| `3334` | `.reader-action-btn` | `border-color, color, background-color` |
| `3499` | `.toc-item` | `background-color, color` |
| `3593` | `.theme-dot` | `border-color, box-shadow, transform` |
| `5558` | `.conversation-item` | `border-color, background-color` |
| `6313` | `.model-pick-item` | `background-color, color, border-color` |
| `6765` | `.tools-tree-leaf` | `background-color, color, border-color` |
| `7446` | `.palette-item` | `background-color, border-color` |
| `9277` | `.ai-world-view-switch button` | `color, background-color, border-color` |

统一使用 `var(--dur-hover) var(--ease-out)`；菜单项（`.ui-dropdown-item`）使用 `var(--dur-press) var(--ease-out)`，避免键盘连按时高亮跟不上。
