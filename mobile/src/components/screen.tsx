/**
 * 屏幕容器与统一页头。
 *
 * 为什么需要 `Screen`：`App.tsx` 只挂了 `SafeAreaProvider`，但**没有任何地方消费
 * `useSafeAreaInsets`**。后果是全屏布局直接顶到状态栏（标题被时间/电量压住），
 * 底部 Tab 栏也贴着系统导航栏。这里统一把顶部安全区吃掉；底部由 App.tsx 的
 * Tab 栏统一处理，屏幕容器不重复加，否则会多出一段空白。
 *
 * 所有 Tab 页面（含它们内部的二级页面，如阅读器、密码编辑页）都在同一个
 * Tab 容器内，所以**只在这 5 个 Tab 的根节点包一层**，子页面不要再包，
 * 否则顶部会被 padding 叠加两次。
 */
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors, fonts, spacing } from '../theme'

export function Screen({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.screen, { paddingTop: insets.top }, style]}>
      {children}
    </View>
  )
}

export interface ScreenHeaderProps {
  title: string
  subtitle?: string
  /** 右侧操作区。按钮不允许被压缩，否则窄屏上会被裁掉一半 */
  actions?: ReactNode
}

/**
 * 统一页头。
 *
 * 关键约束（窄屏被裁按钮 / 标题压住按钮的根因）：
 * - 文本块必须 `flex: 1` 才能收缩。不加的话它按副标题的**完整固有宽度**撑开，
 *   右侧按钮会被挤出屏幕 —— 实测「密码宝匣」那页的「新建」只剩半个。
 * - 标题与副标题都 `numberOfLines={1}`，超长截断而不是换行把页头撑高。
 * - 操作区 `flexShrink: 0`，两个以上按钮时也不压缩。
 */
export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps): ReactNode {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md
  },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 22, color: colors.textHi, fontFamily: fonts.serif },
  headerSubtitle: { fontSize: 11, color: colors.textDim, letterSpacing: 2 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // 按钮不参与收缩：宁可标题被截断，也不能让按钮只剩半个
    flexShrink: 0
  }
})
