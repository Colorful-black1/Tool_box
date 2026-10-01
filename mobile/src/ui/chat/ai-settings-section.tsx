/**
 * AI 档案区：列出已保存的档案、切换启用、删除、进入编辑。
 *
 * 密钥一律不出这一层：界面只拿 `AiProfileView`（只有 hasApiKey），
 * 明文只在网关内部解密后直接用于请求。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'

import { GlassCard } from '../../components/placeholder-screen'
import { Banner, GhostButton, PrimaryButton, SectionTitle } from '../../components/ui'
import { useServices } from '../../runtime/services'
import { AiProfileEditor } from './ai-profile-editor'
import type { AiConfigView } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

export function AiSettingsSection(): ReactNode {
  const { aiSettings } = useServices()
  const [view, setView] = useState<AiConfigView>({ profiles: [], activeId: null })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      setView(await aiSettings.getView())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 AI 配置失败')
    }
  }, [aiSettings])

  useEffect(() => {
    void reload()
  }, [reload])

  if (editing) {
    return (
      <AiProfileEditor
        profile={editing === 'new' ? undefined : view.profiles.find((item) => item.id === editing)}
        onDone={() => {
          setEditing(null)
          void reload()
        }}
      />
    )
  }

  const remove = (id: string, name: string): void => {
    Alert.alert('删除 AI 配置', `确定删除「${name}」？该配置保存的 API Key 会一并清除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setView(await aiSettings.remove(id))
            } catch (removeError) {
              setError(removeError instanceof Error ? removeError.message : '删除失败')
            }
          })()
        }
      }
    ])
  }

  const activate = async (id: string): Promise<void> => {
    try {
      setView(await aiSettings.activate(id))
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : '启用失败')
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <SectionTitle>AI 配置</SectionTitle>
      {error ? <Banner message={error} /> : null}

      {view.profiles.length === 0 ? (
        <GlassCard>
          <Text style={styles.emptyTitle}>还没有配置</Text>
          <Text style={styles.emptyText}>
            新建一套档案并启用后才能发送消息。API Key 会用系统钥匙串加密后存到本地数据库。
          </Text>
        </GlassCard>
      ) : (
        view.profiles.map((profile) => {
          const active = profile.id === view.activeId
          return (
            <GlassCard key={profile.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{profile.name}</Text>
                {active ? <Text style={styles.activeBadge}>已启用</Text> : null}
                {!profile.hasApiKey ? <Text style={styles.warnBadge}>缺 Key</Text> : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {profile.provider} · {profile.model}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {profile.baseUrl}
              </Text>
              <View style={styles.actions}>
                {active ? null : (
                  <GhostButton label="启用" onPress={() => void activate(profile.id)} />
                )}
                <GhostButton label="编辑" onPress={() => setEditing(profile.id)} />
                <GhostButton label="删除" onPress={() => remove(profile.id, profile.name)} />
              </View>
            </GlassCard>
          )
        })
      )}

      <PrimaryButton label="新建档案" onPress={() => setEditing('new')} />
      {view.profiles.length > 0 && !view.activeId ? (
        <Banner tone="info" message="当前没有启用中的档案，发送消息前请先启用一套。" />
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  card: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 15, color: colors.textHi, flexShrink: 1 },
  activeBadge: {
    fontSize: 10,
    color: colors.success,
    borderWidth: 1,
    borderColor: 'rgba(127, 231, 160, 0.4)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  warnBadge: {
    fontSize: 10,
    color: colors.danger,
    borderWidth: 1,
    borderColor: 'rgba(255, 158, 199, 0.4)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  meta: { fontSize: 11, color: colors.textDim, fontFamily: fonts.mono },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  emptyTitle: { fontSize: 14, color: colors.textHi, marginBottom: spacing.xs },
  emptyText: { fontSize: 12, color: colors.textMid, lineHeight: 18 }
})
