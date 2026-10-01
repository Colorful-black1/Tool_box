/**
 * 阅读统计（M4）：今日 / 累计时长与字数，以及最近 7 天明细。
 *
 * 数据全部来自 `store.statsSummary()`，本屏不做任何本地聚合 ——
 * 与桌面端读同一张 `reading_stats` 表，聚合口径只有一处。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { GlassCard } from '../../components/placeholder-screen'
import { GhostButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import type { ReadingStat, StatsSummary } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

const EMPTY: StatsSummary = { todayDurationMs: 0, totalDurationMs: 0, totalCharCount: 0, recent: [] }

export function ReadingStatsScreen({ onBack }: { onBack: () => void }): ReactNode {
  const { store } = useServices()
  const [summary, setSummary] = useState<StatsSummary>(EMPTY)
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      setSummary(await store.statsSummary())
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取统计失败')
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload])

  const peak = Math.max(1, ...summary.recent.map((item) => item.durationMs))

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GhostButton label="返回" onPress={onBack} />
        <Text style={styles.title} numberOfLines={1}>
          阅读统计
        </Text>
        <GhostButton label="刷新" onPress={() => void reload()} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.tiles}>
          <Tile label="今日" value={formatDuration(summary.todayDurationMs)} />
          <Tile label="累计时长" value={formatDuration(summary.totalDurationMs)} />
          <Tile label="累计字数" value={`${summary.totalCharCount}`} />
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.cardTitle}>最近 7 天</Text>
          {summary.recent.length === 0 ? (
            <Text style={styles.empty}>还没有阅读记录。</Text>
          ) : (
            summary.recent.map((stat) => <Row key={stat.date} stat={stat} peak={peak} />)
          )}
        </GlassCard>
      </ScrollView>
    </View>
  )
}

function Tile({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

function Row({ stat, peak }: { stat: ReadingStat; peak: number }): ReactNode {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statDate}>{stat.date.slice(5)}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.bar, { width: `${Math.round((stat.durationMs / peak) * 100)}%` }]} />
      </View>
      <Text style={styles.statValue}>{formatDuration(stat.durationMs)}</Text>
    </View>
  )
}

/** 时长文案：不足 1 分钟按秒，不足 1 小时按分钟 */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} 秒`
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, color: colors.textHi, fontFamily: fonts.serif },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  error: { color: colors.danger, fontSize: 12 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2
  },
  tileLabel: { fontSize: 10, color: colors.textDim, letterSpacing: 1 },
  tileValue: { fontSize: 15, color: colors.gold },
  card: { gap: spacing.sm },
  cardTitle: { fontSize: 13, color: colors.textMid, marginBottom: spacing.xs },
  empty: { fontSize: 12, color: colors.textDim },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statDate: { width: 46, fontSize: 10, color: colors.textDim, fontFamily: fonts.mono },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.bgDeep,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  bar: { height: 8, backgroundColor: colors.goldDim, borderRadius: radius.pill },
  statValue: { width: 62, fontSize: 10, color: colors.textDim, textAlign: 'right' }
})
