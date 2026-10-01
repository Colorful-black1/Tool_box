import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ReactNode } from 'react'

import { AI_PROVIDER_PRESETS, findAiProvider } from '../shared-bridge'
import { colors, fonts, radius, spacing } from '../theme'
import { GlassCard, PlaceholderScreen } from '../components/placeholder-screen'
import { SectionTitle } from '../components/ui'
import { AiSettingsSection } from '../ui/chat/ai-settings-section'

/**
 * 设置页。
 *
 * 分三块：AI 配置（可交互）、供应商预设（只读，来自桌面端共享表）、自检展示。
 * 预设表直接复用桌面端 `src/shared/types.ts`，手机端不复制一份。
 */
export function SettingsScreen(): ReactNode {
  return (
    <PlaceholderScreen title="星轨链路" subtitle="SETTINGS · 连接你的模型星域">
      <ScrollView contentContainerStyle={styles.list}>
        <AiSettingsSection />

        <View style={styles.block}>
          <SectionTitle>供应商预设（{AI_PROVIDER_PRESETS.length} 家）</SectionTitle>
          {AI_PROVIDER_PRESETS.map((preset) => (
            <GlassCard key={preset.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{preset.name}</Text>
                <Text style={styles.badge}>{preset.models.length} 模型</Text>
              </View>
              <Text style={styles.url} numberOfLines={1}>
                {preset.baseUrl || '（自定义，需手填）'}
              </Text>
              {preset.models[0] ? (
                <Text style={styles.model} numberOfLines={1}>
                  推荐：{preset.models[0]}
                </Text>
              ) : null}
            </GlassCard>
          ))}
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.name}>共享逻辑校验</Text>
          <Text style={styles.model}>
            findAiProvider('glm') = {findAiProvider('glm').name} · {findAiProvider('glm').baseUrl}
          </Text>
        </GlassCard>
      </ScrollView>
    </PlaceholderScreen>
  )
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xxl, gap: spacing.md },
  block: { gap: spacing.sm },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15, color: colors.textHi },
  badge: {
    fontSize: 10,
    color: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldLine,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  url: { fontSize: 11, color: colors.textMid, fontFamily: fonts.mono },
  model: { fontSize: 11, color: colors.textDim }
})
