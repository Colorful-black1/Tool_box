const { ipcMain } = require('electron')

/** 真实工具／审批／临时 SQLite，模型返回由验收脚本替代，不访问用户来源。 */
module.exports = function registerChatTools(api, store, todos) {
  const conversation = store.listConversations()[0] ?? store.createConversation('对话工具验收')
  if (!store.listNotes().length) {
    store.saveNote({ title: '发布笔记', content: '第一段\n启动命令 old\n保留末尾' })
    const group = store.createGroup('发布分组')
    const book = store.importBook({
      title: '发布故事',
      author: '合成作者',
      chapters: [
        { title: '第一章', body: '第一章合成正文' },
        { title: '第二章', body: '第二章合成正文' }
      ]
    })
    store.setBooksGroup([book.id], group.id)
  }
  const definitions = api.createAgentToolSet({
    store,
    todos,
    importService: {},
    usage: {
      query: async (query) => api.usageReport([], [], 1, query)
    }
  })
  const pending = new Map()
  const send = (event, channel, value) =>
    event.sender.send(channel, { conversationId: conversation.id, ...value })
  ipcMain.handle('verify:chat:conversations', () => store.listConversations())
  ipcMain.handle('verify:chat:messages', (_event, id) => store.listMessages(id))
  ipcMain.handle('verify:chat:notes', () => store.listNotes())
  ipcMain.handle('verify:chat:books', () => store.listBooks())
  ipcMain.handle('verify:chat:groups', () => store.listGroups())
  ipcMain.handle('verify:chat:chapters', (_event, id) => store.listChapters(id))
  ipcMain.handle('verify:chat:chapter', (_event, id) => store.chapterContent(id))
  ipcMain.handle('verify:chat:progress', (_event, id) => store.progressGet(id))
  ipcMain.handle('verify:chat:bookmarks', (_event, id) => store.listBookmarks(id))
  ipcMain.handle('verify:chat:note-delete', (_event, id) => store.deleteNote(id))
  ipcMain.handle('verify:chat:approve', (_event, input) => {
    pending.get(input.callId)?.(input.approved)
    pending.delete(input.callId)
  })
  ipcMain.handle('verify:chat:tool', async (event, name, input, permission = 'confirm') => {
    const references = []
    const definition = definitions.find((item) => item.name === name)
    if (!definition) throw new Error('无此合成工具')
    const [tool] = api.buildLangChainTools([definition], permission, {
      conversationId: conversation.id,
      addReferences: (items) => references.push(...items),
      notifyToolCall: (value) => send(event, 'chat:event:tool-call', value),
      notifyToolResult: (value) => send(event, 'chat:event:tool-result', value),
      requestApproval: (value) =>
        new Promise((resolve) => {
          pending.set(value.callId, resolve)
          send(event, 'chat:event:tool-approval', value)
        })
    })
    const result = await tool.invoke(input)
    const content = `合成工具已返回结果。\n\n${references.map((item) => `- ${api.referenceMarkdown(item)}`).join('\n')}`
    const message = store.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content
    })
    send(event, 'chat:event:completed', { message, conversation: store.listConversations()[0] })
    return result
  })
}
