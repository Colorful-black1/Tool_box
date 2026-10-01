/**
 * M0 占位屏：仅验证「路由 + 主题 + 跨端引用」三件事。
 *
 * 顶部安全区由 `Screen` 统一处理，这里**不再加 `paddingTop`** ——
 * 重复加会让标题整体下移一截。同理 `useScreenTitle` 这个从未被使用的
 * 占位 hook 已删除，留着只会让人以为有状态托管。
 */
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

import { colors, fonts, radius, spacing } from '../theme'

export interface PlaceholderScreenProps {
  title: string
  subtitle: string
  children?: ReactNode
}

export function PlaceholderScreen({
  title,
  subtitle,
  children
}: PlaceholderScreenProps): ReactNode {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  )
}

export function GlassCard({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bgDeep
  },
  title: {
    fontSize: 22,
    color: colors.textHi,
    fontFamily: fonts.serif,
    marginBottom: spacing.xs,
    paddingTop: spacing.xxl
  },
  subtitle: {
    fontSize: 12,
    color: colors.textDim,
    letterSpacing: 1
  },
  extra: {
    marginTop: spacing.lg
  },
  card: {
    backgroundColor: colors.bgPanelSolid,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg
  }
})
