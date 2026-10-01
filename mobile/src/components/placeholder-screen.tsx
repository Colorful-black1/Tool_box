import { useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

import { colors, fonts, radius, spacing } from '../theme'

export interface PlaceholderScreenProps {
  title: string
  subtitle: string
  children?: ReactNode
}

/**
 * M0 占位屏：仅验证「路由 + 主题 + 跨端引用」三件事，
 * 各模块的真实界面分别在 M2（对话）、M3（记事本）、M4（阅读）、M5（密码箱）实现。
 */
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
    paddingTop: spacing.xxl,
    backgroundColor: colors.bgDeep
  },
  title: {
    fontSize: 22,
    color: colors.textHi,
    fontFamily: fonts.serif,
    marginBottom: spacing.xs
  },
  subtitle: {
    fontSize: 12,
    color: colors.textDim,
    letterSpacing: 1
  },
  extra: {
    marginTop: spacing.xl
  },
  card: {
    backgroundColor: colors.bgPanelSolid,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg
  }
})

/** 供各屏复用的状态占位（后续接真实 store 时替换） */
export function useScreenTitle(): [string, (next: string) => void] {
  return useState('')
}
