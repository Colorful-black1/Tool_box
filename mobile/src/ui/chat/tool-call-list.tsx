import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '../../theme'

/** 界面上一次工具调用的呈现状态（由 chat-detail-screen 维护） */
export interface ToolCallView {
  callId: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error'
  summary?: string
}

/**
 * 工具调用卡片列表。
 *
 * 与桌面端 `.tool-call` 的信息层级一致：工具名 + 状态 + 入参摘要 + 结果摘要，
 * 但**不复述原始 JSON**（入参本身已是截断后的字符串）。
 */
export function ToolCallList({ calls }: { calls: ToolCallView[] }): ReactNode {
  if (calls.length === 0) return null
  return (
    <View style={styles.list}>
      {calls.map((call) => (
        <ToolCallCard key={call.callId} call={call} />
      ))}
    </View>
  )
}

function ToolCallCard({ call }: { call: ToolCallView }): ReactNode {
  return (
    <View
      style={[
        styles.card,
        call.status === 'ok' && styles.cardOk,
        call.status === 'error' && styles.cardError
      ]}
    >
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>
          {call.name}
        </Text>
        <Text style={styles.status}>{statusLabel(call.status)}</Text>
      </View>
      {call.args ? (
        <Text style={styles.args} numberOfLines={3}>
          {call.args}
        </Text>
      ) : null}
      {call.summary && call.status !== 'running' ? (
        <Text style={styles.summary}>{call.summary}</Text>
      ) : null}
    </View>
  )
}

function statusLabel(status: ToolCallView['status']): string {
  if (status === 'running') return '执行中…'
  return status === 'ok' ? '完成' : '失败'
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, alignSelf: 'stretch' },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4
  },
  cardOk: { borderColor: 'rgba(127, 231, 160, 0.32)' },
  cardError: { borderColor: 'rgba(255, 158, 199, 0.32)' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { color: colors.gold, fontSize: 12, fontFamily: fonts.mono, flexShrink: 1 },
  status: { color: colors.textDim, fontSize: 10 },
  args: { color: colors.textDim, fontSize: 11, fontFamily: fonts.mono, lineHeight: 15 },
  summary: { color: colors.textMid, fontSize: 12, lineHeight: 17 }
})
