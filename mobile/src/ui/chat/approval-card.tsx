import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { GhostButton, PrimaryButton } from '../../components/ui'
import { colors, fonts, radius, spacing } from '../../theme'

/** 待用户批准的写工具调用 */
export interface PendingApprovalView {
  callId: string
  name: string
  args: string
  risk: 'write' | 'destructive'
}

/**
 * 审批卡：写工具执行前的人确认。
 *
 * 为什么用内联卡片而不是 `Modal`：RN 的 Modal 在 Android 上会盖住键盘、
 * 也可能被输入框的焦点抢回去；这张卡出现在输入框上方，和桌面端的
 * `.tool-approval` 位置一致，也不打断打字。
 *
 * 两个按钮的主次与桌面端一致：允许是主操作（金色），拒绝是次操作（幽灵）。
 */
export function ApprovalCard({
  approval,
  onRespond
}: {
  approval: PendingApprovalView
  onRespond: (approved: boolean) => void
}): ReactNode {
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.head}>
        <Text style={styles.title}>需要确认的操作</Text>
        <Text style={[styles.risk, approval.risk === 'destructive' && styles.riskDestructive]}>
          {approval.risk === 'destructive' ? '破坏性' : '写入'}
        </Text>
      </View>
      <Text style={styles.name}>{approval.name}</Text>
      {approval.args ? (
        <Text style={styles.args} numberOfLines={4}>
          {approval.args}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <GhostButton label="拒绝" onPress={() => onRespond(false)} />
        <PrimaryButton label="允许" onPress={() => onRespond(true)} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: 'rgba(232, 201, 138, 0.08)',
    borderWidth: 1,
    borderColor: colors.goldLine,
    borderRadius: radius.lg
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textHi, fontSize: 13 },
  risk: {
    color: colors.gold,
    fontSize: 10,
    borderWidth: 1,
    borderColor: colors.goldLine,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  riskDestructive: { color: colors.danger, borderColor: 'rgba(255, 158, 199, 0.4)' },
  name: { color: colors.gold, fontSize: 12, fontFamily: fonts.mono },
  args: { color: colors.textDim, fontSize: 11, fontFamily: fonts.mono, lineHeight: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }
})
