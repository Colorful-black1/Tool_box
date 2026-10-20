/**
 * 会话详情：消息流 + 输入框 + 停止。
 *
 * 流式期间的显示策略：
 * - 增量文本放在 `streaming` 本地状态里，不落库（与桌面端语义一致：只有成功才落库）；
 * - 收到 completed / stopped / error 后重新从 store 拉一次消息，以库为准；
 * - 因此即使中途杀进程，也不会留下半截的 assistant 消息。
 *
 * 输入框的键盘避让用 `useKeyboardInset()` 而不是 `KeyboardAvoidingView`：
 * 后者在 Android 上是否生效取决于宿主 App 的 `windowSoftInputMode`，
 * Expo Go 不是 `adjustResize`，于是 `behavior="padding"` 完全不起作用，
 * 输入框被键盘整块盖住。详见 `ui/keyboard.ts` 的说明。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { Clipboard } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

import { useServices } from '../../runtime/services'
import { PrimaryButton } from '../../components/ui'
import { MarkdownView } from '../../components/markdown'
import { useKeyboardInset } from '../keyboard'
import { getAgentPermission } from '../../agent/permission'
import type { ChatEventSink } from '../../ai/ai-gateway'
import type { AgentPermission, ChatMessage } from '../../shared-bridge'
import { AGENT_PERMISSION_LABELS, DEFAULT_AGENT_PERMISSION } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'
import { ApprovalCard } from './approval-card'
import type { PendingApprovalView } from './approval-card'
import { ModelPickerSheet } from './model-picker-sheet'
import { ToolCallList } from './tool-call-list'
import type { ToolCallView } from './tool-call-list'

interface Props {
  conversationId: string
  onBack: () => void
}

export function ChatDetailScreen({ conversationId, onBack }: Props): ReactNode {
  const { store, gateway, aiSettings } = useServices()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [toolCalls, setToolCalls] = useState<ToolCallView[]>([])
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalView | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [permission, setPermission] = useState<AgentPermission>(DEFAULT_AGENT_PERMISSION)
  const [model, setModel] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const listRef = useRef<FlatList<ChatMessage> | null>(null)
  /**
   * 是否贴着底部。
   *
   * 用户往回翻历史时必须停止自动滚底，否则新内容会把正在看的内容顶走；
   * 这时用「回到最新」按钮把用户带回去。
   */
  const stickToBottom = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const keyboard = useKeyboardInset()

  const streamingNow = sending || streaming.length > 0

  const reload = useCallback(async (): Promise<void> => {
    try {
      setMessages(await store.listMessages(conversationId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取消息失败')
    }
  }, [conversationId, store])

  useEffect(() => {
    void reload()
  }, [reload])

  // 顶部显示当前权限档位：AI 拒绝写操作时，用户能立刻明白是档位限制
  useEffect(() => {
    void (async () => {
      try {
        setPermission(await getAgentPermission(store))
      } catch {
        // 读不到就保持默认档位展示，不值得打断对话页
      }
    })()
  }, [store])

  // 当前档案用的模型：显示在输入框上方，点一下就能换
  useEffect(() => {
    void (async () => {
      try {
        const view = await aiSettings.getView()
        const active = view.profiles.find((item) => item.id === view.activeId)
        setModel(active?.model ?? '')
      } catch {
        // 读不到就不显示模型名，不影响对话
      }
    })()
  }, [aiSettings])

  /**
   * 离开会话时拒绝挂起的审批。
   *
   * 审批卡随页面一起消失，用户再也点不到「允许 / 拒绝」；不主动 settle 的话
   * 工具节点会永远挂着，该会话的流永远不结束（下一轮请求也发不出去）。
   * 刻意不用 `stop()`：那会中断请求，把用户还想看的正文一起打断。
   */
  useEffect(() => {
    return () => gateway.cancelApprovals(conversationId)
  }, [conversationId, gateway])

  // 增量或工具卡片有变化就滚到底部，让用户始终看到最新内容；
  // 但用户主动往回翻时不再抢滚动位置
  useEffect(() => {
    if (!streaming && toolCalls.length === 0) return
    if (!stickToBottom.current) return
    listRef.current?.scrollToEnd({ animated: true })
  }, [streaming, toolCalls.length])

  const send = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || streamingNow) return

    setError('')
    setNotice('')
    setToolCalls([])
    setPendingApproval(null)
    setSending(true)
    setDraft('')

    /** 三种结束方式（完成 / 出错 / 停止）的公共清理 */
    const settle = (): void => {
      setStreaming('')
      setSending(false)
      setPendingApproval(null)
    }

    const sink: ChatEventSink = {
      onDelta: (event) => setStreaming((prev) => prev + event.delta),
      onToolCall: (event) =>
        setToolCalls((prev) => [
          ...prev,
          { callId: event.callId, name: event.name, args: event.args, status: 'running' }
        ]),
      onToolResult: (event) =>
        setToolCalls((prev) =>
          prev.map((call) =>
            call.callId === event.callId
              ? { ...call, status: event.ok ? 'ok' : 'error', summary: event.summary }
              : call
          )
        ),
      onToolApprovalRequest: (event) =>
        setPendingApproval({
          callId: event.callId,
          name: event.name,
          args: event.args,
          risk: event.risk === 'destructive' ? 'destructive' : 'write'
        }),
      onNotice: (message) => setNotice(message),
      onCompleted: () => {
        settle()
        void reload()
      },
      onError: (event) => {
        settle()
        setError(event.message)
        void reload()
      },
      onStopped: () => {
        settle()
        void reload()
      }
    }

    try {
      await gateway.send(conversationId, content, sink)
      // send 只负责落库 user 消息并立即返回，assistant 内容走 sink
      await reload()
    } catch (sendError) {
      setSending(false)
      setError(sendError instanceof Error ? sendError.message : '发送失败')
      setDraft(content)
    }
  }

  const stop = (): void => gateway.stop(conversationId)

  /** 切换模型：写回当前档案，下一轮对话就用新模型 */
  const selectModel = async (next: string): Promise<void> => {
    setModel(next)
    try {
      const view = await aiSettings.getView()
      const active = view.profiles.find((item) => item.id === view.activeId)
      if (!active) return
      await aiSettings.save({
        id: active.id,
        name: active.name,
        provider: active.provider,
        baseUrl: active.baseUrl,
        model: next,
        // 勾选清单原样带回：换模型不该动用户在设置里选好的那批
        selectedModels: active.selectedModels
      })
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : '切换模型失败')
    }
  }

  /** 记录是否还贴着底部：离底超过一屏就认为用户在看历史 */
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distance = contentSize.height - contentOffset.y - layoutMeasurement.height
    const atBottom = distance < 80
    if (atBottom === stickToBottom.current) return
    stickToBottom.current = atBottom
    setShowJumpButton(!atBottom)
  }

  /** 「回到最新」：重新贴底并恢复自动滚动 */
  const jumpToLatest = (): void => {
    stickToBottom.current = true
    setShowJumpButton(false)
    listRef.current?.scrollToEnd({ animated: true })
  }

  /** 审批回执：先收起卡片，再通知主进程放行 / 拒绝 */
  const respondApproval = (approved: boolean): void => {
    const pending = pendingApproval
    setPendingApproval(null)
    if (!pending) return
    gateway.approveTool({ conversationId, callId: pending.callId, approved })
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
          onPress={() => {
            Keyboard.dismiss()
            onBack()
          }}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ 会话</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Text style={styles.permission}>{AGENT_PERMISSION_LABELS[permission]}</Text>
          {streamingNow ? (
            <Pressable accessibilityRole="button" onPress={stop} style={styles.stop}>
              <Text style={styles.stopText}>■ 停止</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={120}
        onScroll={handleScroll}
        onContentSizeChange={() => {
          if (messages.length === 0) return
          if (!stickToBottom.current) return
          listRef.current?.scrollToEnd({ animated: false })
        }}
        ListEmptyComponent={
          messages.length === 0 && !streaming && toolCalls.length === 0 ? (
            <Text style={styles.empty}>试试让 AI 帮你查书架、整理记事本或找密码条目</Text>
          ) : null
        }
        renderItem={({ item }) => <Bubble message={item} />}
        ListFooterComponent={
          <View style={styles.footer}>
            {/* 顺序与桌面端一致：消息 → 工具卡片 → 正在流式的正文 */}
            <ToolCallList calls={toolCalls} />
            {streaming ? (
              <View style={[styles.bubble, styles.bubbleAssistant]}>
                <Text style={styles.bubbleText}>{streaming}</Text>
                <Text style={styles.cursor}>▍</Text>
              </View>
            ) : null}
          </View>
        }
      />

      {pendingApproval ? (
        <ApprovalCard approval={pendingApproval} onRespond={respondApproval} />
      ) : null}

      {showJumpButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新消息"
          onPress={jumpToLatest}
          style={styles.jumpButton}
        >
          <Text style={styles.jumpText}>↓ 回到最新</Text>
        </Pressable>
      ) : null}

      {/*
        模型入口：放在输入框上方（与桌面端把模型下拉放在输入框旁一致），
        不塞进页头 —— 页头已经有权限档位和停止按钮，再加一项会很挤。
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="切换模型"
        onPress={() => setModelOpen(true)}
        style={styles.modelRow}
      >
        <Text style={styles.modelLabel}>模型</Text>
        <Text style={styles.modelValue} numberOfLines={1}>
          {model || '未选择'}
        </Text>
        <Text style={styles.modelCaret}>▾</Text>
      </Pressable>

      <ModelPickerSheet
        visible={modelOpen}
        current={model}
        onClose={() => setModelOpen(false)}
        onSelect={(next) => void selectModel(next)}
      />

      {/*
        输入区整体上移键盘高度。
        `offset` 已经是「扣除宿主自动缩放后仍需避让的净高度」，
        所以 adjustResize 与 adjustPan 两种宿主下都不会重复避让或漏避让。
      */}
      <View style={[styles.composerWrap, { marginBottom: keyboard.offset }]}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={streamingNow ? '正在生成…' : '输入消息'}
            placeholderTextColor={colors.textDim}
            multiline
            editable={!streamingNow}
            accessibilityLabel="消息输入框"
          />
          <PrimaryButton
            label={streamingNow ? '生成中' : '发送'}
            onPress={() => void send()}
            disabled={streamingNow || draft.trim().length === 0}
          />
        </View>
      </View>
    </View>
  )
}

