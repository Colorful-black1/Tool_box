/**
 * 软键盘高度 hook —— 解决「输入法弹出后底部输入区被键盘盖住」。
 *
 * 为什么不用 `KeyboardAvoidingView`：
 * 它在 Android 上只有 `behavior` 生效，而**行为取决于宿主 App 的
 * `android:windowSoftInputMode`**：
 * - `adjustResize` → 窗口本身变矮，`behavior="padding"` 会**重复避让**，输入框飞太高；
 * - `adjustPan` / `adjustNothing`（Expo Go 属于后者）→ 什么都不避让，输入框直接被盖。
 * 一套代码没法同时伺候这两种宿主，所以这里改成**自己判断**：
 *
 * 1. 订阅 `keyboardDidShow` / `keyboardDidHide` 拿到键盘高度；
 * 2. 记下「键盘收起时」的窗口高度；
 * 3. 键盘弹出后若 `windowHeight` 变小了，说明宿主已经自动缩放（adjustResize），
 *    这时 `offset = 0`，交给系统；没变小才自己让出键盘高度。
 *
 * 结果与宿主设置无关，两种情况都对。
 *
 * 基准高度放在 state 而不是 ref：render 期间读 ref 会让组件在该值变化时
 * 拿不到新结果（`react-hooks` 规则也会直接报错），且旋转屏幕时也会失效。
 */
import { useEffect, useState } from 'react'
import { Keyboard, Platform, useWindowDimensions } from 'react-native'

export interface KeyboardInset {
  /** 需要额外往上让出的像素；宿主已自动缩放窗口时为 0 */
  offset: number
  visible: boolean
}

export function useKeyboardInset(): KeyboardInset {
  const { height } = useWindowDimensions()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  /** 键盘收起时的窗口高度，作为「未被键盘压缩」的基准 */
  const [collapsedHeight, setCollapsedHeight] = useState(height)

  useEffect(() => {
    if (keyboardHeight === 0) setCollapsedHeight(height)
  }, [height, keyboardHeight])

  useEffect(() => {
    // iOS 用 will 系列能拿到动画前的目标高度，观感更跟手；Android 只有 did
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  const visible = keyboardHeight > 0
  // 容差 1px：部分机型在键盘动画过程中会有一帧抖动，别把它当成「已缩放」
  const windowResized = visible && height < collapsedHeight - 1

  return { offset: windowResized ? 0 : keyboardHeight, visible }
}
