/**
 * 笔记编辑页：新建与编辑共用，`note` 为 null 即新建。
 *
 * 为什么直接接收 `NoteView` 而不是 `noteId`：
 * 数据层只有 `listNotes()`，没有单条读取；为了拿一条笔记把整张表拉回来
 * 再 find 一次，既浪费又拿不到「删掉了正在编辑的笔记」这种边界。
 * 列表本来就已经持有完整对象，直接传下去即可；返回列表时由列表自己重载，
 * 保证看到的永远是库里的最新值。
 *
 * 保存策略：**防抖自动保存 + 显式「保存」按钮 + 返回时兜底落盘**。
 * 手机上手写笔记最怕「以为存了其实没存」，所以不设「不保存」这个选项，
 * 也没有「未保存」这个状态 —— 只要离开前有改动就一定写进库。
 *
 * 自动保存的并发正确性（踩过的坑）：
 * 不能用一个 `dirty` 布尔值。保存是异步的，用户在请求飞行途中继续打字时，
 * 新改动已经把 dirty 置回 true，而旧请求 resolve 时又把 dirty 抹成 false，
 * 于是新内容永远等不到下一次保存 —— 丢数据且极难复现。
 * 改用单调递增的修订号：保存开始时记下目标版本，回来只标记「至少已存到这个版本」，
 * 新版本自然还会触发下一轮防抖。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Keyboard } from 'react-native'

import { GhostButton, PrimaryButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import { useKeyboardInset } from '../keyboard'
import type { NoteView } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

/** 停止输入这么久后自动落盘 */
const AUTOSAVE_DELAY_MS = 700

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败'
}

export function NoteEditorScreen({
  note,
  onBack
}: {
  note: NoteView | null
  onBack: () => void
}): ReactNode {
  const { store } = useServices()
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState('')
  const keyboard = useKeyboardInset()

  // 这篇笔记当前在库里的 id。新建时首存返回的 id 会写进来，
  // 否则每次防抖保存都会因 id 为 null 而新建一条。
  const idRef = useRef<string | null>(note?.id ?? null)
  /** 最新改动版本号 */
  const revRef = useRef(0)
  /** 已确认落库的版本号 */
  const savedRevRef = useRef(0)
  /** 是否是已存在的笔记（新建时不该显示「删除」） */
  const isExisting = note !== null

  const persist = useCallback(async (): Promise<void> => {
    const targetRev = revRef.current
    if (targetRev === savedRevRef.current) return

    const snapshotTitle = title
    const snapshotContent = content
    // 标题与正文都空的新笔记不落库，否则连点两次「新建」会攒出一堆空行
    if (!idRef.current && !snapshotTitle.trim() && !snapshotContent.trim()) {
      savedRevRef.current = targetRev
      return
    }

    setStatus('saving')
    try {
      const saved: NoteView = await store.saveNote({
        id: idRef.current ?? undefined,
        title: snapshotTitle,
        content: snapshotContent
      })
      idRef.current = saved.id
      // 只前进到本次快照的版本，不覆盖飞行途中产生的新版本
      savedRevRef.current = Math.max(savedRevRef.current, targetRev)
      setStatus('saved')
      setError('')
    } catch (saveError) {
      setStatus('error')
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    }
  }, [content, store, title])

  // 防抖自动保存：title / content 任一变化就重置计时
  useEffect(() => {
    const timer = setTimeout(() => {
      void persist()
    }, AUTOSAVE_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [content, persist, title])

  const changeTitle = (next: string): void => {
    revRef.current += 1
    setTitle(next)
  }
  const changeContent = (next: string): void => {
    revRef.current += 1
    setContent(next)
  }

  /** 返回前强制落盘一次，避免防抖窗口内退出丢字 */
  const goBack = (): void => {
    void (async () => {
      await persist()
      Keyboard.dismiss()
      onBack()
    })()
  }

  const remove = (): void => {
    const id = idRef.current
    if (!id) {
      onBack()
      return
    }
    Alert.alert('删除笔记', '确定删除这条笔记？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deleteNote(id)
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除失败')
            }
            onBack()
          })()
        }
      }
    ])
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GhostButton label="返回" onPress={goBack} />
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {error || STATUS_TEXT[status]}
        </Text>
        <View style={styles.headerActions}>
          {isExisting ? <GhostButton label="删除" onPress={remove} /> : null}
          <PrimaryButton label="保存" onPress={() => void persist()} busy={status === 'saving'} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + keyboard.offset }]}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={changeTitle}
          placeholder="标题"
          placeholderTextColor={colors.textDim}
          accessibilityLabel="标题"
        />
        <TextInput
          style={styles.contentInput}
          value={content}
          onChangeText={changeContent}
          placeholder="正文…"
          placeholderTextColor={colors.textDim}
          multiline
          textAlignVertical="top"
          accessibilityLabel="正文"
        />
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  status: { flex: 1, fontSize: 11, color: colors.textDim, textAlign: 'center' },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  titleInput: {
    color: colors.textHi,
    fontSize: 20,
    fontFamily: fonts.serif,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  contentInput: {
    color: colors.textHi,
    fontSize: 15,
    lineHeight: 24,
    fontFamily: fonts.sans,
    minHeight: 320,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md
  }
})
