/** 合成桥接：只供隔离 UI 验收，不读文件、不调用 AI、不写系统剪贴板。 */
module.exports = function createFixture() {
  let failPorts = false
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
  let kbDocuments = [
    {
      id: 'doc1',
      title: '验收资料甲',
      category: 'work',
      fileName: '验收资料甲.md',
      fileSize: 2048,
      status: 'ready',
      chunkCount: 2,
      embeddedChunkCount: 0,
      error: '',
      createdAtMs: 1,
      updatedAtMs: 2
    },
    {
      id: 'doc2',
      title: '验收资料乙',
      category: 'personal',
      fileName: '验收资料乙.txt',
      fileSize: 1024,
      status: 'failed',
      chunkCount: 0,
      embeddedChunkCount: 0,
      error: '合成索引失败',
      createdAtMs: 1,
      updatedAtMs: 3
    }
  ]
  let kbImportCount = 0
  /** 设置页模型字段验收专用档案；默认空列表，不影响其他场景。 */
  let settingsProfiles =
    process.env.TOOLBOX_MODEL_SETTINGS_VERIFY === '1'
      ? [
          {
            id: 'profile1',
            name: '验收配置',
            provider: 'custom',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-6-luna',
            hasApiKey: true,
            selectedModels: ['gpt-6-luna'],
            embeddingModel: '',
            rerankModel: ''
          }
        ]
      : []
  let activeSettingsId = settingsProfiles[0]?.id ?? null
  const settingsBridge = {
    get: async () => ({ activeId: activeSettingsId, profiles: copy(settingsProfiles) }),
    save: async (input) => {
      const existing = input.id
        ? settingsProfiles.find((item) => item.id === input.id)
        : undefined
      const profile = {
        id: existing?.id ?? `profile-${settingsProfiles.length + 1}`,
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        hasApiKey: existing?.hasApiKey ?? true,
        selectedModels: input.selectedModels ?? existing?.selectedModels ?? [],
        embeddingModel: input.embeddingModel ?? existing?.embeddingModel ?? '',
        rerankModel: input.rerankModel ?? existing?.rerankModel ?? ''
      }
      settingsProfiles = existing
        ? settingsProfiles.map((item) => (item.id === profile.id ? profile : item))
        : [...settingsProfiles, profile]
      activeSettingsId = activeSettingsId ?? profile.id
      return { activeId: activeSettingsId, profiles: copy(settingsProfiles) }
    },
    activate: async (id) => {
      activeSettingsId = id
      return { activeId: activeSettingsId, profiles: copy(settingsProfiles) }
    },
    remove: async (id) => {
      settingsProfiles = settingsProfiles.filter((item) => item.id !== id)
      if (activeSettingsId === id) activeSettingsId = settingsProfiles[0]?.id ?? null
      return { activeId: activeSettingsId, profiles: copy(settingsProfiles) }
    },
    fetchModels: async () => ({ models: ['gpt-6-luna'], source: 'preset' })
  }
  const kbChunk = {
    id: 'chunk1',
    ordinal: 0,
    heading: '部署 > 回滚',
    charCount: 24,
    startOffset: 0,
    preview: '数据库回滚要先恢复备份。'
  }
  const kbHit = {
    chunkId: 'chunk1',
    documentId: 'doc1',
    documentTitle: '验收资料甲',
    category: 'work',
    heading: '部署 > 回滚',
    ordinal: 0,
    charCount: 24,
    content: '数据库回滚要先恢复备份。',
    startOffset: 0,
    score: -0.001
  }
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
  let failPublicIp = false
  let holdAi = false
  let pendingAi = null
  const waitForAi = (kind, requestId) =>
    new Promise((resolve, reject) => {
      holdAi = false
      pendingAi = { kind, requestId, resolve, reject }
    })

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
      holdNextAi: () => {
        holdAi = true
      },
      pendingAiId: () => pendingAi?.requestId,
      aiDelta: (delta) => {
        if (pendingAi)
          emit('ai-output', { kind: 'prompt-polish', requestId: pendingAi.requestId, delta })
      },
      aiPasswordPreview: (entries) => {
        if (pendingAi)
          emit('ai-output', {
            kind: 'password-import',
            requestId: pendingAi.requestId,
            receivedChars: 80,
            entries
          })
      },
      finishAi: (value) => {
        const pending = pendingAi
        pendingAi = null
        pending?.resolve(value)
      },
      failAi: () => {
        const pending = pendingAi
        pendingAi = null
        pending?.reject(new Error('合成生成失败'))
      },
      failNextPolish: () => {
        failPolish = true
      },
      failNextIp: () => {
        failIp = true
      },
      failNextPublicIp: () => {
        failPublicIp = true
      },
      failNextPorts: () => { failPorts = true },
      lastNote: () => copy(notes.at(-1)),
      failNextNoteSave: () => {
        failNoteSave = true
      },
      kbImportCount: () => kbImportCount
    },
    toolbox: {
      tools: {
        inspectCertificate: async (text) => {
          if (text.includes('PRIVATE KEY')) throw new Error('检测到私钥')
          try {
            const cert = new (require('node:crypto').X509Certificate)(
              text.includes('BEGIN CERTIFICATE') ? text : require('node:buffer').Buffer.from(text, 'base64'))
            return [{ subject: cert.subject, issuer: cert.issuer, subjectAltName: cert.subjectAltName || '',
              serialNumber: cert.serialNumber, validFrom: new Date(cert.validFrom).toISOString(), validTo: new Date(cert.validTo).toISOString(),
              fingerprint256: cert.fingerprint256, publicKey: cert.publicKey.asymmetricKeyType, ca: cert.ca }]
          } catch { throw new Error('无法解析证书') }
        },
        polishPrompt: async (text, requestId) => {
          polishCount++
          if (failPolish) {
            failPolish = false
            throw new Error('合成润色失败，请重试')
          }
          if (holdAi) return waitForAi('prompt-polish', requestId)
          const output = `请清晰地执行以下合成任务：\n\n${text}`
          emit('ai-output', { kind: 'prompt-polish', requestId, delta: output })
          return output
        },
        onAiOutput: subscribe('ai-output'),
        stopAi: async (requestId) => {
          if (pendingAi?.requestId === requestId) {
            const pending = pendingAi
            pendingAi = null
            pending.reject(new Error('已停止生成，未完成的结果未采用'))
          }
        }
      },
      opencode: opencode.bridge,
      app: { info: async () => ({ name: '隔离验收', version: '0.3.0', platform: 'win32' }) },
      config: { get: async () => null, set: async () => null },
      settings: settingsBridge,
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
      groups: {
        list: async () => copy(groups),
        create: async (name) => {
          const group = { id: `group-${groups.length + 1}`, name }
          groups.unshift(group)
          return copy(group)
        }
      },
      passwords: {
        list: async () => copy(passwords),
        importAi: async (requestId) => (holdAi ? waitForAi('password-import', requestId) : []),
        importSave: async (drafts) => drafts.length
      },
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
      knowledge: {
        list: async (input) =>
          copy(
            input?.category
              ? kbDocuments.filter((item) => item.category === input.category)
              : kbDocuments
          ),
        importFiles: async () => {
          kbImportCount++
          return {
            imported: [copy(kbDocuments[0])],
            skipped: [{ path: 'C:\\合成\\手册.pdf', reason: '仅支持 .md / .txt 文件' }]
          }
        },
        reindex: async (id) => {
          const document = kbDocuments.find((item) => item.id === id)
          if (!document) throw new Error('资料不存在，请刷新列表')
          const updated = { ...document, status: 'ready', chunkCount: 2, embeddedChunkCount: 0, error: '', updatedAtMs: 4 }
          kbDocuments = kbDocuments.map((item) => (item.id === id ? updated : item))
          return copy(updated)
        },
        remove: async (id) => {
          kbDocuments = kbDocuments.filter((item) => item.id !== id)
        },
        search: async ({ query, category }) => {
          const hits = category && category !== 'work' ? [] : [copy(kbHit)]
          return {
            query,
            mode: 'keyword',
            hits: query.trim() ? hits : [],
            degraded: 'no-embedding',
            message: '未配置向量模型，本次仅使用关键词检索。',
            rerank: 'off',
            keywordCount: hits.length,
            semanticCount: 0,
            totalChars: hits.length * kbHit.charCount,
            dropped: 0
          }
        },
        document: async (id, chunkId) => {
          const document = kbDocuments.find((item) => item.id === id)
          if (!document) throw new Error('资料不存在，请刷新列表')
          return {
            document: copy(document),
            sourcePath: `C:\\合成\\${document.fileName}`,
            chunks: document.status === 'failed' ? [] : [copy(kbChunk)],
            focusChunkId: chunkId === kbChunk.id ? chunkId : null
          }
        },
        onProgress: subscribe('kb-progress')
      },
      system: {
        portProcesses: async () => {
          if (failPorts) { failPorts = false; throw new Error('合成端口查询失败') }
          return { capturedAt: new Date().toISOString(), total: 3, processNamesAvailable: true, entries: [
            { protocol: 'TCP', address: '::', port: 8080, remote: '[::]:0', state: 'LISTENING', pid: 1200, processName: 'java' },
            { protocol: 'UDP', address: '0.0.0.0', port: 5353, remote: '', state: 'BOUND', pid: 1300, processName: 'dns-fixture' },
            { protocol: 'TCP', address: '127.0.0.1', port: 53000, remote: '192.0.2.1:443', state: 'ESTABLISHED', pid: 1400, processName: 'client-fixture' }
          ] }
        },
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
        publicIp: async () => {
          if (failPublicIp) {
            failPublicIp = false
            throw new Error('公网 IP 查询失败，请检查网络或代理后重试')
          }
          return {
            ipv4: { address: '203.0.113.45', family: 'IPv4', source: '合成服务' },
            ipv6: { address: '2001:db8::45', family: 'IPv6', source: '合成服务' },
            checkedAt: new Date().toISOString()
          }
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
        context: async (conversationId) => ({
          conversationId,
          model: 'fixture-model',
          windowTokens: 128_000,
          windowSource: 'api',
          thresholdTokens: 102_400,
          estimatedTokens: conversationId === 'c0' ? 54_000 : 1_200,
          percent: conversationId === 'c0' ? 42 : 1,
          breakdown: {
            system: 2_100,
            tools: 4_800,
            summary: 0,
            messages: conversationId === 'c0' ? 47_100 : 1_200
          },
          lastUsage: null,
          checkpoint: null,
          autoCompact: true,
          compacting: false,
          messageCount: conversationId === 'c0' ? 24 : 1
        }),
        compact: async () => ({
          compacted: false,
          coveredMessages: 0,
          freedTokens: 0,
          message: '对话还短，无需压缩'
        }),
        onContext: subscribe('context'),
        onCompaction: subscribe('compaction'),
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
