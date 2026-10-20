import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ReactNode } from 'react'

import { AI_PROVIDER_PRESETS, findAiProvider } from '../shared-bridge'
import { colors, fonts, radius, spacing } from '../theme'
import { GlassCard } from '../components/placeholder-screen'
import { ScreenHeader } from '../components/screen'
import { SectionBlock } from '../components/ui'
import { AiSettingsSection } from '../ui/chat/ai-settings-section'

/**
 * 设置页。
 *
 * 分三块：AI 配置（可交互）、供应商预设（只读，来自桌面端共享表）、自检展示。
 * 预设表直接复用桌面端 `src/shared/types.ts`，手机端不复制一份。
 *
 * 页头换成统一的 `ScreenHeader`（文本块 `flex: 1` 收缩 + 单行截断），
 * 否则「SETTINGS · 连接你的模型星域」这行副标题会按固有宽度撑开，
 * 把右侧内容顶出屏幕。
 *
 * 底部内边距给到 `xxl`：Tab 栏之上还要留出最后一张卡片的呼吸空间，
 * 否则「共享逻辑校验」那张卡会紧贴 Tab 栏。
 */
export function SettingsScreen(): ReactNode {
  return (
    <View style={styles.root}>
      <ScreenHeader title="星轨链路" subtitle="SETTINGS · 连接你的模型星域" />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <SectionBlock
          badge="AI"
          title="AI 档案与权限"
          description="配置模型接口，并决定 AI 助手可以改动到什么程度"
        >
          <AiSettingsSection />
        </SectionBlock>

        <SectionBlock
          badge="API"
          title={`供应商预设（${AI_PROVIDER_PRESETS.length} 家）`}
          description="内置的 OpenAI 兼容端点与推荐模型，可直接选用"
        >
          {AI_PROVIDER_PRESETS.map((preset) => (
            <GlassCard key={preset.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {preset.name}
                </Text>
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
        </SectionBlock>

        <SectionBlock badge="i" title="关于" description="两端共用的供应商表在本机的实时取值">
          <GlassCard style={styles.card}>
            <Text style={styles.name}>共享逻辑校验</Text>
            <Text style={styles.model}>
              findAiProvider('glm') = {findAiProvider('glm').name} · {findAiProvider('glm').baseUrl}
            </Text>
          </GlassCard>
        </SectionBlock>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  block: { gap: spacing.sm },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { flexShrink: 1, fontSize: 15, color: colors.textHi },
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
