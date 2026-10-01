/**
 * AI 档案编辑表单。
 *
 * 两处与桌面端刻意保持一致：
 * - `apiKey` 留空 = 沿用已保存的 Key（编辑时不必重新输入）；
 * - 模型列表拉取失败时降级为内置推荐，并明确告诉用户「这是推荐列表不是实时列表」。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { AI_PROVIDER_PRESETS, findAiProvider } from '../../shared-bridge'
import type { AiProfileView, AiProviderId, AiProviderPreset } from '../../shared-bridge'
import { Banner, ChipRow, Field, GhostButton, PrimaryButton, SectionTitle } from '../../components/ui'
import { fetchModels } from '../../ai/model-fetcher'
import { useServices } from '../../runtime/services'
import { colors, fonts, radius, spacing } from '../../theme'

export function AiProfileEditor({
  profile,
  onDone
}: {
  /** 留空表示新建 */
  profile?: AiProfileView
  onDone: () => void
}): ReactNode {
  const { aiSettings, fetchImpl } = useServices()
  const existing = profile
  const profileId = profile?.id

  const [provider, setProvider] = useState<AiProviderId>(existing?.provider ?? 'deepseek')
  const [name, setName] = useState(existing?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? findAiProvider(provider).baseUrl)
  const [model, setModel] = useState(existing?.model ?? findAiProvider(provider).models[0] ?? '')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)

  const pickProvider = (next: AiProviderId): void => {
    const preset = findAiProvider(next)
    setProvider(next)
    // 换供应商时带出默认地址与推荐模型，但允许用户随后手改
    setBaseUrl(preset.baseUrl)
    setModel(preset.models[0] ?? model)
    setModels([])
    setNote('')
  }

  const loadModels = async (): Promise<void> => {
    setLoadingModels(true)
    setError('')
    setNote('')
    try {
      const result = await fetchModels(
        aiSettings,
        { profileId, provider, baseUrl, apiKey: apiKey || undefined },
        fetchImpl
      )
      setModels(result.models)
      if (result.message) setNote(result.message)
      if (!result.models.includes(model)) setModel(result.models[0] ?? model)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取模型列表失败')
    } finally {
      setLoadingModels(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await aiSettings.save({
        id: profileId,
        name,
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined
      })
      onDone()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  // 同上：嵌在设置页的纵向 ScrollView 里，这里用 View 避免嵌套滚动
  return (
    <View style={styles.root}>
      <SectionTitle>供应商</SectionTitle>
      <ChipRow contentContainerStyle={styles.chips}>
        {AI_PROVIDER_PRESETS.map((preset: AiProviderPreset) => (
          <Chip
            key={preset.id}
            label={preset.name}
            active={provider === preset.id}
            onPress={() => pickProvider(preset.id)}
          />
        ))}
      </ChipRow>

      <View style={styles.form}>
        <Field
          label="名称"
          value={name}
          onChangeText={setName}
          placeholder={findAiProvider(provider).name}
        />
        <Field
          label="接口地址"
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="https://api.example.com/v1"
          autoCapitalize="none"
          keyboardType="url"
          hint="留空会自动补 /v1；填了完整 /chat/completions 也会被自动剥掉"
        />
        <Field
          label="API Key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={existing?.hasApiKey ? '已保存，留空则不修改' : '必填'}
          secure
          autoCapitalize="none"
          hint="用系统钥匙串加密后存库，不会以明文落盘"
        />
        <Field
          label="模型"
          value={model}
          onChangeText={setModel}
          placeholder="deepseek-v4-pro"
          autoCapitalize="none"
        />

        <View style={styles.actions}>
          <GhostButton
            label={loadingModels ? '拉取中…' : '拉取模型列表'}
            onPress={() => void loadModels()}
            disabled={loadingModels}
          />
          <PrimaryButton label="保存并启用" onPress={() => void save()} busy={busy} />
        </View>

        {note ? <Banner tone="info" message={note} /> : null}
        {error ? <Banner message={error} /> : null}

        {models.length > 0 ? (
          <View style={styles.modelList}>
            <SectionTitle>可选模型（{models.length}）</SectionTitle>
            {models.slice(0, 60).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                onPress={() => setModel(item)}
                style={[styles.modelRow, item === model && styles.modelRowActive]}
              >
                <Text style={[styles.modelText, item === model && styles.modelTextActive]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <GhostButton label="取消" onPress={onDone} />
      </View>
    </View>
  )
}

function Chip({
  label,
  active,
  onPress
}: {
  label: string
  active: boolean
  onPress: () => void
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  chips: { paddingVertical: spacing.xs, paddingRight: spacing.lg },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line
  },
  chipActive: { backgroundColor: 'rgba(232, 201, 138, 0.16)', borderColor: colors.goldLine },
  chipText: { color: colors.textMid, fontSize: 12, fontFamily: fonts.sans },
  chipTextActive: { color: colors.gold },
  form: { gap: spacing.md, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  modelList: { gap: 4 },
  modelRow: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSolid
  },
  modelRowActive: { backgroundColor: 'rgba(232, 201, 138, 0.16)' },
  modelText: { color: colors.textMid, fontSize: 12, fontFamily: fonts.mono },
  modelTextActive: { color: colors.gold }
})
