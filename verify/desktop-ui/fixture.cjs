/** 合成桥接：只供隔离 UI 验收，不读文件、不调用 AI、不写系统剪贴板。 */
module.exports = function createFixture() {
  const opencode = require('./opencode-fixture.cjs')()
  const conversations = Array.from({ length: 30 }, (_, index) => ({
    id: `c${index}`,
    title: `验收会话 ${index}`,
    messageCount: index === 0 ? 24 : 1,
    createdAtMs: index,
    updatedAtMs: index
  }))
  let notes = [
    { id: 'n1', title: '验收笔记甲', content: '甲笔记正文', createdAtMs: 1, updatedAtMs: 1 },
    { id: 'n2', title: '验收笔记乙', content: '乙笔记正文', createdAtMs: 2, updatedAtMs: 2 }
  ]
  const groups = [
    { id: 'g1', name: '验收分组甲' },
    { id: 'g2', name: '验收分组乙' }
  ]
  const books = groups.map((group, index) => ({
    id: `b${index}`,
    title: index === 0 ? '甲组小说' : '乙组小说',
    author: '合成作者',
    chapterCount: 1,
    coverPath: '',
    sortIndex: index,
    groupId: group.id,
    createdAtMs: 1,
    updatedAtMs: 1,
    progress: null
  }))
  const passwords = [
    {
      id: 'p1',
      title: '验收账号',
      url: 'https://example.invalid',
      account: 'synthetic',
      password: 'fixture-only',
      remark: '仅合成数据',
      firstLetter: 'Y',
      isFavorite: false,
      isDecryptable: true,
      createdAtMs: 1,
      updatedAtMs: 1
    }
  ]
  passwords.push({ ...passwords[0], id: 'p2', title: '验收账号乙', password: 'fixture-only-2' })
  const listeners = new Map()
  const subscribe = (name) => (listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(listener)
    return () => listeners.get(name).delete(listener)
  }
  const emit = (name, event) => listeners.get(name)?.forEach((listener) => listener(event))
  const copy = (value) => JSON.parse(JSON.stringify(value))
  let copied = ''
  let streamingId = 'c0'
  let failNotes = false
  let failNoteSave = false
  let noteSaveCount = 0
  let chatSendCount = 0
  let polishCount = 0
  let failPolish = false
  let failIp = false

  return {
    controls: {
      ...opencode.controls,
      delta: (text) => emit('delta', { conversationId: streamingId, delta: text }),
      removeNote: (id) => {
        notes = notes.filter((note) => note.id !== id)
      },
      failNextNotesLoad: () => {
        failNotes = true
      },
      copiedText: () => copied,
      noteSaveCount: () => noteSaveCount,
      chatSendCount: () => chatSendCount,
      polishCount: () => polishCount,
      failNextPolish: () => {
        failPolish = true
      },
      failNextIp: () => {
        failIp = true
      },
      lastNote: () => copy(notes.at(-1)),
      failNextNoteSave: () => {
        failNoteSave = true
      }
    },
    toolbox: {
      tools: {
        polishPrompt: async (text) => {
          polishCount++
          if (failPolish) {
            failPolish = false
            throw new Error('合成润色失败，请重试')
          }
          return `请清晰地执行以下合成任务：\n\n${text}`
        }
      },
      opencode: opencode.bridge,
      app: { info: async () => ({ name: '隔离验收', version: '0.2.0', platform: 'win32' }) },
      config: { get: async () => null, set: async () => null },
      settings: { get: async () => ({ activeId: null, profiles: [] }) },
      agent: { getPermission: async () => 'confirm' },
      books: {
        list: async () => copy(books),
        listChapters: async () => [{ id: 'chapter1', idx: 0, title: '合成章节', wordCount: 1000 }],
        chapterContent: async () => ({
          id: 'chapter1',
          idx: 0,
          title: '合成章节',
          content: '这是用于检查阅读器独立配色的合成正文。'.repeat(120)
        }),
        progressGet: async () => null,
        progressSave: async () => undefined
      },
      bookmarks: { list: async () => [] },
      stats: {
        summary: async () => ({
          todayDurationMs: 120000,
          totalDurationMs: 3600000,
          totalCharCount: 1000,
          recent: []
        }),
        flush: async () => undefined
      },
      groups: { list: async () => copy(groups) },
      passwords: { list: async () => copy(passwords) },
      notes: {
        list: async () => {
          if (failNotes) {
            failNotes = false
            throw new Error('合成加载失败')
          }
          return copy(notes)
        },
        save: async (input) => {
          if (failNoteSave) {
            failNoteSave = false
            throw new Error('合成保存失败')
          }
          noteSaveCount++
          const note = {
            ...input,
            id: input.id || `new-note-${noteSaveCount}`,
            createdAtMs: 1,
            updatedAtMs: 2
          }
          notes = [...notes.filter((item) => item.id !== note.id), note]
          return copy(note)
        }
      },
      system: {
        networkAddresses: async () => {
          if (failIp) {
            failIp = false
            throw new Error('合成网络读取失败')
          }
          return [
            {
              interfaceName: '合成网卡',
              family: 'IPv4',
              address: '192.0.2.10',
              netmask: '255.255.255.0'
            },
            {
              interfaceName: '合成网卡',
              family: 'IPv6',
              address: '2001:db8::10',
              netmask: 'ffff:ffff:ffff:ffff::'
            }
          ]
        },
        getShortcut: async () => ({ enabled: false, accelerator: 'Control+Shift+Space' }),
        copyText: async (text) => {
          copied = text
        }
      },
      chat: {
        listConversations: async () => copy(conversations),
        listMessages: async (id) =>
          Array.from({ length: id === 'c0' ? 24 : 1 }, (_, index) => ({
            id: `${id}-m${index}`,
            conversationId: id,
            role: index % 2 ? 'assistant' : 'user',
            content: `消息 ${index}\n` + '用于验证历史消息滚动的位置。'.repeat(24),
            createdAtMs: index
          })),
        send: async ({ conversationId, content }) => {
          chatSendCount++
          streamingId = conversationId
          return {
            conversation: copy(conversations.find((item) => item.id === conversationId)),
            userMessage: { id: 'sent', conversationId, role: 'user', content, createdAtMs: 100 }
          }
        },
        stop: async () => emit('stopped', { conversationId: streamingId }),
        onDelta: subscribe('delta'),
        onCompleted: subscribe('completed'),
        onError: subscribe('error'),
        onStopped: subscribe('stopped'),
        onToolCall: subscribe('tool-call'),
        onToolResult: subscribe('tool-result'),
        onToolApprovalRequest: subscribe('approval')
      }
    }
  }
}
