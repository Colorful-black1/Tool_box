export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  conversationList: 'conversation:list',
  conversationCreate: 'conversation:create',
  conversationRename: 'conversation:rename',
  conversationDelete: 'conversation:delete',
  messageList: 'message:list',
  chatSend: 'chat:send',
  chatStop: 'chat:stop',
  booksList: 'books:list',
  booksImport: 'books:import',
  booksChapters: 'books:chapters',
  booksChapterContent: 'books:chapter-content',
  booksProgressGet: 'books:progress:get',
  booksProgressSave: 'books:progress:save',
  booksDelete: 'books:delete',
  passwordList: 'password:list',
  passwordSave: 'password:save',
  passwordDelete: 'password:delete',
  passwordSetFavorite: 'password:set-favorite',
  passwordImport: 'password:import',
  notesList: 'notes:list',
  notesSave: 'notes:save',
  notesDelete: 'notes:delete',
  notesImport: 'notes:import',
  notesExport: 'notes:export',
  systemCopy: 'system:copy'
} as const

export const CHAT_EVENT = {
  delta: 'chat:event:delta',
  completed: 'chat:event:completed',
  error: 'chat:event:error',
  stopped: 'chat:event:stopped'
} as const
