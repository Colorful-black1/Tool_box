import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AIMessageChunk } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'

import { CHAT_TIMEOUT_MS, CONVERSATION_TITLE_MAX_CHARS, DEFAULT_CONVERSATION_TITLE } from '../../../shared/constants'
import type {
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ConversationSummary
} from '../../../shared/types'
import { validateChatInput } from './errors'
import { AiGatewayError, describeAiError, normalizeOpenAiBaseUrl } from './errors'
import type { SettingsService } from '../settings/settings-service'
import type { ToolboxStore } from '../chat-store/chat-store'

export interface ChatEventSink {
  onDelta(event: ChatDeltaEvent): void
  onCompleted(event: ChatCompletedEvent): void
  onError(event: ChatErrorEvent): void
  onStopped(event: ChatStoppedEvent): void
}

export class AiGateway {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly settings: SettingsService,
    private readonly chatStore: ToolboxStore
  ) {}

  async send(
    request: ChatSendRequest,
    sink: ChatEventSink
  ): Promise<ChatSendResult> {
    const conversationId = request.conversationId
    if (this.active.has(conversationId)) {
      throw new AiGatewayError('该会话正在生成回复，请先停止或稍候')
    }

    const content = validateChatInput(request.content)
    const conversation = this.requireConversation(conversationId)
    const config = await this.settings.getAiConfig()

    const userMessage = this.chatStore.appendMessage({
      conversationId,
      role: 'user',
      content
    })

    const updatedConversation = this.autoTitle(conversation, content)
    const history = this.chatStore.listMessages(conversationId)
    const controller = new AbortController()
    this.active.set(conversationId, controller)

    void this.streamResponse({
      conversationId,
      history,
      config,
      controller,
      sink
    })

    return {
      userMessage,
      conversation: updatedConversation
    }
  }

  stop(conversationId: string): void {
    this.active.get(conversationId)?.abort()
  }

  /** 非流式一次性对话：供密码箱 AI 识别等内部工具复用同一份配置与错误映射 */
  async complete(system: string, user: string): Promise<string> {
    const content = validateChatInput(user)
    const config = await this.settings.getAiConfig()
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      timeout: CHAT_TIMEOUT_MS,
      maxRetries: 1,
      configuration: { baseURL: normalizeOpenAiBaseUrl(config.baseUrl) }
    })

    try {
      const reply = await model.invoke([
        new SystemMessage(system),
        new HumanMessage(content)
      ])
      const text = typeof reply.content === 'string' ? reply.content : ''
      if (!text.trim()) throw new AiGatewayError('AI 未返回内容')
      return text
    } catch (error) {
      if (error instanceof AiGatewayError) throw error
      throw new AiGatewayError(describeAiError(error, config.apiKey), error)
    }
  }

  private async streamResponse(input: {
    conversationId: string
    history: ChatMessage[]
    config: {
      baseUrl: string
      model: string
      apiKey: string
    }
    controller: AbortController
    sink: ChatEventSink
  }): Promise<void> {
    const { conversationId, history, config, controller, sink } = input
    let fullContent = ''

    try {
      const model = new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: 0.7,
        timeout: CHAT_TIMEOUT_MS,
        maxRetries: 1,
        configuration: {
          baseURL: normalizeOpenAiBaseUrl(config.baseUrl)
        }
      })

      const stream = await model.stream(toLangChainMessages(history), {
        signal: controller.signal
      })

      for await (const chunk of stream) {
        const delta = extractDelta(chunk)
        if (!delta) continue
        fullContent += delta
        sink.onDelta({ conversationId, delta })
      }

      if (!fullContent.trim()) {
        throw new AiGatewayError('AI 未返回内容')
      }

      const assistantMessage = this.chatStore.appendMessage({
        conversationId,
        role: 'assistant',
        content: fullContent
      })
      const conversation = this.requireConversation(conversationId)
      sink.onCompleted({ conversationId, message: assistantMessage, conversation })
    } catch (error) {
      if (controller.signal.aborted) {
        sink.onStopped({ conversationId })
      } else {
        sink.onError({
          conversationId,
          message: describeAiError(error, config.apiKey)
        })
      }
    } finally {
      this.active.delete(conversationId)
    }
  }

  private autoTitle(
    conversation: ConversationSummary,
    content: string
  ): ConversationSummary {
    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return conversation

    const title =
      content.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX_CHARS) ||
      DEFAULT_CONVERSATION_TITLE
    return this.chatStore.renameConversation(conversation.id, title)
  }

  private requireConversation(conversationId: string): ConversationSummary {
    const conversation = this.chatStore.getConversation(conversationId)
    if (!conversation) throw new AiGatewayError('会话不存在')
    return conversation
  }
}

function toLangChainMessages(messages: ChatMessage[]) {
  return messages.map((message) =>
    message.role === 'user'
      ? new HumanMessage(message.content)
      : new AIMessage(message.content)
  )
}

function extractDelta(chunk: AIMessageChunk): string {
  const content = chunk.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part === 'object' && part !== null && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}
