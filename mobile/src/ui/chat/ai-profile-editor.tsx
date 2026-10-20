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

import { AI_PROVIDER_PRESETS, applyModelToggle, findAiProvider } from '../../shared-bridge'
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
  /** 勾选的模型清单：只有这些会出现在对话页的模型选择里 */
  const [selectedModels, setSelectedModels] = useState<string[]>(
    existing?.selectedModels?.length ? existing.selectedModels : []
  )

  const pickProvider = (next: AiProviderId): void => {
    const preset = findAiProvider(next)
    setProvider(next)
    // 换供应商时带出默认地址与推荐模型，但允许用户随后手改
    setBaseUrl(preset.baseUrl)
    setModel(preset.models[0] ?? model)
    // 勾选清单跟着供应商走：上一个供应商的模型在这里多半不存在
    setSelectedModels(preset.models[0] ? [preset.models[0]] : [])
    setModels([])
    setNote('')
    // 顺手拉一次该供应商的实时模型列表：省得用户再点一次「拉取模型列表」
    void loadModels({ provider: next, baseUrl: preset.baseUrl }, true)
  }

  /**
   * 拉取模型列表。
   *
   * `silent` 用于「换供应商自动拉取」这类顺带动作：失败只给一句提示，
   * 不弹错误横幅（那时用户可能还没填 Key）。
   */
  const loadModels = async (
    overrides?: { provider?: AiProviderId; baseUrl?: string },
    silent = false
  ): Promise<void> => {
    const targetProvider = overrides?.provider ?? provider
    const targetBaseUrl = overrides?.baseUrl ?? baseUrl
    setLoadingModels(true)
    setError('')
    setNote('')
    try {
      const result = await fetchModels(
        aiSettings,
        {
          profileId,
          provider: targetProvider,
          baseUrl: targetBaseUrl,
          apiKey: apiKey || undefined
        },
        fetchImpl
      )
      setModels(result.models)
      if (result.message) setNote(result.message)
      if (!model && result.models.length > 0) setModel(result.models[0])
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '获取模型列表失败'
      if (silent) setNote(message)
      else setError(message)
    } finally {
      setLoadingModels(false)
    }
  }

  /**
   * 勾选 / 取消勾选一个模型。
   *
   * 勾选清单同时决定「对话页模型选择里有哪些」与「当前用哪个」：
   * 勾上一个 → 当前模型切过去（勾哪个用哪个）；
   * 取消勾选当前正在用的模型 → 顺延到清单里剩下的第一个。
   */
  const toggleModel = (name: string): void => {
    const next = applyModelToggle(model, selectedModels, name)
    setSelectedModels(next.selectedModels)
    setModel(next.model)
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
        apiKey: apiKey || undefined,
        selectedModels
      })
      onDone()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  // 候选清单：拉到的实时列表 + 供应商内置推荐 + 已勾选的 + 当前正在用的
  const candidates: string[] = []
  const seenCandidates = new Set<string>()
  const pushCandidate = (name: string): void => {
    const value = name.trim()
    if (!value || seenCandidates.has(value)) return
    seenCandidates.add(value)
    candidates.push(value)
  }
  for (const item of models) pushCandidate(item)
  for (const item of findAiProvider(provider).models) pushCandidate(item)
  for (const item of selectedModels) pushCandidate(item)
  pushCandidate(model)

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
          hint="当前正在用的模型；下面勾选的模型会出现在对话页的模型选择里"
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

        <View style={styles.modelList}>
          <View style={styles.modelListHead}>
            <SectionTitle>可选模型（{candidates.length}）</SectionTitle>
            <Text style={styles.modelCount}>已选 {selectedModels.length}</Text>
          </View>
          <Text style={styles.modelHint}>
            勾选的模型会出现在对话页的模型选择里；勾上即切为当前模型
          </Text>
          {candidates.slice(0, 60).map((item) => {
            const checked = selectedModels.includes(item)
            return (
              <Pressable
                key={item}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => toggleModel(item)}
                style={[styles.modelRow, checked && styles.modelRowActive]}
              >
                <View style={[styles.modelCheck, checked && styles.modelCheckOn]}>
                  {checked ? <Text style={styles.modelCheckMark}>✓</Text> : null}
                </View>
                <Text style={[styles.modelText, checked && styles.modelTextActive]}>{item}</Text>
                {item === model ? <Text style={styles.modelCurrent}>当前</Text> : null}
              </Pressable>
            )
          })}
        </View>

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
  modelListHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  modelCount: { color: colors.gold, fontSize: 11 },
  modelHint: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginBottom: 2 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSolid
  },
  modelRowActive: { backgroundColor: 'rgba(232, 201, 138, 0.16)' },
  modelCheck: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.goldLine,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modelCheckOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  modelCheckMark: { color: colors.bgDeep, fontSize: 10, lineHeight: 12 },
  modelText: { flex: 1, color: colors.textMid, fontSize: 12, fontFamily: fonts.mono },
  modelTextActive: { color: colors.gold },
  modelCurrent: { color: colors.goldDim, fontSize: 10, letterSpacing: 1 }
})
