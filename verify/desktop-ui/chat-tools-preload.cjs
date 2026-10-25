/** 仅隔离验收进程可用；产品 preload 没有这些辅助接口。 */
module.exports = function chatToolsPreload(fixture, ipc) {
  const invoke =
    (channel) =>
    (...args) =>
      ipc.invoke(`verify:chat:${channel}`, ...args)
  const subscribe = (channel) => (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipc.on(`chat:event:${channel}`, wrapped)
    return () => ipc.removeListener(`chat:event:${channel}`, wrapped)
  }
  Object.assign(fixture.toolbox.chat, {
    listConversations: invoke('conversations'),
    listMessages: invoke('messages'),
    onCompleted: subscribe('completed'),
    onToolCall: subscribe('tool-call'),
    onToolResult: subscribe('tool-result'),
    onToolApprovalRequest: subscribe('tool-approval'),
    approveTool: invoke('approve')
  })
  fixture.toolbox.notes.list = invoke('notes')
  fixture.toolbox.groups.list = invoke('groups')
  Object.assign(fixture.toolbox.books, {
    list: invoke('books'),
    listChapters: invoke('chapters'),
    chapterContent: invoke('chapter'),
    progressGet: invoke('progress')
  })
  fixture.toolbox.bookmarks.list = invoke('bookmarks')
  fixture.controls.callChatTool = invoke('tool')
  fixture.controls.removeChatNote = invoke('note-delete')
}
