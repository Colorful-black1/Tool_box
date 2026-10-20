/**
 * 底部 Tab 的路由参数。
 *
 * 目前只有一个用途：长按 Tab 触发该页的主操作（新建 / 导入）。
 * 之所以走路由参数而不是全局事件总线：路由参数是 react-navigation 自己的
 * 机制，不引任何新依赖。
 */

/**
 * 五个 Tab 的参数表。
 *
 * `quick` 带一个唯一后缀（`create-<时间戳>`）：同一个动作连按两次时，
 * 值必须变化，否则页面里的 effect 不会再次触发。
 */
export type RootTabParamList = {
  Chat: { quick?: string } | undefined
  Shelf: { quick?: string } | undefined
  Passwords: { quick?: string } | undefined
  Notes: { quick?: string } | undefined
  Settings: undefined
}
