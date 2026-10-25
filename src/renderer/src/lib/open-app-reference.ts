import { parseAppTarget } from '../../../shared/app-reference'
import { useAppStore } from '../stores/app-store'
import { useTodoStore } from '../stores/todo-store'
import { confirmDialog } from '../stores/dialog-store'

let navigation = 0

async function readTarget<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw new Error('无法读取该结果，请刷新后重试', { cause: error })
  }
}

/** 只导航，不执行写操作；每次点击重新检查对象，旧异步请求不能抢走新页面。 */
export async function openAppReference(href: string): Promise<void> {
  const target = parseAppTarget(href)
  if (!target) throw new Error('此入口无效，请重新查询')
  const bridge = window.toolbox
  if (!bridge) throw new Error('桌面桥接未就绪，暂时无法打开')
  const ticket = ++navigation
  const source = useAppStore.getState()
  if (
    source.hasUnsavedChanges &&
    !(await confirmDialog('当前有未保存的编辑，打开结果将放弃这些内容。是否继续？'))
  )
    return
  const current = (): boolean =>
    ticket === navigation &&
    useAppStore.getState().view === source.view &&
    useAppStore.getState().activeConversationId === source.activeConversationId
  if (!current()) return
  if (target.kind === 'note') {
    const notes = await readTarget(() => bridge.notes.list())
    if (!current()) return
    if (!notes.some((item) => item.id === target.id)) throw new Error('该笔记已不存在，请重新搜索')
    useAppStore.setState({ notes })
    useAppStore.getState().openSearchTarget({ kind: 'note', id: target.id })
  } else if (target.kind === 'group') {
    const groups = await readTarget(() => bridge.groups.list())
    if (!current()) return
    if (!groups.some((item) => item.id === target.id)) throw new Error('该分组已不存在，请重新搜索')
    useAppStore.setState({ groups })
    useAppStore.getState().openSearchTarget({ kind: 'group', id: target.id })
  } else if (target.kind === 'todo') {
    const result = await readTarget(() =>
      bridge.todos.list({
        focusId: target.id,
        filter: 'all',
        search: '',
        offset: 0,
        limit: 1
      })
    )
    if (!current()) return
    if (!result.items.length) throw new Error('该待办已不存在，请重新查询')
    useTodoStore.getState().open(target.id)
    useAppStore.getState().setView('todos')
  } else if (target.kind === 'usage') {
    useAppStore.setState({ view: 'agent-usage', usageTarget: target.query, searchTarget: null })
  } else {
    const books = await readTarget(() => bridge.books.list())
    if (!current()) return
    if (!books.some((item) => item.id === target.id)) throw new Error('该书籍已不存在，请重新搜索')
    if (target.kind === 'chapter') {
      const chapters = await readTarget(() => bridge.books.listChapters(target.id))
      if (!current()) return
      if (!chapters.some((item) => item.idx === target.chapterIdx))
        throw new Error('该章节已不存在，请重新查询目录')
    }
    useAppStore.setState({ books })
    useAppStore
      .getState()
      .openReader(target.id, target.kind === 'chapter' ? target.chapterIdx : undefined)
  }
}