function Bubble({ message }: { message: ChatMessage }): ReactNode {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = (): void => {
    // 剪贴板用 react-native core 的 Clipboard：它已被标记 @deprecated，
    // 但换库要新增第三方依赖（未授权），密码箱那边也是同一个用法。
    Clipboard.setString(message.content)
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      {isUser ? (
        <Text style={styles.bubbleText}>{message.content}</Text>
      ) : message.content.trim() ? (
        // 只有已落库的完整回答才按 Markdown 渲染；
        // 流式过程用纯文本，避免半截语法（未闭合的 ``` ）来回闪烁
        <MarkdownView source={message.content} />
      ) : (
        <Text style={styles.bubbleText}>（空回复）</Text>
      )}
      <View style={styles.bubbleFooter}>
        <Text style={styles.bubbleTime}>{formatTime(message.createdAtMs)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="复制消息"
          hitSlop={8}
          onPress={copy}
        >
          <Text style={styles.bubbleCopy}>{copied ? '已复制' : '复制'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** 消息时间戳：只到分钟，跨天由日期分组负责 */
function formatTime(createdAtMs: number): string {
  const date = new Date(createdAtMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm
  },
  back: { paddingVertical: 4, paddingRight: spacing.md },
  backText: { color: colors.gold, fontSize: 14, fontFamily: fonts.sans },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  permission: { color: colors.textDim, fontSize: 11 },
  stop: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 158, 199, 0.4)'
  },
  stopText: { color: colors.danger, fontSize: 12, fontFamily: fonts.sans },
  error: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    lineHeight: 17
  },
  notice: {
    color: colors.textDim,
    fontSize: 11,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    lineHeight: 16
  },
  list: { padding: spacing.lg, gap: spacing.sm },
  // 列表尾部：工具卡片与流式正文之间也要有间距（contentContainer 的 gap 管不到这里）
  footer: { gap: spacing.sm },
  empty: { color: colors.textDim, fontSize: 12, textAlign: 'center', paddingVertical: spacing.xxl },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: 'rgba(232, 201, 138, 0.14)' },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.bgPanelSolid },
  bubbleText: { color: colors.textHi, fontSize: 14, lineHeight: 21, fontFamily: fonts.sans },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: 4
  },
  bubbleTime: { color: colors.textDim, fontSize: 10, fontFamily: fonts.mono },
  bubbleCopy: { color: colors.textDim, fontSize: 10, fontFamily: fonts.sans },
  jumpButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 96,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.goldLine,
    backgroundColor: colors.bgPanelSolid
  },
  jumpText: { color: colors.gold, fontSize: 11, fontFamily: fonts.sans },
  cursor: { color: colors.gold, fontSize: 12 },
  // 外层只负责挂 marginBottom，内容样式留给 composer，两层职责分开
  composerWrap: { backgroundColor: colors.bgPanelSolid },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgPanelSolid,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft
  },
  modelLabel: { color: colors.textDim, fontSize: 11 },
  modelValue: { flex: 1, color: colors.gold, fontSize: 12, fontFamily: fonts.mono },
  modelCaret: { color: colors.textDim, fontSize: 11 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    backgroundColor: colors.bgPanelSolid
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textHi,
    fontSize: 14,
    fontFamily: fonts.sans
  }
})
