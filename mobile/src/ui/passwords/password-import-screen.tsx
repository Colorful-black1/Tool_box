/**
 * 密码批量导入（M5）：固定格式文本解析 + AI 识别两条通道。
 *
 * 两条通道产出同一种中间物 `PasswordDraft[]`，共用同一份预览与导入逻辑：
 * 用户能看清「将要写入什么」，也能看到哪些条目已存在会被跳过。
 * 这点很关键 —— 批量导入是最容易造成重复数据的操作，盲导不可接受。
 *
 * 解析器都不在本文件里：
 * - 固定格式复用桌面端共享的 `parsePasswordText`；
 * - AI 识别走 `AiGateway.complete()`（不落库、不进会话并发表），
 *   结果解析在 `password-recognizer.ts`，两处都是可单测的纯逻辑。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { File } from 'expo-file-system'

import { GlassCard } from '../../components/placeholder-screen'
import { Banner, Chip, GhostButton, PrimaryButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import { useKeyboardInset } from '../keyboard'
import {
  RECOGNIZE_SYSTEM_PROMPT,
  assertRecognizable,
  buildRecognitionPrompt,
  parseRecognitionResult
} from '../../ai/password-recognizer'
import type { PasswordAiPreview, PasswordDraft } from '../../shared-bridge'
import { JsonArrayObjectStream, passwordPreview, parsePasswordText } from '../../shared-bridge'
import { duplicateKey } from './password-groups'
import { readPickedTextFile } from '../../data/text-file'
import { colors, fonts, radius, spacing } from '../../theme'

type Tab = 'format' | 'ai'

const SAMPLE = `网站名：GitHub
网址：https://github.com
用户名：octocat@example.com
密码：correct-horse-battery-staple
备注：工作账号

网站名：内部 Wiki
用户名：zhangsan
密码：P@ssw0rd-2026`

export function PasswordImportScreen({ onBack }: { onBack: () => void }): ReactNode {
  const { store, gateway } = useServices()
  const [tab, setTab] = useState<Tab>('format')
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<PasswordDraft[] | null>(null)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<PasswordAiPreview[]>([])
  const [received, setReceived] = useState(0)
  const task = useRef<{ controller: AbortController | null }>({ controller: null })
  const keyboard = useKeyboardInset()

  useEffect(() => {
    const state = task.current
    return () => {
      state.controller?.abort()
      state.controller = null
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setExisting(await store.duplicateKeys())
      } catch {
        // 重复标记拿不到不影响导入本身，savePasswordDrafts 内部还会再挡一次
      }
    })()
  }, [store])

  const reset = useCallback((): void => {
    setDrafts(null)
    setMessage('')
    setError('')
  }, [])

  const parseFormat = (): void => {
    reset()
    const outcome = parsePasswordText(text)
    if (outcome.entries.length === 0) {
      setError('没解析出任何条目。每条之间空一行，行内写「标签: 值」。')
      return
    }
    setDrafts(outcome.entries)
    setMessage(
      `解析出 ${outcome.entries.length} 条` + (outcome.skipped > 0 ? `，跳过 ${outcome.skipped} 行无法识别的内容` : '')
    )
  }

  /** 两条通道（粘贴 / 选文件）共用的正文产出：把识别结果落成草稿预览 */
  const applyRecognized = async (source: string, controller: AbortController): Promise<void> => {
    const trimmed = assertRecognizable(source)
    const parser = new JsonArrayObjectStream()
    const entries: PasswordAiPreview[] = []
    let chars = 0
    const raw = await gateway.complete({
      system: RECOGNIZE_SYSTEM_PROMPT,
      prompt: buildRecognitionPrompt(trimmed),
      signal: controller.signal,
      onDelta: (delta) => {
        if (task.current.controller !== controller || controller.signal.aborted) return
        chars += delta.length
        for (const object of parser.push(delta)) {
          try {
            if (entries.length < 200)
              entries.push(...parseRecognitionResult(`[${object}]`).map(passwordPreview))
          } catch {
            // 无效的片段不预览，最终完整 JSON 仍由解析器检查。
          }
        }
        setReceived(chars)
        setPreview([...entries])
      }
    })
    if (task.current.controller !== controller || controller.signal.aborted) return
    const parsed = parseRecognitionResult(raw)
    if (parsed.length === 0) {
      setError('AI 没识别出可导入的条目，换一段描述更明确的文本试试。')
      return
    }
    setDrafts(parsed)
    setMessage(`AI 识别出 ${parsed.length} 条`)
  }

  const recognize = async (source: () => Promise<string | null> = async () => text): Promise<void> => {
    if (task.current.controller || busy) return
    reset()
    setPreview([])
    setReceived(0)
    setBusy(true)
    const controller = new AbortController()
    task.current.controller = controller
    try {
      const content = await source()
      if (controller.signal.aborted) {
        setError('已停止识别，未完成的结果未采用')
        return
      }
      if (content !== null) await applyRecognized(content, controller)
    } catch (recognizeError) {
      if (task.current.controller === controller)
        setError(
          controller.signal.aborted
            ? '已停止识别，未完成的结果未采用'
            : recognizeError instanceof Error ? recognizeError.message : 'AI 识别失败'
        )
    } finally {
      if (task.current.controller === controller) {
        task.current.controller = null
        setBusy(false)
        setPreview([])
        setReceived(0)
      }
    }
  }

  /**
   * 从文件导入（两种 tab 都有）。
   *
   * 选完直接解析 / 识别，**不把内容灌进输入框** —— 手机上手动粘贴长文本本就是
   * 主要痛点，灌进 TextInput 反而让人以为还得再点一次按钮。
   *
   * 按格式走纯本地解析，AI 通道则先经 `assertRecognizable` 判长度：
   * 文件里的内容用户多半没逐字看过，静默截断一半再让人确认导入风险更大，
   * 所以超限直接报错要求拆分。
   */
  const importFromFile = async (): Promise<void> => {
    if (tab === 'ai') {
      await recognize(async () => {
        const picked = await File.pickFileAsync()
        return picked.canceled ? null : readPickedTextFile(picked.result)
      })
      return
    }
    reset()
    setBusy(true)
    try {
      const picked = await File.pickFileAsync()
      if (picked.canceled) return

      const content = await readPickedTextFile(picked.result)
      setMessage(`已读取 ${picked.result.name}`)

      if (tab === 'format') {
        const outcome = parsePasswordText(content)
        if (outcome.entries.length === 0) {
          setError(`${picked.result.name} 里没解析出任何条目。每条之间空一行，行内写「标签: 值」。`)
          setMessage('')
          return
        }
        setDrafts(outcome.entries)
        setMessage(
          `从 ${picked.result.name} 解析出 ${outcome.entries.length} 条` +
            (outcome.skipped > 0 ? `，跳过 ${outcome.skipped} 行无法识别的内容` : '')
        )
        return
      }

    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : '读取文件失败')
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (): Promise<void> => {
    if (!drafts || drafts.length === 0) return
    setBusy(true)
    try {
      const imported = await store.savePasswordDrafts(drafts)
      setError('')
      setMessage(`成功导入 ${imported} 条${imported < drafts.length ? `，跳过 ${drafts.length - imported} 条重复` : ''}`)
      setDrafts(null)
      setText('')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GhostButton label="返回" onPress={onBack} />
        {/* 标题能收缩、按钮组不收缩，窄屏上「返回 + 双筛选 + 标题」不会互相挤掉 */}
        <Text style={styles.headerTitle} numberOfLines={1}>
          批量导入
        </Text>
        <View style={styles.headerActions}>
          <Chip
            label="按格式" active={tab === 'format'} disabled={busy}
            onPress={() => { setTab('format'); reset() }}
          />
          <Chip
            label="AI 识别" active={tab === 'ai'} disabled={busy}
            onPress={() => { setTab('ai'); reset() }}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + keyboard.offset }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          {tab === 'format'
            ? '每条之间空一行，行内写「标签: 值」。支持 网站名/网址/用户名/密码/备注 等中文或英文标签。也可以直接选一个 .txt / .md 文件。'
            : '粘贴记录或选择文本文件，AI 将流式展示脱敏预览，完成校验后可导入。请先在设置页启用 AI 配置。'}
        </Text>

        <TextInput
          style={styles.input}
          value={text}
          editable={!busy}
          onChangeText={(next) => {
            setText(next)
            if (drafts) reset()
          }}
          placeholder={tab === 'format' ? `${SAMPLE}\n\n也可以直接选文件` : '把杂乱文本粘贴到这里'}
          placeholderTextColor={colors.textDim}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
          accessibilityLabel="待导入文本"
        />

        {/* 两个 tab 都能选文件：粘贴长文本在手机上很痛苦，文件是更现实的入口 */}
        <View style={styles.actions}>
          <GhostButton label="选择文件" onPress={() => void importFromFile()} disabled={busy} />
          {tab === 'format' ? (
            <>
              <GhostButton label="填入示例" onPress={() => setText(SAMPLE)} />
              <PrimaryButton label="解析" onPress={parseFormat} disabled={!text.trim()} />
            </>
          ) : (
            <PrimaryButton
              label="AI 识别"
              onPress={() => void recognize()}
              busy={busy}
              disabled={!text.trim()}
            />
          )}
        </View>

        {busy && tab === 'ai' ? (
          <GlassCard style={styles.preview}>
            <Text style={styles.hint}>
              已接收 {received} 字符，预览 {preview.length} 条（最多 200 条）；完成校验后可导入。
            </Text>
            {preview.map((entry, index) => (
              <View key={index} style={styles.previewRow}>
                <Text style={styles.previewTitleText}>{entry.title || '（无名称）'}</Text>
                <Text style={styles.previewMeta}>
                  {[entry.account, entry.hasPassword ? '密码已填' : '无密码']
                    .filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
            <GhostButton label="停止识别" onPress={() => task.current.controller?.abort()} />
          </GlassCard>
        ) : null}

        {error ? <Banner message={error} /> : null}
        {message && !error ? <Banner message={message} tone="info" /> : null}

        {drafts && drafts.length > 0 ? (
          <GlassCard style={styles.preview}>
            <Text style={styles.previewTitle}>预览（{drafts.length} 条）</Text>
            {drafts.map((draft, index) => {
              const key = duplicateKey(draft.title, draft.account)
              const duplicated = Boolean(draft.account.trim()) && existing.has(key)
              return (
                <View key={`${draft.title}-${index}`} style={styles.previewRow}>
                  <Text style={styles.previewTitleText} numberOfLines={1}>
                    {draft.title}
                    {duplicated ? '（已存在，将跳过）' : ''}
                  </Text>
                  <Text style={styles.previewMeta} numberOfLines={1}>
                    {[draft.account, draft.url, draft.password ? '密码已填' : '无密码']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              )
            })}
            <PrimaryButton label="确认导入" onPress={() => void runImport()} busy={busy} />
          </GlassCard>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, color: colors.textHi },
  headerActions: { flexDirection: 'row', gap: spacing.sm, flexShrink: 0 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  hint: { fontSize: 11, color: colors.textDim, lineHeight: 17 },
  input: {
    minHeight: 180,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textHi,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fonts.mono
  },
  // 三个按钮在窄屏会换行：wrap 让它们落到第二行而不是被压扁
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  preview: { gap: spacing.sm },
  previewTitle: { fontSize: 13, color: colors.textMid, marginBottom: spacing.xs },
  previewRow: { gap: 1 },
  previewTitleText: { fontSize: 13, color: colors.textHi },
  previewMeta: { fontSize: 10, color: colors.textDim, fontFamily: fonts.mono }
})
